"""Protocol-level tests with a local fake app-server; no Codex account is used."""
from __future__ import annotations

import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

from codex_app_server import AppServerError, AppServerTransport, MAX_EVENT


FAKE_SERVER = r'''
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
    elif method == "turn/start":
        turn_count += 1
        turn_id = "turn-" + str(turn_count)
        send({"id": message["id"], "result": {"turn": {"id": turn_id}}})
        send({"method": "item/agentMessage/delta", "params": {"threadId": "thread-test", "turnId": turn_id, "delta": "Working"}})
        send({"method": "item/commandExecution/requestApproval", "id": 900 + turn_count,
              "params": {"threadId": "thread-test", "turnId": turn_id, "itemId": "item-test", "reason": "Test action"}})
        send({"method": "mcpServer/elicitation/request", "id": 990 + turn_count, "params": {"secret": "never-forward"}})
    elif method == "turn/interrupt":
        send({"id": message["id"], "result": {}})
        send({"method": "turn/completed", "params": {"threadId": "thread-test", "turn": {"id": message["params"]["turnId"], "status": "interrupted"}}})
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

        turn_id = self.transport.turn_start(thread_id, "Move this there")
        self.assertEqual(turn_id, "turn-1")
        pending = self.wait_for_approval(901)
        self.assertEqual(pending[0]["params"]["turnId"], turn_id)
        with self.assertRaises(AppServerError):
            self.transport.respond_approval(901, thread_id, "wrong-turn", "accept")
        with self.assertRaises(ValueError):
            self.transport.respond_approval(901, thread_id, turn_id, "acceptForSession")
        self.transport.respond_approval(901, thread_id, turn_id, "accept")
        with self.assertRaises(AppServerError):
            self.transport.respond_approval(901, thread_id, turn_id, "accept")

        second_turn = self.transport.turn_start(thread_id, "Now make it taller")
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
            self.transport.turn_start("thread-test", " ")
        with self.assertRaises(ValueError):
            self.transport.turn_start("thread-test", "x" * 16001)
        with self.assertRaises(ValueError):
            self.transport.thread_start(sandbox="no-sandbox")
        with self.assertRaises(ValueError):
            self.transport.thread_resume("thread-test", sandbox="no-sandbox")
        for policy in ("never", "unknown"):
            with self.subTest(policy=policy), self.assertRaises(ValueError):
                self.transport.thread_start(approval_policy=policy)
            with self.subTest(policy=policy), self.assertRaises(ValueError):
                self.transport.thread_resume("thread-test", approval_policy=policy)

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
