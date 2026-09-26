import copy
from pathlib import Path
import tempfile
import unittest

from matrix_tool_bridge import MatrixToolBridge, rigid_action, rigid_status, scene_summary, spawn_builtin
from server import APIError, State, command, scene


POSE = {"position": {"x": 0, "y": 1, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
BODY = {"schemaVersion": 1, "type": "dynamic", "collider": "bounds-box",
        "restitution": .25, "friction": .7, "sensor": False}


class MatrixRigidCreatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(Path(self.temp.name) / "scenes")
        self.object = {"objectId": "block-1", "assetId": "block",
                       "anchorId": "web-floor", "transform": copy.deepcopy(POSE)}
        self.snapshot = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                                   "objects": [copy.deepcopy(self.object)]},
                         "assets": [{"assetId": "block", "displayName": "Block",
                                     "localBounds": {"center": {"x": 0, "y": .5, "z": 0},
                                                     "size": {"x": 1, "y": 1, "z": 1}}}],
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

    def exchange(self, *, body=None, gravity=None, request_id=None, ok=True, error="",
                 object_id="block-1"):
        value = copy.deepcopy(self.snapshot)
        if body is not None:
            value["scene"]["objects"][0]["rigidBody"] = copy.deepcopy(body)
        if gravity is not None:
            value["rigidGravity"] = copy.deepcopy(gravity)
        results = ([{"requestId": request_id, "ok": ok, "error": error,
                    "objectId": object_id}] if request_id else [])
        self.state.exchange({"clientId": "web-client", "snapshot": value,
                             "results": results})

    def request(self, action, **extra):
        return {"action": action, "room_id": "web-virtual-room-v1",
                "scene_revision": self.state.revision, **extra}

    def test_body_gravity_and_remove_require_matching_observation(self):
        queued = self.state.agent_rigid_action(self.request(
            "set-body", object_id="block-1", rigid_body=BODY))
        self.assertEqual(queued["status"], "queued")
        raw = self.state.pending[queued["requestId"]]
        self.assertEqual(raw["op"], "set_rigid_body")
        self.assertIsNone(raw["expectedRigidBody"])
        self.assertEqual(raw["expectedTransform"], POSE)
        self.exchange(request_id=queued["requestId"])
        self.assertEqual(self.state.agent_rigid_status(queued["requestId"])["status"],
                         "unconfirmed")
        second = self.state.agent_rigid_action(self.request(
            "set-body", object_id="block-1", rigid_body=BODY))
        self.exchange(body=BODY, request_id=second["requestId"])
        self.assertEqual(self.state.agent_rigid_status(second["requestId"])["status"],
                         "succeeded")
        gravity = {"x": 0, "y": -4, "z": 0}
        changed = self.state.agent_rigid_action(self.request("set-gravity", gravity=gravity))
        self.assertEqual(self.state.pending[changed["requestId"]]["expectedGravity"],
                         {"x": 0, "y": -9.81, "z": 0})
        self.exchange(body=BODY, gravity=gravity, request_id=changed["requestId"])
        self.assertEqual(self.state.agent_rigid_status(changed["requestId"])["status"],
                         "succeeded")
        self.snapshot["rigidGravity"] = gravity
        removed = self.state.agent_rigid_action(self.request("remove-body", object_id="block-1"))
        self.assertEqual(self.state.pending[removed["requestId"]]["expectedRigidBody"], BODY)
        self.exchange(gravity=gravity, request_id=removed["requestId"])
        self.assertEqual(self.state.agent_rigid_status(removed["requestId"])["status"],
                         "succeeded")

    def test_stale_invalid_and_play_mode_requests_do_not_queue(self):
        for bad in (self.request("set-body", scene_revision=0, object_id="block-1",
                                 rigid_body=BODY),
                    self.request("set-body", object_id="block-1",
                                 rigid_body={**BODY, "sensor": True}),
                    self.request("set-gravity", gravity={"x": 0, "y": -31, "z": 0}),
                    self.request("remove-body", object_id="block-1")):
            with self.assertRaises(APIError):
                self.state.agent_rigid_action(bad)
        self.assertFalse(self.state.pending)
        self.snapshot["creatorMode"] = {"schemaVersion": 1, "mode": "play",
                                        "simulation": "running", "revision": 1}
        self.exchange()
        with self.assertRaisesRegex(APIError, "Creator Mode"):
            self.state.agent_rigid_action(self.request(
                "set-body", object_id="block-1", rigid_body=BODY))
        with self.assertRaises(APIError):
            command({"op": "set_gravity", "gravity": {"x": 0, "y": -4, "z": 0}})

    def test_private_bridge_keeps_reviewed_contract(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        import unittest.mock
        with unittest.mock.patch("matrix_tool_bridge.MOVE_WAIT", .02):
            queued = rigid_action(bridge.url, bridge.token, self.request(
                "set-body", object_id="block-1", rigid_body=BODY))
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(rigid_status(bridge.url, bridge.token,
                                      queued["requestId"])["status"], "queued")

    def test_internal_solver_floor_id_cannot_be_authored_or_restored(self):
        forged = {**copy.deepcopy(self.object), "objectId": "__matrix_floor__"}
        with self.assertRaisesRegex(APIError, "Reserved Matrix floor"):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [forged]})
        self.snapshot["scene"]["objects"] = [forged]
        with self.assertRaisesRegex(APIError, "Reserved Matrix floor"):
            self.exchange()

    def test_live_builtin_catalog_and_spawn_use_normal_receipt(self):
        self.assertEqual(scene_summary(self.state)["assets"][0]["assetId"], "block")
        value = {"room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
                 "asset_id": "block", "transform": copy.deepcopy(POSE)}
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        import unittest.mock
        with unittest.mock.patch("matrix_tool_bridge.MOVE_WAIT", .02):
            queued = spawn_builtin(bridge.url, bridge.token, value)
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(self.state.pending[queued["requestId"]]["op"], "spawn")
        self.assertEqual(self.state.pending[queued["requestId"]]["assetId"], "block")
        self.exchange(request_id=queued["requestId"])
        self.assertEqual(self.state.agent_spawn_status(queued["requestId"])["status"],
                         "unconfirmed")
        second = self.state.agent_spawn_builtin({**value, "scene_revision": self.state.revision})
        new_object = {**copy.deepcopy(self.object), "objectId": "block-2"}
        self.snapshot["scene"]["objects"].append(new_object)
        self.exchange(request_id=second["requestId"], object_id="block-2")
        self.assertEqual(self.state.agent_spawn_status(second["requestId"])["status"],
                         "succeeded")


if __name__ == "__main__":
    unittest.main()
