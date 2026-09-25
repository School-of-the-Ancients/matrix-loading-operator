"""Matrix MCP catalog tools reuse the validated content-addressed GLB boundary."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from agent_session import _mcp_approval_description
from matrix_tool_bridge import MatrixToolBridge, list_assets, register_glb
from server import APIError, State
from test_web_assets import glb
from web_assets import WebAssetError


class MatrixCatalogToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = State(self.root / "scenes", web_assets_directory=self.root / "catalog")
        self.source = self.root / "triangle.glb"
        self.source.write_bytes(glb())
        self.digest = hashlib.sha256(self.source.read_bytes()).hexdigest()

    def request(self, **overrides):
        return {"source_path": str(self.source), "expected_sha256": self.digest,
                "name": "Test Triangle", "description": "", "spawn_scale": 1,
                "local_bounds": None, **overrides}

    def test_register_uses_validator_and_lists_bounded_catalog(self):
        entry = self.state.agent_register_glb(self.request())
        self.assertEqual(entry["status"], "registered")
        self.assertEqual(entry["sha256"], self.digest)
        self.assertEqual(self.state.web_assets.file(self.digest).read_bytes(), self.source.read_bytes())
        self.assertNotIn(str(self.source), str(entry))
        self.assertEqual(list((self.root / "scenes").glob(".agent-glb-*")), [])
        listed = self.state.agent_list_assets()
        self.assertEqual(listed["total"], 1)
        self.assertEqual(listed["assets"][0]["assetId"], entry["assetId"])
        self.assertEqual(self.state.agent_register_glb(self.request())["assetId"], entry["assetId"])
        self.assertEqual(self.state.agent_list_assets()["total"], 1)
        scaled = self.state.agent_register_glb(self.request(spawn_scale=2))
        self.assertEqual(scaled["spawnScale"], 2)
        self.assertEqual(self.state.agent_register_glb(self.request())["spawnScale"], 2)
        with self.assertRaises(APIError):
            self.state.agent_list_assets(0, 25)
        with self.assertRaises(WebAssetError):
            self.state.agent_register_glb(self.request(spawn_scale=True))

    def test_changed_or_invalid_glb_never_enters_catalog(self):
        with self.assertRaisesRegex(APIError, "changed"):
            self.state.agent_register_glb(self.request(expected_sha256="0" * 64))
        self.assertEqual(self.state.agent_list_assets()["total"], 0)
        external = self.root / "external.glb"
        external.write_bytes(glb(external=True))
        with self.assertRaisesRegex(WebAssetError, "External"):
            self.state.agent_register_glb(self.request(source_path=str(external),
                expected_sha256=hashlib.sha256(external.read_bytes()).hexdigest()))
        self.assertEqual(self.state.agent_list_assets()["total"], 0)
        with self.assertRaises(APIError):
            self.state.agent_register_glb(self.request(source_path="https://example.test/asset.glb"))

    def test_private_catalog_endpoints_ignore_proxy_and_require_token(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:9", "NO_PROXY": "browser"}):
            result = register_glb(bridge.url, bridge.token, self.request())
            self.assertEqual(result["sha256"], self.digest)
            page = list_assets(bridge.url, bridge.token)
            self.assertEqual(page["assets"][0]["assetId"], result["assetId"])
            large = register_glb(bridge.url, bridge.token,
                                 self.request(name="Emoji Triangle", description="😀" * 500))
            self.assertEqual(large["status"], "registered")
            self.assertEqual(list_assets(bridge.url, bridge.token)["total"], 2)
            with self.assertRaises(urllib.error.HTTPError):
                list_assets(bridge.url, "wrong-token")

    def test_xr_approval_uses_filename_and_digest_not_pc_path(self):
        args = {"source_path": str(self.source), "expected_sha256": self.digest,
                "name": "Test Triangle"}
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_register_glb"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": args}}
        summary, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("triangle.glb", summary)
        self.assertIn(self.digest[:12], summary)
        self.assertNotIn(str(self.root), summary)
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**args, "description": "more detail"}}})[1])
        for changed in ({"name": "Tri\u202eangle"},
                        {"source_path": str(self.source.with_name("tri\u202eangle.glb"))}):
            summary, reviewable = _mcp_approval_description({**approval, "_meta": {
                **approval["_meta"], "tool_params": {**args, **changed}}})
            self.assertFalse(reviewable)
            self.assertNotIn("\u202e", summary)


if __name__ == "__main__":
    unittest.main()
