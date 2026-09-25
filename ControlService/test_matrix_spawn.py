"""Registered GLB spawn preserves native approval and observed runtime receipts."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from agent_session import LocalCodexAgentBackend, _mcp_approval_description
from codex_provider import CodexConfig
from matrix_tool_bridge import MatrixToolBridge, spawn_asset, spawn_status
from server import APIError, State
from test_web_assets import glb


POSE = {"position": {"x": 1, "y": 0, "z": -2},
        "rotation": {"x": 0, "y": 30, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}


class MatrixSpawnTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = State(root / "state", web_assets_directory=root / "assets")
        source = root / "dragon.glb"
        source.write_bytes(glb())
        self.asset = self.state.web_assets.register(source, "Ice Dragon")
        self.room = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": []},
                     "assets": [{"assetId": self.asset["assetId"], "displayName": "Ice Dragon"}],
                     "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                     "roomContext": {"mode": "white-room", "state": "ready",
                                     "alignmentVerified": False, "message": "Virtual room"}}
        self.exchange()

    def exchange(self, *, object_id=None, ok=True, request_id=None, error=""):
        room = deepcopy(self.room)
        if object_id:
            room["scene"]["objects"].append({"objectId": object_id,
                "assetId": self.asset["assetId"], "anchorId": "web-floor", "transform": deepcopy(POSE)})
        results = ([{"requestId": request_id, "ok": ok, "error": error,
                    "objectId": object_id or ""}] if request_id else [])
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": results})

    def request(self, **overrides):
        return {"room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
                "asset_id": self.asset["assetId"], "transform": deepcopy(POSE), **overrides}

    def test_spawn_queues_normal_command_and_requires_observed_object(self):
        queued = self.state.agent_spawn(self.request())
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(self.state.pending[queued["requestId"]]["op"], "spawn")
        self.assertEqual(self.state.pending[queued["requestId"]]["assetId"], self.asset["assetId"])
        self.exchange(request_id=queued["requestId"])
        self.assertEqual(self.state.agent_spawn_status(queued["requestId"])["status"], "unconfirmed")
        # A fresh request is needed after an unconfirmed execution; no implicit retry.
        next_queued = self.state.agent_spawn(self.request())
        self.exchange(object_id="dragon-1", request_id=next_queued["requestId"])
        success = self.state.agent_spawn_status(next_queued["requestId"])
        self.assertEqual(success["status"], "succeeded")
        self.assertEqual(success["objectId"], "dragon-1")

    def test_stale_offline_unregistered_and_ar_reject_without_queue(self):
        for bad in (self.request(room_id="wrong"), self.request(scene_revision=0),
                    self.request(asset_id="web:missing:000000000000"),
                    self.request(transform={**POSE, "scale": {"x": 0, "y": 1, "z": 1}})):
            with self.assertRaises(APIError):
                self.state.agent_spawn(bad)
        self.assertFalse(self.state.pending)
        self.state.latest["roomContext"]["mode"] = "ar"
        with self.assertRaisesRegex(APIError, "virtual room"):
            self.state.agent_spawn(self.request())
        self.state.latest["roomContext"]["mode"] = "white-room"
        self.state.latest["assets"] = []
        with self.assertRaisesRegex(APIError, "refresh its catalog"):
            self.state.agent_spawn(self.request())
        self.state.last_seen = -float("inf")
        with self.assertRaises(APIError):
            self.state.agent_spawn(self.request())
        self.assertFalse(self.state.pending)

    def test_failed_receipt_and_lost_client_never_claim_success(self):
        queued = self.state.agent_spawn(self.request())
        self.exchange(request_id=queued["requestId"], ok=False, error="Scene full")
        failed = self.state.agent_spawn_status(queued["requestId"])
        self.assertEqual(failed["status"], "failed")
        self.assertIn("Scene full", failed["error"])
        next_queued = self.state.agent_spawn(self.request())
        self.state.last_seen = -float("inf")
        self.assertEqual(self.state.agent_spawn_status(next_queued["requestId"])["status"], "unconfirmed")

    def test_private_bridge_and_xr_approval_are_bounded(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch("matrix_tool_bridge.MOVE_WAIT", .05):
            queued = spawn_asset(bridge.url, bridge.token, self.request())
            self.assertEqual(spawn_status(bridge.url, bridge.token, queued["requestId"])["status"], "queued")
            with self.assertRaises(urllib.error.HTTPError):
                spawn_status(bridge.url, "wrong-token", queued["requestId"])
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_spawn_asset"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {
                        key: value for key, value in self.request().items()}}}
        summary, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("Ice", self.asset["displayName"])
        self.assertIn(self.asset["assetId"], summary)
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**approval["_meta"]["tool_params"],
                                                  "token": "secret"}}})[1])
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**approval["_meta"]["tool_params"],
                                                  "scene_revision": True}}})[1])
        with patch.object(CodexConfig, "validate"):
            backend = LocalCodexAgentBackend(CodexConfig("codex.exe"), self.temp.name, bridge)
        settings = " ".join(backend.transport.command)
        self.assertIn("matrix_spawn_asset", settings)
        self.assertIn("matrix_spawn_status", settings)
        self.assertIn("tools.matrix_spawn_asset.approval_mode", settings)
        self.assertNotIn(bridge.token, settings)


if __name__ == "__main__":
    unittest.main()
