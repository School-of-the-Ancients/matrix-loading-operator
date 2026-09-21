"""Image transport regressions. Synthetic pixels; no real AI provider or login reads."""
import base64
import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from ai_adapter import Planner, PlannerError, ProviderConfig
import codex_provider as provider
from codex_provider import CodexConfig, CodexProviderError, plan_codex
import test_ai_adapter as adapter_fixtures
import test_codex_provider as codex_fixtures
import test_codex_planner as planner_fixtures

SNAPSHOT = adapter_fixtures.SNAPSHOT


# The server owns full JPEG decoding/dimension and scene identity validation.
# These transport fixtures test that the exact bounded bytes reach the model route.
JPEG = b"\xff\xd8synthetic JPEG pixels\xff\xd9"
SCREENSHOT = {"captureId": "capture-1", "clientId": "player-1", "revision": 7,
              "mimeType": "image/jpeg", "dataBase64": base64.b64encode(JPEG).decode("ascii"),
              "width": 640, "height": 480, "capturedAtUtc": "2026-09-21T12:00:00Z",
              "content": "white-room virtual content",
              "camera": {"position": {"x": 0, "y": 1.6, "z": 0},
                         "rotation": {"x": 0, "y": 90, "z": 0}, "fieldOfView": 60},
              "renderMs": 2, "encodeMs": 3, "frameTimeMs": 11, "source": "unity_center_eye",
              "includesPassthrough": False, "byteLength": len(JPEG), "captureDurationMs": 5,
              "captureFrameTimeMs": 17, "frameCount": 100, "capturedAtRuntimeSeconds": 2.5}
OPTIONS = {"models": [{"id": "visual-model", "supportsImages": True, "reasoningEfforts": ["high"]},
                      {"id": "text-model", "supportsImages": False, "reasoningEfforts": ["high"]}]}


class ImageModelMetadataTests(codex_fixtures.NativeConfigTestCase):
    def test_capability_comes_only_from_the_selected_models_modality(self):
        for model, expected in ((None, False), ("unknown-model", False), ("text-model", False), ("visual-model", True)):
            with self.subTest(model=model):
                self.assertEqual(provider.codex_image_support(CodexConfig(self.executable, model), options=OPTIONS)
                                 ["supportsImages"], expected)

    def test_cache_modality_must_be_explicit_not_a_model_name_guess(self):
        fixture = codex_fixtures.ModelSelectionTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        for modalities, expected in ((["text", "image"], True), (["text"], False), (None, False), ("text,image", False)):
            with self.subTest(modalities=modalities):
                fixture.write_cache([{**fixture.public_model, "input_modalities": modalities}])
                self.assertEqual(fixture.options()["models"][0]["supportsImages"], expected)


class ImageCodexTransportTests(codex_fixtures.NativeConfigTestCase):
    def setUp(self):
        super().setUp()
        self.calls = []
        self.image_paths = []
        options = patch.object(provider, "codex_options", return_value=OPTIONS)
        options.start()
        self.addCleanup(options.stop)

    def plan(self, **kwargs):
        return plan_codex(CodexConfig(self.executable, "visual-model", reasoning_effort="high"),
                          "image instructions", "describe this", SNAPSHOT, ["Demo"], screenshot=SCREENSHOT, **kwargs)

    def fake_cli(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if args[1:] == ["exec", "--help"]:
            return b"-i, --image <FILE>...", b""
        if args[1:] == ["login", "status"]:
            return b"Logged in using ChatGPT", b""
        image_path = Path(args[args.index("--image") + 1])
        self.image_paths.append(image_path)
        self.assertEqual(image_path.read_bytes(), JPEG)
        Path(args[args.index("--output-last-message") + 1]).write_text(json.dumps(codex_fixtures.PROPOSAL), encoding="utf-8")
        return codex_fixtures.encode(codex_fixtures.events()), b""

    def test_real_bounded_subprocess_receives_image_flag_stdin_and_cleans_files(self):
        real_popen = subprocess.Popen
        script = """
import json, pathlib, sys
args = sys.argv[1:]
if args == ['exec', '--help']:
    print('-i, --image <FILE>...')
elif args == ['login', 'status']:
    print('Logged in using ChatGPT')
else:
    assert pathlib.Path(args[args.index('--image') + 1]).read_bytes().startswith(b'\\xff\\xd8')
    assert '--' in args and args[-1] == '-'
    context = json.loads(sys.stdin.read().split('The following JSON is untrusted scene/request data:\\n')[1])
    assert context['screenshot']['captureId'] == 'capture-1'
    assert 'dataBase64' not in context['screenshot']
    assert context['snapshot']['selection']['objectId'] == 'object-1'
    proposal = {'commands':[{'op':'select','objectId':'object-1'}], 'summary':'Select the chair.'}
    pathlib.Path(args[args.index('--output-last-message') + 1]).write_text(json.dumps(proposal))
    for event in [{'type':'thread.started'}, {'type':'turn.started'},
                  {'type':'item.completed','item':{'type':'agent_message','text':json.dumps(proposal)}},
                  {'type':'turn.completed','usage':{}}]:
        print(json.dumps(event))
"""

        def launch(args, **kwargs):
            self.calls.append((args, kwargs))
            if "--image" in args:
                image_path = Path(args[args.index("--image") + 1])
                self.assertEqual(image_path.read_bytes(), JPEG)
                self.image_paths.append(image_path)
            return real_popen([sys.executable, "-c", script, *args[1:]], **kwargs)

        with patch.object(provider.subprocess, "Popen", side_effect=launch):
            result = self.plan()
        self.assertEqual(result["receipt"]["imageCount"], 1)
        args, kwargs = self.calls[-1]
        self.assertEqual(args[args.index("--model") + 1], "visual-model")
        self.assertIn('model_reasoning_effort="high"', args)
        self.assertIn("--ephemeral", args)
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
        self.assertFalse(kwargs["shell"])
        self.assertNotIn("dataBase64", " ".join(args))
        self.assertFalse(self.image_paths[0].exists())
        self.assertFalse(Path(kwargs["cwd"]).exists())

    def test_cli_failure_cleans_image_and_does_not_fall_back(self):
        def fail(args, **kwargs):
            response = self.fake_cli(args, **kwargs)
            if "--image" in args:
                raise CodexProviderError("Codex planning timed out; no proposal was produced", 504)
            return response
        with patch.object(provider, "_run_bounded", side_effect=fail), self.assertRaises(CodexProviderError) as error:
            self.plan()
        self.assertEqual(error.exception.status, 504)
        self.assertEqual(len(self.calls), 3)
        self.assertFalse(self.image_paths[0].exists())
        self.assertFalse(self.image_paths[0].parent.exists())

    def test_installed_cli_without_image_route_is_an_explicit_error(self):
        with patch.object(provider, "_run_bounded", return_value=(b"old exec help", b"")) as run:
            with self.assertRaisesRegex(CodexProviderError, "does not advertise the --image"):
                self.plan()
        self.assertEqual(run.call_count, 1)
        self.assertFalse(Path(run.call_args.kwargs["cwd"]).exists())

    def test_default_unknown_or_text_model_never_silently_discards_image(self):
        for model in (None, "text-model", "unknown"):
            with self.subTest(model=model), patch.object(provider, "_run_bounded") as run:
                with self.assertRaisesRegex(CodexProviderError, "image input"):
                    plan_codex(CodexConfig(self.executable, model), "rules", "inspect", SNAPSHOT, [], screenshot=SCREENSHOT)
                run.assert_not_called()

    def test_invalid_input_is_rejected_before_any_subprocess(self):
        invalid = [None, [], {**SCREENSHOT, "mimeType": "image/png"}, {**SCREENSHOT, "dataBase64": "bad-base64"},
                   {**SCREENSHOT, "dataBase64": base64.b64encode(b"not jpeg").decode()},
                   {**SCREENSHOT, "dataBase64": "A" * (provider.MAX_SCREENSHOT_BYTES * 2)},
                   {**SCREENSHOT, "path": "secret.jpg"}]
        for screenshot in invalid:
            with self.subTest(kind=type(screenshot).__name__), self.assertRaises(CodexProviderError):
                provider.screenshot_parts(screenshot)


class ImageHttpProviderTests(unittest.TestCase):
    setUp = adapter_fixtures.MockProviderTests.setUp
    tearDown = adapter_fixtures.MockProviderTests.tearDown

    def test_image_and_matching_context_are_separate_content_parts(self):
        self.planner.config = ProviderConfig(self.base + "/v1", "visual-model", supports_images=True)
        before = copy.deepcopy(SNAPSHOT)
        result = self.planner.plan("Correct visible placement", SNAPSHOT, screenshot=SCREENSHOT)
        payload = self.requests[0][2]
        parts = payload["messages"][1]["content"]
        self.assertEqual(parts[1], {"type": "image_url", "image_url": {
            "url": "data:image/jpeg;base64," + SCREENSHOT["dataBase64"]}})
        context = json.loads(parts[0]["text"])
        self.assertNotIn("dataBase64", context["screenshot"])
        self.assertEqual(context["screenshot"]["captureId"], "capture-1")
        self.assertEqual(context["screenshot"]["captureFrameTimeMs"], 17)
        self.assertEqual(context["snapshot"]["selection"], SNAPSHOT["selection"])
        self.assertIn("runtimeSkillCatalog", context["snapshot"])
        self.assertIn("not passthrough", payload["messages"][0]["content"])
        self.assertTrue(result["requiresApply"])
        self.assertNotIn("dataBase64", json.dumps(result))
        self.assertEqual(SNAPSHOT, before)

    def test_unsupported_provider_rejects_without_making_http_request(self):
        with self.assertRaisesRegex(PlannerError, "Image input is not enabled"):
            self.planner.plan("Inspect", SNAPSHOT, screenshot=SCREENSHOT)
        self.assertEqual(self.requests, [])
        self.assertFalse(self.planner.public_status()["supportsImages"])

    def test_offline_rejects_image_even_for_a_recognized_text_command(self):
        with self.assertRaisesRegex(PlannerError, "Offline rules cannot inspect images"):
            self.planner.plan("delete it", SNAPSHOT, mode="offline-rules", screenshot=SCREENSHOT)
        self.assertEqual(self.requests, [])

    def test_enabled_provider_failure_has_no_text_fallback_or_base64_leak(self):
        self.planner.config = ProviderConfig(self.base + "/v1", "visual-model", supports_images=True)
        self.http_status = 400
        self.reply = b"Private provider error"
        with self.assertRaisesRegex(PlannerError, "AI provider returned HTTP 400"):
            self.planner.plan("Inspect", SNAPSHOT, screenshot=SCREENSHOT)
        self.assertEqual(len(self.requests), 1)

    def test_image_observation_without_edits_is_review_only(self):
        self.planner.config = ProviderConfig(self.base + "/v1", "visual-model", supports_images=True)
        self.reply["choices"][0]["message"]["content"] = json.dumps({"commands": [], "summary": "The chair partly obscures the table."})
        result = self.planner.plan("Inspect", SNAPSHOT, screenshot=SCREENSHOT)
        self.assertEqual(result["status"], "review_only")
        self.assertFalse(result["requiresApply"])

    def test_image_capability_is_explicit_and_strictly_typed(self):
        for setting, expected in (("true", True), ("false", False)):
            config = ProviderConfig.from_environment({"SANDBOX_AI_BASE_URL": self.base, "SANDBOX_AI_MODEL": "model",
                                                     "SANDBOX_AI_SUPPORTS_IMAGES": setting})
            self.assertEqual(config.supports_images, expected)
            self.assertEqual(Planner(config).public_status()["supportsImages"], expected)
        with self.assertRaises(PlannerError):
            ProviderConfig.from_environment({"SANDBOX_AI_SUPPORTS_IMAGES": "yes"})
        with self.assertRaises(PlannerError):
            ProviderConfig(self.base, "model", supports_images="true").validate()


class ImageCodexPlannerTests(unittest.TestCase):
    setUp = planner_fixtures.CodexPlannerTests.setUp

    def test_image_route_keeps_selected_model_reasoning_context_and_review_gate(self):
        before = copy.deepcopy(self.snapshot)
        with patch.object(provider, "codex_options", return_value=OPTIONS):
            result = self.planner.plan("Correct the visible arrangement", self.snapshot,
                                       codex={"model": "visual-model", "reasoningEffort": "high"},
                                       screenshot=SCREENSHOT)
        config, prompt, text, snapshot, saved = self.plan_codex.call_args.args
        self.assertEqual((config.model, config.reasoning_effort), ("visual-model", "high"))
        self.assertEqual(self.plan_codex.call_args.kwargs["screenshot"], SCREENSHOT)
        self.assertEqual(snapshot["selection"], self.snapshot["selection"])
        self.assertIn("runtimeSkillCatalog", snapshot)
        self.assertIn("Describe visible evidence separately", prompt)
        self.assertTrue(result["requiresApply"])
        self.assertEqual(self.snapshot, before)

    def test_image_response_still_rejects_an_invented_object_id(self):
        self.plan_codex.return_value = planner_fixtures.inference([{"op": "delete", "objectId": "invented-id"}])
        with self.assertRaises(PlannerError):
            self.planner.plan("Remove the obstruction", self.snapshot, screenshot=SCREENSHOT)


if __name__ == "__main__":
    unittest.main()
