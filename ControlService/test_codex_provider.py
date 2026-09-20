"""Codex transport tests use mocked CLI output and harmless Python subprocesses.

No test invokes Codex, reads auth stores, or makes provider requests.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import codex_provider as provider
from codex_provider import CodexConfig, CodexProviderError, plan_codex

PROPOSAL = {"commands": [{"op": "select", "objectId": "object-1"}], "summary": "Select the chair."}


def events(proposal=None):
    return [{"type": "thread.started", "thread_id": "test-thread"},
            {"type": "turn.started"},
            {"type": "item.completed", "item": {"type": "agent_message", "text": json.dumps(proposal or PROPOSAL)}},
            {"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 20, "output_tokens": 35}}]


def encode(values):
    return ("\n".join(json.dumps(item) for item in values) + "\n").encode()


class NativeConfigTestCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        fixture = Path(folder.name) / "mock-codex.exe"
        fixture.write_bytes(b"MZ mock executable; tests never run this file")
        self.executable = str(fixture)


class ConfigurationTests(NativeConfigTestCase):
    def test_explicit_mode_is_required_and_model_not_invented(self):
        with patch.object(provider.shutil, "which", return_value=self.executable):
            self.assertIsNone(CodexConfig.from_environment({}))
            config = CodexConfig.from_environment({"SANDBOX_AI_MODE": "codex-cli"})
        self.assertEqual(config.executable, self.executable)
        self.assertIsNone(config.model)
        config.validate()

    def test_missing_executable_in_explicit_mode_fails(self):
        with patch.object(provider.shutil, "which", return_value=None):
            with self.assertRaises(CodexProviderError) as raised:
                CodexConfig.from_environment({"SANDBOX_AI_MODE": "codex-cli"})
        self.assertEqual(raised.exception.status, 503)

    def test_only_documented_model_override_is_used(self):
        config = CodexConfig.from_environment({"SANDBOX_AI_MODE": "codex-cli", "SANDBOX_CODEX_EXE": sys.executable,
                                               "SANDBOX_CODEX_MODEL": " exact-model ", "OPENAI_MODEL": "wrong-model"})
        self.assertEqual(config.model, "exact-model")

    def test_rejects_shell_wrappers_relative_paths_nonexecutables_and_bad_models(self):
        with tempfile.TemporaryDirectory() as folder:
            disguised = Path(folder) / "fake.exe"
            disguised.write_text("echo unsafe")
            for path, model in (("codex.exe", None), ("codex.cmd", None), (str(disguised), None),
                                (self.executable, "bad\nmodel"), (self.executable, "x" * 161),
                                (self.executable, ""), (self.executable, 42)):
                with self.subTest(path=Path(path).name, model_type=type(model).__name__):
                    with self.assertRaises(CodexProviderError):
                        CodexConfig(path, model).validate()


class EventTests(unittest.TestCase):
    def parse(self, values=None, final=None):
        return provider._parse_result(encode(values if values is not None else events()),
                                      json.dumps(PROPOSAL).encode() if final is None else final)

    def test_complete_turn_has_sanitized_receipt_and_no_guessed_model(self):
        values = events()
        values[-1]["usage"]["untrusted_extra"] = "do not expose this"
        result = self.parse(values)
        self.assertEqual(result["proposal"], PROPOSAL)
        self.assertEqual(result["receipt"], {"transport": "codex-cli", "completedTurn": True,
                                           "toolCallCount": 0, "usage": {"input_tokens": 100,
                                           "cached_input_tokens": 20, "output_tokens": 35}})
        self.assertNotIn("test-thread", json.dumps(result))

    def test_observed_model_and_reasoning_are_allowed(self):
        values = events()
        values[1]["model"] = "reported-model"
        values.insert(2, {"type": "item.completed", "item": {"type": "reasoning", "text": "private reasoning"}})
        result = self.parse(values)
        self.assertEqual(result["receipt"]["model"], "reported-model")
        self.assertNotIn("private reasoning", json.dumps(result))

    def test_rejects_every_tool_type_file_change_and_unknown_event(self):
        for item_type in ("command_execution", "file_change", "mcp_tool_call", "web_search", "tool_call",
                          "collab_tool_call", "image_generation", "todo_list", "new_future_tool"):
            for event_type in ("item.started", "item.updated", "item.completed"):
                with self.subTest(item_type=item_type, event_type=event_type):
                    values = events()
                    values.insert(2, {"type": event_type, "item": {"type": item_type}})
                    with self.assertRaises(CodexProviderError):
                        self.parse(values)
        with self.assertRaises(CodexProviderError):
            self.parse(events()[:-1] + [{"type": "unknown.event"}] + events()[-1:])

    def test_failed_error_incomplete_duplicate_and_post_completion_events_rejected(self):
        candidates = (events()[:-1], events()[2:], events()[1:], events() + [events()[-1]],
                      events()[:1] + events(), [events()[2]] + events(),
                      events()[:1] + [events()[1]] + events()[1:],
                      events()[:-1] + [{"type": "turn.failed", "error": {"message": "secret"}}],
                      events()[:-1] + [{"type": "error", "message": "secret"}],
                      events() + [{"type": "thread.started"}])
        for values in candidates:
            with self.subTest(events=len(values)):
                with self.assertRaises(CodexProviderError) as raised:
                    self.parse(values)
                self.assertNotIn("secret", str(raised.exception))

    def test_invalid_json_duplicate_keys_and_nonfinite_numbers_rejected(self):
        for raw in (b"not-json", b'{"commands":[],"commands":[],"summary":"x"}',
                    b'{"commands":[],"summary":NaN}', b"\xff"):
            with self.subTest(raw=raw[:20]):
                with self.assertRaises(CodexProviderError):
                    self.parse(final=raw)
        for raw in (b"not-json", b'{"type":"thread.started","type":"turn.started"}\n'):
            with self.assertRaises(CodexProviderError):
                provider._parse_result(raw, json.dumps(PROPOSAL).encode())

    def test_final_must_match_completed_agent_message(self):
        with self.assertRaises(CodexProviderError):
            self.parse(final=json.dumps({**PROPOSAL, "summary": "Different."}).encode())
        values = events()
        values[2]["type"] = "item.started"
        with self.assertRaises(CodexProviderError):
            self.parse(values)

    def test_limits_and_invalid_response_shapes_rejected(self):
        proposals = ({"commands": [], "summary": ""}, {"commands": [], "summary": "x" * 801},
                     {"commands": [], "summary": "x\ny"}, {"commands": [{}] * 21, "summary": "x"},
                     {"commands": ["not a command"], "summary": "x"},
                     {**PROPOSAL, "extra": "secret"})
        for proposal in proposals:
            with self.assertRaises(CodexProviderError):
                self.parse(events(proposal), json.dumps(proposal).encode())
        with self.assertRaises(CodexProviderError):
            self.parse(final=b"x" * (provider.MAX_FINAL + 1))
        with self.assertRaises(CodexProviderError):
            provider._parse_result(b"x" * (provider.MAX_OUTPUT + 1), b"{}")

    def test_usage_and_model_metadata_are_typed(self):
        for value in (-1, True, "100", None, 10**13):
            values = events()
            values[-1]["usage"]["input_tokens"] = value
            with self.assertRaises(CodexProviderError):
                self.parse(values)
        values = events()
        values[0]["model"] = "one"
        values[-1]["model"] = "two"
        with self.assertRaises(CodexProviderError):
            self.parse(values)


class PlanningTests(NativeConfigTestCase):
    def setUp(self):
        super().setUp()
        self.calls = []
        self.workspace = None

    def fake_cli(self, args, **kwargs):
        self.calls.append((args, kwargs))
        self.workspace = kwargs["cwd"]
        if args[1:] == ["login", "status"]:
            return b"", b"Logged in using ChatGPT\n"
        schema = json.loads(Path(args[args.index("--output-schema") + 1]).read_text())
        self.assertFalse(schema["additionalProperties"])
        final_path = Path(args[args.index("--output-last-message") + 1])
        final_path.write_text(json.dumps(PROPOSAL), encoding="utf-8")
        return encode(events()), b"diagnostics must not leave transport"

    def test_login_probe_ephemeral_constraints_stdin_and_clean_environment(self):
        before = {"CODEX_API_KEY": "synthetic-api-key", "OPENAI_API_KEY": "synthetic-api-key",
                  "CODEX_HOME": "unchanged-auth-location", "OTHER_ENV": "retain"}
        with patch.dict(os.environ, before, clear=True), patch.object(provider, "_run_bounded", side_effect=self.fake_cli):
            result = plan_codex(CodexConfig(self.executable), "system contract", "select chair", {"scene": {}}, ["Demo"])
            self.assertEqual(dict(os.environ), before)
        self.assertEqual(result["proposal"], PROPOSAL)
        self.assertEqual(len(self.calls), 2)
        args, options = self.calls[1]
        for flag in ("--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--json", "--output-schema"):
            self.assertIn(flag, args)
        for feature in provider.DISABLED_FEATURES:
            self.assertIn(["--disable", feature], [args[i:i + 2] for i in range(len(args) - 1)])
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
        self.assertIn('approval_policy="never"', args)
        self.assertIn('web_search="disabled"', args)
        self.assertNotIn("--ignore-rules", args)
        self.assertNotIn("--model", args)
        self.assertNotIn("select chair", " ".join(args))
        self.assertIn(b"select chair", options["data"])
        self.assertNotIn("OPENAI_API_KEY", options["env"])
        self.assertNotIn("CODEX_API_KEY", options["env"])
        self.assertEqual(options["env"]["CODEX_HOME"], before["CODEX_HOME"])
        self.assertFalse(Path(self.workspace).exists())

    def test_explicit_model_is_passed_without_claiming_effective_model(self):
        with patch.object(provider, "_run_bounded", side_effect=self.fake_cli):
            result = plan_codex(CodexConfig(self.executable, "chosen-model"), "rules", "select", {}, [])
        args = self.calls[-1][0]
        self.assertEqual(args[args.index("--model") + 1], "chosen-model")
        self.assertNotIn("model", result["receipt"])

    def test_api_login_or_no_login_never_runs_inference(self):
        for output in (b"Logged in using an API key", b"Not logged in", b"Logged in using ChatGPT plus unexpected secret"):
            with patch.object(provider, "_run_bounded", return_value=(b"", output)) as run:
                with self.assertRaises(CodexProviderError) as raised:
                    plan_codex(CodexConfig(self.executable), "rules", "select", {}, [])
                self.assertEqual(run.call_count, 1)
                self.assertEqual(raised.exception.status, 503)

    def test_missing_final_and_large_context_fail_without_fallback(self):
        with patch.object(provider, "_run_bounded", side_effect=[(b"Logged in using ChatGPT", b""), (encode(events()), b"")]):
            with self.assertRaises(CodexProviderError):
                plan_codex(CodexConfig(self.executable), "rules", "select", {}, [])
        with patch.object(provider, "_run_bounded") as run:
            with self.assertRaises(CodexProviderError):
                plan_codex(CodexConfig(self.executable), "rules", "x" * provider.MAX_INPUT, {}, [])
            run.assert_not_called()

    def test_schema_contains_only_existing_operations(self):
        variants = provider._schema()["properties"]["commands"]["items"]["anyOf"]
        self.assertEqual({entry["properties"]["op"]["enum"][0] for entry in variants},
                         {"spawn", "set_transform", "select", "duplicate", "delete", "clear", "undo", "redo",
                          "get_scene", "list_assets", "list_targets", "save_scene", "load_scene"})
        self.assertTrue(all(entry["additionalProperties"] is False for entry in variants))


class BoundedProcessTests(unittest.TestCase):
    def run_python(self, code, **kwargs):
        with tempfile.TemporaryDirectory() as folder:
            return provider._run_bounded([sys.executable, "-c", code], cwd=folder, env=os.environ.copy(), **kwargs)

    def test_real_pipes_receive_stdin_without_shell(self):
        output, error = self.run_python("import sys; sys.stdout.buffer.write(sys.stdin.buffer.read()); sys.stderr.write('ok')", data=b"request")
        self.assertEqual(output, b"request")
        self.assertEqual(error, b"ok")

    def test_timeout_terminates_process(self):
        with self.assertRaises(CodexProviderError) as raised:
            self.run_python("import time; time.sleep(10)", timeout=0.1)
        self.assertEqual(raised.exception.status, 504)

    def test_stdout_and_stderr_limits_terminate_process(self):
        for stream in ("stdout", "stderr"):
            with self.subTest(stream=stream), patch.object(provider, "MAX_OUTPUT", 8192), patch.object(provider, "MAX_ERROR", 8192):
                with self.assertRaises(CodexProviderError):
                    self.run_python("import sys; sys." + stream + ".buffer.write(b'x' * 1000000)")

    def test_failed_process_never_exposes_diagnostics(self):
        with self.assertRaises(CodexProviderError) as raised:
            self.run_python("import sys; sys.stderr.write('synthetic-secret'); sys.exit(3)")
        self.assertNotIn("synthetic-secret", str(raised.exception))

    def test_spawn_error_is_sanitized(self):
        with patch.object(subprocess, "Popen", side_effect=OSError("synthetic-secret")):
            with self.assertRaises(CodexProviderError) as raised:
                self.run_python("pass")
        self.assertNotIn("synthetic-secret", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
