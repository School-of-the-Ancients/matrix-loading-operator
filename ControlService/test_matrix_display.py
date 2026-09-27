import copy
from pathlib import Path
import tempfile
import unittest

from agent_session import _mcp_approval_description
from matrix_tool_bridge import MatrixToolBridge, display_action, display_status, scene_summary
from server import APIError, State, command, display_descriptor, scene


POSE = {"position": {"x": 0, "y": 0, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
DISPLAY = {"schemaVersion": 1, "title": "Challenge", "body": "Deliver the objects.",
           "binding": {"kind": "game-progress"}}


class MatrixDisplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(Path(self.temp.name) / "scenes")
        self.object = {"objectId": "board", "assetId": "wall", "anchorId": "web-floor",
                       "transform": copy.deepcopy(POSE),
                       "rigidBody": {"schemaVersion": 1, "type": "static",
                                     "collider": "bounds-box", "restitution": 0,
                                     "friction": .5, "sensor": False}}
        self.snapshot = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                                   "objects": [copy.deepcopy(self.object)]},
                         "assets": [{"assetId": "wall", "displayName": "Wall"}],
                         "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                         "rigidSchemaVersion": 1,
                         "rigidGravity": {"x": 0, "y": -9.81, "z": 0},
                         "rigidStates": [],
                         "creatorMode": {"schemaVersion": 1, "mode": "creator",
                                         "simulation": "paused", "revision": 0},
                         "roomContext": {"mode": "white-room", "state": "ready",
                                         "message": "Virtual room",
                                         "alignmentVerified": False}}
        self.exchange()

    def exchange(self, *, display=None, request_id=None, ok=True, error=""):
        value = copy.deepcopy(self.snapshot)
        if display is not None:
            value["scene"]["objects"][0]["display"] = copy.deepcopy(display)
        results = ([{"requestId": request_id, "ok": ok, "error": error,
                    "objectId": "board"}] if request_id else [])
        self.state.exchange({"clientId": "web-client", "snapshot": value,
                             "results": results})

    def request(self, action, **extra):
        return {"action": action, "room_id": "web-virtual-room-v1",
                "scene_revision": self.state.revision, "object_id": "board", **extra}

    def test_descriptor_matches_plain_text_versioned_contract(self):
        for binding in (None, {"kind": "game-progress"}, {"kind": "gravity"},
                        {"kind": "rigid-body", "objectId": "block-1"},
                        {"kind": "object-transform", "objectId": "block-1"}):
            self.assertEqual(display_descriptor({**DISPLAY, "binding": binding})["binding"],
                             binding)
        for bad in ({**DISPLAY, "title": ""}, {**DISPLAY, "body": "x" * 601},
                    {**DISPLAY, "title": "\x00"},
                    {**DISPLAY, "schemaVersion": True},
                    {**DISPLAY, "binding": {"kind": "rigid-body", "objectId": ""}},
                    {**DISPLAY, "binding": {"kind": "object-transform", "objectId": ""}},
                    {**DISPLAY, "binding": {"kind": "object-transform",
                                             "objectId": "block-1", "ratio": 2}},
                    {**DISPLAY, "binding": {"kind": "game-progress", "extra": 1}}):
            with self.assertRaises(APIError):
                display_descriptor(bad)

    def test_set_remove_receipt_requires_observed_state_and_preserves_body(self):
        queued = self.state.agent_display_action(self.request("set", display=DISPLAY))
        self.assertEqual(queued["status"], "queued")
        raw = self.state.pending[queued["requestId"]]
        self.assertEqual(raw["op"], "set_display")
        self.assertIsNone(raw["expectedDisplay"])
        self.exchange(request_id=queued["requestId"])
        self.assertEqual(self.state.agent_display_status(queued["requestId"])["status"],
                         "unconfirmed")
        second = self.state.agent_display_action(self.request("set", display=DISPLAY))
        self.exchange(display=DISPLAY, request_id=second["requestId"])
        self.assertEqual(self.state.agent_display_status(second["requestId"])["status"],
                         "succeeded")
        self.assertEqual(self.state.latest["scene"]["objects"][0]["rigidBody"],
                         self.object["rigidBody"])
        self.assertEqual(scene_summary(self.state)["objects"][0]["display"], DISPLAY)
        removed = self.state.agent_display_action(self.request("remove"))
        self.assertEqual(self.state.pending[removed["requestId"]]["expectedDisplay"], DISPLAY)
        self.exchange(request_id=removed["requestId"])
        self.assertEqual(self.state.agent_display_status(removed["requestId"])["status"],
                         "succeeded")
        self.assertNotIn("display", self.state.latest["scene"]["objects"][0])

    def test_rejects_stale_revision_play_mode_and_bad_command(self):
        with self.assertRaises(APIError):
            self.state.agent_display_action(self.request("set", scene_revision=0,
                                                        display=DISPLAY))
        with self.assertRaises(APIError):
            self.state.agent_display_action(self.request("remove"))
        self.snapshot["creatorMode"] = {"schemaVersion": 1, "mode": "play",
                                        "simulation": "running", "revision": 1}
        self.exchange()
        with self.assertRaisesRegex(APIError, "Creator Mode"):
            self.state.agent_display_action(self.request("set", display=DISPLAY))
        with self.assertRaises(APIError):
            command({"op": "set_display", "objectId": "board", "display": DISPLAY})
        with self.assertRaises(APIError):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [{**self.object, "display": {**DISPLAY, "body": "\x01"}}]})

    def test_private_bridge_set_uses_same_contract(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        import unittest.mock
        with unittest.mock.patch("matrix_tool_bridge.MOVE_WAIT", .02):
            queued = display_action(bridge.url, bridge.token,
                                    self.request("set", display=DISPLAY))
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(display_status(bridge.url, bridge.token,
                                        queued["requestId"])["status"], "queued")

    def test_world_checkpoint_round_trips_live_bound_display(self):
        self.exchange(display=DISPLAY)
        world = {"version": 2, "scene": copy.deepcopy(self.state.latest["scene"]),
                 "game": None, "creatorMode": copy.deepcopy(self.snapshot["creatorMode"]),
                 "rigidGravity": copy.deepcopy(self.snapshot["rigidGravity"])}
        self.state.save_world_checkpoint("display-board", world)
        reopened = self.state.load_world_checkpoint("display-board")["world"]
        self.assertEqual(reopened, world)
        self.assertEqual(reopened["scene"]["objects"][0]["display"], DISPLAY)

    def test_transform_binding_and_specimen_pose_survive_checkpoint(self):
        specimen = {"objectId": "specimen-1", "assetId": "block",
                    "anchorId": "web-floor", "transform": {**copy.deepcopy(POSE),
                        "scale": {"x": 2, "y": .75, "z": 1.25}}}
        self.snapshot["scene"]["objects"].append(specimen)
        self.snapshot["assets"].append({"assetId": "block", "displayName": "Block"})
        self.exchange()
        board = {**DISPLAY, "title": "Scale Exhibit",
                 "binding": {"kind": "object-transform", "objectId": "specimen-1"}}
        queued = self.state.agent_display_action(self.request("set", display=board))
        self.exchange(display=board, request_id=queued["requestId"])
        self.assertEqual(self.state.agent_display_status(queued["requestId"])["status"],
                         "succeeded")
        objects = scene_summary(self.state)["objects"]
        self.assertEqual(objects[0]["display"], board)
        self.assertEqual(objects[1]["transform"]["scale"], specimen["transform"]["scale"])
        world = {"version": 2, "scene": copy.deepcopy(self.state.latest["scene"]),
                 "game": None, "creatorMode": copy.deepcopy(self.snapshot["creatorMode"]),
                 "rigidGravity": copy.deepcopy(self.snapshot["rigidGravity"])}
        self.state.save_world_checkpoint("scale-exhibit", world)
        reopened = self.state.load_world_checkpoint("scale-exhibit")["world"]
        self.assertEqual(reopened["scene"]["objects"], world["scene"]["objects"])

        args = {"room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
                "object_id": "board", "display": board}
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_set_display"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": args}}
        summary, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("object-transform:specimen-1", summary)


if __name__ == "__main__":
    unittest.main()
