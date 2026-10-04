"""Protocol-level tests with a local fake app-server; no Codex account is used."""
from __future__ import annotations

import base64
import hashlib
import json
import sys
import tempfile
import textwrap
import time
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from codex_app_server import AppServerError, AppServerTransport, MAX_EVENT

ORDINARY_POLICY = {"sandbox": "workspace-write", "approval_policy": "on-request"}
IMAGE_POLICY = {"sandbox": "read-only", "approval_policy": "on-request"}


FAKE_SERVER = r'''
import base64
import json
import sys

def send(value):
    sys.stdout.write(json.dumps(value) + "\n")
    sys.stdout.flush()

turn_count = 0
for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    if method == "initialize":
        send({"id": message["id"], "result": {"userAgent": "test-app-server"}})
    elif method == "initialized":
        pass
    elif method == "thread/start":
        assert message["params"]["approvalPolicy"] in ("on-request", "never")
        assert message["params"]["approvalsReviewer"] == "user"
        assert message["params"]["sandbox"] == ("danger-full-access" if message["params"]["approvalPolicy"] == "never" else "workspace-write")
        send({"id": message["id"], "result": {"thread": {"id": "thread-test"}}})
    elif method == "thread/resume":
        assert message["params"]["threadId"] == "thread-test"
        assert message["params"]["approvalPolicy"] in ("on-request", "never")
        assert message["params"]["approvalsReviewer"] == "user"
        assert message["params"]["sandbox"] == ("danger-full-access" if message["params"]["approvalPolicy"] == "never" else "workspace-write")
        send({"id": message["id"], "result": {"thread": {"id": "thread-test"}}})
    elif method == "thread/read":
        assert message["params"]["includeTurns"] is False
        send({"id": message["id"], "result": {"thread": {"id": "thread-test", "turns": []}}})
    elif method == "account/read":
        send({"id": message["id"], "result": {"account": {"type": "chatgpt", "email": "private@example.com"},
                                                "requiresOpenaiAuth": True}})
    elif method == "modelProvider/capabilities/read":
        send({"id": message["id"], "result": {"namespaceTools": True, "imageGeneration": True,
                                                "webSearch": True}})
    elif method == "turn/start":
        image_turn = message["params"]["input"][0]["text"].startswith("$imagegen")
        assert message["params"]["sandboxPolicy"] == (
            {"type": "readOnly", "networkAccess": False} if image_turn else
            {"type": "workspaceWrite"})
        assert message["params"]["approvalPolicy"] == "on-request"
        turn_count += 1
        turn_id = "turn-" + str(turn_count)
        send({"id": message["id"], "result": {"turn": {"id": turn_id}}})
        if message["params"]["input"][0]["text"].startswith("$imagegen"):
            image = b"\x89PNG\r\n\x1a\n" + b"x" * 1700000
            send({"method": "item/completed", "params": {"threadId": "thread-test", "turnId": turn_id,
                  "item": {"type": "imageGeneration", "id": "image-1", "status": "completed",
                           "result": base64.b64encode(image).decode(), "savedPath": None,
                           "revisedPrompt": "test revised prompt", "failure": None}}})
            send({"method": "turn/completed", "params": {"threadId": "thread-test",
                  "turn": {"id": turn_id, "status": "completed"}}})
            continue
        send({"method": "item/agentMessage/delta", "params": {"threadId": "thread-test", "turnId": turn_id, "delta": "Working"}})
        send({"method": "item/commandExecution/requestApproval", "id": 900 + turn_count,
              "params": {"threadId": "thread-test", "turnId": turn_id, "itemId": "item-test", "reason": "Test action"}})
        send({"method": "mcpServer/elicitation/request", "id": 990 + turn_count, "params": {"secret": "never-forward"}})
    elif method == "turn/interrupt":
        send({"id": message["id"], "result": {}})
        send({"method": "turn/completed", "params": {"threadId": "thread-test", "turn": {"id": message["params"]["turnId"], "status": "interrupted"}}})
    elif method == "turn/steer":
        assert message["params"] == {"threadId": "thread-test",
                                     "expectedTurnId": "turn-" + str(turn_count),
                                     "input": [{"type": "text", "text": "Add some color"}]}
        send({"id": message["id"], "result": {"turnId": "turn-" + str(turn_count)}})
    elif "id" in message and "result" in message:
        if message["id"] in (777, 778):
            assert message["result"] == ({"action": "accept", "content": {}} if message["id"] == 777
                                          else {"action": "decline"})
            send({"method": "serverRequest/resolved", "params": {"requestId": message["id"]}})
            continue
        assert message["result"]["decision"] in ("accept", "decline")
        send({"method": "serverRequest/resolved", "params": {"requestId": message["id"]}})
        send({"method": "turn/completed", "params": {"threadId": "thread-test", "turn": {"id": "turn-" + str(turn_count), "status": "completed"}}})
    elif "id" in message and "error" in message:
        assert message["id"] == 990 + turn_count
        send({"method": "test/unsupportedRejected", "params": {"id": message["id"]}})
    else:
        raise AssertionError("unexpected client message: " + str(message))
'''


class AppServerTransportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        script = Path(self.directory.name) / "fake_server.py"
        script.write_text(textwrap.dedent(FAKE_SERVER), encoding="utf-8")
        self.transport = AppServerTransport([sys.executable, "-u", str(script)], self.directory.name, timeout=2)
        self.addCleanup(self.transport.close)
        self.transport.start()

    def wait_for_approval(self, request_id):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            pending = self.transport.pending_approvals()
            if any(item["requestId"] == request_id for item in pending):
                return pending
            time.sleep(0.01)
        self.fail("fake server approval was not received")

    def test_persistent_thread_followup_native_approval_and_bounded_events(self):
        thread_id = self.transport.thread_start()
        self.assertEqual(thread_id, "thread-test")
        self.assertEqual(self.transport.thread_resume(thread_id), thread_id)
        self.assertEqual(self.transport.thread_read(thread_id)["turns"], [])

        turn_id = self.transport.turn_start(thread_id, "Move this there", **ORDINARY_POLICY)
        self.assertEqual(turn_id, "turn-1")
        pending = self.wait_for_approval(901)
        self.assertEqual(pending[0]["params"]["turnId"], turn_id)
        self.transport.turn_steer(thread_id, turn_id, "Add some color")
        with self.assertRaises(AppServerError):
            self.transport.respond_approval(901, thread_id, "wrong-turn", "accept")
        with self.assertRaises(ValueError):
            self.transport.respond_approval(901, thread_id, turn_id, "acceptForSession")
        self.transport.respond_approval(901, thread_id, turn_id, "accept")
        with self.assertRaises(AppServerError):
            self.transport.respond_approval(901, thread_id, turn_id, "accept")

        second_turn = self.transport.turn_start(thread_id, "Now make it taller", **ORDINARY_POLICY)
        self.assertEqual(second_turn, "turn-2")
        self.wait_for_approval(902)
        self.transport.respond_approval(902, thread_id, second_turn, "decline")
        self.transport.turn_interrupt(thread_id, second_turn)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and not all(
            any(event["method"] == method for event in self.transport.events_since())
            for method in ("turn/completed", "test/unsupportedRejected")
        ):
            time.sleep(0.01)
        events = self.transport.events_since()
        self.assertTrue(any(event["method"] == "item/agentMessage/delta" for event in events))
        self.assertTrue(any(event["method"] == "mcpServer/elicitation/request" for event in events))
        self.assertTrue(any(event["method"] == "test/unsupportedRejected" for event in events))
        self.assertTrue(any(event["method"] == "turn/completed" for event in events))
        cursor = events[-1]["sequence"]
        self.assertEqual(self.transport.events_since(cursor), [])
        events[0]["params"]["changed"] = True
        self.assertNotIn("changed", self.transport.events_since()[0]["params"])

    def test_rejects_bad_requests(self):
        with self.assertRaises(ValueError):
            self.transport.request("thread/start", [])
        with self.assertRaises(ValueError):
            self.transport.turn_start("thread-test", " ", **ORDINARY_POLICY)
        with self.assertRaises(ValueError):
            self.transport.turn_start("thread-test", "x" * 16001, **ORDINARY_POLICY)
        with self.assertRaises(ValueError):
            self.transport.turn_steer("thread-test", "turn-1", " ")
        with self.assertRaises(ValueError):
            self.transport.turn_steer("thread-test", "turn-1", "x" * 16001)
        with self.assertRaises(TypeError):
            self.transport.turn_start("thread-test", "No implicit policy")
        for sandbox, approval_policy in (("invalid", "on-request"),
                                         ("workspace-write", "never"),
                                         ("read-only", "never")):
            with self.subTest(sandbox=sandbox, approval_policy=approval_policy), \
                    self.assertRaises(ValueError):
                self.transport.turn_start("thread-test", "Invalid policy",
                                          sandbox=sandbox, approval_policy=approval_policy)
        with self.assertRaises(ValueError):
            self.transport.thread_start(sandbox="no-sandbox")
        with self.assertRaises(ValueError):
            self.transport.thread_resume("thread-test", sandbox="no-sandbox")
        for policy in ("never", "unknown"):
            with self.subTest(policy=policy), self.assertRaises(ValueError):
                self.transport.thread_start(approval_policy=policy)
            with self.subTest(policy=policy), self.assertRaises(ValueError):
                self.transport.thread_resume("thread-test", approval_policy=policy)

    def test_turn_start_attaches_pc_image_as_multimodal_input(self):
        image = Path(self.directory.name) / "selected.png"
        image.write_bytes(b"\x89PNG\r\n\x1a\nconcept")
        with patch.object(self.transport, "request", return_value={"turn": {"id": "turn-image"}}) as request:
            self.assertEqual(self.transport.turn_start("thread-test", "Build this",
                                                       image_path=image, **ORDINARY_POLICY), "turn-image")
        method, params = request.call_args.args
        self.assertEqual(method, "turn/start")
        self.assertEqual(params["input"], [
            {"type": "text", "text": "Build this"},
            {"type": "localImage", "path": str(image.resolve())}])
        self.assertEqual(Path(params["input"][1]["path"]).read_bytes(), image.read_bytes())
        with self.assertRaisesRegex(ValueError, "existing local image"):
            self.transport.turn_start("thread-test", "Build this",
                                      image_path=image.with_name("missing.png"), **ORDINARY_POLICY)

    def test_image_turn_policy_is_explicit_and_later_full_access_is_restored(self):
        with patch.object(self.transport, "request",
                          return_value={"turn": {"id": "turn-policy"}}) as request:
            self.transport.turn_start("thread-test", "$imagegen blue orb", **IMAGE_POLICY)
            self.transport.turn_start("thread-test", "Build this",
                                      sandbox="danger-full-access", approval_policy="never")
        first, second = [call.args[1] for call in request.call_args_list]
        self.assertEqual(first["sandboxPolicy"], {"type": "readOnly", "networkAccess": False})
        self.assertEqual(first["approvalPolicy"], "on-request")
        self.assertEqual(second["sandboxPolicy"], {"type": "dangerFullAccess"})
        self.assertEqual(second["approvalPolicy"], "never")

    def test_native_image_over_two_megabyte_line_stays_pc_only(self):
        self.assertEqual(self.transport.native_image_capability(), (True, None))
        turn_id = self.transport.turn_start("thread-test", "$imagegen test art", **IMAGE_POLICY)
        deadline = time.monotonic() + 3
        result = None
        while time.monotonic() < deadline:
            result = self.transport.image_generation_result("thread-test", turn_id)
            if result is not None:
                break
            time.sleep(.01)
        self.assertIsNotNone(result)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["mimeType"], "image/png")
        self.assertIs(result["transientArtifact"], True)
        self.assertEqual(result["revisedPrompt"], "test revised prompt")
        self.assertEqual(Path(result["imagePath"]).stat().st_size, 1700008)
        self.assertEqual(result["sha256"], hashlib.sha256(Path(result["imagePath"]).read_bytes()).hexdigest())
        self.assertNotIn("result", json.dumps(self.transport.events_since()))
        self.assertNotIn("savedPath", json.dumps(self.transport.events_since()))
        self.assertGreater(Path(result["imagePath"]).stat().st_size * 4 // 3, 2 * 1024 * 1024)

    def test_saved_native_path_must_be_under_codex_generated_root(self):
        root = Path(self.directory.name) / "generated_images"
        root.mkdir()
        self.transport._generated_root = root
        saved = root / "native.png"
        saved.write_bytes(b"\x89PNG\r\n\x1a\nimage")
        self.transport._receive({"method": "item/completed", "params": {
            "threadId": "thread-test", "turnId": "saved-turn",
            "item": {"type": "imageGeneration", "id": "image-saved", "status": "completed",
                     "savedPath": str(saved), "result": base64.b64encode(saved.read_bytes()).decode(),
                     "revisedPrompt": None}}})
        result = self.transport.image_generation_result("thread-test", "saved-turn")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["imagePath"], str(saved.resolve()))
        outside = Path(self.directory.name) / "outside.png"
        outside.write_bytes(saved.read_bytes())
        self.transport._receive({"method": "item/completed", "params": {
            "threadId": "thread-test", "turnId": "outside-turn",
            "item": {"type": "imageGeneration", "id": "image-outside", "status": "completed",
                     "savedPath": str(outside), "result": "not-base64"}}})
        self.assertEqual(self.transport.image_generation_result("thread-test", "outside-turn")["status"],
                         "failed")

    def test_saved_path_hash_mismatch_uses_completed_image_bytes(self):
        root = Path(self.directory.name) / "generated_images"
        root.mkdir()
        self.transport._generated_root = root
        saved = root / "wrong.png"
        saved.write_bytes(b"\x89PNG\r\n\x1a\nwrong")
        actual = b"\x89PNG\r\n\x1a\nactual"
        self.transport._receive({"method": "item/completed", "params": {
            "threadId": "thread-test", "turnId": "mismatch-turn",
            "item": {"type": "imageGeneration", "id": "image-mismatch", "status": "completed",
                     "savedPath": str(saved), "result": base64.b64encode(actual).decode()}}})
        result = self.transport.image_generation_result("thread-test", "mismatch-turn")
        self.assertEqual(result["status"], "ready")
        self.assertNotEqual(Path(result["imagePath"]), saved)
        self.assertEqual(Path(result["imagePath"]).read_bytes(), actual)

    def test_duplicate_native_result_and_close_discard_staged_images(self):
        encoded = base64.b64encode(b"\x89PNG\r\n\x1a\nimage").decode()
        def receive(turn_id):
            self.transport._receive({"method": "item/completed", "params": {
                "threadId": "thread-test", "turnId": turn_id,
                "item": {"type": "imageGeneration", "status": "completed",
                         "savedPath": None, "result": encoded}}})
        receive("duplicate-turn")
        staged = Path(self.transport.image_generation_result("thread-test", "duplicate-turn")["imagePath"])
        self.assertTrue(staged.exists())
        receive("duplicate-turn")
        self.assertEqual(self.transport.image_generation_result("thread-test", "duplicate-turn")["status"],
                         "failed")
        self.assertFalse(staged.exists())
        receive("unconsumed-turn")
        staged = Path(self.transport.image_generation_result("thread-test", "unconsumed-turn")["imagePath"])
        self.assertTrue(staged.exists())
        self.transport.close()
        self.assertFalse(staged.exists())

    def test_native_capability_requires_chatgpt_account(self):
        with patch.object(self.transport, "request", return_value={"account": {"type": "apiKey"}}):
            available, reason = self.transport.native_image_capability()
        self.assertFalse(available)
        self.assertIn("ChatGPT", reason)

    def test_automatic_policy_is_sent_on_new_and_resumed_thread(self):
        thread_id = self.transport.thread_start(sandbox="danger-full-access", approval_policy="never")
        self.assertEqual(thread_id, "thread-test")
        self.assertEqual(self.transport.thread_resume(thread_id, sandbox="danger-full-access",
                                                      approval_policy="never"), thread_id)

    def test_native_mcp_tool_approval_accept_and_decline(self):
        params = {"threadId": "thread-test", "turnId": "turn-mcp", "serverName": "matrix_webxr",
                  "mode": "form", "message": 'Allow the matrix_webxr MCP server to run tool "matrix_scene_summary"?',
                  "requestedSchema": {"type": "object", "properties": {}},
                  "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {}}}
        self.transport._receive({"id": 777, "method": "mcpServer/elicitation/request", "params": params})
        self.assertEqual(self.wait_for_approval(777)[0]["method"], "mcpServer/elicitation/request")
        with self.assertRaises(AppServerError):
            self.transport.respond_approval(777, "thread-test", "wrong-turn", "accept")
        self.transport.respond_approval(777, "thread-test", "turn-mcp", "accept")
        self.transport._receive({"id": 778, "method": "mcpServer/elicitation/request", "params": params})
        self.wait_for_approval(778)
        self.transport.respond_approval(778, "thread-test", "turn-mcp", "decline")
        self.assertEqual(self.transport.pending_approvals(), [])

    def test_reviewed_approval_rejects_replaced_params_or_method_without_consuming(self):
        expected = {"method": "mcpServer/elicitation/request", "params": {
            "threadId": "thread-test", "turnId": "turn-mcp", "serverName": "blender",
            "mode": "form", "message": 'Allow Blender to run "execute_blender_code"?',
            "_meta": {"codex_approval_kind": "mcp_tool_call",
                      "tool_params": {"code": "print('reviewed')"}}}}
        for changed_field in ("params", "method"):
            with self.subTest(changed_field=changed_field):
                changed = deepcopy(expected)
                if changed_field == "params":
                    changed["params"]["_meta"]["tool_params"]["code"] = "print('changed')"
                else:
                    changed["method"] = "item/commandExecution/requestApproval"
                self.transport._receive({"id": 777, **changed})
                with patch.object(self.transport, "_write") as write:
                    with self.assertRaisesRegex(AppServerError, "changed since it was reviewed"):
                        self.transport.respond_approval(777, "thread-test", "turn-mcp", "accept",
                                                        expected_request=expected)
                    write.assert_not_called()
                self.assertEqual(self.transport.pending_approvals(), [{"requestId": 777, **changed}])

    def test_reviewed_approval_accepts_exact_request_once(self):
        for method, decision, result in (
            ("mcpServer/elicitation/request", "accept", {"action": "accept", "content": {}}),
            ("mcpServer/elicitation/request", "decline", {"action": "decline"}),
            ("item/commandExecution/requestApproval", "accept", {"decision": "accept"}),
        ):
            with self.subTest(method=method, decision=decision):
                expected = {"method": method, "params": {
                    "threadId": "thread-test", "turnId": "turn-review", "mode": "form",
                    "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {}}}}
                self.transport._receive({"id": 777, **deepcopy(expected)})
                with patch.object(self.transport, "_write") as write:
                    self.transport.respond_approval(777, "thread-test", "turn-review", decision,
                                                    expected_request=expected)
                    write.assert_called_once_with({"id": 777, "result": result})
                    with self.assertRaisesRegex(AppServerError, "no longer pending"):
                        self.transport.respond_approval(777, "thread-test", "turn-review", decision,
                                                        expected_request=expected)
                    write.assert_called_once()
                self.assertEqual(self.transport.pending_approvals(), [])

    def test_reviewed_approval_preserves_json_argument_types(self):
        for reviewed_value, changed_value in ((True, 1), (False, 0), (1, 1.0)):
            with self.subTest(reviewed=reviewed_value, changed=changed_value):
                expected = {"method": "mcpServer/elicitation/request", "params": {
                    "threadId": "thread-test", "turnId": "turn-types", "mode": "form",
                    "_meta": {"codex_approval_kind": "mcp_tool_call",
                              "tool_params": {"value": reviewed_value}}}}
                changed = deepcopy(expected)
                changed["params"]["_meta"]["tool_params"]["value"] = changed_value
                self.transport._receive({"id": 777, **changed})
                with patch.object(self.transport, "_write") as write:
                    with self.assertRaisesRegex(AppServerError, "changed since it was reviewed"):
                        self.transport.respond_approval(777, "thread-test", "turn-types", "accept",
                                                        expected_request=expected)
                    write.assert_not_called()
                self.assertEqual(self.transport.pending_approvals(), [{"requestId": 777, **changed}])

    def test_reviewed_approval_rejects_non_json_values_without_consuming(self):
        expected = {"method": "mcpServer/elicitation/request", "params": {
            "threadId": "thread-test", "turnId": "turn-json", "mode": "form",
            "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {"value": 1}}}}
        self.transport._receive({"id": 777, **deepcopy(expected)})
        for value in (float("nan"), float("inf")):
            with self.subTest(value=value):
                malformed = deepcopy(expected)
                malformed["params"]["_meta"]["tool_params"]["value"] = value
                with patch.object(self.transport, "_write") as write:
                    with self.assertRaisesRegex(AppServerError, "cannot be matched"):
                        self.transport.respond_approval(777, "thread-test", "turn-json", "accept",
                                                        expected_request=malformed)
                    write.assert_not_called()
                self.assertEqual(self.transport.pending_approvals(), [{"requestId": 777, **expected}])

    def test_oversized_event_retains_routing_and_completion(self):
        self.transport._receive({"method": "turn/completed", "params": {
            "threadId": "thread-test", "turn": {"id": "turn-7", "status": "completed",
                                                "payload": "x" * MAX_EVENT}, "credential": "do-not-retain"}})
        event = self.transport.events_since()[-1]
        self.assertEqual(event["params"], {"truncated": True, "threadId": "thread-test",
                                            "turn": {"id": "turn-7", "status": "completed"}})

    def test_failed_reader_is_visible_to_event_polling(self):
        self.transport._fail("Codex app-server connection closed")
        with self.assertRaisesRegex(AppServerError, "connection closed"):
            self.transport.events_since()


if __name__ == "__main__":
    unittest.main()
