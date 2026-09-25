"""Named GLB clip bindings cross the PC gateway and observed browser receipt."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from agent_session import LocalCodexAgentBackend, _mcp_approval_description
from codex_provider import CodexConfig
from matrix_tool_bridge import MatrixToolBridge, animation_status, bind_animation, scene_summary
from server import APIError, State
from test_web_assets import animated_glb


POSE = {"position": {"x": 0, "y": 0, "z": -2}, "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}


def two_clips(document):
    second = deepcopy(document["animations"][0])
    second["name"] = "Roar"
    document["animations"].append(second)


class MatrixAnimationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = State(root / "state", web_assets_directory=root / "assets")
        source = root / "dragon.glb"
        source.write_bytes(animated_glb(two_clips))
        self.asset = self.state.web_assets.register(source, "Ice Dragon")
        self.names = [clip["name"] for clip in self.asset["geometry"]["animationClips"]]
        self.room = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": [
            {"objectId": "dragon-1", "assetId": self.asset["assetId"], "anchorId": "web-floor",
             "transform": POSE}]}, "assets": [{"assetId": self.asset["assetId"],
             "displayName": "Ice Dragon", "animationClips": self.names}],
             "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
             "animationSchemaVersion": 1,
             "roomContext": {"mode": "white-room", "state": "ready",
                             "alignmentVerified": False, "message": "Virtual room"}}
        self.exchange()

    def exchange(self, binding=None, *, request_id=None, ok=True, error=""):
        room = deepcopy(self.room)
        if binding:
            room["scene"]["objects"][0]["animation"] = binding
        results = [{"requestId": request_id, "ok": ok, "error": error,
                    "objectId": "dragon-1"}] if request_id else []
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": results})

    def request(self, **overrides):
        return {"room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
                "object_id": "dragon-1", "expected_asset_id": self.asset["assetId"],
                "loop_clip": "Flight", "select_clip": "Roar", **overrides}

    def test_binding_and_removal_require_observed_runtime_state(self):
        queued = self.state.agent_bind_animation(self.request())
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(self.state.pending[queued["requestId"]]["op"], "bind_animation")
        self.exchange(request_id=queued["requestId"])
        self.assertEqual(self.state.agent_animation_status(queued["requestId"])["status"], "unconfirmed")
        next_queued = self.state.agent_bind_animation(self.request())
        binding = {"loopClip": "Flight", "selectClip": "Roar"}
        self.exchange(binding, request_id=next_queued["requestId"])
        self.assertEqual(self.state.agent_animation_status(next_queued["requestId"])["status"], "succeeded")
        self.assertEqual(scene_summary(self.state)["objects"][0]["animation"], binding)
        remove = self.state.agent_bind_animation(self.request(loop_clip=None, select_clip=None))
        self.exchange(request_id=remove["requestId"])
        self.assertEqual(self.state.agent_animation_status(remove["requestId"])["status"], "succeeded")
        self.assertNotIn("animation", scene_summary(self.state)["objects"][0])

    def test_stale_unknown_offline_and_ar_fail_without_queue(self):
        for bad in (self.request(room_id="other"), self.request(scene_revision=0),
                    self.request(expected_asset_id="chair"), self.request(select_clip="Unknown"),
                    self.request(loop_clip="Roar", select_clip="Roar"),
                    self.request(select_clip="\u202eRoar")):
            with self.assertRaises(APIError):
                self.state.agent_bind_animation(bad)
        self.assertFalse(self.state.pending)
        self.state.latest["roomContext"]["mode"] = "ar"
        with self.assertRaisesRegex(APIError, "virtual room"):
            self.state.agent_bind_animation(self.request())
        self.state.latest["roomContext"]["mode"] = "white-room"
        self.state.latest["assets"][0]["animationClips"] = []
        with self.assertRaisesRegex(APIError, "current GLB animation catalog"):
            self.state.agent_bind_animation(self.request())
        self.state.last_seen = -float("inf")
        with self.assertRaises(APIError):
            self.state.agent_bind_animation(self.request())

    def test_failure_unconfirmed_and_snapshot_validation(self):
        queued = self.state.agent_bind_animation(self.request())
        self.exchange(request_id=queued["requestId"], ok=False, error="Clip unavailable")
        status = self.state.agent_animation_status(queued["requestId"])
        self.assertEqual(status["status"], "failed")
        self.assertIn("Clip unavailable", status["error"])
        next_queued = self.state.agent_bind_animation(self.request())
        self.state.last_seen = -float("inf")
        self.assertEqual(self.state.agent_animation_status(next_queued["requestId"])["status"], "unconfirmed")
        room = deepcopy(self.room)
        room["scene"]["objects"][0]["animation"] = {"loopClip": "Unknown", "selectClip": None}
        with self.assertRaisesRegex(APIError, "clip is unavailable"):
            self.state.exchange({"clientId": "web-client", "snapshot": room})

    def test_private_bridge_native_approval_and_secret_isolation(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch("matrix_tool_bridge.MOVE_WAIT", .05):
            queued = bind_animation(bridge.url, bridge.token, self.request())
            self.assertEqual(animation_status(bridge.url, bridge.token, queued["requestId"])["status"], "queued")
            with self.assertRaises(urllib.error.HTTPError):
                animation_status(bridge.url, "wrong-token", queued["requestId"])
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_bind_animation"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": self.request()}}
        summary, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("Flight", summary)
        self.assertIn("Roar", summary)
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**self.request(), "token": "secret"}}})[1])
        with patch.object(CodexConfig, "validate"):
            backend = LocalCodexAgentBackend(CodexConfig("codex.exe"), self.temp.name, bridge)
        settings = " ".join(backend.transport.command)
        self.assertIn("matrix_bind_animation", settings)
        self.assertIn("matrix_animation_status", settings)
        self.assertIn("tools.matrix_bind_animation.approval_mode", settings)
        self.assertNotIn(bridge.token, settings)


if __name__ == "__main__":
    unittest.main()
