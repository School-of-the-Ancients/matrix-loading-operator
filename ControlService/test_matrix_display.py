import copy
from pathlib import Path
import tempfile
import unittest

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
                        {"kind": "rigid-body", "objectId": "block-1"}):
            self.assertEqual(display_descriptor({**DISPLAY, "binding": binding})["binding"],
                             binding)
        for bad in ({**DISPLAY, "title": ""}, {**DISPLAY, "body": "x" * 601},
                    {**DISPLAY, "title": "\x00"},
                    {**DISPLAY, "schemaVersion": True},
                    {**DISPLAY, "binding": {"kind": "rigid-body", "objectId": ""}},
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


if __name__ == "__main__":
    unittest.main()
