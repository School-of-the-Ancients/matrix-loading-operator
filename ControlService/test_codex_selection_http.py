"""Selector HTTP regressions; inference transport is stubbed with a subprocess tripwire."""
import copy
import unittest
from unittest.mock import patch

import test_codex_planner as fixtures


class CodexSelectionHttpTests(unittest.TestCase):
    # Reuse the real loopback server/lease fixture, not its test methods.
    tearDown = fixtures.CodexPlannerHttpTests.tearDown
    request = fixtures.CodexPlannerHttpTests.request
    exchange = fixtures.CodexPlannerHttpTests.exchange

    def setUp(self):
        fixtures.CodexPlannerHttpTests.setUp(self)
        self.options = {"source": "local-codex-cache", "fetchedAt": None, "models": [
            {"id": "model-a", "displayName": "Model A", "reasoningEfforts": ["low", "high"],
             "defaultReasoningEffort": "low"},
            {"id": "model-b", "displayName": "Model B", "reasoningEfforts": ["low"],
             "defaultReasoningEffort": "low"}]}
        for target in ("codex_provider.codex_options", "server.codex_options"):
            patcher = patch(target, return_value=self.options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_preferences_are_visible_used_by_planner_and_not_applied(self):
        choice = {"model": "model-a", "reasoningEffort": "high"}
        code, result = self.request("/api/planner_preferences", {"codex": choice})
        self.assertEqual((code, result), (200, {"codex": choice}))
        self.plan_codex.assert_not_called()
        code, status = self.request("/api/planner")
        self.assertEqual(code, 200)
        self.assertEqual(status["codexPreferences"], choice)
        self.assertEqual(status["codexOptions"], self.options)
        code, result = self.request("/api/plan", {"text": "Duplicate this chair", "mode": "codex-cli"})
        self.assertEqual(code, 200, result)
        config = self.plan_codex.call_args.args[0]
        self.assertEqual((config.model, config.reasoning_effort), ("model-a", "high"))
        self.assertEqual(result["commands"], [{"op": "duplicate", "objectId": "chair-1"}])
        self.assertTrue(result["requiresApply"])
        self.assertFalse(self.state.pending)
        self.assertEqual(self.snapshot, fixtures.SNAPSHOT)

    def test_explicit_text_override_does_not_replace_session_preference(self):
        choice = {"model": "model-a", "reasoningEffort": "high"}
        self.assertEqual(self.request("/api/planner_preferences", {"codex": choice})[0], 200)
        code, result = self.request("/api/plan", {"text": "Duplicate this chair", "mode": "codex-cli",
                                                "codex": {"model": "model-b", "reasoningEffort": "low"}})
        self.assertEqual(code, 200, result)
        config = self.plan_codex.call_args.args[0]
        self.assertEqual((config.model, config.reasoning_effort), ("model-b", "low"))
        self.assertEqual(self.state.codex_preferences, choice)
        self.assertFalse(self.state.pending)
        code, result = self.request("/api/plan", {"text": "Duplicate this chair", "mode": "codex-cli",
                                                "codex": {"model": None, "reasoningEffort": None}})
        self.assertEqual(code, 200, result)
        self.assertEqual(self.plan_codex.call_args.args[0], self.config)
        self.assertEqual(self.state.codex_preferences, choice)

    def test_unsupported_pair_rejected_without_inference_or_preference_mutation(self):
        choice = {"model": "model-a", "reasoningEffort": "high"}
        self.assertEqual(self.request("/api/planner_preferences", {"codex": choice})[0], 200)
        for invalid in ({"model": "unknown"}, {"model": "model-b", "reasoningEffort": "high"}):
            with self.subTest(invalid=invalid):
                code, _ = self.request("/api/planner_preferences", {"codex": invalid})
                self.assertEqual(code, 422)
                self.assertEqual(self.state.codex_preferences, choice)
                code, _ = self.request("/api/plan", {"text": "Duplicate this chair", "mode": "codex-cli", "codex": invalid})
                self.assertEqual(code, 422)
                self.plan_codex.assert_not_called()
                self.assertFalse(self.state.pending)
                self.assertFalse(self.state.proposals)

    def test_reset_restores_service_default_without_touching_scene(self):
        self.assertEqual(self.request("/api/planner_preferences", {"codex": {"model": "model-a", "reasoningEffort": "high"}})[0], 200)
        scene = copy.deepcopy(self.state.latest)
        self.assertEqual(self.request("/api/planner_preferences", {"codex": {"model": None, "reasoningEffort": None}})[0], 200)
        code, result = self.request("/api/plan", {"text": "Duplicate this chair", "mode": "codex-cli"})
        self.assertEqual(code, 200, result)
        self.assertEqual(self.plan_codex.call_args.args[0], self.config)
        self.assertEqual(self.state.latest, scene)
        self.assertFalse(self.state.pending)


if __name__ == "__main__":
    unittest.main()
