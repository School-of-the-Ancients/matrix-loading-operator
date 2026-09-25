"""The browser-safe contract contains no opaque Codex or MCP event payloads."""
import unittest
from types import SimpleNamespace

from agent_session import LocalCodexAgentBackend, normalize_event


class FakeTransport:
    def __init__(self):
        self.calls = []

    def events_since(self, cursor):
        self.calls.append(("events", cursor))
        return [
            {"sequence": 1, "method": "item/agentMessage/delta",
             "params": {"threadId": "thread-1", "turnId": "turn-1", "delta": "Hello", "auth": "secret"}},
            {"sequence": 2, "method": "item/started",
             "params": {"threadId": "thread-1", "turnId": "turn-1",
                        "item": {"type": "mcpToolCall", "server": "blender", "arguments": "secret"}}},
            {"sequence": 3, "method": "item/commandExecution/requestApproval", "requestId": 42,
             "params": {"threadId": "thread-1", "turnId": "turn-1", "command": "echo secret"}},
            {"sequence": 4, "method": "mcpServer/startupStatus/updated", "params": {"token": "secret"}},
            {"sequence": 5, "method": "turn/completed",
             "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}}},
        ]

    def pending_approvals(self):
        return [{"requestId": 42, "method": "item/commandExecution/requestApproval",
                 "params": {"threadId": "thread-1", "turnId": "turn-1", "command": "echo secret"}}]

    def thread_start(self, *, model=None):
        self.calls.append(("start", model))
        return "thread-1"

    def thread_resume(self, identifier):
        self.calls.append(("resume", identifier))
        return identifier

    def turn_start(self, identifier, text, *, effort=None):
        self.calls.append(("send", identifier, text, effort))
        return "turn-1"

    def respond_approval(self, *args):
        self.calls.append(("approval", *args))

    def turn_interrupt(self, *args):
        self.calls.append(("interrupt", *args))


class AgentSessionTests(unittest.TestCase):
    def test_normalizer_drops_tool_arguments_and_credentials(self):
        backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
        backend.config = SimpleNamespace(model="model-test", reasoning_effort="medium")
        backend.transport = FakeTransport()
        self.assertEqual(backend.start_conversation(), "thread-1")
        self.assertEqual(backend.resume_conversation("thread-1"), "thread-1")
        self.assertEqual(backend.send_text("thread-1", "Hello"), "turn-1")
        events = backend.events_since(0)
        self.assertEqual([event["type"] for event in events],
                         ["text", "activity", "approval", "activity"])
        self.assertEqual(events[1]["activity"], "using_blender")
        self.assertEqual(events[2]["action"], "running_command")
        self.assertTrue(all(event["conversationId"] == "thread-1" for event in events))
        self.assertNotIn("secret", str(events))
        approvals = backend.pending_approvals()
        self.assertEqual(approvals[0]["approvalId"], 42)
        self.assertEqual(approvals[0]["conversationId"], "thread-1")
        self.assertNotIn("secret", str(approvals))
        cursor, polled = backend.poll(0)
        self.assertEqual(cursor, 5)
        self.assertEqual(polled, events)
        backend.decide(42, "thread-1", "turn-1", False)
        backend.cancel("thread-1", "turn-1")
        self.assertIn(("approval", 42, "thread-1", "turn-1", "decline"), backend.transport.calls)
        self.assertIn(("interrupt", "thread-1", "turn-1"), backend.transport.calls)

    def test_only_known_activity_and_complete_text(self):
        self.assertIsNone(normalize_event({"sequence": 1, "method": "unknown", "params": {"token": "secret"}}))
        event = normalize_event({"sequence": 1, "method": "item/agentMessage/delta",
                                 "params": {"threadId": "thread-1", "delta": "x" * 9000}})
        self.assertEqual(len(event["text"]), 9000)
        cancelled = normalize_event({"sequence": 2, "method": "turn/completed",
                                     "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "interrupted"}}})
        self.assertEqual(cancelled["activity"], "cancelled")
        with self.assertRaises(ValueError):
            backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
            backend.transport = FakeTransport()
            backend.decide(42, "thread-1", "turn-1", "yes")


if __name__ == "__main__":
    unittest.main()
