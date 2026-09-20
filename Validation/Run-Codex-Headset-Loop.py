"""Stage two: real Codex proposals applied to an already connected Quest runtime.

Read-only preflight is the default. --run explicitly authorizes five live Codex
turns and the controlled scene changes, confirms headset/service pairing, and
confirms other clients and controller/browser edits are stopped. Each proposal
must pass a narrow programmatic review before Apply. There is no offline fallback.
The inherited harness saves a unique original backup and restores it in finally.

No desktop player, synthetic client, installation, app launch, or headset input
is performed. Device execution attribution still requires operator-confirmed
pairing; wearer visuals and tracking are not established by HTTP acknowledgements.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import uuid

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("headset_base", Path(__file__).with_name("Run-Headset-Loop.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
sys.path.insert(0, str(PROJECT / "ControlService"))
from ai_adapter import PlannerError, validate_commands

USAGE_KEYS = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens")


def inference_receipt(value):
    """Retain only observed transport metadata; never infer a requested model."""
    if not isinstance(value, dict) or value.get("transport") != "codex-cli" or value.get("completedTurn") is not True:
        raise base.CheckFailed("A completed Codex CLI inference receipt is required")
    if type(value.get("toolCallCount")) is not int or value["toolCallCount"] != 0:
        raise base.CheckFailed("The Codex proposal must report zero tool calls")
    usage = value.get("usage")
    if not isinstance(usage, dict):
        raise base.CheckFailed("Codex did not report token usage")
    kept = {}
    for key in USAGE_KEYS:
        if key in usage:
            if type(usage[key]) is not int or not 0 <= usage[key] <= 100000000:
                raise base.CheckFailed("Codex reported invalid token usage")
            kept[key] = usage[key]
    if kept.get("input_tokens", 0) <= 0 or kept.get("output_tokens", 0) <= 0:
        raise base.CheckFailed("Positive observed input and output token usage is required")
    result = {"transport": "codex-cli", "completedTurn": True, "toolCallCount": 0, "usage": kept}
    model = value.get("model")
    if model is not None:
        if not isinstance(model, str) or not model or len(model) > 160 or any(ord(c) < 32 for c in model):
            raise base.CheckFailed("Codex reported invalid observed model metadata")
        result["model"] = model
    return result


class CodexHeadsetHarness(base.Harness):
    def __init__(self, args):
        super().__init__(args)
        self.report.update(
            scope="Live Codex CLI inference plus existing executor HTTP loop with connected headset package inspection",
            mode="codex-controlled-run" if args.run else "codex-read-only-preflight",
            commandPath="Live codex-cli proposal, narrow programmatic review, explicit Apply, runtime acknowledgement",
            languageModelUsed=False,
            inferenceSteps=[],
            plannedInferenceCalls=5,
            recoveryTransport="Inherited typed executor backup restore; no additional inference",
        )

    def request(self, path, body=None):
        if path != "/api/plan":
            return super().request(path, body)
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.base + path, data=json.dumps(body, allow_nan=False).encode("utf-8"), headers=headers)
        try:
            # Provider bounds the CLI turn at 90 seconds plus its authentication check.
            with self.http.open(request, timeout=120) as response:
                raw = response.read(base.MAX_BODY + 1)
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise base.HttpFailure(path, status) from None
        except (OSError, TimeoutError):
            raise base.CheckFailed("Codex planning request failed or timed out; no offline fallback was attempted") from None
        if len(raw) > base.MAX_BODY:
            raise base.CheckFailed("Codex planning response exceeded the size limit")
        try:
            result = json.loads(raw)
        except (UnicodeError, ValueError):
            raise base.CheckFailed("Codex planning returned invalid JSON") from None
        if not isinstance(result, dict):
            raise base.CheckFailed("Codex planning returned an unexpected response shape")
        return result

    def preflight(self):
        scale = super().preflight()
        status = self.request("/api/planner")
        self.check(status.get("configured") is True and status.get("mode") == "codex-cli" and
                   "codex-cli" in status.get("availableModes", []),
                   "Existing PC service is configured for Codex CLI; no inference runs during preflight")
        selection = self.original.get("selection") or {}
        self.check(selection.get("anchorId") == self.args.anchor_id and isinstance(selection.get("position"), dict),
                   "Runtime has a selected point on the expected virtual floor")
        return scale

    def model_step(self, prompt, expected_op, review):
        before = copy.deepcopy(self.assert_context()["snapshot"])
        self.check(self.request("/api/state")["pendingCount"] == 0, expected_op + ": no commands are pending before inference")
        proposal = self.request("/api/plan", {"text": prompt, "mode": "codex-cli"})
        self.check(proposal.get("mode") == "codex-cli" and proposal.get("requiresApply") is True,
                   expected_op + ": proposal explicitly reports Codex mode and requires Apply")
        receipt = inference_receipt(proposal.get("inference"))
        self.report["languageModelUsed"] = True
        step = {"prompt": prompt, "inference": receipt, "reviewed": False, "applied": False}
        self.report["inferenceSteps"].append(step)
        after = self.request("/api/state")
        self.check(after.get("online") and after.get("pendingCount") == 0 and after.get("snapshot") == before,
                   expected_op + ": model proposal did not change the scene or selection")
        try:
            commands = validate_commands(proposal.get("commands"), before, self.request("/api/scenes").get("scenes", []))
        except PlannerError:
            raise base.CheckFailed(expected_op + ": proposal failed the existing command validator") from None
        self.check(len(commands) == 1 and commands[0]["op"] == expected_op,
                   expected_op + ": proposal contains exactly the intended operation")
        self.check(review(commands[0], before), expected_op + ": object identity and all requested fields passed programmatic review")
        step["commands"] = copy.deepcopy(commands)
        step["reviewed"] = True
        self.assert_context()
        plan_id = proposal.get("planId")
        self.check(isinstance(plan_id, str) and bool(plan_id), expected_op + ": server supplied a reviewed proposal identifier")
        self.mutation_attempted = True
        response = self.request("/api/apply_plan", {"planId": plan_id})
        step["applied"] = True
        if expected_op == "save_scene":
            self.check(response.get("saved") is True and response.get("name") == commands[0]["name"],
                       "save_scene: PC confirmed the exact requested save")
            snapshot = self.assert_context()["snapshot"]
            self.check(commands[0]["name"] in self.request("/api/scenes").get("scenes", []),
                       "save_scene: the unique save appears in the PC catalog")
            return snapshot, []
        snapshot, results = self.wait_ack(response)
        self.check(all(result["ok"] for result in results), expected_op + ": runtime acknowledged the reviewed command")
        return snapshot, results

    def run_controlled(self, scale):
        suffix = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        backup = "CodexBackup_" + suffix
        saved_name = "CodexLoop_" + suffix
        names = self.request("/api/scenes").get("scenes", [])
        self.check(backup not in names and saved_name not in names, "Unique Codex validation saves will not overwrite existing saves")
        self.save(backup)
        self.backup_name = backup
        self.report["pretestBackupName"] = backup
        self.check(backup in self.request("/api/scenes").get("scenes", []), "Original scene is saved before the first model proposal")
        expected_pose = {
            "position": copy.deepcopy(self.original["selection"]["position"]),
            "rotation": {"x": 0, "y": 0, "z": 0},
            "scale": {"x": scale, "y": scale, "z": scale},
        }

        def review_spawn(command, _snapshot):
            return command["assetId"] == "chair" and command["anchorId"] == self.args.anchor_id and \
                base.same_transform(command["transform"], expected_pose)

        snapshot, results = self.model_step(
            "Summon one chair here at its normal catalog size with zero rotation. Make no other changes.",
            "spawn", review_spawn)
        identifier = results[0].get("objectId")
        originals = {item["objectId"] for item in self.original["scene"]["objects"]}
        self.check(isinstance(identifier, str) and identifier and identifier not in originals,
                   "Live Codex spawn produces a new runtime-assigned object ID")
        self.report["testObjectId"] = identifier
        item = next(obj for obj in snapshot["scene"]["objects"] if obj["objectId"] == identifier)
        self.check(item["assetId"] == "chair" and item["anchorId"] == self.args.anchor_id and
                   base.same_transform(item["transform"], expected_pose),
                   "Headset runtime state matches the reviewed chair pose")
        retained = copy.deepcopy(snapshot["scene"])
        retained["objects"] = [obj for obj in retained["objects"] if obj["objectId"] != identifier]
        self.check(base.same_scene(retained, self.original["scene"]), "Model spawn preserves all pre-existing scene objects")
        self.check(snapshot["selection"]["objectId"] == identifier, "The spawned chair is selected for the next natural-language reference")
        doubled = copy.deepcopy(item["transform"])
        doubled["scale"] = {axis: value * 2 for axis, value in doubled["scale"].items()}

        def review_resize(command, _snapshot):
            return command["objectId"] == identifier and command.get("anchorId", self.args.anchor_id) == self.args.anchor_id and \
                base.same_transform(command["transform"], doubled)

        snapshot, _ = self.model_step("Make it twice as big. Keep its position, rotation and anchor unchanged.", "set_transform", review_resize)
        item = next(obj for obj in snapshot["scene"]["objects"] if obj["objectId"] == identifier)
        self.check(base.same_transform(item["transform"], doubled), "Live Codex resize changes the same object ID to exactly double scale")
        retained = copy.deepcopy(snapshot["scene"])
        retained["objects"] = [obj for obj in retained["objects"] if obj["objectId"] != identifier]
        self.check(base.same_scene(retained, self.original["scene"]), "Model resize preserves all pre-existing objects")
        saved_scene = copy.deepcopy(snapshot["scene"])
        self.report["testSaveName"] = saved_name
        self.model_step("Save the scene as " + saved_name + ".", "save_scene",
                        lambda command, _snapshot: command["name"] == saved_name)
        snapshot, _ = self.model_step("Clear the scene.", "clear", lambda _command, _snapshot: True)
        self.check(snapshot["scene"]["objects"] == [], "Live Codex clear is acknowledged by the runtime")
        snapshot, _ = self.model_step("Restore the saved scene " + saved_name + ".", "load_scene",
                                     lambda command, _snapshot: command["name"] == saved_name)
        self.check(base.same_scene(snapshot["scene"], saved_scene),
                   "Live Codex restore preserves exact object IDs assets anchors and local transforms")
        self.check(len(self.report["inferenceSteps"]) == 5 and
                   all(step["reviewed"] and step["applied"] for step in self.report["inferenceSteps"]),
                   "Five observed Codex turns completed the reviewed spawn edit save clear restore loop")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="Authorize five live Codex turns plus controlled scene edits and confirm headset pairing")
    parser.add_argument("--serial", help="Explicit authorized ADB device; otherwise exactly one is required")
    parser.add_argument("--adb", help="ADB executable; otherwise PATH or the Unity Android SDK")
    parser.add_argument("--service-url", default="http://127.0.0.1:8765", help="Existing PC service; token from SANDBOX_TOKEN")
    parser.add_argument("--package", default=base.DEFAULT_PACKAGE)
    parser.add_argument("--room-id", default="white-room-v1")
    parser.add_argument("--anchor-id", default="white-floor")
    parser.add_argument("--timeout", type=float, default=30, help="Runtime acknowledgement timeout in seconds (1-60)")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+", args.package):
        parser.error("--package must be an Android package identifier")
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    if args.report is None:
        args.report = PROJECT / "Validation" / ("codex-headset-loop-results.json" if args.run else "codex-headset-preflight-results.json")
    try:
        return CodexHeadsetHarness(args).execute()
    except base.CheckFailed as error:
        parser.error(str(error))


if __name__ == "__main__":
    sys.exit(main())
