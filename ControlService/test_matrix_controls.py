"""Contract checks for authored world controls and observed Play actions."""
import copy
from pathlib import Path
import tempfile
import unittest

from server import APIError, State, control_descriptor, snapshot
from agent_session import _new_matrix_approval_summary
from matrix_tool_bridge import entity_page, scene_summary


POSE = {"position": {"x": 0, "y": 1, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
CONTROL = {"schemaVersion": 1, "label": "Resize exhibit",
           "action": {"kind": "cycle-values", "channel": "transform.scale",
                      "targetObjectId": "block-1",
                      "values": [[1, 1, 1], [2, 3, 4]]}}


class MatrixControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(Path(self.temp.name) / "scenes")
        self.snapshot = {
            "scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                      "objects": [
                          {"objectId": "button-1", "assetId": "wall",
                           "anchorId": "web-floor", "transform": copy.deepcopy(POSE)},
                          {"objectId": "block-1", "assetId": "block",
                           "anchorId": "web-floor", "transform": copy.deepcopy(POSE)}]},
            "assets": [{"assetId": "wall", "displayName": "Wall"},
                       {"assetId": "block", "displayName": "Block"}],
            "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
            "controlSchemaVersion": 1, "controlStates": {},
            "entityActionSchemaVersion": 1,
            "creatorMode": {"schemaVersion": 1, "mode": "creator",
                            "simulation": "paused", "revision": 1},
            "roomContext": {"mode": "white-room", "state": "ready",
                            "message": "Virtual room", "alignmentVerified": False}}
        self.exchange()

    def exchange(self, receipt=None):
        return self.state.exchange({"clientId": "web-client",
                                    "snapshot": copy.deepcopy(self.snapshot),
                                    "results": [receipt] if receipt else []})

    def author(self):
        queued = self.state.agent_control_action({
            "action": "set", "room_id": "web-virtual-room-v1",
            "scene_revision": self.state.revision, "object_id": "button-1",
            "control": copy.deepcopy(CONTROL)})
        self.assertEqual(queued["status"], "queued")
        command = self.state.pending[queued["requestId"]]
        self.assertEqual(command["expectedControl"], None)
        self.assertEqual(command["expectedTargetTransform"], POSE)
        self.snapshot["scene"]["objects"][0]["control"] = copy.deepcopy(CONTROL)
        self.snapshot["controlStates"] = {"button-1": {"index": 0, "revision": 0}}
        self.snapshot["creatorMode"]["revision"] += 1
        self.exchange({"requestId": queued["requestId"], "ok": True,
                       "error": "", "objectId": "button-1"})
        confirmed = self.state.agent_control_status(queued["requestId"])
        self.assertEqual(confirmed["status"], "succeeded")
        self.assertEqual(confirmed["controlState"], {"index": 0, "revision": 0})

    def inspect(self):
        queued = self.state.agent_inspect_entity({
            "room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
            "object_id": "button-1"})
        outcome = {"schemaVersion": 1, "kind": "entity-inspection",
                   "roomId": "web-virtual-room-v1",
                   "object": copy.deepcopy(self.snapshot["scene"]["objects"][0]),
                   "rigidState": None, "colliderScope": None,
                   "availableActions": ["activate_control"],
                   "creatorMode": copy.deepcopy(self.snapshot["creatorMode"]),
                   "gameStatus": None, "gameRoles": [], "agentGrab": None,
                   "displayObservation": None,
                   "controlState": copy.deepcopy(self.snapshot["controlStates"]["button-1"]),
                   "roomContext": {"mode": "white-room", "state": "ready",
                                   "alignmentVerified": False}}
        self.exchange({"requestId": queued["requestId"], "ok": True,
                       "error": "", "objectId": "button-1", "outcome": outcome})
        self.assertEqual(self.state.agent_entity_status(queued["requestId"])["status"],
                         "succeeded")
        return queued["requestId"]

    def test_descriptor_and_state_reject_invalid_or_mismatched_values(self):
        for values in ([[1, 1, 1]], [[1, 1, 1], [float("nan"), 2, 3]],
                       [[1, 1, 1], [1, 1, 1]]):
            bad = copy.deepcopy(CONTROL)
            bad["action"]["values"] = values
            with self.assertRaises(APIError):
                control_descriptor(bad)
        for label in (" bad ", "\ud800"):
            bad = copy.deepcopy(CONTROL)
            bad["label"] = label
            with self.assertRaises(APIError):
                control_descriptor(bad)
        bad = copy.deepcopy(CONTROL)
        bad["action"]["targetObjectId"] = "block\n1"
        with self.assertRaises(APIError):
            control_descriptor(bad)
        self.author()
        discovered = scene_summary(self.state)
        self.assertEqual(discovered["controlSchemaVersion"], 1)
        self.assertEqual(discovered["controlStates"], {"button-1": {"index": 0, "revision": 0}})
        self.assertEqual(discovered["objects"][0]["control"], CONTROL)
        self.assertEqual(entity_page(self.state, 0, 2)["objects"][0]["control"], CONTROL)
        bad = copy.deepcopy(self.snapshot)
        bad["controlStates"]["button-1"]["index"] = 1
        with self.assertRaisesRegex(APIError, "disagrees with target scale"):
            snapshot(bad)
        bad = copy.deepcopy(self.snapshot)
        del bad["controlSchemaVersion"]
        with self.assertRaisesRegex(APIError, "Scene controls require"):
            snapshot(bad)
        summary = _new_matrix_approval_summary("matrix_set_control", {
            "room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
            "object_id": "button-1", "control": CONTROL})
        self.assertIn("block-1 scale", summary)
        self.assertIn("[[1,1,1],[2,3,4]]", summary)

    def test_author_inspect_activate_and_reject_duplicate_or_stale_action(self):
        self.author()
        self.snapshot["creatorMode"].update(mode="play", simulation="running")
        self.exchange()
        inspection = self.inspect()
        queued = self.state.agent_entity_action({
            "action": "activate", "room_id": "web-virtual-room-v1",
            "object_id": "button-1", "inspection_request_id": inspection})
        self.assertEqual(queued["status"], "queued")
        command = self.state.pending[queued["requestId"]]
        self.assertEqual(command["expectedControlState"], {"index": 0, "revision": 0})
        self.assertEqual(command["expectedTargetTransform"], POSE)
        self.snapshot["scene"]["objects"][1]["transform"]["scale"] = {
            "x": 2, "y": 3, "z": 4}
        self.snapshot["controlStates"]["button-1"] = {"index": 1, "revision": 1}
        outcome = {"schemaVersion": 1, "kind": "control-activated",
                   "objectId": "button-1", "targetObjectId": "block-1",
                   "creatorHistoryCleared": False,
                   "controlState": {"index": 1, "revision": 1},
                   "transform": copy.deepcopy(self.snapshot["scene"]["objects"][1]["transform"]),
                   "creatorMode": copy.deepcopy(self.snapshot["creatorMode"])}
        self.exchange({"requestId": queued["requestId"], "ok": True,
                       "error": "", "objectId": "button-1", "outcome": outcome})
        self.assertEqual(self.state.agent_entity_status(queued["requestId"])["status"],
                         "succeeded")
        with self.assertRaisesRegex(APIError, "Inspect the current entity"):
            self.state.agent_entity_action({
                "action": "activate", "room_id": "web-virtual-room-v1",
                "object_id": "button-1", "inspection_request_id": inspection})
        with self.assertRaisesRegex(APIError, "Control state changed"):
            self.state.queue([copy.deepcopy(command)])
        second_inspection = self.inspect()
        second = self.state.agent_entity_action({
            "action": "activate", "room_id": "web-virtual-room-v1",
            "object_id": "button-1", "inspection_request_id": second_inspection})
        self.snapshot["scene"]["objects"][1]["transform"]["scale"] = {
            "x": 1, "y": 1, "z": 1}
        self.snapshot["controlStates"]["button-1"] = {"index": 0, "revision": 2}
        outcome["controlState"] = {"index": 0, "revision": 2}
        outcome["transform"] = copy.deepcopy(self.snapshot["scene"]["objects"][1]["transform"])
        self.exchange({"requestId": second["requestId"], "ok": True,
                       "error": "", "objectId": "button-1", "outcome": outcome})
        self.assertEqual(self.state.agent_entity_status(second["requestId"])["status"],
                         "succeeded")
        self.snapshot["creatorMode"].update(mode="creator", simulation="paused", revision=3)
        self.exchange()
        removed = self.state.agent_control_action({
            "action": "remove", "room_id": "web-virtual-room-v1",
            "scene_revision": self.state.revision, "object_id": "button-1"})
        self.snapshot["scene"]["objects"][0].pop("control")
        self.snapshot["controlStates"] = {}
        self.snapshot["creatorMode"]["revision"] += 1
        self.exchange({"requestId": removed["requestId"], "ok": True,
                       "error": "", "objectId": "button-1"})
        self.assertEqual(self.state.agent_control_status(removed["requestId"])["status"],
                         "succeeded")

    def test_activation_rejects_target_motion_after_inspection(self):
        self.author()
        self.snapshot["creatorMode"].update(mode="play", simulation="running")
        self.exchange()
        inspection = self.inspect()
        self.snapshot["scene"]["objects"][1]["transform"]["position"]["x"] = 1
        self.exchange()
        with self.assertRaisesRegex(APIError, "Inspect the current entity"):
            self.state.agent_entity_action({
                "action": "activate", "room_id": "web-virtual-room-v1",
                "object_id": "button-1", "inspection_request_id": inspection})

    def test_pc_checkpoint_keeps_control_progress_and_rejects_forgery(self):
        self.author()
        world = {"version": 2,
                 "scene": copy.deepcopy(self.snapshot["scene"]), "game": None,
                 "creatorMode": copy.deepcopy(self.snapshot["creatorMode"]),
                 "controlSchemaVersion": 1,
                 "controlStates": copy.deepcopy(self.snapshot["controlStates"])}
        self.state.save_world_checkpoint("controlled exhibit", world)
        saved_path = self.state.world_checkpoint_path("controlled exhibit")
        original = saved_path.read_bytes()
        restored = self.state.load_world_checkpoint("controlled exhibit")["world"]
        self.assertEqual(restored["controlStates"], world["controlStates"])
        forged = copy.deepcopy(world)
        forged["controlStates"]["button-1"]["index"] = 1
        with self.assertRaisesRegex(APIError, "disagrees with target scale"):
            self.state.save_world_checkpoint("controlled exhibit", forged)
        self.assertEqual(saved_path.read_bytes(), original)
        missing = copy.deepcopy(world)
        del missing["controlStates"]
        with self.assertRaisesRegex(APIError, "require live control states"):
            self.state.save_world_checkpoint("controlled exhibit", missing)
        self.assertEqual(saved_path.read_bytes(), original)
        missing_schema = copy.deepcopy(world)
        del missing_schema["controlSchemaVersion"]
        with self.assertRaisesRegex(APIError, "control contract"):
            self.state.save_world_checkpoint("controlled exhibit", missing_schema)
        self.assertEqual(saved_path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
