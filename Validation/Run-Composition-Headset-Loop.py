"""Two real model-designed compositions on the connected Quest, with backup recovery.

Default is read-only preflight. --run confirms readiness for temporary edits.
Uses existing Codex/ADB harness boundaries; no templates, synthetic runtime,
offline parser, app launch, or model-generated code. A room plan is checked for
bounded wall pieces, not architectural quality. Wearer inspection is separate.
"""
import argparse
import copy
import datetime
import importlib.util
import math
from pathlib import Path
import re
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location("codex_loop", Path(__file__).with_name("Run-Codex-Headset-Loop.py"))
codex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(codex)
base = codex.base


class CompositionHarness(codex.CodexHeadsetHarness):
    def __init__(self, args):
        super().__init__(args)
        self.report.update(plannedInferenceCalls=2, scope="Real Codex composition, Quest executor and PC persistence",
                           mode="composition-controlled-run" if args.run else "composition-read-only-preflight",
                           architecturalQualityAssessed=False, collisionClearanceAssessed=False,
                           compositionReviewScope="Known upright pieces, bounded geometry, furniture placement and exact executor/persistence state; no visual or room-enclosure assessment")

    def preflight(self):
        scale = super().preflight()
        assets = {a["assetId"]: a for a in self.original["assets"]}
        self.check(all(assets.get(a, {}).get("localBounds") for a in ("chair", "table", "wall")),
                   "Quest runtime supplies measured prefab geometry")
        # The first bridge exchange can precede the controller's first LateUpdate.
        deadline = time.monotonic() + 5
        while not self.original.get("viewer", {}).get("frames") and time.monotonic() < deadline:
            time.sleep(.2)
            self.original = copy.deepcopy(self.assert_context()["snapshot"])
        self.check(any(frame.get("anchorId") == self.args.anchor_id
                       for frame in self.original.get("viewer", {}).get("frames", [])),
                   "Quest runtime supplies a tracked viewer frame for the expected floor")
        self.check(len(self.original["scene"]["objects"]) <= 80, "Room remains within object budget for temporary compositions")
        return scale

    def composition(self, prompt, furniture=False):
        before = copy.deepcopy(self.assert_context()["snapshot"])
        proposal = self.request("/api/plan", {"text": prompt, "mode": "codex-cli"})
        receipt = codex.inference_receipt(proposal.get("inference"))
        self.report["languageModelUsed"] = True
        step = {"prompt": prompt, "inference": receipt, "summary": proposal.get("summary"),
                "assumptions": proposal.get("assumptions"), "commands": proposal.get("commands"),
                "reviewed": False, "applied": False}
        self.report["inferenceSteps"].append(step)
        self.check(proposal.get("mode") == "codex-cli" and proposal.get("requiresApply") is True
                   and proposal.get("status") == "ready", "Composition produces an actionable Codex proposal")
        commands = codex.validate_commands(proposal["commands"], before)
        self.check(all(c["op"] == "spawn" and c["anchorId"] == self.args.anchor_id for c in commands),
                   "Composition only adds known pieces on the expected floor")
        scene_context = lambda value: {key: item for key, item in value.items() if key != "viewer"}
        self.check(scene_context(self.assert_context()["snapshot"]) == scene_context(before),
                   "Planning leaves the scene selection and catalogs unchanged; head tracking may update")
        assets = {a["assetId"]: a for a in before["assets"]}
        for c in commands:
            t, bounds = c["transform"], assets[c["assetId"]].get("localBounds")
            self.check(isinstance(bounds, dict), "Every proposed piece has measured geometry for review")
            self.check(abs(t["rotation"]["x"]) < .001 and abs(t["rotation"]["z"]) < .001,
                       "Temporary composition pieces remain upright")
            bottom = t["position"]["y"] + (bounds["center"]["y"] - bounds["size"]["y"] / 2) * t["scale"]["y"]
            top = t["position"]["y"] + (bounds["center"]["y"] + bounds["size"]["y"] / 2) * t["scale"]["y"]
            if furniture:
                self.check(abs(bottom) < .02, "Furniture base rests on the virtual floor")
            else:
                self.check(bottom >= -.02 and top <= 10,
                           "Room pieces stay above ground and below ten metres; elevated lintels are allowed")
            self.check(max(bounds["size"][a] * t["scale"][a] for a in "xyz") <= 10,
                       "Temporary piece geometry stays within ten metres")
        if furniture:
            self.check(sorted(c["assetId"] for c in commands) == ["chair", "chair", "table"],
                       "Exact user request produces one table and two chairs")
            captured = proposal.get("viewerAtRequest") or {}
            frame = next((f for f in captured.get("frames", []) if f.get("anchorId") == self.args.anchor_id), None)
            self.check(frame is not None, "Furniture proposal records the actual captured floor-relative viewer frame")
            step["viewerAtRequest"] = copy.deepcopy(frame)
            table = next(c for c in commands if c["assetId"] == "table")["transform"]["position"]
            delta = {a: table[a] - frame["position"][a] for a in "xz"}
            ahead = sum(delta[a] * frame["forward"][a] for a in "xz")
            self.check(.5 < ahead < 8, "Table is ahead of the actual captured headset viewpoint")
            for c in commands:
                if c["assetId"] == "chair":
                    p = c["transform"]["position"]
                    self.check(.4 <= math.hypot(p["x"] - table["x"], p["z"] - table["z"]) <= 3,
                               "Chair is arranged near the table")
        else:
            self.check(3 <= len(commands) <= 20 and sum(c["assetId"] == "wall" for c in commands) >= 3,
                       "Broad room request composes multiple wall prefabs")
        step["reviewed"] = True
        self.assert_context()
        plan_id = proposal.get("planId")
        self.check(isinstance(plan_id, str) and bool(plan_id), "Service supplied the reviewed composition identifier")
        self.mutation_attempted = True
        response = self.request("/api/apply_plan", {"planId": plan_id})
        queued = response.get("commands")
        self.check(isinstance(queued, list) and len(queued) == len(commands)
                   and all(isinstance(c, dict) for c in queued)
                   and [{key: value for key, value in c.items() if key != "requestId"} for c in queued] == commands,
                   "Apply queues exactly the reviewed model commands")
        request_ids = [c.get("requestId") for c in queued]
        self.check(all(isinstance(identifier, str) and identifier for identifier in request_ids)
                   and len(set(request_ids)) == len(commands), "Every queued piece has a unique request identifier")
        after, results = self.wait_ack(response)
        step["applied"] = True
        by_request = {r["requestId"]: r for r in results}
        ids = set()
        original_ids = {obj["objectId"] for obj in before["scene"]["objects"]}
        for command in response["commands"]:
            result = by_request[command["requestId"]]
            self.check(isinstance(result.get("objectId"), str) and bool(result["objectId"])
                       and result["objectId"] not in ids and result["objectId"] not in original_ids,
                       "Each composition piece receives a fresh distinct runtime object ID")
            ids.add(result["objectId"])
            obj = next(o for o in after["scene"]["objects"] if o["objectId"] == result["objectId"])
            self.check(obj["assetId"] == command["assetId"] and obj["anchorId"] == command["anchorId"]
                       and base.same_transform(obj["transform"], command["transform"]),
                       "Quest acknowledged and captured the exact model-authored piece")
        retained = copy.deepcopy(after["scene"])
        retained["objects"] = [o for o in retained["objects"] if o["objectId"] not in ids]
        self.check(base.same_scene(retained, before["scene"]), "Composition preserves every existing object")
        step["spawnedObjectIds"] = sorted(ids)
        return after

    def run_controlled(self, _scale):
        suffix = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        backup_name = "CompositionBackup_" + suffix
        name = "CompositionFurniture_" + suffix
        room_name = "CompositionRoom_" + suffix
        saved_names = self.request("/api/scenes").get("scenes", [])
        self.check(all(name not in saved_names for name in (backup_name, name, room_name)),
                   "Composition test saves will not overwrite any existing scene")
        self.save(backup_name)
        self.backup_name = backup_name
        self.report["pretestBackupName"] = self.backup_name
        self.check(self.backup_name in self.request("/api/scenes").get("scenes", []),
                   "Original scene backup exists before any composition edits")
        furniture = self.composition("put a table in front of me with two chairs.", furniture=True)
        self.save(name)
        self.report["furnitureSaveName"] = name
        cleared, _ = self.command({"op": "clear"})
        self.check(cleared["scene"]["objects"] == [], "Composed furniture clears through existing executor")
        restored = self.load(name)
        self.check(base.same_scene(restored["scene"], furniture["scene"]), "PC save restores all composed pieces with exact IDs and poses")
        original = self.load(self.backup_name)
        self.check(base.same_scene(original["scene"], self.original["scene"]),
                   "Original scene is restored before the independent room request")
        if self.original.get("selection", {}).get("objectId"):
            self.command({"op": "select", "objectId": self.original["selection"]["objectId"]})
        room = self.composition("create a room")
        self.save(room_name)
        self.report["roomSaveName"] = room_name
        cleared, _ = self.command({"op": "clear"})
        self.check(cleared["scene"]["objects"] == [], "Composed room clears through the existing executor")
        restored = self.load(room_name)
        self.check(base.same_scene(restored["scene"], room["scene"]),
                   "PC save restores the composed room with exact IDs assets anchors and poses")
        self.check(len(self.report["inferenceSteps"]) == 2
                   and all(step["reviewed"] and step["applied"] for step in self.report["inferenceSteps"]),
                   "Both observed Codex compositions passed programmatic review and runtime acknowledgement")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--serial")
    parser.add_argument("--adb")
    parser.add_argument("--service-url", default="http://127.0.0.1:8765")
    parser.add_argument("--package", default=base.DEFAULT_PACKAGE)
    parser.add_argument("--room-id", default="white-room-v1")
    parser.add_argument("--anchor-id", default="white-floor")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+", args.package):
        parser.error("--package must be an Android package identifier")
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    if args.report is None:
        args.report = base.PROJECT / "Validation" / ("composition-headset-results.json" if args.run else "composition-headset-preflight-results.json")
    try:
        return CompositionHarness(args).execute()
    except base.CheckFailed as error:
        parser.error(str(error))


if __name__ == "__main__":
    sys.exit(main())
