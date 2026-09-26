"""Authenticated Matrix Agent Portal API on an isolated loopback service."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from agent_portal import AgentPortal
from agent_session import _mcp_approval_description
from server import Server, State, agent_turn_context, snapshot
from test_agent_portal import FakeBackend


class AgentPortalHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.persisted = [False]
        self.state = State(self.temp.name)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
                                             lambda: FakeBackend(self.persisted))
        self.token = "matrix-agent-test-token-0123456789"
        self.server = Server(("127.0.0.1", 0), self.state, self.token)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, path, body, *, auth=True, origin=None):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + self.token
        if origin is not None:
            headers["Origin"] = origin
        request = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_auth_origin_validation_and_reconnect_without_browser_secrets(self):
        self.assertEqual(self.post("/api/agent/session", {}, auth=False)[0], 401)
        self.assertEqual(self.post("/api/agent/session", {}, origin="https://other.example")[0], 403)
        code, opened = self.post("/api/agent/session", {}, origin=self.url)
        self.assertEqual(code, 200)
        session_id = opened["sessionId"]
        self.assertEqual(len(session_id), 32)
        self.assertNotIn("agent_portal", self.state.scenes()["scenes"])
        self.assertNotEqual(self.state.path("agent_portal"), self.state.agent_portal.path)
        self.assertNotIn("native-thread-id", json.dumps(opened))
        self.assertNotIn(self.token, json.dumps(opened))
        self.assertEqual(self.post("/api/agent/turn", {"sessionId": session_id, "text": "Place this there"})[0], 200)
        self.assertEqual(self.post("/api/agent/status", {"sessionId": "wrong", "cursor": 0})[0], 404)
        self.assertEqual(self.post("/api/agent/status", {"sessionId": session_id, "cursor": "bad"})[0], 400)
        code, status = self.post("/api/agent/status", {"sessionId": session_id, "cursor": 0})
        self.assertEqual(code, 200)
        pending = status["pendingApprovals"][0]
        self.assertEqual(self.post("/api/agent/approval", {"sessionId": session_id,
                     "turnId": "wrong", "approvalId": pending["approvalId"], "approve": True})[0], 409)
        self.assertEqual(self.post("/api/agent/approval", {"sessionId": session_id,
                     "turnId": pending["turnId"], "approvalId": pending["approvalId"], "approve": True})[0], 200)
        code, resumed = self.post("/api/agent/session", {})
        self.assertEqual(code, 200)
        self.assertEqual(resumed["sessionId"], session_id)
        self.assertEqual(self.post("/api/agent/session", {"unexpected": 1})[0], 400)

    def test_agent_transcription_reuses_pc_speech_without_planning(self):
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        with patch("server.speech.decode_audio", return_value=b"wav") as decode, \
             patch("server.speech.configuration"), \
             patch("server.speech.transcribe", return_value="Move this there") as transcribe:
            body = {"sessionId": session_id, "audioBase64": "recording"}
            self.assertEqual(self.post("/api/agent/transcribe", body, auth=False)[0], 401)
            self.assertEqual(self.post("/api/agent/transcribe", {**body, "sessionId": "wrong"})[0], 404)
            self.assertEqual(self.post("/api/agent/transcribe", body),
                             (200, {"transcript": "Move this there"}))
            decode.assert_called_once_with("recording")
            transcribe.assert_called_once_with(b"wav")
            self.assertFalse(self.state.voice_jobs)

    def test_known_mcp_approval_uses_existing_browser_decision_route(self):
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        self.post("/api/agent/turn", {"sessionId": session_id, "text": "Read this room"})
        backend = self.state.agent_portal._backend
        backend.approval.update(action="using_tool", summary="Read the current Matrix room summary.",
                                reviewable=True)
        code, status = self.post("/api/agent/status", {"sessionId": session_id})
        self.assertEqual(code, 200)
        pending = status["pendingApprovals"][0]
        self.assertEqual(pending["action"], "using_tool")
        self.assertTrue(pending["reviewable"])
        self.assertEqual(self.post("/api/agent/approval", {"sessionId": session_id,
                         "turnId": pending["turnId"], "approvalId": pending["approvalId"],
                         "approve": True})[0], 200)

    def test_rotation_summary_is_visible_and_only_visible_summary_can_be_approved(self):
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        self.post("/api/agent/turn", {"sessionId": session_id, "text": "Turn the object"})
        backend = self.state.agent_portal._backend
        arguments = {"room_id": "web-virtual-room-v1", "scene_revision": 20,
                     "object_id": "a" * 32, "expected_asset_id": "web:" + "d" * 65,
                     "position": {"x": 0, "y": 0, "z": -2},
                     "rotation": {"x": 0, "y": 180, "z": 0}}
        summary, reviewable = _mcp_approval_description({
            "serverName": "matrix_webxr",
            "message": 'Allow the matrix_webxr MCP server to run tool "matrix_move_object"?',
            "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": arguments}})
        self.assertTrue(reviewable)
        self.assertTrue(200 < len(summary) <= 240)
        backend.approval.update(action="using_tool", summary=summary, reviewable=reviewable)
        pending = self.post("/api/agent/status", {"sessionId": session_id})[1]["pendingApprovals"][0]
        self.assertEqual(pending["summary"], summary)
        self.assertTrue(pending["reviewable"])
        self.assertEqual(self.post("/api/agent/approval", {"sessionId": session_id,
                         "turnId": pending["turnId"], "approvalId": pending["approvalId"],
                         "approve": True})[0], 200)

        self.post("/api/agent/turn", {"sessionId": session_id, "text": "Another action"})
        backend.approval.update(action="using_tool", summary="X" * 241, reviewable=True)
        pending = self.post("/api/agent/status", {"sessionId": session_id})[1]["pendingApprovals"][0]
        self.assertEqual(pending["summary"], "Codex action needs PC review.")
        self.assertFalse(pending["reviewable"])
        self.assertEqual(self.post("/api/agent/approval", {"sessionId": session_id,
                         "turnId": pending["turnId"], "approvalId": pending["approvalId"],
                         "approve": True})[0], 409)

    def test_generic_command_stays_unreviewable_and_raw_fields_stay_on_pc(self):
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        self.post("/api/agent/turn", {"sessionId": session_id, "text": "Build an asset"})
        backend = self.state.agent_portal._backend
        backend.approval.update(summary="Codex requests a command. Its effect cannot be reviewed in XR.",
                                reviewable=False, command="SECRET_NATIVE_COMMAND",
                                cwd="C:/private/workspace", reason="SECRET_REASON",
                                networkApprovalContext={"host": "secret.example.invalid"})
        code, status = self.post("/api/agent/status", {"sessionId": session_id})
        self.assertEqual(code, 200)
        self.assertFalse(status["pendingApprovals"][0]["reviewable"])
        for secret in ("SECRET_NATIVE_COMMAND", "C:/private/workspace", "SECRET_REASON",
                       "secret.example.invalid"):
            self.assertNotIn(secret, json.dumps(status))
        pending = status["pendingApprovals"][0]
        code, response = self.post("/api/agent/approval", {"sessionId": session_id,
                                    "turnId": pending["turnId"],
                                    "approvalId": pending["approvalId"], "approve": True})
        self.assertEqual(code, 409)
        self.assertNotIn("SECRET_NATIVE_COMMAND", json.dumps(response))

    def test_spatial_turn_is_bounded_validated_and_keeps_user_transcript_clean(self):
        room = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                          "objects": [{"objectId": "chair-1", "assetId": "chair", "anchorId": "web-floor",
                                       "transform": {"position": {"x": 1, "y": 0, "z": -2},
                                                     "rotation": {"x": 0, "y": 0, "z": 0},
                                                     "scale": {"x": 1, "y": 1, "z": 1}}}]},
                "assets": [{"assetId": "chair", "displayName": "Chair"}],
                "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                "selection": {"anchorId": "web-floor", "objectId": "chair-1",
                              "position": {"x": 1, "y": 0, "z": -2}},
                "roomContext": {"mode": "white-room", "state": "ready",
                                "alignmentVerified": False, "message": "Virtual room"}}
        self.state.latest = snapshot(room)
        self.state.client_id = "web-client"
        self.state.last_seen = self.state.clock()
        self.state.revision = 7
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        context = {"schemaVersion": 1, "inputSource": "voice_transcript", "clientId": "web-client",
                   "roomId": "web-virtual-room-v1", "selectedObjectId": "chair-1",
                   "pointingTarget": {"anchorId": "web-floor", "objectId": None,
                                      "position": {"x": 2, "y": 0, "z": -3}},
                   "viewerFrame": {"anchorId": "web-floor", "position": {"x": 0, "y": 1.7, "z": 0},
                                   "forward": {"x": 0, "y": 0, "z": -1}}}
        body = {"sessionId": session_id, "text": "Put this over there", "context": context}
        self.assertEqual(self.post("/api/agent/turn", {**body, "context": {**context, "schemaVersion": 2}})[0], 400)
        self.assertEqual(self.post("/api/agent/turn", {**body, "context": {**context, "roomId": "other"}})[0], 409)
        self.assertEqual(self.post("/api/agent/turn", {**body, "context": {**context, "clientId": "other"}})[0], 409)
        self.assertEqual(self.post("/api/agent/turn", {**body, "context": {**context, "selectedObjectId": "missing"}})[0], 409)
        self.assertEqual(self.post("/api/agent/turn", {**body, "text": "x" * 15990})[0], 400)
        self.assertEqual(self.post("/api/agent/turn", body)[0], 200)
        sent = self.state.agent_portal._backend.sent_texts[-1]
        self.assertIn("User request:\nPut this over there", sent)
        self.assertIn("matrix_move_object sets position and optional bounded Euler rotation", sent)
        self.assertIn("Published numeric Matrix components can be attached", sent)
        self.assertIn("matrix_spawn_asset", sent)
        self.assertIn("build a reusable WebXR capability", sent)
        self.assertNotIn("asset spawning are unavailable", sent)
        self.assertNotIn("No typed Matrix world-action tool is available", sent)
        encoded = sent.split("<matrix_spatial_context>", 1)[1].split("</matrix_spatial_context>", 1)[0]
        grounded = json.loads(encoded)
        self.assertEqual(grounded["sceneRevision"], 7)
        self.assertEqual(grounded["selectedObject"]["objectId"], "chair-1")
        self.assertEqual(grounded["pointingTarget"]["position"], {"x": 2, "y": 0, "z": -3})
        self.assertEqual(grounded["inputSource"], "voice_transcript")
        self.assertEqual(grounded["sceneSummary"]["objectCount"], 1)
        self.assertNotIn("Virtual room", sent)
        status = self.post("/api/agent/status", {"sessionId": session_id})[1]
        self.assertEqual(status["transcript"][-1]["user"], "Put this over there")

    def test_pointed_object_is_in_bounded_summary_even_after_first_eight(self):
        pose = {"position": {"x": 0, "y": 0, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 1, "y": 1, "z": 1}}
        objects = [{"objectId": f"chair-{index}", "assetId": "chair",
                    "anchorId": "web-floor", "transform": pose} for index in range(12)]
        self.state.latest = snapshot({"scene": {"schemaVersion": 1, "roomId": "room-1", "objects": objects},
                                      "assets": [{"assetId": "chair", "displayName": "Chair"}],
                                      "anchors": [{"anchorId": "web-floor", "displayName": "Floor"}],
                                      "selection": {"objectId": "chair-10", "anchorId": "web-floor",
                                                    "position": pose["position"]}})
        self.state.client_id = "web-client"
        self.state.last_seen = self.state.clock()
        context = {"schemaVersion": 1, "inputSource": "text", "clientId": "web-client",
                   "roomId": "room-1", "selectedObjectId": "chair-10",
                   "pointingTarget": {"anchorId": "web-floor", "objectId": "chair-11",
                                      "position": pose["position"]}, "viewerFrame": None}
        grounded = agent_turn_context(self.state, context)
        included = [item["objectId"] for item in grounded["sceneSummary"]["objects"]]
        self.assertEqual(included[:2], ["chair-10", "chair-11"])
        self.assertEqual(len(included), 8)
        self.assertEqual(grounded["sceneSummary"]["omittedObjectCount"], 4)


if __name__ == "__main__":
    unittest.main()
