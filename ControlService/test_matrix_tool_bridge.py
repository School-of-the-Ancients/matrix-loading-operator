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
from matrix_tool_bridge import (MatrixToolBridge, move_status,
                                move_with_room_constraint, read_scene,
                                room_spatial_context, scene_summary,
                                spawn_status, spawn_surface)
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

    def test_measured_room_bridge_requires_fresh_context_and_observed_spawn(self):
        origin = {"position": {"x": 0, "y": 0, "z": 0},
                  "rotation": {"x": 0, "y": 0, "z": 0},
                  "scale": {"x": 1, "y": 1, "z": 1}}
        pose = copy.deepcopy(origin)
        room = copy.deepcopy(SNAPSHOT)
        room["scene"]["roomId"] = "webxr-session-bridge"
        room["scene"]["objects"] = [{"objectId": "chair-vr", "assetId": "chair",
                                     "anchorId": "web-floor", "transform": copy.deepcopy(pose)}]
        room["assets"] = [{"assetId": "chair", "displayName": "Chair", "spawnScale": 1,
                           "localBounds": {"center": {"x": 0, "y": .45, "z": 0},
                                           "size": {"x": .6, "y": .9, "z": .6}}}]
        room["anchors"] = [{"anchorId": "web-floor", "displayName": "Virtual floor"},
                           {"anchorId": "webxr-plane-1", "displayName": "FLOOR",
                            "source": "webxr", "semanticLabels": ["FLOOR"],
                            "surface": {"kind": "support", "boundary": [
                                {"x": -2, "y": 0, "z": -2}, {"x": 2, "y": 0, "z": -2},
                                {"x": 2, "y": 0, "z": 2}, {"x": -2, "y": 0, "z": 2}]},
                            "roomPose": copy.deepcopy(origin)}]
        room["roomContext"] = {"mode": "ar", "state": "ready", "message": "Room aligned",
                               "alignmentVerified": True}
        room["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                     "renderer": "threejs-webxr", "presentation": "ar"}
        room["creatorMode"] = {"schemaVersion": 1, "mode": "creator",
                               "simulation": "paused", "revision": 0}
        room["spatialObservation"] = {"schemaVersion": 1, "planeAgeMs": 0,
                                      "trackingEpoch": 1, "webFloorPose": copy.deepcopy(origin)}
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": []})
        spatial = room_spatial_context(self.bridge.url, self.bridge.token)
        self.assertTrue(spatial["usable"])
        self.assertEqual(spatial["planeCount"], 1)
        self.assertEqual(spatial["planes"][0]["anchorId"], "webxr-plane-1")
        targeted = room_spatial_context(self.bridge.url, self.bridge.token,
                                        "webxr-plane-1")
        self.assertEqual(targeted["planes"][0]["spatialToken"],
                         spatial["planes"][0]["spatialToken"])
        with self.assertRaises(ValueError):
            room_spatial_context(self.bridge.url, self.bridge.token, "../other")
        self.assertEqual(spatial["coordinateFrame"], "xr-reference-space")
        request = {"room_id": spatial["roomId"], "scene_revision": spatial["sceneRevision"],
                   "spatial_token": spatial["spatialToken"], "asset_id": "chair",
                   "anchor_id": "webxr-plane-1", "transform": pose}
        with self.assertRaises(urllib.error.HTTPError) as denied_read:
            room_spatial_context(self.bridge.url, "wrong-token")
        self.assertEqual(denied_read.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as denied_write:
            spawn_surface(self.bridge.url, "wrong-token", request)
        self.assertEqual(denied_write.exception.code, 404)

        room["spatialObservation"]["trackingEpoch"] = 2
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": []})
        with self.assertRaises(urllib.error.HTTPError) as stale:
            spawn_surface(self.bridge.url, self.bridge.token, request)
        self.assertEqual(stale.exception.code, 409)
        self.assertFalse(self.state.pending)

        spatial = room_spatial_context(self.bridge.url, self.bridge.token)
        request.update(scene_revision=spatial["sceneRevision"],
                       spatial_token=spatial["spatialToken"])
        with patch("matrix_tool_bridge.MOVE_WAIT", .05):
            queued = spawn_surface(self.bridge.url, self.bridge.token, request)
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(queued["anchorId"], "web-floor")
        self.assertEqual(queued["supportAnchorId"], "webxr-plane-1")
        self.assertEqual(self.state.pending[queued["requestId"]]["anchorId"], "webxr-plane-1")
        canonical_pose = copy.deepcopy(pose)
        canonical_pose["position"]["x"] = .75
        self.state.exchange({"clientId": "web-client", "snapshot": room,
                             "results": [{"requestId": queued["requestId"], "ok": True,
                                          "objectId": "chair-1", "error": "",
                                          "outcome": {"kind": "room-surface-spawn",
                                                      "supportAnchorId": "webxr-plane-1",
                                                      "anchorId": "web-floor",
                                                      "transform": canonical_pose}}]})
        self.assertEqual(spawn_status(self.bridge.url, self.bridge.token,
                                      queued["requestId"])["status"], "unconfirmed",
                         "the receipt alone cannot prove a durable scene object")
        room["scene"]["objects"].append({"objectId": "chair-1", "assetId": "chair",
                                         "anchorId": "web-floor", "transform": canonical_pose})
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": []})
        spawned = spawn_status(self.bridge.url, self.bridge.token, queued["requestId"])
        self.assertEqual(spawned["status"], "succeeded")
        self.assertEqual(spawned["objectId"], "chair-1")
        self.assertEqual(spawned["transform"], canonical_pose)

        spatial = room_spatial_context(self.bridge.url, self.bridge.token)
        move = {"room_id": spatial["roomId"], "scene_revision": spatial["sceneRevision"],
                "spatial_token": spatial["spatialToken"], "anchor_id": "webxr-plane-1",
                "object_id": "chair-vr", "expected_asset_id": "chair",
                "position": {"x": 1, "y": 0, "z": 0}}
        with self.assertRaises(urllib.error.HTTPError) as denied_move:
            move_with_room_constraint(self.bridge.url, "wrong-token", move)
        self.assertEqual(denied_move.exception.code, 404)
        room["spatialObservation"]["trackingEpoch"] = 3
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": []})
        with self.assertRaises(urllib.error.HTTPError) as stale_move:
            move_with_room_constraint(self.bridge.url, self.bridge.token, move)
        self.assertEqual(stale_move.exception.code, 409)
        self.assertIn("Target support or room origin changed", str(stale_move.exception))
        self.assertFalse(self.state.pending)

        room["scene"]["objects"][0]["transform"]["rotation"]["x"] = 1
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": []})
        spatial = room_spatial_context(self.bridge.url, self.bridge.token)
        move.update(scene_revision=spatial["sceneRevision"],
                    spatial_token=spatial["planes"][0]["spatialToken"])
        with self.assertRaises(urllib.error.HTTPError) as tilted_move:
            move_with_room_constraint(self.bridge.url, self.bridge.token, move)
        self.assertEqual(tilted_move.exception.code, 409)
        self.assertIn("requires an upright object", str(tilted_move.exception))
        self.assertFalse(self.state.pending)
        move["rotation"] = {"x": 0, "y": 0, "z": 0}
        with patch("matrix_tool_bridge.MOVE_WAIT", .05):
            moved = move_with_room_constraint(self.bridge.url, self.bridge.token, move)
        self.assertEqual(moved["status"], "queued")
        command = self.state.pending[moved["requestId"]]
        self.assertEqual(command["op"], "set_transform")
        self.assertEqual(command["roomConstraint"], {"anchorId": "webxr-plane-1",
                                                      "trackingEpoch": 3})
        self.assertEqual(command["transform"]["position"], move["position"])
        room["scene"]["objects"][0]["transform"]["position"] = move["position"]
        room["scene"]["objects"][0]["transform"]["rotation"] = move["rotation"]
        self.state.exchange({"clientId": "web-client", "snapshot": room,
                             "results": [{"requestId": moved["requestId"], "ok": True,
                                          "objectId": "chair-vr", "error": ""}]})
        receipt = move_status(self.bridge.url, self.bridge.token, moved["requestId"])
        self.assertEqual(receipt["status"], "succeeded")
        self.assertEqual(receipt["constraintAnchorId"], "webxr-plane-1")
        self.assertEqual(receipt["transform"]["position"], move["position"])

        desktop = copy.deepcopy(room)
        desktop["scene"]["roomId"] = "web-virtual-room-v1"
        desktop["runtimeDescriptor"]["presentation"] = "desktop"
        desktop["roomContext"] = {"mode": "white-room", "state": "ready",
                                  "message": "Virtual room", "alignmentVerified": False}
        desktop["anchors"] = [{"anchorId": "web-floor", "displayName": "Virtual floor"}]
        desktop.pop("spatialObservation")
        self.state.exchange({"clientId": "web-client", "snapshot": desktop, "results": []})
        carried = spawn_status(self.bridge.url, self.bridge.token, queued["requestId"])
        self.assertEqual(carried["status"], "succeeded")
        self.assertEqual(carried["observedRoomId"], "web-virtual-room-v1")

    def test_native_image_turn_blocks_matrix_mutations_at_private_bridge(self):
        self.state.agent_portal._native_starting = True
        try:
            for path in ("/manipulation", "/spawn-builtin", "/spawn-surface", "/move-room", "/scale",
                         "/register-glb", "/concept-build"):
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
