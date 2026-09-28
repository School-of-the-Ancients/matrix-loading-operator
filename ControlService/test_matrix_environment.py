"""Panorama catalog, typed receipts and persistent world dependency checks."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
import zlib

from agent_session import _mcp_approval_description
from matrix_tool_bridge import (MatrixToolBridge, environment_action,
                                environment_status, list_environments, scene_summary)
from server import APIError, Server, State, command, scene, snapshot
from web_environments import WebEnvironmentCatalog, WebEnvironmentError


def png(width=4, height=2, *, color=(20, 80, 160)):
    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload +
                struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff))
    pixels = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


class MatrixEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.catalog = WebEnvironmentCatalog(self.root / "panoramas")
        self.source_a = self.root / "sunset-a.png"
        self.source_b = self.root / "sunset-b.png"
        self.source_a.write_bytes(png())
        self.source_b.write_bytes(png(color=(120, 40, 10)))
        self.a = self.catalog.register(self.source_a, "Sunset A")
        self.b = self.catalog.register(self.source_b, "Sunset B")
        self.state = State(self.root / "scenes",
                           web_environments_directory=self.catalog.root)
        self.object = {"objectId": "block-1", "assetId": "block", "anchorId": "web-floor",
                       "transform": {"position": {"x": 1, "y": 0, "z": -2},
                                     "rotation": {"x": 0, "y": 0, "z": 0},
                                     "scale": {"x": 1, "y": 1, "z": 1}}}
        self.base = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                               "objects": [copy.deepcopy(self.object)]},
                     "assets": [{"assetId": "block", "displayName": "Block"}],
                     "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                     "environmentSchemaVersion": 1,
                     "environmentAssets": self.catalog.list(),
                     "creatorMode": {"schemaVersion": 1, "mode": "creator",
                                     "simulation": "paused", "revision": 0},
                     "roomContext": {"mode": "white-room", "state": "ready",
                                     "message": "Digital world", "alignmentVerified": False}}
        self.exchange()

    def descriptor(self, entry, yaw=0):
        return {"schemaVersion": 1, "kind": "equirectangular",
                "assetId": entry["assetId"], "sha256": entry["sha256"],
                "yawDegrees": yaw}

    def exchange(self, environment=None, receipt=None, *, outcome=None):
        value = copy.deepcopy(self.base)
        if environment is not None:
            value["scene"]["environment"] = copy.deepcopy(environment)
        results = []
        if receipt:
            results = [{"requestId": receipt, "ok": True, "error": "",
                        "objectId": "", "outcome": outcome}]
        self.state.exchange({"clientId": "web-client", "snapshot": value,
                             "results": results})

    def action(self, action, **extra):
        return self.state.agent_environment_action({
            "action": action, "room_id": "web-virtual-room-v1",
            "scene_revision": self.state.revision, **extra})

    def test_png_registration_is_content_addressed_and_rejects_invalid_pixels(self):
        self.assertEqual(self.catalog.register(self.source_a, "Different name"), self.a)
        self.assertEqual(len(self.catalog.list()), 2)
        self.assertEqual(self.catalog.file(self.a["sha256"]).read_bytes(), self.source_a.read_bytes())
        invalid = [png(width=4, height=3), png()[:-9],
                   png().replace(b"IHDR", b"IHdR", 1)]
        for index, data in enumerate(invalid):
            source = self.root / f"invalid-{index}.png"
            source.write_bytes(data)
            with self.assertRaises(WebEnvironmentError):
                self.catalog.register(source, "Invalid")
        source = self.root / "corrupt-zlib.png"
        data = png()
        idat_at = data.index(b"IDAT") + 4
        changed = bytearray(data)
        changed[idat_at + 2] ^= 0xff
        crc_at = data.index(b"IEND") - 4
        changed[crc_at:crc_at + 4] = struct.pack(">I", zlib.crc32(changed[idat_at - 4:crc_at]) & 0xffffffff)
        source.write_bytes(changed)
        with self.assertRaises(WebEnvironmentError):
            self.catalog.register(source, "Corrupt pixels")

    def test_set_change_get_remove_are_receipt_bound_and_preserve_objects(self):
        first = self.descriptor(self.a, 35)
        second = self.descriptor(self.b, 170)
        queued = self.action("set", asset_id=self.a["assetId"], yaw_degrees=35)
        self.assertEqual(self.state.pending[queued["requestId"]]["expectedEnvironment"], None)
        self.exchange(first, queued["requestId"], outcome={
            "kind": "environment-set", "environment": first,
            "previousEnvironment": None})
        self.assertEqual(self.state.agent_environment_status(queued["requestId"])["status"],
                         "succeeded")
        self.assertEqual(scene_summary(self.state)["environment"], first)
        self.assertEqual(self.state.latest["scene"]["objects"], [self.object])
        read = self.action("get")
        self.exchange(first, read["requestId"], outcome={
            "kind": "environment-status", "environment": first})
        self.assertEqual(self.state.agent_environment_status(read["requestId"])["status"],
                         "succeeded")
        changed = self.action("set", asset_id=self.b["assetId"], yaw_degrees=170)
        self.exchange(second, changed["requestId"], outcome={
            "kind": "environment-set", "environment": second,
            "previousEnvironment": first})
        self.assertEqual(self.state.agent_environment_status(changed["requestId"])["status"],
                         "succeeded")
        removed = self.action("remove")
        self.exchange(None, removed["requestId"], outcome={
            "kind": "environment-removed", "environment": None,
            "previousEnvironment": second})
        self.assertEqual(self.state.agent_environment_status(removed["requestId"])["status"],
                         "succeeded")
        self.assertEqual(self.state.latest["scene"]["objects"], [self.object])

    def test_stale_or_corrupt_environment_is_not_queued_or_loaded(self):
        with self.assertRaises(APIError):
            self.state.agent_environment_action({"action": "set", "room_id": "web-virtual-room-v1",
                "scene_revision": self.state.revision - 1,
                "asset_id": self.a["assetId"], "yaw_degrees": 0})
        with self.assertRaises(APIError):
            command({"op": "set_environment", "roomId": "web-virtual-room-v1",
                     "environment": self.descriptor(self.a)})
        bad = self.descriptor(self.a)
        bad["yawDegrees"] = 360
        with self.assertRaises(APIError):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [], "environment": bad})
        (self.catalog.root / f"{self.a['sha256']}.png").write_bytes(b"damaged")
        with self.assertRaisesRegex(APIError, "corrupt"):
            self.action("set", asset_id=self.a["assetId"], yaw_degrees=0)
        self.assertEqual(len(self.state.pending), 0)

    def test_mismatched_browser_receipt_does_not_confirm_a_panorama(self):
        target = self.descriptor(self.a, 20)
        queued = self.action("set", asset_id=self.a["assetId"], yaw_degrees=20)
        request_id = queued["requestId"]
        with self.assertRaisesRegex(APIError, "receipt"):
            self.exchange(target, request_id, outcome={
                "kind": "environment-set", "environment": target,
                "previousEnvironment": self.descriptor(self.b)})
        self.assertIn(request_id, self.state.pending)
        self.assertNotIn("environment", self.state.latest["scene"])
        with self.assertRaisesRegex(APIError, "kind"):
            self.exchange(target, request_id, outcome={
                "kind": "environment-removed", "environment": target,
                "previousEnvironment": None})
        self.assertIn(request_id, self.state.pending)
        self.exchange(target, request_id, outcome={
            "kind": "environment-set", "environment": target,
            "previousEnvironment": None})
        self.assertEqual(self.state.agent_environment_status(request_id)["status"],
                         "succeeded")

    def test_pc_checkpoint_binds_panorama_digest_and_legacy_world_still_loads(self):
        legacy = {"version": 2, "scene": copy.deepcopy(self.state.latest["scene"]),
                  "game": None}
        self.state.save_world_checkpoint("legacy", legacy)
        self.assertEqual(self.state.load_world_checkpoint("legacy")["world"], legacy)
        descriptor = self.descriptor(self.a, 42)
        self.exchange(descriptor)
        world = {"version": 2, "scene": copy.deepcopy(self.state.latest["scene"]),
                 "game": None}
        saved = self.state.save_world_checkpoint("panorama", world)
        self.assertEqual(saved["dependencies"], [{"kind": "panorama",
            "assetId": self.a["assetId"], "sha256": self.a["sha256"]}])
        self.assertEqual(self.state.load_world_checkpoint("panorama")["world"], world)
        (self.catalog.root / f"{self.a['sha256']}.png").write_bytes(b"broken")
        with self.assertRaisesRegex(APIError, "corrupt"):
            self.state.load_world_checkpoint("panorama")
        self.assertEqual(self.state.latest["scene"]["environment"], descriptor)

    def test_private_bridge_and_http_route_use_catalog_and_digest_bytes(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        page = list_environments(bridge.url, bridge.token)
        self.assertEqual(page["total"], 2)
        with patch("matrix_tool_bridge.MOVE_WAIT", .01):
            queued = environment_action(bridge.url, bridge.token, {
                "action": "set", "room_id": "web-virtual-room-v1",
                "scene_revision": self.state.revision,
                "asset_id": self.a["assetId"], "yaw_degrees": 0})
        self.assertEqual(environment_status(bridge.url, bridge.token,
                                            queued["requestId"])["status"], "queued")
        server = Server(("127.0.0.1", 0), self.state)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_port}"
        with urllib.request.urlopen(base + "/api/web/environments", timeout=3) as response:
            self.assertEqual(json.load(response)["assets"], self.catalog.list())
        with urllib.request.urlopen(base + self.a["url"], timeout=3) as response:
            self.assertEqual(response.headers["Content-Type"], "image/png")
            self.assertEqual(hashlib.sha256(response.read()).hexdigest(), self.a["sha256"])
        (self.catalog.root / f"{self.a['sha256']}.png").write_bytes(b"broken")
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(base + self.a["url"], timeout=3)
        self.assertEqual(error.exception.code, 404)

    def test_native_approval_summarizes_exact_panorama_action(self):
        params = {"serverName": "matrix_webxr",
                  "message": 'Allow the matrix_webxr MCP server to run tool "matrix_set_environment"?',
                  "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {
                      "room_id": "web-virtual-room-v1", "scene_revision": 4,
                      "asset_id": self.a["assetId"], "yaw_degrees": 90}}}
        summary, reviewable = _mcp_approval_description(params)
        self.assertTrue(reviewable)
        self.assertIn(self.a["assetId"], summary)
        self.assertIn("90 degrees", summary)


if __name__ == "__main__":
    unittest.main()
