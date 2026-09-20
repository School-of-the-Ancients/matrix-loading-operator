"""Real Node core + PC HTTP service + Unity Windows simulation; no headset/model claims."""
import argparse
import copy
import datetime
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

PROJECT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-project", type=Path, default=PROJECT.parent / "sota-v2")
    parser.add_argument("--player", type=Path, default=PROJECT / "Builds/Desktop/AR-Sandbox.exe")
    args = parser.parse_args()
    report = {"startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope": "Real Node canonical core, Python HTTP adapter and Unity Windows player; simulated room",
              "hardwareTested": False, "liveModelTested": False, "checks": []}
    core_port, pc_port = free_port(), free_port()
    core_url, pc_url = f"http://127.0.0.1:{core_port}", f"http://127.0.0.1:{pc_port}"
    processes, logs = [], []
    temporary = tempfile.TemporaryDirectory(prefix="sota-learning-loop-")
    data = Path(temporary.name)

    def check(value, label):
        if not value:
            raise AssertionError(label)
        report["checks"].append(label)

    def launch(command, cwd, name, env=None):
        log = (data / (name + ".log")).open("ab")
        logs.append(log)
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log, **options)
        processes.append(proc)
        return proc

    def stop(proc):
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill(); proc.wait(timeout=5)

    def request(path, body=None, core=False, expected=200):
        base = core_url + "/api/operator/v1" if core else pc_url
        raw = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=raw, headers={"Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(req, timeout=6)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result = json.load(response)
            if response.status != expected:
                raise AssertionError(f"{path}: HTTP {response.status}: {result}")
            return result

    def until(callback, seconds=30):
        deadline = time.monotonic() + seconds
        last = None
        while time.monotonic() < deadline:
            try:
                last = callback()
                if last:
                    return last
            except (OSError, AssertionError):
                pass
            time.sleep(0.15)
        raise TimeoutError("Expected state not reached: " + str(last))

    def start_services():
        core = launch(["node", "--experimental-strip-types", "src/bin/operator-server.ts", "--port", str(core_port),
                       "--data", str(data / "core")], args.core_project, "core")
        until(lambda: request("/health", core=True).get("ok"))
        env = dict(os.environ, SOTA_CORE_URL=core_url)
        env.pop("SANDBOX_TOKEN", None)
        pc = launch([sys.executable, "server.py", "--port", str(pc_port), "--scenes", str(data / "scenes")],
                    PROJECT / "ControlService", "pc", env)
        until(lambda: request("/api/health").get("ok"))
        return core, pc

    def settled(response):
        ids = {c["requestId"] for c in response["commands"]}
        def ready():
            state = request("/api/state")
            results = [r for r in state["results"] if r["requestId"] in ids]
            if state["pendingCount"] or len(results) != len(ids):
                return None
            check(all(r["ok"] for r in results), "Unity acknowledged room command")
            return state["snapshot"]
        return until(ready)

    def language(text):
        proposal = request("/api/plan", {"text": text, "mode": "offline-rules"})
        check(proposal["mode"] == "offline-rules", "Natural-language edit explicitly uses offline rules")
        return settled(request("/api/apply_plan", {"planId": proposal["planId"]}))

    def act(action, message="", **extra):
        s = request("/api/learning")["session"]
        return request("/api/learning/action", {"requestId": uuid.uuid4().hex, "sessionId": s["id"],
                       "expectedRevision": s["revision"], "action": action, "message": message, **extra})["session"]

    try:
        core, pc = start_services()
        player = launch([str(args.player), "-batchmode", "-nographics", "-serviceUrl", pc_url,
                         "-logFile", str(data / "unity.log")], PROJECT, "player")
        until(lambda: request("/api/state")["online"])
        check(request("/api/state")["snapshot"]["scene"]["roomId"] == "simulated-room-v1", "Room explicitly identified as simulation")
        check(len(request("/api/lessons")["lessons"]) == 1, "Canonical authored lesson catalog reached through PC adapter")
        before = language("Put a block here")
        obj = before["scene"]["objects"][0]
        started = request("/api/learning/start", {"requestId": uuid.uuid4().hex, "lessonId": "observation-and-scale", "objectId": obj["objectId"]})["session"]
        check(started["stage"] == "explain" and started["context"]["objectId"] == obj["objectId"], "Lesson binds actual spawned Unity object")
        act("ask_more_explanation")
        act("advance")
        practice = act("advance", "I predict each axis doubles and geometric volume increases eightfold; position and rotation stay the same.")
        check(practice["stage"] == "guided_practice", "Explain, hint, example and prediction recorded in canonical runtime")
        check(request("/api/save", {"name": "Learning checkpoint"})["saved"], "Scene and immutable canonical checkpoint saved together")
        changed = language("Make it twice as big")
        check(changed["scene"]["objects"][0]["objectId"] == obj["objectId"], "Language revision preserves bound object identity")
        checked = act("submit_practice", "All three scale values doubled, so volume is eight times the starting volume.",
                      evidence={"objectId": "browser-spoof", "scale": {"x": 99}})
        check(checked["stage"] == "socratic_check" and checked["evidence"][0]["objectId"] == obj["objectId"], "Practice uses authoritative Unity evidence, ignoring browser-provided pose")
        check(checked["evidence"][0]["scale"] == changed["scene"]["objects"][0]["transform"]["scale"], "Recorded evidence equals actual runtime scale")
        act("answer_socratic_check", "Each final axis divided by its starting value is two. A one-axis stretch leaves two ratios at one.")
        completed = act("finish", "The evidence confirmed uniform doubling. Next I would change one axis to compare the volume ratio.")
        check(completed["stage"] == "ended" and "Mastery was not assessed" in completed["completionLabel"], "Reflection persisted without fabricated mastery grade")
        check(len([m for m in completed["messages"] if m["role"] == "learner"]) == 4, "Prediction, observation, reasoning and reflection retained")
        cleared = settled(request("/api/command", {"op": "clear"}))
        check(not cleared["scene"]["objects"] and request("/api/learning")["issue"], "Clearing room pauses bound lesson presentation")
        stop(pc); stop(core)
        core, pc = start_services()
        until(lambda: request("/api/state")["online"])
        check(request("/sessions/" + completed["id"], core=True)["session"]["stage"] == "ended", "Completed canonical session survives core and PC process restart")
        load_body = {"name": "Learning checkpoint", "requestId": uuid.uuid4().hex}
        load_response = request("/api/load", load_body)
        restored_scene = settled(load_response)
        restored = until(lambda: (lambda d: d["session"] if not d["restorePending"] else None)(request("/api/learning")))
        check(restored_scene["scene"] == before["scene"], "Restore recovers exact object IDs, room, anchors and transforms")
        check(restored["stage"] == practice["stage"] and restored["messages"] == practice["messages"], "Checkpoint restores saved lesson stage and response history")
        check(restored["id"] != completed["id"] and restored["restoredFrom"]["sessionId"] == completed["id"], "Restore creates a provenance-linked fork preserving later progress")
        check(request("/sessions/" + completed["id"], core=True)["session"]["stage"] == "ended", "Original later completed record remains intact")
        check(request("/api/load", load_body) == load_response and request("/api/state")["pendingCount"] == 0, "Repeated load request does not requeue or refork")
        check(request("/api/learning")["session"]["id"] == restored["id"], "Retry preserves restored session identity")
        stop(player)
        unity_log = (data / "unity.log").read_text(errors="replace")
        check("Exception:" not in unity_log and "NullReferenceException" not in unity_log, "Unity player log has no runtime exception")
        report["passed"] = True
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
        raise
    finally:
        for proc in reversed(processes):
            stop(proc)
        for log in logs:
            log.close()
        report["completedUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        target = PROJECT / "Validation/learning-loop-results.json"
        target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        temporary.cleanup()
        print(json.dumps({"passed": report["passed"], "checks": len(report["checks"])}))


if __name__ == "__main__":
    main()
