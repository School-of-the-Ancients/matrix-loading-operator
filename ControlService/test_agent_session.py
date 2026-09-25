"""The browser-safe contract contains no opaque Codex or MCP event payloads."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from agent_session import LocalCodexAgentBackend, normalize_event, _approval_description, _mcp_approval_description
from codex_provider import CodexConfig


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.cwd = Path.cwd()

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

    def thread_start(self, *, model=None, sandbox="workspace-write"):
        self.calls.append(("start", model, sandbox))
        return "thread-1"

    def thread_resume(self, identifier, *, sandbox="workspace-write"):
        self.calls.append(("resume", identifier, sandbox))
        return identifier

    def turn_start(self, identifier, text, *, effort=None):
        self.calls.append(("send", identifier, text, effort))
        return "turn-1"

    def respond_approval(self, *args):
        self.calls.append(("approval", *args))

    def turn_interrupt(self, *args):
        self.calls.append(("interrupt", *args))


class AgentSessionTests(unittest.TestCase):
    def test_windows_fallback_is_a_pc_only_codex_process_setting(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / "codex.exe"
            executable.write_bytes(b"MZ test")
            config = CodexConfig(str(executable), windows_sandbox="unelevated",
                                 agent_sandbox="danger-full-access")
            with patch("agent_session.AppServerTransport") as transport:
                backend = LocalCodexAgentBackend(config, folder)
            command = transport.call_args.args[0]
            self.assertEqual(command[:3], [str(executable), "-c", 'windows.sandbox="unelevated"'])
            self.assertEqual(command[-2:], ["app-server", "--stdio"])
            self.assertEqual(backend.access_mode, "danger-full-access")

    def test_normalizer_drops_tool_arguments_and_credentials(self):
        backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
        backend.config = SimpleNamespace(model="model-test", reasoning_effort="medium", agent_sandbox="workspace-write")
        backend.transport = FakeTransport()
        self.assertEqual(backend.start_conversation(), "thread-1")
        self.assertEqual(backend.resume_conversation("thread-1"), "thread-1")
        self.assertIn(("start", "model-test", "workspace-write"), backend.transport.calls)
        self.assertIn(("resume", "thread-1", "workspace-write"), backend.transport.calls)
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
        self.assertFalse(approvals[0]["reviewable"])
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

    def test_only_one_new_literal_file_inside_repo_has_xr_approval_summary(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / "approval-test.txt"
            command = f"[System.IO.File]::WriteAllText('{target}', 'test')"
            summary, reviewable = _approval_description(
                "item/commandExecution/requestApproval", {"command": command}, root)
            self.assertTrue(reviewable)
            self.assertIn("approval-test.txt", summary)
            self.assertNotIn(str(root), summary)
            self.assertNotIn("'test'", summary)
            bundled = root / "codex-runtimes" / "runtime" / "dependencies" / "native" / "powershell" / "pwsh.exe"
            wrapped = f'"{bundled}" -Command "{command}"'
            self.assertTrue(_approval_description(
                "item/commandExecution/requestApproval", {"command": wrapped}, root)[1])
            untrusted_shell = f'"{root / "pwsh.exe"}" -Command "{command}"'
            self.assertFalse(_approval_description(
                "item/commandExecution/requestApproval", {"command": untrusted_shell}, root)[1])
            for unsafe in (command + "; Remove-Item secret", "echo secret",
                           f"[System.IO.File]::WriteAllText('{root.parent / 'outside.txt'}', 'test')"):
                _, reviewable = _approval_description(
                    "item/commandExecution/requestApproval", {"command": unsafe}, root)
                self.assertFalse(reviewable)
            target.write_text("existing", encoding="utf-8")
            self.assertFalse(_approval_description(
                "item/commandExecution/requestApproval", {"command": command}, root)[1])

    def test_mcp_approval_is_redacted_and_only_known_read_tool_is_reviewable(self):
        params = {"threadId": "thread-1", "turnId": "turn-1", "serverName": "matrix_webxr",
                  "mode": "form", "message": 'Allow the matrix_webxr MCP server to run tool "matrix_scene_summary"?',
                  "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {},
                            "secret": "never-forward"}}
        summary, reviewable = _mcp_approval_description(params)
        self.assertTrue(reviewable)
        self.assertNotIn("secret", summary)
        event = normalize_event({"sequence": 1, "method": "mcpServer/elicitation/request",
                                 "requestId": 777, "params": params})
        self.assertEqual(event["action"], "using_tool")
        self.assertNotIn("secret", str(event))
        self.assertFalse(_mcp_approval_description({**params, "serverName": "blender"})[1])
        self.assertFalse(_mcp_approval_description({**params, "message": "run some other tool"})[1])
        self.assertFalse(_mcp_approval_description({**params, "_meta": {**params["_meta"],
                                                                          "tool_params": {"path": "secret"}}})[1])
        backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
        backend.transport = FakeTransport()
        backend.transport.pending_approvals = lambda: [{"requestId": 777,
            "method": "mcpServer/elicitation/request", "params": params}]
        safe = backend.pending_approvals()[0]
        self.assertEqual(safe["action"], "using_tool")
        self.assertTrue(safe["reviewable"])
        self.assertNotIn("secret", str(safe))


if __name__ == "__main__":
    unittest.main()
