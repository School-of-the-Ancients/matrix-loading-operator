"""Authenticated Matrix Agent Portal API on an isolated loopback service."""
import base64
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from agent_portal import AgentPortal, build_matrix_turn_message
from agent_session import _mcp_approval_description
from matrix_tool_bridge import scene_summary
from server import (APIError, Server, State, agent_runtime_context, agent_turn_context,
                    scene_revision_data, snapshot)
from test_agent_portal import FakeBackend
from test_scene_capture import JPEG, capture_result
from test_server import SNAPSHOT
from test_web_assets import glb
from web_assets import WebAssetCatalog


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
        code, started = self.post("/api/agent/turn", {"sessionId": session_id, "text": "Place this there"})
        self.assertEqual(code, 200)
        steer = {"sessionId": session_id, "turnId": started["turnId"],
                 "text": "And add some lighting"}
        self.assertEqual(self.post("/api/agent/steer", steer, auth=False)[0], 401)
        self.assertEqual(self.post("/api/agent/steer", steer,
                                   origin="https://other.example")[0], 403)
        self.assertEqual(self.post("/api/agent/steer", {**steer, "extra": 1})[0], 400)
        self.assertEqual(self.post("/api/agent/steer", {**steer, "turnId": "wrong"})[0], 409)
        self.assertEqual(self.post("/api/agent/steer", steer)[1]["turnId"],
                         started["turnId"])
        self.assertEqual(self.post("/api/agent/status", {"sessionId": "wrong", "cursor": 0})[0], 404)
        self.assertEqual(self.post("/api/agent/status", {"sessionId": session_id, "cursor": "bad"})[0], 400)
        code, status = self.post("/api/agent/status", {"sessionId": session_id, "cursor": 0})
        self.assertEqual(code, 200)
        self.assertEqual(len(status["transcript"]), 1)
        self.assertIn("And add some lighting", status["transcript"][0]["user"])
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

    def test_explicit_webxr_camera_pair_reaches_one_agent_turn_only(self):
        class ImageBackend(FakeBackend):
            def send_text(self, identifier, text, *, image_path=None):
                self.image_bytes = Path(image_path).read_bytes() if image_path else None
                self.image_path = image_path
                return super().send_text(identifier, text)

        backend = ImageBackend(self.persisted)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
                                             lambda: backend)
        self.addCleanup(self.state.agent_portal.close)
        web = copy.deepcopy(SNAPSHOT)
        web["scene"]["roomId"] = "web-camera-room"
        web["roomContext"] = {"mode": "ar", "state": "ready", "alignmentVerified": False}
        web["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                    "renderer": "threejs-webxr", "presentation": "ar"}
        web["spatialObservation"] = {"schemaVersion": 1, "planeAgeMs": 50,
                                     "trackingEpoch": 1, "webFloorPose": None}
        capabilities = {"modes": ["virtual", "mixed"], "device": "WebXR environment camera",
                        "mixedStatus": "available", "reason": "Separate camera and virtual view",
                        "depthOcclusion": False}
        exchange = {"clientId": "web-camera-runtime", "snapshot": web,
                    "captureSupported": True, "captureCapabilities": capabilities}
        self.state.exchange(exchange)
        capture_id = self.state.request_capture({"mode": "mixed"})["captureId"]
        raw = bytearray(JPEG)
        raw[7:9] = (480).to_bytes(2, "big")
        raw[9:11] = (1280).to_bytes(2, "big")
        pair = capture_result(self.state, source="webxr_camera_pair", mode="mixed",
                              includesPhysicalCamera=True, includesPassthrough=False,
                              dataBase64=base64.b64encode(raw).decode(), width=1280, height=480,
                              cameraFrameCapturedAtUtc="2026-09-21T12:34:55.900Z",
                              cameraToPairMs=100,
                              layout={"kind": "side-by-side", "cameraPanel": [0, 0, 640, 480],
                                      "virtualPanel": [640, 0, 640, 480], "calibrated": False},
                              spatialProvenance={"source": "webxr_room_planes", "roomId": "web-camera-room",
                                                 "anchorCount": len(web["anchors"]), "alignmentVerified": False,
                                                 "depthOcclusion": False, "physicalDepthIncluded": False})
        self.state.exchange({**exchange, "capture": pair})
        self.assertEqual(self.state.capture_status()["status"], "ready")
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        context = {"schemaVersion": 2, "inputSource": "text", "clientId": "web-camera-runtime",
                   "roomId": "web-camera-room", "selectedObjectId": None,
                    "pointingTarget": None, "viewerFrame": None,
                    "presentation": "ar", "trackingEpoch": 1}
        request = {"sessionId": session_id, "text": "Describe the physical marker and virtual scene",
                   "context": context, "captureId": capture_id}
        self.assertEqual(self.post("/api/agent/turn", {**request, "captureId": "bad"})[0], 400)
        self.assertEqual(self.post("/api/agent/turn", {key: value for key, value in request.items()
                                                       if key != "context"})[0], 400)
        code, started = self.post("/api/agent/turn", request)
        self.assertEqual(code, 200, started)
        self.assertEqual(backend.image_bytes, bytes(raw))
        self.assertIn("not pixel aligned", backend.sent_texts[-1])
        self.assertIn("physical", backend.sent_texts[-1].lower())
        self.assertIn("Physical-room layout is currently unverified", backend.sent_texts[-1])
        self.assertIn("cameraFrameCapturedAtUtc", backend.sent_texts[-1])
        self.assertNotIn(pair["dataBase64"], backend.sent_texts[-1])
        self.assertEqual(self.state.capture["agentTurnId"], started["turnId"])
        self.state.agent_portal.cancel(session_id, started["turnId"])
        self.state.agent_portal.status(session_id)
        self.assertEqual(self.post("/api/agent/turn", request)[0], 409)
        code, _ = self.post("/api/agent/turn", {"sessionId": session_id,
                                                "text": "Ordinary follow-up"})
        self.assertEqual(code, 200)
        self.assertIsNone(backend.image_bytes)

    def test_stale_or_mismatched_webxr_capture_cannot_reach_agent(self):
        web = copy.deepcopy(SNAPSHOT)
        web["scene"]["roomId"] = "web-camera-room"
        web["roomContext"] = {"mode": "ar", "state": "ready", "alignmentVerified": False}
        web["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                    "renderer": "threejs-webxr", "presentation": "ar"}
        web["spatialObservation"] = {"schemaVersion": 1, "planeAgeMs": 50,
                                     "trackingEpoch": 1, "webFloorPose": None}
        exchange = {"clientId": "web-camera-runtime", "snapshot": web, "captureSupported": True}
        self.state.exchange(exchange)
        capture_id = self.state.request_capture({})["captureId"]
        self.state.exchange({**exchange,
                             "capture": capture_result(self.state, source="webxr_virtual_center_eye")})
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        context = {"schemaVersion": 2, "inputSource": "text", "clientId": "web-camera-runtime",
                   "roomId": "web-camera-room", "selectedObjectId": None,
                    "pointingTarget": None, "viewerFrame": None,
                    "presentation": "ar", "trackingEpoch": 1}
        body = {"sessionId": session_id, "text": "Review this virtual-only view",
                "context": context, "captureId": capture_id}
        self.assertEqual(self.post("/api/agent/turn", {**body,
                         "context": {**context, "roomId": "another-room"}})[0], 409)
        changed = copy.deepcopy(web)
        changed["runtimeDescriptor"]["presentation"] = "vr"
        changed["roomContext"] = {"mode": "white-room", "state": "ready",
                                  "alignmentVerified": False}
        changed.pop("spatialObservation")
        self.state.exchange({**exchange, "snapshot": changed})
        self.assertEqual(self.state.capture_status()["status"], "stale")
        self.assertEqual(self.post("/api/agent/turn", body)[0], 409)
        self.assertEqual(self.state.agent_portal._backend.sent_texts, [])

    def test_runtime_heartbeat_continues_during_camera_image_admission(self):
        sending = threading.Event()
        release = threading.Event()

        class BlockingImageBackend(FakeBackend):
            def send_text(self, identifier, text, *, image_path=None):
                self.image_bytes = Path(image_path).read_bytes()
                sending.set()
                if not release.wait(3):
                    raise RuntimeError("Camera admission test timed out")
                return super().send_text(identifier, text)

        backend = BlockingImageBackend(self.persisted)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
                                             lambda: backend)
        self.addCleanup(self.state.agent_portal.close)
        web = copy.deepcopy(SNAPSHOT)
        web["scene"]["roomId"] = "web-camera-room"
        web["roomContext"] = {"mode": "white-room", "state": "ready", "alignmentVerified": False}
        web["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                    "renderer": "threejs-webxr", "presentation": "desktop"}
        exchange = {"clientId": "web-camera-runtime", "snapshot": web, "captureSupported": True}
        self.state.exchange(exchange)
        capture_id = self.state.request_capture({})["captureId"]
        self.state.exchange({**exchange,
                             "capture": capture_result(self.state, source="webxr_virtual_center_eye")})
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        body = {"sessionId": session_id, "text": "Review this virtual view",
                "context": {"schemaVersion": 1, "inputSource": "text",
                            "clientId": "web-camera-runtime", "roomId": "web-camera-room",
                            "selectedObjectId": None, "pointingTarget": None, "viewerFrame": None},
                "captureId": capture_id}
        outcome = {}
        sender = threading.Thread(target=lambda: outcome.update(sent=self.post("/api/agent/turn", body)))
        sender.start()
        self.assertTrue(sending.wait(2))
        self.assertEqual(self.state.capture["agentAdmission"], "submitting")
        exchange_started = threading.Event()
        exchange_done = threading.Event()
        def heartbeat():
            exchange_started.set()
            self.state.exchange(exchange)
            exchange_done.set()
        changer = threading.Thread(target=heartbeat)
        changer.start()
        try:
            self.assertTrue(exchange_started.wait(2))
            self.assertTrue(exchange_done.wait(1), "Codex IPC blocked a Matrix heartbeat")
        finally:
            release.set()
            sender.join(3)
            changer.join(3)
        self.assertFalse(sender.is_alive())
        self.assertFalse(changer.is_alive())
        self.assertEqual(outcome["sent"][0], 200)
        self.assertEqual(backend.image_bytes, JPEG)
        self.assertTrue(exchange_done.is_set())
        self.assertEqual(self.state.capture["agentAdmission"], "shared")
        self.state.agent_portal.cancel(session_id, outcome["sent"][1]["turnId"])
        self.state.agent_portal.status(session_id)
        self.assertEqual(self.post("/api/agent/turn", body)[0], 409,
                         "A shared capture must not be admitted twice")

    def test_runtime_switch_during_camera_submission_stops_stale_turn(self):
        sending = threading.Event()
        release = threading.Event()

        class BlockingImageBackend(FakeBackend):
            def send_text(self, identifier, text, *, image_path=None):
                sending.set()
                if not release.wait(3):
                    raise RuntimeError("Camera admission test timed out")
                return super().send_text(identifier, text)

        backend = BlockingImageBackend(self.persisted)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
                                             lambda: backend)
        self.addCleanup(self.state.agent_portal.close)
        web = copy.deepcopy(SNAPSHOT)
        web["scene"]["roomId"] = "web-camera-room"
        web["roomContext"] = {"mode": "white-room", "state": "ready", "alignmentVerified": False}
        web["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                    "renderer": "threejs-webxr", "presentation": "desktop"}
        exchange = {"clientId": "web-camera-runtime", "snapshot": web, "captureSupported": True}
        self.state.exchange(exchange)
        capture_id = self.state.request_capture({})["captureId"]
        self.state.exchange({**exchange,
                             "capture": capture_result(self.state, source="webxr_virtual_center_eye")})
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        body = {"sessionId": session_id, "text": "Review this virtual view",
                "context": {"schemaVersion": 1, "inputSource": "text",
                            "clientId": "web-camera-runtime", "roomId": "web-camera-room",
                            "selectedObjectId": None, "pointingTarget": None, "viewerFrame": None},
                "captureId": capture_id}
        outcome = {}
        sender = threading.Thread(target=lambda: outcome.update(sent=self.post("/api/agent/turn", body)))
        sender.start()
        self.assertTrue(sending.wait(2))
        changed = copy.deepcopy(web)
        changed["runtimeDescriptor"]["presentation"] = "vr"
        self.state.exchange({**exchange, "snapshot": changed})
        try:
            self.assertEqual(self.state.capture["agentAdmission"], "submitting")
        finally:
            release.set()
            sender.join(3)
        self.assertFalse(sender.is_alive())
        self.assertEqual(outcome["sent"][0], 409)
        self.assertIn("Camera view reached Agent", outcome["sent"][1]["error"])
        self.assertEqual(self.state.capture["agentAdmission"], "stale")
        self.assertEqual(backend.approval, None, "Stale Agent turn was not stopped")
        self.assertEqual(self.post("/api/agent/turn", body)[0], 409)

    def test_failed_camera_submission_cleans_staging_and_requires_new_capture(self):
        class FailedImageBackend(FakeBackend):
            def send_text(self, identifier, text, *, image_path=None):
                self.image_path = Path(image_path)
                raise RuntimeError("Agent transport failed after receiving image path")

        backend = FailedImageBackend(self.persisted)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
                                             lambda: backend)
        self.addCleanup(self.state.agent_portal.close)
        web = copy.deepcopy(SNAPSHOT)
        web["scene"]["roomId"] = "web-camera-room"
        web["roomContext"] = {"mode": "white-room", "state": "ready", "alignmentVerified": False}
        web["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                    "renderer": "threejs-webxr", "presentation": "desktop"}
        exchange = {"clientId": "web-camera-runtime", "snapshot": web, "captureSupported": True}
        self.state.exchange(exchange)
        capture_id = self.state.request_capture({})["captureId"]
        self.state.exchange({**exchange,
                             "capture": capture_result(self.state, source="webxr_virtual_center_eye")})
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        body = {"sessionId": session_id, "text": "Review this virtual view",
                "context": {"schemaVersion": 1, "inputSource": "text",
                            "clientId": "web-camera-runtime", "roomId": "web-camera-room",
                            "selectedObjectId": None, "pointingTarget": None, "viewerFrame": None},
                "captureId": capture_id}
        self.assertEqual(self.post("/api/agent/turn", body)[0], 502)
        self.assertEqual(self.state.capture["agentAdmission"], "failed")
        self.assertFalse(backend.image_path.exists())
        self.assertEqual(self.post("/api/agent/turn", body)[0], 409)

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
        self.assertIn("Live runtime identity and presentation: unknown", sent)
        self.assertIn("available typed Matrix tools", sent)
        self.assertNotIn("matrix_move_object sets position", sent)
        self.assertLess(len(sent), 4000)
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

    def test_room_spatial_uses_current_measured_planes_and_rejects_stale_ar_context(self):
        point = lambda x=0, y=0, z=0: {"x": x, "y": y, "z": z}
        pose = lambda x=0, y=0, z=0: {
            "position": point(x, y, z), "rotation": point(), "scale": point(1, 1, 1)}
        room = {"scene": {"schemaVersion": 1, "roomId": "webxr-session-149",
                          "objects": [{"objectId": "tower-1", "assetId": "tower",
                                       "anchorId": "web-floor", "transform": pose()}]},
                "selection": {"anchorId": "floor-1", "objectId": "tower-1",
                              "position": point(.4, 0, -.2)},
                "assets": [{"assetId": "tower", "displayName": "Tower",
                            "localBounds": {"center": point(0, 1, 0), "size": point(1, 2, 1)}}],
                "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"},
                            {"anchorId": "floor-1", "displayName": "Measured floor",
                             "source": "webxr", "semanticLabels": ["FLOOR"],
                             "surface": {"kind": "support", "boundary": [
                                 point(-2, 0, -2), point(2, 0, -2),
                                 point(2, 0, 2), point(-2, 0, 2)]},
                             "roomPose": pose()}],
                "roomContext": {"mode": "ar", "state": "ready",
                                "alignmentVerified": True, "message": "Room ready"},
                "runtimeDescriptor": {"schemaVersion": 1, "client": "matrix-web",
                                      "renderer": "threejs-webxr", "presentation": "ar"},
                "creatorMode": {"schemaVersion": 1, "mode": "creator",
                                "simulation": "paused", "revision": 0},
                "spatialObservation": {"schemaVersion": 1, "planeAgeMs": 50,
                                       "trackingEpoch": 7, "webFloorPose": pose()}}
        self.state.latest = snapshot(room)
        self.state.client_id = "web-client"
        self.state.last_seen = self.state.clock()
        self.state.revision = 12
        context = {"schemaVersion": 2, "inputSource": "text", "clientId": "web-client",
                   "roomId": "webxr-session-149", "selectedObjectId": "tower-1",
                   "pointingTarget": None, "viewerFrame": None,
                   "presentation": "ar", "trackingEpoch": 7}
        grounded = agent_turn_context(self.state, context, creation=True)
        spatial = grounded["roomSpatial"]
        self.assertTrue(spatial["usable"])
        self.assertTrue(spatial["surfaceSpawnAvailable"])
        self.assertEqual(spatial["coordinateFrame"], "xr-reference-space")
        self.assertEqual(spatial["planes"][0]["anchorId"], "floor-1")
        self.assertEqual(spatial["planes"][0]["surface"]["boundary"],
                         room["anchors"][1]["surface"]["boundary"])
        self.assertEqual(spatial["sceneRevision"], 12)
        self.assertEqual(len(spatial["spatialToken"]), 64)
        self.assertIn("localBounds", grounded["sceneSummary"]["objects"][0])
        selected = {**context, "schemaVersion": 3,
                    "selectedPlacement": {"anchorId": "floor-1",
                                          "position": point(.4, 0, -.2),
                                          "source": "adjusted"}}
        selected_context = agent_turn_context(self.state, selected)
        self.assertEqual(selected_context["selectedObject"]["objectId"], "tower-1")
        self.assertEqual(selected_context["selectedPlacement"],
                         selected["selectedPlacement"])
        self.assertEqual(selected_context["roomSpatial"]["planes"][0]["anchorId"],
                         "floor-1")
        self.state.latest["selection"]["position"] = point(.7, 0, -.2)
        with self.assertRaises(APIError) as moved_pin:
            agent_turn_context(self.state, selected)
        self.assertEqual(moved_pin.exception.status, 409)
        self.state.latest["selection"]["position"] = point(.4, 0, -.2)
        with self.assertRaises(APIError) as changed_object:
            agent_turn_context(self.state, {**selected, "selectedObjectId": None})
        self.assertEqual(changed_object.exception.status, 409)
        with self.assertRaises(APIError):
            agent_turn_context(self.state, {**selected,
                "selectedPlacement": {**selected["selectedPlacement"],
                                      "position": point(4, 0, 0)}})
        with self.assertRaises(APIError):
            agent_turn_context(self.state, {**selected,
                "selectedPlacement": {**selected["selectedPlacement"],
                                      "anchorId": "missing"}})
        self.state.latest["roomContext"]["alignmentVerified"] = False
        with self.assertRaises(APIError):
            agent_turn_context(self.state, selected)
        self.state.latest["roomContext"]["alignmentVerified"] = True
        self.assertNotIn("roomSpatial", agent_runtime_context(self.state))
        self.assertNotIn("roomSpatial", agent_runtime_context(self.state, include_scene=True))
        self.assertEqual(self.state.agent_room_spatial()["spatialToken"], spatial["spatialToken"])
        with self.assertRaises(APIError) as old:
            agent_turn_context(self.state, {key: item for key, item in context.items()
                                            if key not in ("presentation", "trackingEpoch")}
                               | {"schemaVersion": 1})
        self.assertEqual(old.exception.status, 409)
        with self.assertRaises(APIError) as changed:
            agent_turn_context(self.state, {**context, "trackingEpoch": 6})
        self.assertEqual(changed.exception.status, 409)
        with self.assertRaises(APIError) as mode:
            agent_turn_context(self.state, {**context, "presentation": "vr"})
        self.assertEqual(mode.exception.status, 409)
        refined = snapshot(room)
        refined["anchors"][1]["roomPose"]["position"]["x"] = .4
        self.assertEqual(scene_revision_data(self.state.latest), scene_revision_data(refined))
        self.state.latest = refined
        self.assertNotEqual(self.state.agent_room_spatial()["spatialToken"], spatial["spatialToken"])
        self.assertNotEqual(self.state.agent_room_spatial()["planes"][0]["spatialToken"],
                            spatial["planes"][0]["spatialToken"])
        move = {"room_id": spatial["roomId"], "scene_revision": spatial["sceneRevision"],
                "spatial_token": spatial["spatialToken"], "anchor_id": "floor-1",
                "object_id": "tower-1", "expected_asset_id": "tower",
                "position": point(1, 0, 0)}
        with self.assertRaises(APIError) as stale_move:
            self.state.agent_move_room(move)
        self.assertEqual(stale_move.exception.status, 409)
        self.assertFalse(self.state.pending)
        self.state.latest["roomContext"]["alignmentVerified"] = False
        self.assertEqual(self.state.agent_room_spatial()["unusableReason"], "alignment-unverified")
        self.state.latest["roomContext"]["alignmentVerified"] = True
        self.state.last_seen -= 3
        self.assertEqual(self.state.agent_room_spatial()["unusableReason"], "tracking-stale")
        with self.assertRaises(APIError) as stale_tracking:
            self.state.agent_move_room({**move, "spatial_token": "0" * 64})
        self.assertEqual(stale_tracking.exception.status, 409)
        self.state.last_seen = self.state.clock()
        fresh = self.state.agent_room_spatial()
        target_token = fresh["planes"][0]["spatialToken"]
        other = copy.deepcopy(self.state.latest["anchors"][1])
        other["anchorId"] = "floor-2"
        other["roomPose"]["position"]["x"] = 1
        self.state.latest["anchors"].append(other)
        changed_other = self.state.agent_room_spatial()
        self.assertNotEqual(changed_other["spatialToken"], fresh["spatialToken"])
        self.assertEqual(changed_other["planes"][0]["spatialToken"], target_token)
        queued = self.state.agent_move_room({**move, "spatial_token": target_token})
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(queued["constraintAnchorId"], "floor-1")
        self.assertEqual(self.state.pending[queued["requestId"]]["roomConstraint"],
                         {"anchorId": "floor-1", "trackingEpoch": 7})
        self.state.pending.clear()
        fresh = self.state.agent_room_spatial()
        spawned = self.state.agent_spawn_surface({
            "room_id": fresh["roomId"], "scene_revision": fresh["sceneRevision"],
            "spatial_token": fresh["spatialToken"], "asset_id": "tower",
            "anchor_id": "floor-1", "transform": pose()})
        self.assertEqual(spawned["status"], "queued")
        spawn_command = self.state.pending[spawned["requestId"]]
        self.assertEqual(spawn_command["placement"], "surface")
        self.assertEqual(spawn_command["roomConstraint"],
                         {"anchorId": "floor-1", "trackingEpoch": 7})
        self.state.pending.clear()
        for index in range(9):
            extra = copy.deepcopy(self.state.latest["anchors"][1])
            extra["anchorId"] = f"floor-extra-{index}"
            extra["roomPose"]["position"]["x"] = index + 3
            self.state.latest["anchors"].append(extra)
        table = copy.deepcopy(self.state.latest["anchors"][1])
        table["anchorId"] = "table-1"
        table["semanticLabels"] = ["TABLE"]
        table["roomPose"]["position"]["y"] = .7
        self.state.latest["anchors"].append(table)
        self.assertNotIn("table-1", [item["anchorId"] for item in
                                     self.state.agent_room_spatial()["planes"]])
        targeted = self.state.agent_room_spatial("table-1")
        self.assertEqual(targeted["planes"][0]["anchorId"], "table-1")
        table_token = targeted["planes"][0]["spatialToken"]
        table_move = {**move, "anchor_id": "table-1",
                      "scene_revision": targeted["sceneRevision"],
                      "spatial_token": table_token,
                      "position": point(1, .7, 0)}
        targeted_move = self.state.agent_move_room(table_move)
        self.assertEqual(targeted_move["status"], "queued")
        self.state.pending.clear()
        after_move = self.state.agent_room_spatial("table-1")
        targeted_spawn = self.state.agent_spawn_surface({
            "room_id": after_move["roomId"], "scene_revision": after_move["sceneRevision"],
            "spatial_token": after_move["planes"][0]["spatialToken"], "asset_id": "tower",
            "anchor_id": "table-1", "transform": pose()})
        self.assertEqual(targeted_spawn["status"], "queued")
        self.state.pending.clear()
        after_spawn = self.state.agent_room_spatial("table-1")
        table_move.update(scene_revision=after_spawn["sceneRevision"],
                          spatial_token=after_spawn["planes"][0]["spatialToken"])
        table["roomPose"]["position"]["x"] = .9
        with self.assertRaises(APIError) as stale_table:
            self.state.agent_move_room(table_move)
        self.assertEqual(stale_table.exception.status, 409)
        table["roomPose"]["position"]["x"] = .4
        self.state.latest["spatialObservation"]["webFloorPose"]["position"]["x"] = .4
        with self.assertRaises(APIError) as stale_origin:
            self.state.agent_move_room(table_move)
        self.assertEqual(stale_origin.exception.status, 409)
        self.state.latest["spatialObservation"]["webFloorPose"]["position"]["x"] = 0
        self.state.latest["spatialObservation"]["trackingEpoch"] = 8
        with self.assertRaises(APIError) as stale_epoch:
            self.state.agent_move_room(table_move)
        self.assertEqual(stale_epoch.exception.status, 409)
        with self.assertRaises(APIError) as stale_spawn:
            self.state.queue([{key: item for key, item in spawn_command.items()
                               if key != "requestId"}])
        self.assertEqual(stale_spawn.exception.status, 409)
        self.state.results.append({"requestId": queued["requestId"], "ok": True,
                                   "objectId": "tower-1", "error": ""})
        self.state.latest["scene"]["objects"][0]["transform"]["position"] = point(1, 0, 0)
        self.state.latest["scene"]["roomId"] = "web-virtual-room-v1"
        self.state.latest["roomContext"] = {"mode": "white-room", "state": "ready",
                                             "alignmentVerified": False}
        self.state.latest["runtimeDescriptor"]["presentation"] = "desktop"
        self.state.latest["anchors"] = [room["anchors"][0]]
        del self.state.latest["spatialObservation"]
        carried = self.state.agent_move_status(queued["requestId"])
        self.assertEqual(carried["status"], "succeeded")
        self.assertEqual(carried["observedRoomId"], "web-virtual-room-v1")
        self.state.client_id = "different-client"
        self.assertEqual(self.state.agent_move_status(queued["requestId"])["status"],
                         "unconfirmed")
        self.state.client_id = "web-client"
        self.state.results[-1]["objectId"] = "other-object"
        self.assertEqual(self.state.agent_move_status(queued["requestId"])["status"],
                         "unconfirmed")

    def test_spatial_observation_schema_is_ar_only_and_does_not_change_scene_revision(self):
        base = {"scene": {"schemaVersion": 1, "roomId": "webxr-session-149", "objects": []},
                "assets": [], "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                "roomContext": {"mode": "ar", "state": "ready",
                                "alignmentVerified": False, "message": "Tracking"}}
        observation = {"schemaVersion": 1, "planeAgeMs": 10, "trackingEpoch": 2,
                       "webFloorPose": None}
        first = snapshot({**base, "spatialObservation": observation})
        second = snapshot({**base, "spatialObservation": {**observation,
                                                         "planeAgeMs": 500,
                                                         "trackingEpoch": 3}})
        self.assertEqual(scene_revision_data(first), scene_revision_data(second))
        for malformed in ({**observation, "planeAgeMs": -1},
                          {**observation, "trackingEpoch": True},
                          {**observation, "extra": "untrusted"}):
            with self.subTest(malformed=malformed), self.assertRaises(APIError):
                snapshot({**base, "spatialObservation": malformed})
        with self.assertRaises(APIError):
            snapshot({**base, "roomContext": {"mode": "white-room", "state": "ready",
                                              "alignmentVerified": False},
                      "spatialObservation": observation})

    def test_text_turn_without_spatial_opt_in_gets_fresh_runtime_metadata_only(self):
        room = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                          "objects": [{"objectId": "private-chair", "assetId": "chair",
                                       "anchorId": "web-floor",
                                       "transform": {"position": {"x": 1, "y": 0, "z": -2},
                                                     "rotation": {"x": 0, "y": 0, "z": 0},
                                                     "scale": {"x": 1, "y": 1, "z": 1}}}]},
                "assets": [{"assetId": "chair", "displayName": "Chair"}],
                "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                "rigidSchemaVersion": 1,
                "roomContext": {"mode": "white-room", "state": "ready",
                                "alignmentVerified": False, "message": "Virtual room"},
                "runtimeDescriptor": {"schemaVersion": 1, "client": "matrix-web",
                                      "renderer": "threejs-webxr", "presentation": "desktop"}}
        self.state.latest = snapshot(room)
        self.state.client_id = "web-client"
        self.state.last_seen = self.state.clock()
        session_id = self.post("/api/agent/session", {})[1]["sessionId"]
        self.state.agent_portal._backend.enabled_matrix_tools = (
            "matrix_scene_summary", "matrix_list_assets")
        code, _ = self.post("/api/agent/turn", {"sessionId": session_id,
                                                "text": "Operator, load XYZ"})
        self.assertEqual(code, 200)
        sent = self.state.agent_portal._backend.sent_texts[-1]
        self.assertIn("desktop presentation", sent)
        self.assertIn("matrix_list_assets offset/limit pages", sent)
        self.assertNotIn("private-chair", sent)
        encoded = sent.split("<matrix_runtime_context>", 1)[1].split(
            "</matrix_runtime_context>", 1)[0]
        grounded = json.loads(encoded)
        self.assertEqual(grounded["capabilityVersions"]["rigidSchemaVersion"], 1)
        self.assertEqual(grounded["assetCatalogCount"], 1)
        self.assertEqual(grounded["room"], {"mode": "white-room", "state": "ready",
                                            "alignmentVerified": False, "readOnly": False})
        self.assertNotIn("sceneSummary", grounded)
        self.assertNotIn("selectedObject", grounded)

    def test_text_runtime_context_reports_ar_recovery_without_claiming_alignment(self):
        self.state.latest = snapshot({
            "scene": {"schemaVersion": 1, "roomId": "webxr-session-recovery", "objects": []},
            "assets": [], "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
            "roomContext": {"mode": "ar", "state": "missing", "alignmentVerified": False,
                            "message": "Room origin unavailable"},
            "readOnly": True,
            "runtimeDescriptor": {"schemaVersion": 1, "client": "matrix-web",
                                  "renderer": "threejs-webxr", "presentation": "ar"}})
        self.state.client_id = "web-client"
        self.state.last_seen = self.state.clock()
        grounded = agent_runtime_context(self.state)
        self.assertTrue(grounded["online"])
        self.assertEqual(grounded["room"], {"mode": "ar", "state": "missing",
                                            "alignmentVerified": False, "readOnly": True})
        self.assertNotIn("Room origin unavailable", json.dumps(grounded))
        self.assertNotIn("sceneSummary", grounded)
        self.state.latest = None
        self.assertIsNone(agent_runtime_context(self.state)["room"])

    def test_live_descriptor_capability_guidance_and_catalog_beyond_preview(self):
        context = {"schemaVersion": 1, "inputSource": "text", "clientId": "web-client",
                   "roomId": "web-virtual-room-v1", "selectedObjectId": None,
                   "pointingTarget": None, "viewerFrame": None}
        source = Path(self.temp.name) / "catalog-example.glb"
        source.write_bytes(glb())
        self.state.web_assets = WebAssetCatalog(Path(self.temp.name) / "catalog")
        registered = [self.state.web_assets.register(source, f"Asset {i:02}")
                      for i in range(30)]
        assets = [{"assetId": item["assetId"], "displayName": item["displayName"],
                   "sha256": item["sha256"]} for item in registered]
        base = {"scene": {"schemaVersion": 1, "roomId": context["roomId"], "objects": []},
                "assets": assets,
                "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                "rigidSchemaVersion": 1, "entityActionSchemaVersion": 1,
                "proceduralGenerators": [],
                "roomContext": {"mode": "white-room", "state": "ready",
                                "alignmentVerified": False, "message": "Virtual room"}}
        self.state.client_id = context["clientId"]
        self.state.last_seen = self.state.clock()
        enabled = ("matrix_scene_summary", "matrix_list_assets",
                   "matrix_list_procedural_generators")
        for presentation in ("desktop", "vr", "ar"):
            room = {**base, "roomContext": {**base["roomContext"],
                                            "mode": "ar" if presentation == "ar" else "white-room"},
                    "runtimeDescriptor": {"schemaVersion": 1, "client": "matrix-web",
                                          "renderer": "threejs-webxr",
                                          "presentation": presentation}}
            if presentation == "ar":
                room["spatialObservation"] = {"schemaVersion": 1, "planeAgeMs": 0,
                                              "trackingEpoch": 3, "webFloorPose": None}
            self.state.latest = snapshot(room)
            request_context = ({**context, "schemaVersion": 2, "presentation": "ar",
                                "trackingEpoch": 3} if presentation == "ar" else context)
            grounded = agent_turn_context(self.state, request_context)
            message = build_matrix_turn_message("Operator, load Asset 29", grounded, enabled)
            self.assertIn(f"{presentation} presentation", message)
            self.assertEqual(grounded["capabilityVersions"]["rigidSchemaVersion"], 1)
            self.assertEqual(grounded["assetCatalogCount"], 30)
            self.assertIn("matrix_list_assets offset/limit pages", message)
        preview = scene_summary(self.state)
        self.assertEqual(len(preview["assets"]), 24)
        self.assertTrue(preview["assetsTruncated"])
        target = registered[29]["assetId"]
        self.assertNotIn(target, [asset["assetId"] for asset in preview["assets"]])
        self.assertIn(target, [asset["assetId"] for asset in
                               self.state.agent_list_assets(24, 24)["assets"]])
        old = {**base, "runtimeDescriptor": {"schemaVersion": 0}}
        self.state.latest = snapshot(old)
        grounded = agent_turn_context(self.state, context)
        self.assertIsNone(grounded["runtimeDescriptor"])
        self.assertIn("Live runtime identity and presentation: unknown",
                      build_matrix_turn_message("Operator, load Asset 29", grounded, enabled))
        with self.assertRaisesRegex(APIError, "presentation and room context disagree"):
            snapshot({**base, "runtimeDescriptor": {"schemaVersion": 1,
                      "client": "matrix-web", "renderer": "threejs-webxr",
                      "presentation": "ar"}})
        with self.assertRaisesRegex(APIError, "Invalid Matrix Web runtime descriptor"):
            snapshot({**base, "runtimeDescriptor": {"schemaVersion": 1,
                      "client": "matrix-web", "renderer": "unity", "presentation": "desktop"}})

    def test_pointed_object_is_in_bounded_summary_even_after_first_eight(self):
        pose = {"position": {"x": 0, "y": 0, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 1, "y": 1, "z": 1}}
        objects = [{"objectId": f"chair-{index}", "assetId": "chair",
                    "anchorId": "web-floor", "transform": pose} for index in range(12)]
        binding = {"loopClip": "Flight", "selectClip": None}
        objects[10]["animation"] = binding
        self.state.latest = snapshot({"scene": {"schemaVersion": 1, "roomId": "room-1", "objects": objects},
                                      "assets": [{"assetId": "chair", "displayName": "Chair",
                                                  "animationClips": ["Flight"]}],
                                      "anchors": [{"anchorId": "web-floor", "displayName": "Floor"}],
                                      "animationSchemaVersion": 1,
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
        self.assertEqual(grounded["selectedObject"]["assetDisplayName"], "Chair")
        self.assertEqual(grounded["selectedObject"]["animation"], binding)
        self.assertEqual(grounded["sceneSummary"]["objects"][0]["animation"], binding)
        self.assertEqual(grounded["sceneSummary"]["objects"][1]["assetDisplayName"], "Chair")
        self.assertNotIn("animation", grounded["sceneSummary"]["objects"][1])
        self.assertNotIn("assetDisplayName", grounded["sceneSummary"]["objects"][2])


if __name__ == "__main__":
    unittest.main()
