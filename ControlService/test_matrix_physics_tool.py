"""The PC-local physics tool distinguishes approval, receipt, and observed contact."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from agent_session import LocalCodexAgentBackend, _mcp_approval_description
from codex_provider import CodexConfig
from matrix_tool_bridge import MatrixToolBridge, physics_action, physics_status, scene_summary
from server import APIError, State
from test_web_assets import animated_glb


POSE = {"position": {"x": 0, "y": 2, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
BOUNDS = {"center": {"x": 0, "y": .5, "z": 0},
          "size": {"x": 1, "y": 1, "z": 1}}
PHYSICS = {"schemaVersion": 1, "kind": "gravity-floor",
           "collider": "catalog-bounds-box", "restitution": .5}


class MatrixPhysicsToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = State(root / "state", web_assets_directory=root / "assets")
        source = root / "drop.glb"
        source.write_bytes(animated_glb())
        self.asset = self.state.web_assets.register(source, "Drop Model", local_bounds=BOUNDS)
        self.room = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                               "objects": [{"objectId": "drop-1", "assetId": self.asset["assetId"],
                                            "anchorId": "web-floor", "transform": POSE}]},
                     "assets": [{"assetId": self.asset["assetId"], "displayName": "Drop Model",
                                 "spawnScale": 1, "localBounds": BOUNDS}],
                     "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                     "physicsSchemaVersion": 1,
                     "roomContext": {"mode": "white-room", "state": "ready",
                                     "alignmentVerified": False, "message": "Virtual room"}}
        self.exchange()

    def exchange(self, *, configuration=None, states=None, request_id=None, ok=True, error=""):
        room = deepcopy(self.room)
        if configuration is not None:
            room["scene"]["objects"][0]["physics"] = configuration
        if states is not None:
            room["physicsStates"] = states
        results = [{"requestId": request_id, "ok": ok, "error": error,
                    "objectId": "drop-1"}] if request_id else []
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": results})

    def request(self, action="set", **overrides):
        value = {"action": action, "room_id": "web-virtual-room-v1",
                 "scene_revision": self.state.revision, "object_id": "drop-1",
                 "expected_asset_id": self.asset["assetId"]}
        if action == "set":
            value["restitution"] = .5
        value.update(overrides)
        return value

    @staticmethod
    def observation(request_id, count=1):
        return {"objectId": "drop-1", "executionId": request_id,
                "status": "falling", "position": {"x": 0, "y": .5, "z": -2},
                "verticalVelocityMps": 2, "contactCount": count,
                "lastContact": {"index": 1, "surface": "web-floor",
                                "impactSpeedMps": 6.264, "approximate": True} if count else None}

    def test_receipt_contact_and_removal_are_distinct(self):
        first = self.state.agent_physics_action(self.request())
        self.assertEqual(first["status"], "queued")
        self.assertEqual(self.state.pending[first["requestId"]]["op"], "set_physics")
        self.exchange(configuration=PHYSICS, request_id=first["requestId"])
        self.assertEqual(self.state.agent_physics_status(first["requestId"])["status"], "unconfirmed")

        second = self.state.agent_physics_action(self.request())
        state = self.observation(second["requestId"])
        self.exchange(configuration=PHYSICS, states=[state], request_id=second["requestId"])
        result = self.state.agent_physics_status(second["requestId"])
        self.assertEqual(result["status"], "succeeded")
        self.assertTrue(result["contactObserved"])
        self.assertEqual(result["physicsState"]["lastContact"]["surface"], "web-floor")
        revision = self.state.revision
        self.exchange(configuration=PHYSICS, states=[{**state, "position": {"x": 0, "y": .25, "z": -2}}])
        self.assertEqual(self.state.revision, revision)
        self.assertEqual(scene_summary(self.state)["physicsStates"][0]["executionId"],
                         second["requestId"])

        removed = self.state.agent_physics_action(self.request(action="remove"))
        self.exchange(request_id=removed["requestId"])
        self.assertEqual(self.state.agent_physics_status(removed["requestId"])["status"], "succeeded")

    def test_stale_wrong_asset_ar_and_conflicting_writer_reject_before_queue(self):
        for value in (self.request(room_id="other"), self.request(scene_revision=0),
                      self.request(expected_asset_id="chair"), self.request(restitution=.8)):
            with self.assertRaises(APIError):
                self.state.agent_physics_action(value)
        self.assertFalse(self.state.pending)
        self.state.latest["roomContext"]["mode"] = "ar"
        with self.assertRaisesRegex(APIError, "White Room"):
            self.state.agent_physics_action(self.request())
        self.state.latest["roomContext"]["mode"] = "white-room"
        self.state.latest["scene"]["objects"][0]["component"] = {"status": "stopped"}
        with self.assertRaisesRegex(APIError, "competing transform writer"):
            self.state.agent_physics_action(self.request())
        self.assertFalse(self.state.pending)

    def test_private_bridge_and_exact_native_approval(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch("matrix_tool_bridge.MOVE_WAIT", .05):
            queued = physics_action(bridge.url, bridge.token, self.request())
            self.assertEqual(physics_status(bridge.url, bridge.token, queued["requestId"])["status"], "queued")
            with self.assertRaises(urllib.error.HTTPError):
                physics_status(bridge.url, "wrong-token", queued["requestId"])
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_set_physics"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call",
                              "tool_params": {key: value for key, value in self.request().items()
                                              if key != "action"}}}
        summary, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("restitution 0.5", summary)
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**approval["_meta"]["tool_params"],
                                                  "token": "secret"}}})[1])
        removal = {**approval,
                   "message": 'Allow the matrix_webxr MCP server to run tool "matrix_remove_physics"?',
                   "_meta": {**approval["_meta"], "tool_params": {
                       key: value for key, value in approval["_meta"]["tool_params"].items()
                       if key != "restitution"}}}
        self.assertTrue(_mcp_approval_description(removal)[1])
        with patch.object(CodexConfig, "validate"):
            backend = LocalCodexAgentBackend(CodexConfig("codex.exe"), self.temp.name, bridge)
        settings = " ".join(backend.transport.command)
        for name in ("matrix_set_physics", "matrix_remove_physics", "matrix_physics_status"):
            self.assertIn(name, settings)
        self.assertIn("tools.matrix_set_physics.approval_mode", settings)
        self.assertNotIn(bridge.token, settings)


if __name__ == "__main__":
    unittest.main()
