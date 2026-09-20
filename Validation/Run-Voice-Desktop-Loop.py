"""Opt-in real WAV -> local STT -> Codex -> Windows player -> save/load check.

Only owned processes and isolated saves are used. Supplied WAVs must say
'Put a table in front of me with two chairs' and 'Make this twice as big'.
This does NOT test a headset microphone, controllers or wearer-visible UI.
"""
import argparse
import base64
import copy
import datetime
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("desktop_base", Path(__file__).with_name("Run-Composition-Desktop-Loop.py"))
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


def run(args):
    report = {"startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "status": "failed",
              "scope": "Supplied WAV recordings, real local STT and Codex, actual Windows player, isolated PC saves",
              "headsetMicrophoneTested": False, "controllerInputTested": False, "wearerVisualCheck": False,
              "audioSource": "Windows speech synthesis; not a microphone recording" if args.synthetic_audio else "Supplied WAV; capture source not asserted",
              "audioSha256": [hashlib.sha256(path.read_bytes()).hexdigest() for path in (args.audio, args.edit_audio)],
              "checks": [], "voiceSteps": []}
    workspace = Path(tempfile.mkdtemp(prefix="matrix-voice-desktop-"))
    service = player = None
    log = (workspace / "service.log").open("wb")

    def check(condition, label):
        report["checks"].append({"name": label, "passed": bool(condition)})
        if not condition:
            raise RuntimeError(label)

    def request(path, body=None):
        data = None if body is None else json.dumps(body).encode()
        with urllib.request.urlopen(urllib.request.Request(url + path, data=data, headers={"Content-Type": "application/json"}), timeout=15) as response:
            return json.load(response)

    def await_idle():
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            state = request("/api/state")
            if state["online"] and state["pendingCount"] == 0:
                return state
            time.sleep(.2)
        raise RuntimeError("Runtime did not become idle")

    def confirm(result):
        ids = {command["requestId"] for command in result["commands"]}
        state = await_idle()
        replies = {item["requestId"]: item for item in state["results"]}
        check(all(key in replies and replies[key]["ok"] for key in ids), "Actual Windows player acknowledged all queued commands")
        return state

    def voice(audio_path):
        before = await_idle()
        submitted = request("/api/voice", {"clientId": before["clientId"], "snapshot": before["snapshot"],
                                           "audioBase64": base64.b64encode(audio_path.read_bytes()).decode()})
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            job = request("/api/voice/" + submitted["jobId"])
            if job["phase"] in ("ready", "error", "needs_clarification"):
                break
            time.sleep(.3)
        check(job.get("phase") == "ready", "Real speech and model returned a reviewable proposal: " + job.get("error", ""))
        check(job.get("mode") == "codex-cli" and job.get("inference", {}).get("completedTurn") is True,
              "Voice used a completed real Codex inference, without offline substitution")
        check(job["inference"].get("requestedModel") == args.model and job["inference"].get("requestedReasoningEffort") == args.reasoning,
              "Voice inference uses the selected Codex model and reasoning preferences")
        check(request("/api/state")["pendingCount"] == 0, "Voice proposal did not execute before Apply")
        report["voiceSteps"].append({key: job.get(key) for key in ("transcript", "summary", "commands", "inference", "viewerAtRequest")})
        return job

    try:
        env = desktop.child_environment(argparse.Namespace(codex_exe=None, model=None))
        service = subprocess.Popen([sys.executable, "-u", str(ROOT / "ControlService/server.py"), "--port", "0", "--scenes", str(workspace / "scenes")],
                                   cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, **desktop.hidden_options())
        url = desktop.wait_for_service(service, workspace / "service.log")
        player = subprocess.Popen([str(ROOT / "Builds/WhiteRoomDesktop/MatrixOperator.exe"), "-batchmode", "-nographics", "-serviceUrl", url,
                                   "-logFile", str(workspace / "player.log")], cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **desktop.hidden_options())
        state = await_idle()
        check(not state["snapshot"]["scene"]["objects"], "Owned player starts with an empty scene")
        deadline = time.monotonic() + 5
        while not state["snapshot"].get("viewer", {}).get("frames") and time.monotonic() < deadline:
            time.sleep(.2)
            state = await_idle()
        check(bool(state["snapshot"].get("viewer", {}).get("frames")), "Actual desktop camera supplies request-relative viewpoint")
        options = request("/api/planner")["codexOptions"]["models"]
        chosen = next(item for item in options if item["id"] == args.model)
        check(args.reasoning in chosen["reasoningEfforts"], "Requested model and reasoning pair is discovered from Codex metadata")
        request("/api/planner_preferences", {"codex": {"model": args.model, "reasoningEffort": args.reasoning}})
        proposal = voice(args.audio)
        check(sorted(item.get("assetId") for item in proposal["commands"] if item["op"] == "spawn") == ["chair", "chair", "table"]
              and len(proposal["commands"]) == 3, "Spoken composition produces one table and two chairs")
        state = confirm(request("/api/apply_plan", {"planId": proposal["planId"]}))
        table = next(item for item in state["snapshot"]["scene"]["objects"] if item["assetId"] == "table")
        original = copy.deepcopy(table)
        confirm(request("/api/command", {"op": "select", "objectId": table["objectId"]}))
        proposal = voice(args.edit_audio)
        check(len(proposal["commands"]) == 1 and proposal["commands"][0]["op"] == "set_transform"
              and proposal["commands"][0]["objectId"] == table["objectId"], "Spoken 'this' edits the captured stable selected object ID")
        state = confirm(request("/api/apply_plan", {"planId": proposal["planId"]}))
        resized = next(item for item in state["snapshot"]["scene"]["objects"] if item["objectId"] == table["objectId"])
        check(all(abs(resized["transform"]["scale"][axis] - original["transform"]["scale"][axis] * 2) < .001 for axis in "xyz"),
              "Runtime doubles the same table in all three axes")
        state = confirm(request("/api/command", {"op": "undo"}))
        check(next(item for item in state["snapshot"]["scene"]["objects"] if item["objectId"] == table["objectId"])["transform"] == original["transform"],
              "Existing undo restores the prior selected table transform")
        state = confirm(request("/api/command", {"op": "redo"}))
        saved_scene = state["snapshot"]["scene"]
        check(request("/api/save", {"name": "VoiceLoop"})["saved"], "Voice-built scene saves on the PC")
        confirm(request("/api/command", {"op": "clear"}))
        state = confirm(request("/api/load", {"name": "VoiceLoop"}))
        check(state["snapshot"]["scene"] == saved_scene, "Save, clear and restore preserve exact object IDs, anchors and transforms")
        report["status"] = "passed"
    except Exception as error:
        report["error"] = str(error)
    finally:
        report["ownedProcessesStopped"] = all([desktop.stop_owned_process(player), desktop.stop_owned_process(service)])
        log.close()
        report["evidenceDirectory"] = str(workspace)
        report["passed"] = sum(item["passed"] for item in report["checks"])
        report["failed"] = sum(not item["passed"] for item in report["checks"])
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report.get(key) for key in ("status", "passed", "failed", "error", "ownedProcessesStopped")}))
    return 0 if report["status"] == "passed" and report["ownedProcessesStopped"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Required: permits two live model calls and edits in an isolated player")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--edit-audio", type=Path, required=True)
    parser.add_argument("--synthetic-audio", action="store_true", help="Identify synthesized test speech accurately in the report")
    parser.add_argument("--model", default="gpt-5.6-luna")
    parser.add_argument("--reasoning", default="low")
    parser.add_argument("--report", type=Path, default=ROOT / "Validation/voice-desktop-results.json")
    args = parser.parse_args()
    if not args.run:
        parser.error("Pass --run to authorize the isolated live inference test.")
    sys.exit(run(args))
