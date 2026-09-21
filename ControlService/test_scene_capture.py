"""Capture lifecycle, HTTP transport, freshness, and opt-in image planning tests."""
import base64
import copy
import tempfile
import unittest
from unittest.mock import patch

import scene_capture
from server import APIError, State, plan, snapshot
from test_server import SNAPSHOT, TRANSFORM
import test_server
import test_voice
import server


# A bounded synthetic JPEG frame/scan fixture tests transport parsing only.
# Real JPEG decoding and rendered pixel content are exercised in the player loop.
JPEG = b'\xff\xd8\xff\xc0\x00\x0b\x08\x00\x08\x00\x08\x01\x01\x11\x00\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x00\xff\xd9'


def capture_result(state, **changes):
    result = {"captureId": state.capture["captureId"], "clientId": state.client_id,
              "revision": state.revision, "ok": True, "error": "", "mimeType": "image/jpeg",
              "dataBase64": base64.b64encode(JPEG).decode(), "width": 8, "height": 8,
              "source": "unity_center_eye", "includesPassthrough": False,
              "capturedAtUtc": "2026-09-21T12:34:56Z", "snapshot": copy.deepcopy(state.latest),
              "camera": {"position": {"x": 0, "y": 1.6, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0},
                         "forward": {"x": 0, "y": 0, "z": 1}, "fieldOfView": 70, "aspect": 1,
                         "nearClip": .01, "farClip": 100}, "renderMs": 3, "encodeMs": 1, "frameTimeMs": 16}
    result.update(changes)
    return result


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = [100.0]
        self.state = State(self.temp.name, clock=lambda: self.now[0])
        self.exchange()

    def exchange(self, **changes):
        body = {"clientId": "runtime-a", "snapshot": SNAPSHOT, "captureSupported": True}
        body.update(changes)
        return self.state.exchange(body)

    def ready(self):
        self.state.request_capture({})
        value = capture_result(self.state)
        self.exchange(capture=value)
        self.assertEqual(self.state.capture_status()["status"], "ready")
        return value

    def test_capture_delivery_retry_does_not_mutate_scene_revision(self):
        before = self.state.revision
        requested = self.state.request_capture({})
        expected = {"captureId": requested["captureId"], "revision": before}
        self.assertEqual(self.exchange()["capture"], expected)
        self.assertEqual(self.exchange()["capture"], expected)
        value = capture_result(self.state)
        self.assertNotIn("capture", self.exchange(capture=value))
        self.assertNotIn("capture", self.exchange(capture=value))
        self.assertEqual(self.state.revision, before)
        self.assertEqual(self.state.status()["pendingCount"], 0)
        self.assertNotIn("imageDataUrl", self.state.status()["capture"])
        self.assertTrue(self.state.capture_status(True)["imageDataUrl"].startswith("data:image/jpeg;base64,"))
        self.state.save("NoScreenshot")
        self.assertNotIn("dataBase64", self.state.path("NoScreenshot").read_text())

    def test_missing_and_unsupported_runtime_feedback(self):
        with self.assertRaisesRegex(APIError, "unavailable"):
            self.state.selected_capture("missing")
        self.exchange(captureSupported=False)
        with self.assertRaisesRegex(APIError, "update the app"):
            self.state.request_capture({})

    def test_rate_limit_and_pending_capture(self):
        self.state.request_capture({})
        with self.assertRaisesRegex(APIError, "already pending"):
            self.state.request_capture({})
        self.exchange(capture=capture_result(self.state))
        with self.assertRaises(APIError) as error:
            self.state.request_capture({})
        self.assertEqual(error.exception.status, 429)
        self.now[0] += 2
        self.assertEqual(self.state.request_capture({})["status"], "pending")

    def test_timeout_does_not_block_text_command_queue(self):
        self.state.request_capture({})
        self.now[0] += 16
        self.exchange()
        self.assertEqual(self.state.capture_status()["status"], "error")
        self.assertIn("timed out", self.state.capture_status()["error"])
        self.state.queue([{"op": "spawn", "assetId": "cube", "anchorId": "floor", "transform": TRANSFORM}])

    def test_stale_capture_rejected_after_scene_change_age_and_session_change(self):
        for reason in ("scene", "age", "session"):
            with self.subTest(reason=reason):
                self.setUp()
                value = self.ready()
                if reason == "scene":
                    changed = copy.deepcopy(SNAPSHOT)
                    changed["selection"] = {"anchorId": "floor", "objectId": "", "position": {"x": 1, "y": 0, "z": 0}}
                    self.exchange(snapshot=changed)
                elif reason == "age":
                    for _ in range(4):
                        self.now[0] += 8
                        self.exchange()
                else:
                    self.now[0] += 16
                    self.exchange(clientId="runtime-b")
                self.assertEqual(self.state.capture_status()["status"], "stale")
                with self.assertRaises(APIError):
                    self.state.selected_capture(value["captureId"])

    def test_pose_only_movement_keeps_matching_captured_context(self):
        value = self.ready()
        changed = copy.deepcopy(SNAPSHOT)
        changed["viewer"] = {"frames": [{"anchorId": "floor", "position": {"x": 4, "y": 1, "z": 0},
                                             "forward": {"x": 0, "y": 0, "z": 1}}]}
        self.exchange(snapshot=changed)
        _, captured = self.state.selected_capture(value["captureId"])
        self.assertNotIn("viewer", captured)
        self.assertEqual(self.state.capture_status()["status"], "ready")

    def test_invalid_uploads_surface_error_and_keep_heartbeat_alive(self):
        mutations = [{"clientId": "other"}, {"revision": 999}, {"ok": False, "error": "Tracking unavailable"},
                     {"dataBase64": "invalid!"}, {"dataBase64": "A" * 700000}, {"width": 9},
                     {"includesPassthrough": True}, {"capturedAtUtc": "unknown"}, {"renderMs": float("inf")},
                     {"snapshot": {**SNAPSHOT, "scene": {**SNAPSHOT["scene"], "roomId": "different"}}}]
        for changes in mutations:
            with self.subTest(changes=list(changes)):
                self.now[0] += 2
                self.state.request_capture({})
                self.assertEqual(self.exchange(capture=capture_result(self.state, **changes)), {"commands": []})
                self.assertEqual(self.state.capture_status()["status"], "error")
                self.assertTrue(self.state.online())

    def test_dimensions_checked_against_jpeg_header(self):
        value = self.ready()
        raw = bytearray(JPEG)
        raw[9:11] = (1281).to_bytes(2, "big")
        value.update(dataBase64=base64.b64encode(raw).decode(), width=1281)
        with self.assertRaises(scene_capture.CaptureError) as error:
            scene_capture.image(value)
        self.assertEqual(error.exception.status, 413)

    def test_oversized_integer_metadata_reports_capture_error_without_breaking_heartbeat(self):
        for field in ("renderMs", "encodeMs", "frameTimeMs", "captureFrameTimeMs", "frameCount", "capturedAtRuntimeSeconds"):
            with self.subTest(field=field):
                self.now[0] += 2
                self.state.request_capture({})
                result = capture_result(self.state, **{field: 10 ** 400})
                self.assertEqual(self.exchange(capture=result), {"commands": []})
                self.assertEqual(self.state.capture_status()["status"], "error")
                self.assertIn("Invalid capture " + field, self.state.capture_status()["error"])
                self.assertTrue(self.state.online())
                self.assertEqual(self.exchange(), {"commands": []})

    def test_text_request_has_no_image_and_image_request_uses_captured_snapshot(self):
        value = self.ready()
        proposal = {"commands": [], "status": "needs_clarification", "requiresApply": False}
        with patch("server.Planner.plan", return_value=proposal) as planner:
            plan(self.state, {"text": "inspect"})
            self.assertNotIn("screenshot", planner.call_args.kwargs)
            result = plan(self.state, {"text": "inspect", "captureId": value["captureId"]})
            self.assertEqual(planner.call_args.kwargs["screenshot"]["dataBase64"], value["dataBase64"])
            self.assertEqual(planner.call_args.args[1], snapshot(value["snapshot"]))
            self.assertEqual(result["screenshot"]["captureId"], value["captureId"])
            self.assertNotIn("dataBase64", result["screenshot"])

    def test_new_capture_does_not_reuse_voice_opt_in(self):
        value = self.ready()
        self.state.arm_voice_capture({"captureId": value["captureId"]})
        self.assertEqual(self.state.capture_status()["voiceCaptureId"], value["captureId"])
        self.now[0] += 2
        self.state.request_capture({})
        self.assertIsNone(self.state.capture_status()["voiceCaptureId"])

    def test_ar_content_disclosure_excludes_physical_passthrough(self):
        description = scene_capture.content_description({"roomContext": {"mode": "ar"}})
        self.assertIn("MRUK", description)
        self.assertIn("NOT included", description)


class CaptureHTTPTests(unittest.TestCase):
    setUp = test_server.ServiceTests.setUp
    tearDown = test_server.ServiceTests.tearDown
    request = test_server.ServiceTests.request

    def test_exchange_has_a_separate_bounded_budget_for_image_and_two_snapshots(self):
        body = {"clientId": "runtime-a", "snapshot": SNAPSHOT, "captureSupported": True}
        # Harmless extra padding isolates the HTTP limit from image validation.
        self.assertEqual(self.request("/api/exchange", {**body, "padding": " " * server.MAX_BODY})[0], 200)
        self.assertEqual(self.request("/api/plan", raw=b"{}", headers={"Content-Length": str(server.MAX_BODY + 1)})[0], 413)
        self.assertEqual(self.request("/api/exchange", raw=b"{}", headers={"Content-Length": str(server.MAX_EXCHANGE_BODY + 1)})[0], 413)


def test_http_capture_preview_auth_and_opt_in(self):
    code, _ = self.request("/api/exchange", {"clientId": "runtime-a", "snapshot": SNAPSHOT, "captureSupported": True})
    self.assertEqual(code, 200)
    code, requested = self.request("/api/capture", {})
    self.assertEqual(code, 200)
    self.request("/api/exchange", {"clientId": "runtime-a", "snapshot": SNAPSHOT, "captureSupported": True,
                                   "capture": capture_result(self.state)})
    code, preview = self.request("/api/capture")
    self.assertEqual(code, 200)
    self.assertIn("imageDataUrl", preview)
    self.assertEqual(self.request("/api/capture/voice", {"captureId": requested["captureId"]})[0], 200)
    self.assertEqual(self.request("/api/capture/voice", {"captureId": None})[0], 200)
    self.server.token = "test-token"
    self.assertEqual(self.request("/api/capture")[0], 401)
    self.assertEqual(self.request("/api/capture", {}, {"Authorization": "Bearer test-token", "Origin": "http://foreign"})[0], 403)


CaptureHTTPTests.test_http_capture_preview_auth_and_opt_in = test_http_capture_preview_auth_and_opt_in


class VoiceCaptureTests(unittest.TestCase):
    setUp = test_voice.VoiceJobTests.setUp
    tearDown = test_voice.VoiceJobTests.tearDown
    wait_idle = test_voice.VoiceJobTests.wait_idle
    block = test_voice.VoiceJobTests.block
    begin = test_voice.VoiceJobTests.begin

    def ready(self):
        self.state.exchange({"clientId": "quest-a", "snapshot": self.snapshot, "captureSupported": True})
        self.state.request_capture({})
        value = capture_result(self.state)
        self.state.exchange({"clientId": "quest-a", "snapshot": self.snapshot, "captureSupported": True, "capture": value})
        self.state.arm_voice_capture({"captureId": value["captureId"]})
        return value

    def test_voice_includes_selected_image_once_and_uses_its_matching_pose(self):
        value = self.ready()
        entered, release = self.block(self.transcribe, "inspect this image")
        self.planner.return_value = {"commands": [], "summary": "Image review", "status": "review_only", "requiresApply": False}
        self.body["snapshot"]["viewer"]["frames"][0]["position"]["x"] += 1
        job_id = self.begin()
        self.assertTrue(entered.wait(1))
        public = server.voice_status(self.state, job_id)
        self.assertEqual(public["screenshot"]["captureId"], value["captureId"])
        self.assertNotIn("dataBase64", public["screenshot"])
        self.assertIsNone(self.state.voice_capture_id)
        release.set()
        self.wait_idle()
        self.assertEqual(self.planner.call_args.kwargs["screenshot"]["captureId"], value["captureId"])
        self.assertEqual(self.planner.call_args.args[1]["viewer"], value["snapshot"]["viewer"])
        self.assertEqual(server.voice_status(self.state, job_id)["phase"], "review_only")
        self.begin()
        self.wait_idle()
        self.assertNotIn("screenshot", self.planner.call_args.kwargs)

    def test_capture_that_expires_during_transcription_does_not_fall_back_to_text(self):
        self.ready()
        entered, release = self.block(self.transcribe, "inspect this image")
        job_id = self.begin()
        self.assertTrue(entered.wait(1))
        for _ in range(4):
            self.now[0] += 8
            self.state.exchange({"clientId": "quest-a", "snapshot": self.snapshot, "captureSupported": True})
        release.set()
        self.wait_idle()
        self.assertEqual(server.voice_status(self.state, job_id)["phase"], "error")
        self.planner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
