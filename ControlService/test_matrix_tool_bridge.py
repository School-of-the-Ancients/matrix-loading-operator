"""PC-only MCP bridge reads the live Matrix scene with bounded output."""
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from agent_session import LocalCodexAgentBackend
from codex_provider import CodexConfig
from matrix_tool_bridge import MatrixToolBridge, read_scene, scene_summary
from server import State, local_agent_backend
from test_server import SNAPSHOT


class MatrixToolBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.bridge = MatrixToolBridge(self.state)
        self.addCleanup(self.bridge.close)

    def get(self, token=None):
        request = urllib.request.Request(self.bridge.url, headers={
            "Authorization": "Bearer " + (token or self.bridge.token)})
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.load(response)

    def test_offline_and_authenticated_live_scene_are_bounded(self):
        self.assertEqual(self.get()["online"], False)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("wrong-token")
        self.assertEqual(error.exception.code, 404)
        self.state.exchange({"clientId": "web-client", "snapshot": SNAPSHOT, "results": []})
        data = self.get()
        self.assertTrue(data["online"])
        self.assertEqual(data["roomId"], SNAPSHOT["scene"]["roomId"])
        self.assertEqual(data["objectCount"], len(SNAPSHOT["scene"]["objects"]))
        self.assertNotIn("capture", data)
        self.assertNotIn("results", data)
        self.state.last_seen = -float("inf")
        self.assertEqual(self.get()["objects"], [])
        self.assertIsNone(self.get()["roomId"])

    def test_catalog_is_limited_and_transport_keeps_token_out_of_arguments(self):
        self.state.exchange({"clientId": "web-client", "snapshot": SNAPSHOT, "results": []})
        with self.state.lock:
            template = {"assetId": "cube", "anchorId": "floor",
                        "transform": {"position": {"x": 0, "y": 0, "z": 0},
                                      "rotation": {"x": 0, "y": 0, "z": 0},
                                      "scale": {"x": 1, "y": 1, "z": 1}}}
            self.state.latest["scene"]["objects"] = [
                {**template, "objectId": f"object-{index}"} for index in range(30)]
        summary = scene_summary(self.state)
        self.assertEqual(summary["objectCount"], 30)
        self.assertEqual(len(summary["objects"]), 24)
        self.assertTrue(summary["truncated"])
        fake_exe = str(Path(self.temp.name) / "codex.exe")
        with patch.object(CodexConfig, "validate"):
            backend = LocalCodexAgentBackend(CodexConfig(fake_exe), self.temp.name, self.bridge)
        command = backend.transport.command
        self.assertIn("app-server", command)
        self.assertTrue(any("mcp_servers.matrix_webxr.command=" in part for part in command))
        self.assertNotIn(self.bridge.token, " ".join(command))
        self.assertEqual(backend.transport.environment["MATRIX_CONTROL_TOKEN"], self.bridge.token)

    def test_private_client_ignores_environment_proxy(self):
        self.state.exchange({"clientId": "web-client", "snapshot": SNAPSHOT, "results": []})
        with patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:9",
                                  "HTTPS_PROXY": "http://127.0.0.1:9", "NO_PROXY": "browser"}):
            self.assertEqual(read_scene(self.bridge.url, self.bridge.token)["roomId"],
                             SNAPSHOT["scene"]["roomId"])

    def test_agent_backend_starts_private_listener_only_when_needed(self):
        other = State(self.temp.name)
        self.assertIsNone(other.matrix_tool_bridge)
        config = CodexConfig(str(Path(self.temp.name) / "codex.exe"))
        with patch("server.CodexConfig.from_environment", return_value=config), \
             patch.object(CodexConfig, "validate"):
            local_agent_backend(other)
        self.assertIsNotNone(other.matrix_tool_bridge)
        other.matrix_tool_bridge.close()


if __name__ == "__main__":
    unittest.main()
