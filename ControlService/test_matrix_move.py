"""Typed Matrix move uses the existing queue and runtime receipt contract."""
from copy import deepcopy
import math
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from agent_session import _mcp_approval_description
from matrix_tool_bridge import MatrixToolBridge, move_object, move_status
from server import APIError, State


POSE = {"position": {"x": 0, "y": 0, "z": -2},
        "rotation": {"x": 0, "y": 45, "z": 0}, "scale": {"x": 1.5, "y": 1.5, "z": 1.5}}
ROOM = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                  "objects": [{"objectId": "chair-1", "assetId": "chair", "anchorId": "web-floor",
                               "transform": POSE}]},
        "assets": [{"assetId": "chair", "displayName": "Chair"}],
        "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
        "roomContext": {"mode": "white-room", "state": "ready", "alignmentVerified": False,
                        "message": "Browser virtual floor"}}


class MatrixMoveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.state.exchange({"clientId": "web-client", "snapshot": deepcopy(ROOM), "results": []})

    def request(self, **overrides):
        return {"room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
                "object_id": "chair-1", "expected_asset_id": "chair",
                "position": {"x": 2, "y": 0, "z": -3}, **overrides}

    def ack(self, request_id, *, ok=True, updated=True, error=""):
        room = deepcopy(ROOM)
        if updated:
            room["scene"]["objects"][0]["transform"]["position"] = {"x": 2, "y": 0, "z": -3}
        self.state.exchange({"clientId": "web-client", "snapshot": room,
                             "results": [{"requestId": request_id, "ok": ok, "error": error,
                                          "objectId": "chair-1"}]})

    def test_queues_one_move_and_requires_observed_receipt(self):
        queued = self.state.agent_move(self.request())
        self.assertEqual(queued["status"], "queued")
        command = self.state.pending[queued["requestId"]]
        self.assertEqual(command["op"], "set_transform")
        self.assertEqual(command["transform"]["position"], {"x": 2, "y": 0, "z": -3})
        self.assertEqual(command["transform"]["rotation"], POSE["rotation"])
        self.assertEqual(command["transform"]["scale"], POSE["scale"])
        self.ack(queued["requestId"])
        self.assertEqual(self.state.agent_move_status(queued["requestId"])["status"], "succeeded")

    def test_rotation_only_preserves_position_scale_identity_and_flight_binding(self):
        room = deepcopy(ROOM)
        room["animationSchemaVersion"] = 1
        room["assets"][0]["animationClips"] = ["Flight"]
        binding = {"loopClip": "Flight", "selectClip": None}
        room["scene"]["objects"][0]["animation"] = binding
        self.state.exchange({"clientId": "web-client", "snapshot": room, "results": []})
        rotation = {"x": .17, "y": 180.26, "z": -6.64}
        queued = self.state.agent_move(self.request(position=deepcopy(POSE["position"]),
                                                    rotation=rotation))
        command = self.state.pending[queued["requestId"]]
        self.assertEqual(command["op"], "set_transform")
        self.assertEqual(command["objectId"], "chair-1")
        self.assertEqual(command["transform"], {**POSE, "rotation": rotation})
        room["scene"]["objects"][0]["transform"]["rotation"] = rotation
        self.state.exchange({"clientId": "web-client", "snapshot": room,
                             "results": [{"requestId": queued["requestId"], "ok": True,
                                          "error": "", "objectId": "chair-1"}]})
        self.assertEqual(self.state.agent_move_status(queued["requestId"])["status"], "succeeded")
        observed = self.state.latest["scene"]["objects"][0]
        self.assertEqual(observed["objectId"], "chair-1")
        self.assertEqual(observed["transform"], {**POSE, "rotation": rotation})
        self.assertEqual(observed["animation"], binding)

    def test_rotation_receipt_requires_full_observed_transform(self):
        requested = {"x": 0, "y": 180, "z": 0}
        for changed in ({"rotation": POSE["rotation"]},
                        {"scale": {"x": 1, "y": 1, "z": 1}}):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                state = State(directory)
                state.exchange({"clientId": "web-client", "snapshot": deepcopy(ROOM), "results": []})
                request = {"room_id": "web-virtual-room-v1", "scene_revision": state.revision,
                           "object_id": "chair-1", "expected_asset_id": "chair",
                           "position": deepcopy(POSE["position"]), "rotation": requested}
                queued = state.agent_move(request)
                room = deepcopy(ROOM)
                room["scene"]["objects"][0]["transform"]["rotation"] = requested
                room["scene"]["objects"][0]["transform"].update(changed)
                state.exchange({"clientId": "web-client", "snapshot": room,
                                "results": [{"requestId": queued["requestId"], "ok": True,
                                             "error": "", "objectId": "chair-1"}]})
                self.assertEqual(state.agent_move_status(queued["requestId"])["status"],
                                 "unconfirmed")

    def test_false_or_unobserved_receipt_never_claims_success(self):
        queued = self.state.agent_move(self.request())
        self.ack(queued["requestId"], ok=True, updated=False)
        self.assertEqual(self.state.agent_move_status(queued["requestId"])["status"], "unconfirmed")
        other = State(self.temp.name)
        other.exchange({"clientId": "web-client", "snapshot": deepcopy(ROOM), "results": []})
        denied = other.agent_move({**self.request(), "scene_revision": other.revision})
        other.exchange({"clientId": "web-client", "snapshot": deepcopy(ROOM),
                        "results": [{"requestId": denied["requestId"], "ok": False,
                                     "error": "object outside support", "objectId": "chair-1"}]})
        failed = other.agent_move_status(denied["requestId"])
        self.assertEqual(failed["status"], "failed")
        self.assertIn("outside support", failed["error"])

    def test_stale_room_wrong_asset_and_offline_reject_without_queue(self):
        for bad in (self.request(room_id="other"), self.request(scene_revision=0),
                    self.request(expected_asset_id="other"),
                    self.request(position={"x": 101, "y": 0, "z": 0}),
                    self.request(position={"x": 1, "y": 0, "z": 0, "extra": 1})):
            with self.assertRaises(APIError):
                self.state.agent_move(bad)
        self.assertFalse(self.state.pending)
        self.state.last_seen = -float("inf")
        with self.assertRaises(APIError):
            self.state.agent_move(self.request())

    def test_rotation_requires_exact_finite_bounded_euler_vector(self):
        for rotation in (None, [], {}, {"x": 0, "y": 180},
                         {"x": 0, "y": 180, "z": 0, "w": 1},
                         {"x": True, "y": 180, "z": 0},
                         {"x": 0, "y": math.nan, "z": 0},
                         {"x": 0, "y": math.inf, "z": 0},
                         {"x": 0, "y": 36001, "z": 0}):
            with self.subTest(rotation=rotation), self.assertRaises(APIError):
                self.state.agent_move(self.request(rotation=rotation))
        self.assertFalse(self.state.pending)

    def test_physical_room_is_out_of_scope_and_lease_loss_is_unconfirmed(self):
        self.state.latest["roomContext"]["mode"] = "ar"
        with self.assertRaisesRegex(APIError, "ready WebXR virtual floor"):
            self.state.agent_move(self.request())
        self.state.latest["roomContext"]["mode"] = "white-room"
        queued = self.state.agent_move(self.request())
        self.state.last_seen = -float("inf")
        self.assertEqual(self.state.agent_move_status(queued["requestId"])["status"], "unconfirmed")

    def test_private_move_and_status_are_bounded_and_proxy_free(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch("matrix_tool_bridge.MOVE_WAIT", 0.1), \
             patch.dict("os.environ", {"HTTP_PROXY": "http://127.0.0.1:9",
                                    "NO_PROXY": "browser"}):
            queued = move_object(bridge.url, bridge.token, self.request())
            self.assertEqual(queued["status"], "queued")
            self.assertEqual(move_status(bridge.url, bridge.token, queued["requestId"])["status"], "queued")
            with self.assertRaises(urllib.error.HTTPError):
                move_status(bridge.url, "wrong-token", queued["requestId"])
            self.ack(queued["requestId"])
            self.assertEqual(move_status(bridge.url, bridge.token, queued["requestId"])["status"], "succeeded")

    def test_private_bridge_accepts_rotation_and_checks_its_receipt(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        rotation = {"x": 0, "y": 180, "z": 0}
        with patch("matrix_tool_bridge.MOVE_WAIT", 0.1):
            queued = move_object(bridge.url, bridge.token,
                                 self.request(position=deepcopy(POSE["position"]), rotation=rotation))
            self.assertEqual(queued["status"], "queued")
            room = deepcopy(ROOM)
            room["scene"]["objects"][0]["transform"]["rotation"] = rotation
            self.state.exchange({"clientId": "web-client", "snapshot": room,
                                 "results": [{"requestId": queued["requestId"], "ok": True,
                                              "error": "", "objectId": "chair-1"}]})
            self.assertEqual(move_status(bridge.url, bridge.token, queued["requestId"])["status"],
                             "succeeded")

    def test_move_approval_summary_rejects_opaque_or_extra_arguments(self):
        args = self.request()
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_move_object"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": args}}
        summary, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("chair-1", summary)
        self.assertIn("(2, 0, -3)", summary)
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**args, "token": "secret"}}})[1])
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**args, "scene_revision": True}}})[1])
        rotated = {**args, "rotation": {"x": .17, "y": 180.26, "z": -6.64}}
        summary, reviewable = _mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": rotated}})
        self.assertTrue(reviewable)
        self.assertIn("rotation (0.17, 180.26, -6.64) degrees", summary)
        for bad in (None, {"x": 0, "y": 180},
                    {"x": 0, "y": 180, "z": 0, "w": 0},
                    {"x": 0, "y": math.nan, "z": 0},
                    {"x": 0, "y": 36001, "z": 0}):
            with self.subTest(rotation=bad):
                self.assertFalse(_mcp_approval_description({**approval, "_meta": {
                    **approval["_meta"], "tool_params": {**args, "rotation": bad}}})[1])


if __name__ == "__main__":
    unittest.main()
