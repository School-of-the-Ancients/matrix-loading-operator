"""Real graphical Windows captures, Codex image input, reviewed correction and Undo.

Default is an isolated read-only preflight. --run explicitly enables three real
Codex turns and temporary typed scene edits in an owned graphical player. The
runner uses no batchmode/nographics flags, synthetic snapshots, mocked providers,
or the user's existing service. Screenshots contain only the virtual fixture.
"""
import argparse
import base64
import contextlib
import copy
import datetime
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("visual_desktop_base", Path(__file__).with_name("Run-Composition-Desktop-Loop.py"))
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)
base = desktop.composition.base
codex = desktop.composition.codex
TEMP_PREFIX = "matrix-visual-desktop-"


def pose(x, z, yaw=0):
    return {"position": {"x": x, "y": 0, "z": z}, "rotation": {"x": 0, "y": yaw, "z": 0},
            "scale": {"x": 1, "y": 1, "z": 1}}


class VisualHarness(desktop.DesktopHarness):
    def __init__(self, args, player, service):
        super().__init__(args, player, service)
        self.last_capture = 0
        self.report.update(mode="visual-feedback-desktop-controlled-run" if args.run else "visual-feedback-desktop-preflight",
                           scope="Owned graphical Unity desktop player, real rendered JPEGs and real Codex image turns",
                           plannedInferenceCalls=3 if args.run else 0, graphicalPlayer=True,
                           playerBatchmode=False, playerNographics=False, screenshots=[],
                           wearerVisualCheck="Not a Quest wearer test; exported virtual screenshots need visual inspection",
                           materialColorsSentInContext=False, hardwareHeadsetTested=False)

    def progress(self, text):
        print("VISUAL_FEEDBACK: " + text, file=sys.__stdout__, flush=True)

    def request(self, path, body=None):
        request = urllib.request.Request(self.base + path,
                                         data=None if body is None else json.dumps(body, allow_nan=False).encode(),
                                         headers={"Content-Type": "application/json"})
        try:
            with self.http.open(request, timeout=120 if path == "/api/plan" else 5) as response:
                raw = response.read(base.MAX_BODY + 1)
        except urllib.error.HTTPError as error:
            raw = error.read(8192)
            status = error.code
            error.close()
            try:
                detail = json.loads(raw).get("error", "Request rejected")
            except (ValueError, AttributeError):
                detail = "Request rejected"
            raise base.CheckFailed(path + " returned HTTP " + str(status) + ": " + str(detail)[:1000]) from None
        except (OSError, TimeoutError):
            raise base.CheckFailed("Isolated service request timed out: " + path) from None
        if len(raw) > base.MAX_BODY:
            raise base.CheckFailed("Isolated service response exceeded the size limit")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise base.CheckFailed("Isolated service response was not a JSON object")
        return value

    def preflight(self):
        scale = super().preflight()
        state = self.assert_context()
        self.check(state.get("capture", {}).get("supported") is True,
                   "Graphical player advertises rendered capture support")
        status = self.request("/api/planner")
        self.check(status.get("supportsImages") is True, "Exact configured Codex model advertises image input")
        self.check(status.get("model") == self.args.model, "Isolated service uses the explicitly requested model")
        self.report.update(requestedModel=self.args.model, requestedReasoningEffort=self.args.reasoning,
                           initialCaptureStatus=state.get("capture"))
        return scale

    def capture(self, label):
        # Match the service's two-second request interval without busy polling.
        remaining = 2.1 - (time.monotonic() - self.last_capture)
        if remaining > 0:
            time.sleep(remaining)
        before = copy.deepcopy(self.assert_context()["snapshot"])
        requested = self.request("/api/capture", {})
        self.last_capture = time.monotonic()
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            capture = self.request("/api/capture")
            if capture.get("status") == "ready":
                break
            if capture.get("status") in ("error", "stale"):
                raise base.CheckFailed("Rendered capture failed: " + capture.get("error", "unavailable"))
            self.ensure_same_process()
            time.sleep(.2)
        else:
            raise base.CheckFailed("Rendered capture did not arrive in time")
        self.check(capture.get("captureId") == requested.get("captureId"), "Capture response matches the requested frame")
        self.check(capture.get("source") == "unity_center_eye" and capture.get("includesPassthrough") is False,
                   "Capture honestly reports a Unity view without physical passthrough")
        frame = next((item for item in before.get("viewer", {}).get("frames", []) if item.get("anchorId") == "white-floor"), None)
        self.check(frame is not None and all(math.isclose(capture["camera"]["position"][axis], frame["position"][axis], abs_tol=.001)
                                            for axis in "xyz"), "Rendered camera pose matches the structured floor-relative viewer")
        data_url = capture.get("imageDataUrl", "")
        self.check(data_url.startswith("data:image/jpeg;base64,"), "Preview exposes the captured JPEG")
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
        self.check(len(raw) == capture.get("byteLength") and len(raw) <= 512 * 1024, "Captured JPEG meets byte bounds")
        self.check(base.same_scene(before["scene"], self.assert_context()["snapshot"]["scene"]),
                   "Taking a screenshot does not mutate stable scene state")
        path = self.args.report.parent / ("visual-feedback-" + label + ".jpg")
        path.write_bytes(raw)
        metadata = {key: value for key, value in capture.items() if key != "imageDataUrl"}
        self.report["screenshots"].append({"label": label, "file": path.name, "sha256": hashlib.sha256(raw).hexdigest(),
                                           "metadata": metadata, "snapshot": before})
        self.progress("captured " + path.name + " (" + str(len(raw)) + " bytes)")
        return capture, before

    def infer(self, prompt, capture=None):
        before = copy.deepcopy(self.assert_context()["snapshot"])
        body = {"text": prompt, "mode": "codex-cli",
                "codex": {"model": self.args.model, "reasoningEffort": self.args.reasoning}}
        if capture is not None:
            body["captureId"] = capture["captureId"]
        self.progress("requesting " + ("image" if capture else "text-only control") + " inference")
        proposal = self.request("/api/plan", body)
        receipt = codex.inference_receipt(proposal.get("inference"))
        receipt.update({key: proposal["inference"][key] for key in ("requestedModel", "requestedReasoningEffort", "imageCount")
                        if key in proposal["inference"]})
        if capture is not None:
            self.check(receipt.get("imageCount") == 1, "Real Codex transport reports one attached image")
            self.check(proposal.get("screenshot", {}).get("captureId") == capture["captureId"],
                       "Inference receipt is tied to the requested rendered frame")
        self.report["languageModelUsed"] = True
        self.report["inferenceSteps"].append({"prompt": prompt, "inference": receipt,
                                              "summary": proposal.get("summary"), "commands": proposal.get("commands"),
                                              "status": proposal.get("status"), "reviewed": False, "applied": False,
                                              "captureId": capture.get("captureId") if capture else None})
        self.check(base.same_scene(before["scene"], self.assert_context()["snapshot"]["scene"]),
                   "Real model inference leaves scene state unchanged until Apply")
        self.progress("model returned: " + proposal.get("summary", ""))
        return proposal

    def run_controlled(self, _scale):
        self.backup_name = "VisualFeedbackBackup_" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
        self.save(self.backup_name)
        self.report["pretestBackupName"] = self.backup_name
        self.command({"op": "clear"})
        self.command({"op": "spawn", "assetId": "table", "anchorId": "white-floor", "transform": pose(0, 2)})
        _, results = self.command({"op": "spawn", "assetId": "chair", "anchorId": "white-floor", "transform": pose(0, 1.4, 180)})
        chair_id = results[0]["objectId"]
        self.command({"op": "spawn", "assetId": "chair", "anchorId": "white-floor", "transform": pose(1.25, 2, 90)})
        self.command({"op": "select", "objectId": chair_id})
        context = self.assert_context()["snapshot"]
        furniture = [item for item in context["assets"] if item["assetId"] in ("table", "chair")]
        self.check(all(not any(word in json.dumps(item).lower() for word in ("brown", "black", "oak", "graphite", '"color"', '"material"'))
                       for item in furniture), "Furniture catalog exposes geometry and orientation, without its material colors")
        self.report["imageOnlyDetail"] = {"question": "Visible furniture surface and leg colors",
                                          "furnitureCatalogActuallySent": furniture,
                                          "expectedFromAuthoredMaterials": {"topSeatBack": "brown wood", "legs": "dark graphite"},
                                          "expectationsSentToModel": False,
                                          "source": "Assets/Sandbox/Editor/WhiteRoomSceneSetup.cs Furniture materials",
                                          "imageInspection": {"status": "pending", "observer": None}}
        control = self.infer("Using only available evidence, what colors are the table top, chair seats/backrests, and furniture legs? Do not infer colors from object names or common furniture conventions. If visual color evidence is absent say it cannot be determined. Do not propose edits.")
        self.check(control.get("commands") == [] and control.get("requiresApply") is False,
                   "Text-only color control produces no scene edits")
        capture, baseline = self.capture("before")
        observed = self.infer("Inspect the attached rendered view. Report the visibly observed colors of the table top, chair seats/backrests, and furniture legs. Distinguish visible facts from uncertainty. Do not propose edits.", capture)
        self.check(observed.get("commands") == [] and observed.get("status") == "review_only" and observed.get("requiresApply") is False,
                   "Screenshot color assessment is a review-only response without an executable plan")
        self.report["imageOnlyDetail"].update(textOnlyAnswer=control["summary"], imageAnswer=observed["summary"])
        capture, baseline = self.capture("correction-request")
        proposal = self.infer("Inspect the furniture arrangement in the attached view and describe any visible tight spacing around the selected chair. Propose exactly one set_transform to move only the selected chair 0.6 metres directly away from the table across the floor in its current anchor frame. Preserve its height, rotation and scale, and preserve the other chair and table. Explain the visual evidence without claiming the edit is already applied.", capture)
        commands = codex.validate_commands(proposal.get("commands"), baseline)
        self.check(len(commands) == 1 and commands[0]["op"] == "set_transform" and commands[0]["objectId"] == chair_id,
                   "Image correction proposes only the selected chair's supported transform command")
        transform = commands[0]["transform"]
        self.check(base.same_transform(transform, pose(0, .8, 180)),
                   "Reviewed correction preserves height rotation scale and moves the requested 0.6 metres away")
        self.report["inferenceSteps"][-1]["reviewed"] = True
        applied, _ = self.wait_ack(self.request("/api/apply_plan", {"planId": proposal["planId"]}))
        self.report["inferenceSteps"][-1]["applied"] = True
        actual = next(item for item in applied["scene"]["objects"] if item["objectId"] == chair_id)
        self.check(base.same_transform(actual["transform"], transform), "Existing executor acknowledges the image-assisted correction")
        self.capture("corrected")
        undone, _ = self.command({"op": "undo"})
        self.check(base.same_scene(undone["scene"], baseline["scene"]), "Undo restores the entire scene from before the image correction")
        self.capture("undone")
        saved_name = "VisualFeedbackScene"
        saved = self.save(saved_name)
        cleared, _ = self.command({"op": "clear"})
        self.check(cleared["scene"]["objects"] == [], "Clear removes the scene through the same executor")
        self.capture("cleared")
        restored = self.load(saved_name)
        self.check(base.same_scene(restored["scene"], saved), "Save clear restore preserves exact IDs transforms and anchors")
        self.capture("restored")
        before_behavior = next(item for item in restored["scene"]["objects"] if item["objectId"] == chair_id)["transform"]
        self.command({"op": "set_behavior", "objectId": chair_id,
                      "behavior": {"kind": "rotate", "speedDegreesPerSecond": 40}})
        self.command({"op": "set_behavior", "objectId": chair_id,
                      "behavior": {"kind": "bob", "amplitudeMeters": .2, "frequencyHz": .3}})
        self.capture("behavior-phase-one")
        time.sleep(.4)
        self.capture("behavior-phase-two")
        after_behavior = next(item for item in self.assert_context()["snapshot"]["scene"]["objects"] if item["objectId"] == chair_id)
        self.check(base.same_transform(before_behavior, after_behavior["transform"]),
                   "Live rotate and bob leave the portable base transform unchanged")
        shots = self.report["screenshots"]
        self.check(shots[-1]["sha256"] != shots[-2]["sha256"], "Live behavior phases produce distinct rendered frame pixels")
        by_label = {item["label"]: item for item in shots}
        self.report.update(behaviorCaptureObserved=True, persistenceRoundtripObserved=True,
                           correctionApplyUndoObserved=True, basePosePreservedDuringAnimation=True,
                           restoredPixelsMatchBaseline=by_label["before"]["sha256"] == by_label["undone"]["sha256"] == by_label["restored"]["sha256"],
                           cameraMovementTested=False, questGraphicsTested=False)


def run(args):
    workspace = None
    service = player = log_stream = None
    report = {"status": "blocked", "languageModelUsed": False, "runtimeExecutionObserved": False,
              "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        if os.name != "nt":
            raise base.CheckFailed("Graphical validation requires the Windows player")
        player_path = args.player.resolve()
        build_log = PROJECT / "Validation" / "white-room-desktop.log"
        if not player_path.is_file() or ("WHITE_ROOM_BUILD_OK " + str(player_path)) not in build_log.read_text(encoding="utf-8", errors="replace"):
            raise base.CheckFailed("Build-WhiteRoom Desktop has not reported a successful current artifact")
        env = desktop.child_environment(args)
        env["SANDBOX_CODEX_REASONING"] = args.reasoning
        workspace = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX))
        log_path = workspace / "service.log"
        log_stream = log_path.open("wb")
        service = subprocess.Popen([sys.executable, "-u", str(PROJECT / "ControlService" / "server.py"),
                                    "--host", "127.0.0.1", "--port", "0", "--scenes", str(workspace / "scenes")],
                                   cwd=PROJECT, env=env, stdin=subprocess.DEVNULL, stdout=log_stream,
                                   stderr=subprocess.STDOUT, shell=False, **desktop.hidden_options())
        url = desktop.wait_for_service(service, log_path)
        player = subprocess.Popen([str(player_path), "-screen-fullscreen", "0", "-screen-width", "1280",
                                   "-screen-height", "800", "-serviceUrl", url, "-logFile", str(workspace / "player.log")],
                                  cwd=player_path.parent, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, shell=False, **desktop.hidden_options())
        harness_args = argparse.Namespace(run=args.run, serial=None, adb=None, service_url=url,
                                          package=base.DEFAULT_PACKAGE, room_id="white-room-v1", anchor_id="white-floor",
                                          timeout=args.timeout, report=args.report, model=args.model, reasoning=args.reasoning)
        harness = VisualHarness(harness_args, player, service)
        report = harness.report
        with (workspace / "harness.log").open("w", encoding="utf-8") as harness_log, contextlib.redirect_stdout(harness_log):
            harness.execute()
    except KeyboardInterrupt:
        report.update(status="interrupted", error="Operator interrupted graphical validation")
    except Exception as error:
        report.update(status="failed", error=str(error))
    finally:
        clean = True
        for process in (player, service):
            clean = desktop.stop_owned_process(process) and clean
        if log_stream is not None:
            log_stream.close()
        report["ownedProcessesStopped"] = clean
        if not clean:
            report.update(status="failed", cleanupError="Owned process cleanup could not be confirmed")
        retained = workspace is not None
        if workspace is not None and clean and report["status"] in ("ready", "passed"):
            target = workspace.resolve()
            if (target.parent == Path(tempfile.gettempdir()).resolve() and target.name.startswith(TEMP_PREFIX)
                    and not workspace.is_symlink() and not getattr(workspace, "is_junction", lambda: False)()):
                try:
                    shutil.rmtree(target)
                    retained = False
                except OSError:
                    report.update(status="failed", cleanupError="Could not remove the isolated temporary files")
            else:
                report.update(status="failed", cleanupError="Temporary directory boundary check failed")
        report["isolatedFilesRetained"] = retained
        if retained:
            report["manualRecoveryDirectory"] = str(workspace)
        report.update(completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      failed=0 if report["status"] in ("ready", "passed") else 1)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: report.get(key) for key in ("status", "error", "passed", "failed", "languageModelUsed",
                                                       "ownedProcessesStopped", "manualRecoveryDirectory")}, indent=2))
    return 0 if report["status"] in ("ready", "passed") else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--player", type=Path, default=PROJECT / "Builds" / "WhiteRoomDesktop" / "MatrixOperator.exe")
    parser.add_argument("--codex-exe")
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--reasoning", default="medium")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be 1-60 seconds")
    if args.report is None:
        args.report = PROJECT / "Validation" / ("visual-feedback-desktop-results.json" if args.run else "visual-feedback-desktop-preflight-results.json")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
