"""PC-local Codex component publication and browser receipt contract."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from agent_session import LocalCodexAgentBackend, _mcp_approval_description
from codex_provider import CodexConfig
from matrix_tool_bridge import (MatrixToolBridge, component_action, component_status,
                                list_components, publish_component, scene_summary)
from server import APIError, State
from web_component_catalog import WebComponentCatalog
from web_components import ComponentError


PACKAGE = {"schemaVersion": 1, "name": "Orbit pulse", "outputs": {
    "position.x": {"op": "add", "args": [{"op": "target", "path": "position.x"},
                                       {"op": "cos", "arg": {"op": "time"}}]},
    "scale.y": {"op": "add", "args": [{"op": "self", "path": "scale.y"},
                                    {"op": "sin", "arg": {"op": "time"}}]}}}
POSE = {"position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
ROOM = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": [
    {"objectId": key, "assetId": key, "anchorId": "web-floor", "transform": POSE}
    for key in ("table", "orb")]}, "assets": [], "anchors": [],
    "componentSchemaVersion": 1,
    "roomContext": {"mode": "white-room", "state": "ready", "message": "Virtual room",
                    "alignmentVerified": False}}


class MatrixComponentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.state.exchange({"clientId": "web-client", "snapshot": deepcopy(ROOM)})
        self.published = self.state.agent_publish_component({"package": PACKAGE})

    def request(self, action="attach", **overrides):
        value = {"action": action, "room_id": ROOM["scene"]["roomId"],
                 "scene_revision": self.state.revision, "object_id": "orb", "expected_asset_id": "orb",
                 "component_id": self.published["componentId"]}
        if action == "attach":
            value["target_object_id"] = "table"
        return {**value, **overrides}

    def ack(self, request_id, attachment):
        room = deepcopy(ROOM)
        if attachment is not None:
            room["scene"]["objects"][1]["component"] = attachment
        self.state.exchange({"clientId": "web-client", "snapshot": room,
                             "results": [{"requestId": request_id, "ok": True, "objectId": "orb"}]})

    def attachment(self, status="running", error=None):
        value = {"componentId": self.published["componentId"], "package": PACKAGE,
                 "targetObjectId": "table", "startedAtMs": 1000, "status": status}
        if error:
            value["error"] = error
        return value

    def test_immutable_publication_survives_restart_and_tampering_fails(self):
        self.assertEqual(self.state.agent_publish_component({"package": PACKAGE}), self.published)
        catalog = WebComponentCatalog(Path(self.temp.name) / "web_components")
        self.assertEqual(catalog.get(self.published["componentId"])["package"], PACKAGE)
        newer = deepcopy(PACKAGE)
        newer["outputs"]["position.x"]["args"][1]["op"] = "sin"
        new_id = catalog.publish(newer)["componentId"]
        self.assertNotEqual(new_id, self.published["componentId"])
        self.assertEqual(self.state.agent_list_components()["total"], 2)
        manifest = catalog.root / "manifest.json"
        content = json.loads(manifest.read_text(encoding="utf-8"))
        content[0]["package"]["name"] = "Tampered"
        manifest.write_text(json.dumps(content), encoding="utf-8")
        with self.assertRaisesRegex(ComponentError, "corrupt"):
            catalog.list()

    def test_attach_stop_remove_observe_runtime_receipts(self):
        attached = self.state.agent_component_action(self.request())
        self.assertEqual(attached["status"], "queued")
        self.assertEqual(self.state.pending[attached["requestId"]]["op"], "attach_component")
        self.ack(attached["requestId"], self.attachment())
        self.assertEqual(self.state.agent_component_status(attached["requestId"])["status"], "succeeded")
        self.assertEqual(scene_summary(self.state)["objects"][1]["component"]["status"], "running")
        stopped = self.state.agent_component_action(self.request("stop"))
        self.assertEqual(self.state.pending[stopped["requestId"]]["op"], "stop_component")
        self.ack(stopped["requestId"], self.attachment("stopped"))
        self.assertEqual(self.state.agent_component_status(stopped["requestId"])["status"], "succeeded")
        removed = self.state.agent_component_action(self.request("remove"))
        self.ack(removed["requestId"], None)
        self.assertEqual(self.state.agent_component_status(removed["requestId"])["status"], "succeeded")
        self.assertNotIn("component", scene_summary(self.state)["objects"][1])

    def test_failure_unconfirmed_and_stale_requests_do_not_fake_success(self):
        for bad in (self.request(room_id="other"), self.request(scene_revision=0),
                    self.request(expected_asset_id="chair"),
                    self.request(target_object_id="missing"),
                    self.request(component_id="webcomp:missing:000000000000")):
            with self.assertRaises((APIError, ComponentError)):
                self.state.agent_component_action(bad)
        self.assertFalse(self.state.pending)
        queued = self.state.agent_component_action(self.request())
        with self.assertRaises(APIError):
            self.state.agent_component_action(self.request())
        self.ack(queued["requestId"], None)
        self.assertEqual(self.state.agent_component_status(queued["requestId"])["status"], "unconfirmed")
        other = State(Path(self.temp.name) / "other")
        other.exchange({"clientId": "web-client", "snapshot": deepcopy(ROOM)})
        published = other.agent_publish_component({"package": PACKAGE})
        action = {**self.request(), "scene_revision": other.revision,
                  "component_id": published["componentId"]}
        failed = other.agent_component_action(action)
        room = deepcopy(ROOM)
        room["scene"]["objects"][1]["component"] = self.attachment("failed", "Output exceeded bounds")
        other.exchange({"clientId": "web-client", "snapshot": room,
                        "results": [{"requestId": failed["requestId"], "ok": True,
                                     "objectId": "orb"}]})
        result = other.agent_component_status(failed["requestId"])
        self.assertEqual(result["status"], "failed")
        self.assertIn("bounds", result["error"])

    def test_private_bridge_authentication_and_native_approval_scope(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch("matrix_tool_bridge.MOVE_WAIT", 0.05):
            self.assertEqual(list_components(bridge.url, bridge.token)["total"], 1)
            self.assertEqual(publish_component(bridge.url, bridge.token, PACKAGE)["componentId"],
                             self.published["componentId"])
            queued = component_action(bridge.url, bridge.token, self.request())
            self.assertEqual(queued["status"], "queued")
            self.assertEqual(component_status(bridge.url, bridge.token, queued["requestId"])["status"],
                             "queued")
            with self.assertRaises(urllib.error.HTTPError):
                list_components(bridge.url, "wrong-token")
        with patch.object(CodexConfig, "validate"):
            backend = LocalCodexAgentBackend(CodexConfig("codex.exe"), self.temp.name, bridge)
        settings = " ".join(backend.transport.command)
        for tool in ("matrix_publish_component", "matrix_attach_component",
                     "matrix_stop_component", "matrix_remove_component"):
            self.assertIn(f"tools.{tool}.approval_mode", settings)
        self.assertNotIn(bridge.token, settings)
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_attach_component"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {
                        key: value for key, value in self.request().items() if key != "action"}}}
        summary, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("targeting table", summary)
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**approval["_meta"]["tool_params"],
                                                  "secret": "none"}}})[1])
        publication = {**approval,
                       "message": 'Allow the matrix_webxr MCP server to run tool "matrix_publish_component"?',
                       "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {"package": PACKAGE}}}
        publication_summary, publication_reviewable = _mcp_approval_description(publication)
        self.assertTrue(publication_reviewable)
        self.assertIn(self.published["componentId"], publication_summary)
        self.assertIn("no world change", publication_summary)
        self.assertFalse(_mcp_approval_description({**publication, "_meta": {
            **publication["_meta"], "tool_params": {"package": PACKAGE, "secret": "none"}}})[1])

    def test_unicode_component_name_keeps_immutable_ascii_identity(self):
        localized = deepcopy(PACKAGE)
        localized["name"] = "轨道"
        published = self.state.agent_publish_component({"package": localized})
        self.assertRegex(published["componentId"], r"^webcomp:component-[0-9a-f]{8}:[0-9a-f]{12}$")
        self.assertEqual(self.state.agent_publish_component({"package": localized}), published)
        self.assertEqual(self.state.web_components.get(published["componentId"])["package"]["name"], "轨道")


if __name__ == "__main__":
    unittest.main()
