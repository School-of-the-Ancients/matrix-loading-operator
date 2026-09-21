"""Bounded visual validation against an already running Quest app and PC service.

Default: read-only preflight. --capture adds one rendered JPEG without inference
or scene edits. --run adds a real Codex image assessment. Optional --allow-edits
also requires --wearer-confirmed and saves/restores the complete starting scene
around a disposable table/two-chair composition and a reviewed correction/Undo.

This runner never installs, launches, stops, or forwards a device or service.
The wearer frames captures. Device serials and complete physical-room snapshots
are never written to its report. Captures contain virtual/MRUK rendering only.
"""
import argparse
import base64
import copy
import datetime
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location("visual_headset_codex", Path(__file__).with_name("Run-Codex-Headset-Loop.py"))
codex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(codex)
base = codex.base


class VisualHeadsetHarness(codex.CodexHeadsetHarness):
    def __init__(self, args):
        super().__init__(args)
        self.last_capture = 0
        self.report.update(scope="Existing Quest process, rendered virtual/MRUK capture, optional real Codex assessment",
                           mode="visual-headset-edits" if args.allow_edits else "visual-headset-inspection" if args.run else "visual-headset-capture" if args.capture else "visual-headset-preflight",
                           operatorConfirmedPairing=args.wearer_confirmed,
                           wearerVisualCheck="Wearer readiness confirmed" if args.wearer_confirmed else "Not confirmed by this runner",
                           physicalPassthroughIncluded=False, hardwareHeadsetTested=False,
                           plannedInferenceCalls=3 if args.allow_edits else 1 if args.run else 0,
                           screenshots=[], fullRoomSnapshotRecorded=False,
                           performanceScope="renderMs is render/readback wall time; encodeMs is JPEG work; frameTimeMs is Unity's prior reported delta and may be predicted XR cadence; captureFrameTimeMs is monotonic Update-to-Update wall time around capture, not GPU-exclusive time or a performance pass")

    def progress(self, message):
        print("HEADSET_VISUAL: " + message, flush=True)

    def preflight(self):
        self.choose_device()
        self.check(self.request("/api/health").get("ok") is True, "PC service is healthy")
        deadline = time.monotonic() + self.args.timeout
        while time.monotonic() < deadline:
            state = self.request("/api/state")
            if state.get("online") and state.get("snapshot") and state.get("pendingCount") == 0:
                break
            self.ensure_same_process()
            time.sleep(.2)
        else:
            raise base.CheckFailed("Existing headset app did not connect with an empty command queue")
        snap = state["snapshot"]
        room = snap.get("roomContext") or {}
        self.check(room.get("mode") == "ar" and room.get("state") == "ready", "Live runtime reports ready AR room data")
        self.check(snap.get("readOnly") is not True, "Live AR room is available for capture")
        self.check(state.get("capture", {}).get("supported") is True, "Connected headset advertises rendered capture support")
        self.args.room_id = snap["scene"]["roomId"]
        self.original = copy.deepcopy(snap)
        self.expected_scene = copy.deepcopy(snap["scene"])
        self.report.update(hardwareHeadsetTested=True, pretestSceneDigest=base.scene_digest(snap["scene"]),
                           pretestObjectCount=len(snap["scene"]["objects"]), roomAnchorCount=len(snap.get("anchors", [])),
                           roomAlignmentVerified=room.get("alignmentVerified") is True)
        if self.args.run:
            status = self.request("/api/planner")
            self.check(status.get("mode") == "codex-cli" and status.get("configured") is True,
                       "PC service uses the real Codex CLI provider")
            model = next((item for item in status.get("codexOptions", {}).get("models", []) if item.get("id") == self.args.model), None)
            self.check(model is not None and model.get("supportsImages") is True
                       and self.args.reasoning in model.get("reasoningEfforts", []),
                       "Explicit model and reasoning are locally advertised with image input")
        if self.args.allow_edits:
            self.check(self.args.wearer_confirmed and room.get("alignmentVerified") is True,
                       "Wearer confirmed readiness and runtime room alignment before temporary edits")
            learning = self.request("/api/learning")
            self.check(learning.get("session") is None and not learning.get("restorePending"),
                       "No active learning session or pending checkpoint restore will be disturbed")
            self.check(len(snap["scene"]["objects"]) <= 77, "Live scene has capacity for disposable furniture")
            requested = self.args.anchor_id or (snap.get("selection") or {}).get("anchorId")
            anchor = next((item for item in snap.get("anchors", []) if item.get("anchorId") == requested), None)
            self.check(anchor is not None and anchor.get("source") == "mruk"
                       and anchor.get("surface", {}).get("kind") == "support",
                       "Selected disposable composition target is a measured support surface")
            self.args.anchor_id = requested
            self.check(all(any(item.get("assetId") == asset and item.get("localBounds") for item in snap["assets"])
                           for asset in ("table", "chair")), "Furniture catalog has measured prefab bounds")
        if self.args.capture and not self.args.run:
            self.capture("inspection")
        return None

    def capture(self, label):
        remaining = 2.1 - (time.monotonic() - self.last_capture)
        if remaining > 0:
            time.sleep(remaining)
        before = copy.deepcopy(self.assert_context()["snapshot"])
        queued = self.request("/api/capture", {})
        self.last_capture = time.monotonic()
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            self.ensure_same_process()
            capture = self.request("/api/capture")
            if capture.get("status") == "ready":
                break
            if capture.get("status") in ("error", "stale"):
                raise base.CheckFailed("Capture unavailable: " + capture.get("error", "wearer should reframe and retry"))
            time.sleep(.2)
        else:
            raise base.CheckFailed("Headset rendered capture timed out; keep the application awake")
        self.check(capture.get("captureId") == queued.get("captureId"), "Received the exact requested headset frame")
        self.check(capture.get("source") == "unity_center_eye" and capture.get("includesPassthrough") is False,
                   "Headset capture discloses virtual rendering without physical passthrough")
        self.check("NOT included" in capture.get("content", ""), "AR capture carries the physical-camera exclusion label")
        data = capture.get("imageDataUrl", "")
        self.check(data.startswith("data:image/jpeg;base64,"), "Headset supplied a JPEG preview")
        raw = base64.b64decode(data.split(",", 1)[1], validate=True)
        self.check(len(raw) == capture.get("byteLength") and len(raw) <= 512 * 1024,
                   "Actual headset JPEG meets the transport byte cap")
        self.check(base.same_scene(before["scene"], self.assert_context()["snapshot"]["scene"]),
                   "Capture preserves the complete stable scene; tracked viewer pose may change")
        self.args.report.parent.mkdir(parents=True, exist_ok=True)
        path = self.args.report.parent / ("visual-feedback-headset-" + label + ".jpg")
        path.write_bytes(raw)
        frame_time = capture.get("captureFrameTimeMs")
        self.check(type(frame_time) in (int, float) and frame_time + .1 >= capture["renderMs"] + capture["encodeMs"],
                   "Monotonic capture-frame interval includes measured rendering and encoding work")
        self.report["screenshots"].append({"file": path.name, "label": label,
                                           "sha256": hashlib.sha256(raw).hexdigest(),
                                           "metadata": {key: value for key, value in capture.items() if key != "imageDataUrl"},
                                           "stableSceneDigest": base.scene_digest(before["scene"]),
                                           "objectCount": len(before["scene"]["objects"]),
                                           "captureFrameTimeAvailable": type(frame_time) in (int, float) and frame_time > 0})
        self.progress("saved " + path.name)
        return capture, before

    def infer(self, prompt, capture):
        self.assert_context()
        proposal = self.request("/api/plan", {"text": prompt, "mode": "codex-cli", "captureId": capture["captureId"],
                                               "codex": {"model": self.args.model, "reasoningEffort": self.args.reasoning}})
        receipt = codex.inference_receipt(proposal.get("inference"))
        self.check(proposal["inference"].get("imageCount") == 1, "Real Codex inference received one headset image")
        self.check(proposal.get("screenshot", {}).get("captureId") == capture["captureId"],
                   "Codex result is tied to the captured headset frame")
        receipt.update(imageCount=1, requestedModel=self.args.model, requestedReasoningEffort=self.args.reasoning)
        self.report["languageModelUsed"] = True
        self.report["inferenceSteps"].append({"prompt": prompt, "summary": proposal.get("summary"),
                                              "commands": proposal.get("commands"), "status": proposal.get("status"),
                                              "inference": receipt, "reviewed": False, "applied": False})
        self.assert_context()
        self.progress("model returned: " + proposal.get("summary", ""))
        return proposal

    def apply(self, proposal, commands):
        self.assert_context()
        self.check(proposal.get("requiresApply") is True and isinstance(proposal.get("planId"), str),
                   "Reviewed model edits have an explicit Apply identifier")
        self.report["inferenceSteps"][-1]["reviewed"] = True
        self.mutation_attempted = True
        queued = self.request("/api/apply_plan", {"planId": proposal["planId"]})
        self.check([{key: value for key, value in item.items() if key != "requestId"}
                    for item in queued.get("commands", [])] == commands, "Apply queues exactly the reviewed commands")
        result = self.wait_ack(queued)
        self.report["inferenceSteps"][-1]["applied"] = True
        return result

    def run_controlled(self, _):
        capture, _ = self.capture("inspection")
        observation = self.infer(self.args.prompt, capture)
        self.check(observation.get("commands") == [] and observation.get("requiresApply") is False
                   and observation.get("status") == "review_only", "Headset image assessment is review-only and cannot execute edits")
        if not self.args.allow_edits:
            self.report["sceneEditLoopAttempted"] = False
            self.check(base.same_scene(self.assert_context()["snapshot"]["scene"], self.original["scene"]),
                       "Inspection and real AI assessment preserve the exact starting scene")
            return
        self.report["sceneEditLoopAttempted"] = True
        backup = "VisualHeadsetBackup_" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        self.check(backup not in self.request("/api/scenes").get("scenes", []), "Temporary backup does not overwrite an existing save")
        self.save(backup)
        self.backup_name = backup
        self.report["pretestBackupName"] = backup
        capture, before = self.capture("before-composition")
        proposal = self.infer("Propose exactly three new objects: one table and two chairs on support anchor " + self.args.anchor_id +
                              ". Arrange them near the current selected point, respecting measured support boundaries, prefab bounds, and the current viewer. Keep at least 0.3 metres boundary clearance. Use placement:'surface' for each. Preserve all existing objects. If that surface cannot safely fit all three, return no commands and explain why.", capture)
        commands = codex.validate_commands(proposal.get("commands"), before)
        self.check(len(commands) == 3 and sorted(item.get("assetId", "") for item in commands) == ["chair", "chair", "table"]
                   and all(item["op"] == "spawn" and item.get("anchorId") == self.args.anchor_id
                           and item.get("placement") == "surface" for item in commands),
                   "Disposable composition contains only three surface-checked furniture spawns")
        composed, results = self.apply(proposal, commands)
        ids = {item["objectId"] for item in results}
        retained = copy.deepcopy(composed["scene"])
        retained["objects"] = [item for item in retained["objects"] if item["objectId"] not in ids]
        self.check(base.same_scene(retained, self.original["scene"]), "Disposable composition preserves all pre-existing objects")
        chair = next(item for item in composed["scene"]["objects"] if item["objectId"] in ids and item["assetId"] == "chair")
        capture, before = self.capture("composition")
        proposal = self.infer("Inspect the attached disposable furniture composition. Propose exactly one set_transform moving chair " + chair["objectId"] +
                              " by 0.1 metres in its anchor-local positive X direction while keeping rotation, scale, support anchor, and contact with the surface unchanged. Use placement:'surface' and zero clearance. Do not change any other object. Explain visible spacing and any uncertainty. Return no commands if support constraints prevent this small correction.", capture)
        commands = codex.validate_commands(proposal.get("commands"), before)
        self.check(len(commands) == 1 and commands[0]["op"] == "set_transform" and commands[0].get("objectId") == chair["objectId"]
                   and commands[0].get("anchorId", chair["anchorId"]) == chair["anchorId"] and commands[0].get("placement") == "surface",
                   "Image correction affects only one disposable chair through surface-checked transform")
        expected = copy.deepcopy(chair["transform"])
        expected["position"]["x"] += .1
        expected["position"]["y"] = 0
        self.check(base.same_transform(commands[0]["transform"], expected), "Correction preserves rotation scale and the requested 10 cm displacement")
        self.apply(proposal, commands)
        self.capture("corrected")
        undone, _ = self.command({"op": "undo"})
        self.check(base.same_scene(undone["scene"], before["scene"]), "Undo restores the full scene from before the reviewed correction")
        self.capture("undone")
        self.report["correctionApplyUndoObserved"] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="Capture and run a real image-only Codex assessment")
    parser.add_argument("--capture", action="store_true", help="Capture a preview without inference or scene edits")
    parser.add_argument("--allow-edits", action="store_true", help="Additionally validate disposable composition, correction, Undo and full restore")
    parser.add_argument("--wearer-confirmed", action="store_true", help="Wearer confirmed pairing, framing, alignment and readiness for temporary edits")
    parser.add_argument("--serial", help="Optional exact authorized device; never recorded in the report")
    parser.add_argument("--adb")
    parser.add_argument("--service-url", required=True)
    parser.add_argument("--package", required=True, help="Verified built/installed Android application ID; do not infer from product name")
    parser.add_argument("--anchor-id", help="Optional measured support for edits; otherwise current selected support")
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--reasoning", default="medium")
    parser.add_argument("--prompt", default="Inspect the attached rendered AR view. Describe only visible virtual objects, their colors and their arrangement. State clearly when no virtual object is visible. Distinguish observation from uncertainty. This capture excludes physical passthrough; do not describe physical-room camera imagery. Return no scene commands.")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    args.room_id = None
    if args.allow_edits and (not args.run or not args.wearer_confirmed):
        parser.error("--allow-edits requires --run and --wearer-confirmed")
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+", args.package):
        parser.error("--package must be a verified Android application ID")
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be 1-60 seconds")
    if args.report is None:
        name = "visual-feedback-headset-results.json" if args.run else "visual-feedback-headset-capture.json" if args.capture else "visual-feedback-headset-preflight.json"
        args.report = base.PROJECT / "work" / name
    return VisualHeadsetHarness(args).execute()


if __name__ == "__main__":
    sys.exit(main())
