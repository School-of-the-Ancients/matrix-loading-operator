"""PC-only MCP bridge reads the live Matrix scene with bounded output."""
import copy
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
        self.assertIsNone(self.get()["room"])
        self.assertIsNone(self.get()["digitalWorldVisit"])
        self.assertIsNone(self.get()["runtimeDescriptor"])
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("wrong-token")
        self.assertEqual(error.exception.code, 404)
        self.state.exchange({"clientId": "web-client", "snapshot": SNAPSHOT, "results": []})
        data = self.get()
        self.assertTrue(data["online"])
        self.assertEqual(data["roomId"], SNAPSHOT["scene"]["roomId"])
        self.assertEqual(data["room"], {"mode": "unknown", "state": "unknown",
                                        "alignmentVerified": False, "readOnly": False})
        self.assertFalse(data["digitalWorldVisit"])
        self.assertEqual(data["objectCount"], len(SNAPSHOT["scene"]["objects"]))
        self.assertNotIn("capture", data)
        self.assertNotIn("results", data)
        with self.state.lock:
            self.state.latest["runtimeDescriptor"] = {"schemaVersion": 1,
                "client": "matrix-web", "renderer": "threejs-webxr",
                "presentation": "desktop"}
        self.assertEqual(self.get()["runtimeDescriptor"]["presentation"], "desktop")
        self.state.last_seen = -float("inf")
        self.assertEqual(self.get()["objects"], [])
        self.assertIsNone(self.get()["roomId"])
        self.assertIsNone(self.get()["room"])
        self.assertIsNone(self.get()["digitalWorldVisit"])
        self.assertIsNone(self.get()["runtimeDescriptor"])

    def test_live_room_readiness_tracks_ar_origin_loss_without_exposing_room_message(self):
        desktop = copy.deepcopy(SNAPSHOT)
        desktop["roomContext"] = {"mode": "white-room", "state": "ready",
                                  "alignmentVerified": False, "message": "Browser floor"}
        desktop["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                        "renderer": "threejs-webxr", "presentation": "desktop"}
        self.state.exchange({"clientId": "web-client", "snapshot": desktop, "results": []})
        self.assertEqual(self.get()["room"], {"mode": "white-room", "state": "ready",
                                               "alignmentVerified": False, "readOnly": False})

        ar = copy.deepcopy(desktop)
        ar["scene"]["roomId"] = "webxr-session-1"
        ar["roomContext"] = {"mode": "ar", "state": "ready",
                             "alignmentVerified": False, "message": "Tracking but not aligned"}
        ar["runtimeDescriptor"]["presentation"] = "ar"
        self.state.exchange({"clientId": "web-client", "snapshot": ar, "results": []})
        summary = self.get()
        self.assertEqual(summary["roomMode"], "ar")
        self.assertEqual(summary["room"], {"mode": "ar", "state": "ready",
                                           "alignmentVerified": False, "readOnly": False})
        self.assertNotIn("Tracking but not aligned", json.dumps(summary))

        ar["roomContext"]["alignmentVerified"] = True
        self.state.exchange({"clientId": "web-client", "snapshot": ar, "results": []})
        self.assertTrue(self.get()["room"]["alignmentVerified"])

        ar["roomContext"] = {"mode": "ar", "state": "missing",
                             "alignmentVerified": False, "message": "Origin tracking lost"}
        ar["readOnly"] = True
        self.state.exchange({"clientId": "web-client", "snapshot": ar, "results": []})
        summary = self.get()
        self.assertTrue(summary["online"])
        self.assertEqual(summary["room"], {"mode": "ar", "state": "missing",
                                           "alignmentVerified": False, "readOnly": True})
        self.assertNotIn("Origin tracking lost", json.dumps(summary))

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
        self.assertTrue(any("tools.matrix_move_object.approval_mode=" in part for part in command))
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

    def test_native_image_turn_blocks_matrix_mutations_at_private_bridge(self):
        self.state.agent_portal._native_starting = True
        try:
            for path in ("/spawn-builtin", "/scale", "/register-glb", "/concept-build"):
                with self.subTest(path=path):
                    request = urllib.request.Request(
                        self.bridge.url.replace("/scene", path), data=b"{}",
                        headers={"Authorization": "Bearer " + self.bridge.token,
                                 "Content-Type": "application/json"})
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(request, timeout=3)
                    self.assertEqual(error.exception.code, 409)
                    self.assertIn("blocked during native concept image generation",
                                  error.exception.read().decode("utf-8"))
            self.assertEqual(len(self.state.agent_spawn_ids), 0)
        finally:
            self.state.agent_portal._native_starting = False


if __name__ == "__main__":
    unittest.main()
