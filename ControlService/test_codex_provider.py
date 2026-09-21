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

    def test_explicit_reasoning_configuration_is_typed(self):
        config = CodexConfig.from_environment({"SANDBOX_AI_MODE": "codex-cli", "SANDBOX_CODEX_EXE": self.executable,
                                               "SANDBOX_CODEX_REASONING": " high "})
        self.assertEqual(config.reasoning_effort, "high")
        config.validate()
        for value in ("unexpected", 123, [], "high\n"):
            with self.subTest(value=value), self.assertRaises(CodexProviderError):
                CodexConfig(self.executable, reasoning_effort=value).validate()

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

    def test_explicit_assumptions_survive_with_completed_inference_receipt(self):
        proposal = {**PROPOSAL, "assumptions": ["The selected floor point is the layout center.",
                                              "Keep all existing objects in place."]}
        result = self.parse(events(proposal), json.dumps(proposal).encode())
        self.assertEqual(result["proposal"], proposal)
        self.assertTrue(result["receipt"]["completedTurn"])

    def test_empty_commands_retain_model_clarification_without_becoming_commands(self):
        proposal = {"commands": [], "summary": "Which of the two floor anchors should hold the arrangement?",
                    "assumptions": []}
        result = self.parse(events(proposal), json.dumps(proposal).encode())
        self.assertEqual(result["proposal"], proposal)
        self.assertTrue(result["receipt"]["completedTurn"])

    def test_assumptions_are_bounded_strings_and_unknown_fields_are_rejected(self):
        for assumptions in (None, "guess", {}, [False], [1], [None], [""], [" "], ["x\ny"], ["x" * 201], ["x"] * 9):
            with self.subTest(assumptions=assumptions):
                proposal = {**PROPOSAL, "assumptions": assumptions}
                with self.assertRaises(CodexProviderError):
                    self.parse(events(proposal), json.dumps(proposal).encode())
        proposal = {**PROPOSAL, "assumptions": ["x" * 200] * 8}
        self.assertEqual(self.parse(events(proposal), json.dumps(proposal).encode())["proposal"], proposal)
        for extra in ("status", "planId", "requiresApply", "geometry", "toolCalls"):
            proposal = {**PROPOSAL, "assumptions": [], extra: "untrusted"}
            with self.assertRaises(CodexProviderError):
                self.parse(events(proposal), json.dumps(proposal).encode())

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
        self.assertEqual(result["receipt"]["requestedModel"], "chosen-model")
        self.assertNotIn("model", result["receipt"])

    def test_reasoning_override_is_an_argument_and_preserves_transport_constraints(self):
        with patch.object(provider, "_run_bounded", side_effect=self.fake_cli):
            result = plan_codex(CodexConfig(self.executable, "chosen-model", reasoning_effort="high"),
                                "rules", "select", {}, [])
        args = self.calls[-1][0]
        self.assertIn(["--config", 'model_reasoning_effort="high"'],
                      [args[i:i + 2] for i in range(len(args) - 1)])
        self.assertEqual(result["receipt"]["requestedReasoningEffort"], "high")
        self.assertNotIn("model", result["receipt"])
        self.assertIn('approval_policy="never"', args)
        self.assertIn('web_search="disabled"', args)

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
        schema = provider._schema()
        self.assertEqual(set(schema["required"]), {"commands", "summary", "assumptions"})
        assumptions = schema["properties"]["assumptions"]
        self.assertEqual(assumptions["maxItems"], 8)
        self.assertEqual(assumptions["items"], {"type": "string", "minLength": 1, "maxLength": 200})
        variants = schema["properties"]["commands"]["items"]["anyOf"]
        self.assertEqual({entry["properties"]["op"]["enum"][0] for entry in variants},
                     {"spawn", "set_transform", "set_behavior", "remove_behavior", "select", "duplicate", "delete", "clear", "undo", "redo",
                          "get_scene", "list_assets", "list_targets", "save_scene", "load_scene"})
        self.assertTrue(all(entry["additionalProperties"] is False for entry in variants))


class ModelSelectionTests(NativeConfigTestCase):
    def setUp(self):
        super().setUp()
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.cache = Path(self.folder.name) / "models_cache.json"
        self.environ = {"CODEX_HOME": self.folder.name}
        self.public_model = {"slug": "model-a", "display_name": "Model A", "visibility": "list",
                             "default_reasoning_level": "medium", "supported_reasoning_levels": [
                                 {"effort": "low", "description": "Fast"},
                                 {"effort": "medium"}, {"effort": "high"}]}

    def write_cache(self, models=None, **metadata):
        self.cache.write_text(json.dumps({"models": models if models is not None else [self.public_model],
                                          **metadata}), encoding="utf-8")

    def options(self):
        return provider.codex_options(self.environ)

    def select(self, selection, config=None):
        return provider.select_codex_config(config or CodexConfig(self.executable), selection, options=self.options())

    def test_only_visible_public_metadata_is_exposed(self):
        model = {**self.public_model, "instructions": "private model instructions", "unexpected": "secret"}
        hidden = {**model, "slug": "hidden-model", "visibility": "hide"}
        self.write_cache([model, hidden], identity="private account hash", etag="private cache etag")
        result = self.options()
        self.assertEqual(result["models"], [{"id": "model-a", "displayName": "Model A",
                                             "reasoningEfforts": ["low", "medium", "high"],
                                             "defaultReasoningEffort": "medium", "supportsImages": False}])
        self.assertNotIn("private", json.dumps(result))
        self.assertNotIn("secret", json.dumps(result))

    def test_metadata_is_not_fabricated_when_cache_missing_corrupt_or_oversized(self):
        self.assertEqual(self.options()["models"], [])
        for raw in (b"not json", b'{"models":[],"models":[]}', b'{"models":true}',
                    b'{"models":[],"fetched_at":"not-a-date"}'):
            self.cache.write_bytes(raw)
            result = self.options()
            self.assertEqual(result["models"], [])
            self.assertIn("unavailable", result["warning"])
        self.cache.write_bytes(b" " * 100)
        with patch.object(provider, "MAX_MODEL_CACHE", 99):
            self.assertEqual(self.options()["models"], [])

    def test_stale_cache_is_honestly_labelled_and_auth_files_are_not_needed(self):
        self.write_cache(fetched_at="2001-01-01T00:00:00Z")
        (Path(self.folder.name) / "auth.json").write_text("this is not read", encoding="utf-8")
        result = self.options()
        self.assertIn("over a day old", result["warning"])
        self.assertEqual(len(result["models"]), 1)
        self.assertNotIn("not read", json.dumps(result))

    def test_unavailable_home_directory_keeps_default_available(self):
        with patch.object(provider.Path, "home", side_effect=RuntimeError("Could not determine home directory.")):
            result = provider.codex_options({})
        self.assertEqual(result["models"], [])
        self.assertIn("unavailable", result["warning"])
        self.assertIs(provider.select_codex_config(None, None), None)

    def test_cache_filters_bad_identifiers_names_levels_and_duplicates(self):
        self.write_cache([self.public_model, self.public_model,
                          {**self.public_model, "slug": "bad model"},
                          {**self.public_model, "slug": "bad-name", "display_name": "bad\nname"},
                          {**self.public_model, "slug": "future", "supported_reasoning_levels": [
                              {"effort": "future-value"}, {"effort": "max"}, {"effort": "max"}],
                           "default_reasoning_level": "future-value"}])
        result = self.options()["models"]
        self.assertEqual([item["id"] for item in result], ["model-a", "future"])
        self.assertEqual(result[1]["reasoningEfforts"], ["max"])
        self.assertIsNone(result[1]["defaultReasoningEffort"])

    def test_default_does_not_require_a_cache_or_change_existing_configuration(self):
        config = CodexConfig(self.executable, "configured-model", reasoning_effort="high")
        for selection in (None, {}, {"model": None, "reasoningEffort": None}):
            self.assertIs(self.select(selection, config), config)

    def test_supported_pair_replaces_only_model_settings(self):
        self.write_cache()
        original = CodexConfig(self.executable, "old-model", reasoning_effort="high")
        selected = self.select({"model": "model-a", "reasoningEffort": "low"}, original)
        self.assertEqual(selected.model, "model-a")
        self.assertEqual(selected.reasoning_effort, "low")
        self.assertEqual(selected.executable, original.executable)
        self.assertEqual(original.model, "old-model")
        self.assertIsNone(self.select({"model": "model-a", "reasoningEffort": None}, original).reasoning_effort)

    def test_reasoning_can_use_known_configured_model_but_cannot_guess_default(self):
        self.write_cache()
        configured = CodexConfig(self.executable, "model-a")
        self.assertEqual(self.select({"reasoningEffort": "high"}, configured).reasoning_effort, "high")
        with self.assertRaises(CodexProviderError) as error:
            self.select({"reasoningEffort": "high"})
        self.assertEqual(error.exception.status, 422)

    def test_unknown_model_and_model_specific_efforts_fail_closed(self):
        self.write_cache()
        for selection in ({"model": "unknown"}, {"model": "model-a", "reasoningEffort": "ultra"},
                          {"model": "model-a", "reasoningEffort": "max"}):
            with self.subTest(selection=selection), self.assertRaises(CodexProviderError) as error:
                self.select(selection)
            self.assertEqual(error.exception.status, 422)

    def test_malformed_selection_is_rejected_without_shell_strings(self):
        self.write_cache()
        for selection in ([], "model-a", False, {"model": ""}, {"model": True}, {"model": []},
                          {"model": "model-a", "effort": "high"}, {"reasoningEffort": 12}):
            with self.subTest(selection=selection), self.assertRaises(CodexProviderError) as error:
                self.select(selection)
            self.assertEqual(error.exception.status, 400)


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
