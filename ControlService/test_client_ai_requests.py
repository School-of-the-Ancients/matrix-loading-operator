"""Real local HTTP lifecycle and existing validation; Codex inference is mocked."""
import copy
import os
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch

from codex_provider import CodexProviderError
import test_client_api as fixture
from test_room_context import SNAPSHOT as AR_SNAPSHOT, spawn
from server import LEASE_SECONDS, plan


class ClientAiRequestsTests(unittest.TestCase):
    # Reuse the authenticated HTTP fixture without re-running its inherited tests.
    request = fixture.ClientApiTests.request
    exchange = fixture.ClientApiTests.exchange
    pairing_code = fixture.ClientApiTests.pairing_code
    pair = fixture.ClientApiTests.pair
    scene = fixture.ClientApiTests.scene
    apply = fixture.ClientApiTests.apply
    outcome = fixture.ClientApiTests.outcome

    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        fixture.ClientApiTests.setUp(self)
        self.executable = Path(self.temp.name) / "fixture-codex.exe"
        self.executable.write_bytes(b"MZ-fixture-only-never-executed")
        os.environ.update(SANDBOX_AI_MODE="codex-cli", SANDBOX_CODEX_EXE=str(self.executable),
                          SANDBOX_CODEX_MODEL="owner-default", SANDBOX_CODEX_REASONING="low")
        self.finished = threading.Event()

    def tearDown(self):
        self.finished.set()
        self.assertTrue(self.state.clients.ai_worker.acquire(timeout=5), "Provider fixture must finish before teardown")
        self.state.clients.ai_worker.release()
        fixture.ClientApiTests.tearDown(self)
        self.environment.stop()

    def body(self, request_id="request-1", session=None, text="Arrange the room for a demonstration."):
        value = fixture.ClientApiTests.body(self, request_id, session, text)
        value["intent"]["mode"] = "codex-cli"
        return value

    def submit(self, body=None, session=None):
        return self.request("/api/v1/requests", body or self.body(), (session or self.session)["clientToken"])

    def settled(self, request_id="request-1"):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            result = self.outcome(request_id)
            if result["status"] != "planning":
                return result
            time.sleep(.005)
        self.fail("AI request did not settle")

    @staticmethod
    def response(commands=None):
        return {"proposal": {"commands": commands if commands is not None else [{"op": "list_assets"}],
                             "summary": "Review the proposed scene.", "assumptions": []},
                "receipt": {"provider": "codex-cli", "requestedModel": "owner-default"}}

    def test_discovery_advertises_only_valid_owner_config_without_details_or_provider_call(self):
        with patch("ai_adapter.plan_codex") as provider:
            descriptor = self.request("/api/v1/discovery")[1]["capabilities"]["scene.propose_text"]
            self.assertEqual(descriptor, {"modes": ["offline-rules", "codex-cli"], "requiresOperatorApply": True})
            provider.assert_not_called()
            for environment in ({"SANDBOX_AI_MODE": ""}, {"SANDBOX_AI_MODE": "openai-compatible"},
                                {"SANDBOX_CODEX_EXE": str(self.executable) + ".missing"},
                                {"SANDBOX_CODEX_REASONING": "invalid"}):
                with self.subTest(environment=environment), patch.dict(os.environ, environment):
                    self.assertEqual(self.request("/api/v1/discovery")[1]["capabilities"]["scene.propose_text"]["modes"], ["offline-rules"])
                    code, error = self.submit()
                    self.assertEqual((code, error["code"]), (503, "planner_unavailable"))
            self.assertFalse(self.state.clients.sessions[self.session["sessionId"]]["requests"])
            self.state.codex_preferences = {"model": "not-in-owner-cache"}
            with patch("codex_provider.codex_options", return_value={"models": []}):
                self.assertEqual(self.request("/api/v1/discovery")[1]["capabilities"]["scene.propose_text"]["modes"], ["offline-rules"])
            provider.assert_not_called()

    def test_clients_cannot_override_owner_provider_or_attach_images(self):
        with patch("ai_adapter.plan_codex") as provider:
            for key in ("codex", "model", "reasoningEffort", "executable", "apiKey", "captureId", "screenshot", "commands"):
                for location in ("intent", "envelope"):
                    with self.subTest(key=key, location=location):
                        body = self.body()
                        (body["intent"] if location == "intent" else body)[key] = "untrusted"
                        self.assertEqual(self.submit(body)[0], 400)
            for mode in ("openai-compatible", "auto", None, {}, []):
                body = self.body()
                body["intent"]["mode"] = mode
                self.assertEqual(self.submit(body)[0], 400)
            body = self.body(text="  \n  ")
            self.assertEqual(self.submit(body)[0], 400)
            provider.assert_not_called()
        self.assertFalse(self.state.pending)

    def test_owner_configuration_and_preferences_reach_existing_planner_without_images(self):
        self.state.codex_preferences = {"model": "owner-selected", "reasoningEffort": "high"}
        catalog = {"models": [{"id": "owner-selected", "reasoningEfforts": ["high"]}]}
        with patch("codex_provider.codex_options", return_value=catalog), patch("ai_adapter.plan_codex", return_value=self.response()) as provider:
            code, initial = self.submit()
            self.assertEqual((code, initial["status"], initial["requiresApply"]), (200, "planning", False))
            ready = self.settled()
            self.assertEqual((ready["status"], ready["proposal"]["mode"]), ("ready", "codex-cli"))
            config = provider.call_args.args[0]
            self.assertEqual((config.executable, config.model, config.reasoning_effort),
                             (str(self.executable), "owner-selected", "high"))
            self.assertEqual(provider.call_args.kwargs, {}, "Client cannot request a screenshot")
            self.assertFalse(self.state.pending)
            self.assertEqual(self.apply()[1]["status"], "queued")
            self.assertEqual(len(self.state.pending), 1)

    def test_async_duplicate_busy_and_cancel_discard_late_result_without_blocking_exchange(self):
        entered = threading.Event()
        body = self.body()

        def provider(*args, **kwargs):
            entered.set()
            self.finished.wait(3)
            return self.response()

        with patch("ai_adapter.plan_codex", side_effect=provider) as inference:
            self.assertEqual(self.submit(body)[1]["status"], "planning")
            self.assertTrue(entered.wait(1))
            self.assertEqual(self.exchange()["commands"], [])
            self.assertEqual(self.submit(body)[1]["status"], "planning")
            changed = copy.deepcopy(body)
            changed["intent"]["text"] = "Different work under the same ID"
            self.assertEqual(self.submit(changed)[1]["code"], "idempotency_conflict")
            other = self.pair()
            code, error = self.submit(self.body("concurrent", other), other)
            self.assertEqual((code, error["code"]), (409, "planner_busy"))
            self.assertEqual(self.request("/api/v1/requests/request-1/cancel", {}, self.session["clientToken"])[1]["status"], "cancelled")
            self.assertEqual(self.submit(body)[1]["status"], "cancelled")
            self.assertEqual(self.submit(self.body("new"))[0], 409, "Cancellation does not launch another provider before bounded work ends")
            self.finished.set()
            self.assertTrue(self.state.clients.ai_worker.acquire(timeout=3))
            self.state.clients.ai_worker.release()
            self.assertEqual(self.outcome()["status"], "cancelled")
            self.assertFalse(self.state.proposals)
            self.assertFalse(self.state.pending)
            self.assertEqual(inference.call_count, 1)
            self.assertEqual(self.submit(self.body("new"))[1]["status"], "planning")
            self.assertEqual(self.settled("new")["status"], "ready")

    def test_offline_request_remains_available_while_ai_worker_is_occupied(self):
        entered = threading.Event()

        def provider(*args, **kwargs):
            entered.set()
            self.finished.wait(3)
            return self.response()

        with patch("ai_adapter.plan_codex", side_effect=provider) as inference:
            self.submit()
            self.assertTrue(entered.wait(1))
            offline = fixture.ClientApiTests.body(self, "offline")
            result = self.submit(offline)[1]
            self.assertEqual((result["status"], result["proposal"]["mode"]), ("ready", "offline-rules"))
            self.assertFalse(self.state.pending)
            self.finished.set()
            self.assertEqual(self.settled()["status"], "ready")
            self.assertEqual(inference.call_count, 1)

    def test_same_request_after_configuration_removed_does_not_replan(self):
        body = self.body()
        with patch("ai_adapter.plan_codex", return_value=self.response()) as provider:
            self.submit(body)
            ready = self.settled()
            with patch.dict(os.environ, {"SANDBOX_AI_MODE": ""}):
                self.assertEqual(self.submit(body)[1], ready)
                self.assertEqual(self.submit(self.body("new"))[0], 503)
            self.assertEqual(provider.call_count, 1)

    def test_provider_error_is_retained_and_no_offline_fallback_or_replay(self):
        body = self.body()
        for error in (CodexProviderError("Codex request exceeded its timeout", 504), RuntimeError("private-raw-output")):
            body["requestId"] += "x"
            with self.subTest(error=type(error).__name__), patch("ai_adapter.plan_codex", side_effect=error) as provider:
                self.submit(body)
                outcome = self.settled(body["requestId"])
                self.assertEqual(outcome["status"], "error")
                self.assertNotIn("private-raw-output", outcome["error"])
                self.assertEqual(self.submit(body)[1], outcome)
                self.assertEqual(provider.call_count, 1)
                self.assertFalse(self.state.proposals)
                self.assertFalse(self.state.pending)

    def test_changed_scene_while_provider_plans_never_publishes_proposal(self):
        entered = threading.Event()

        def provider(*args, **kwargs):
            entered.set()
            self.finished.wait(3)
            return self.response()

        with patch("ai_adapter.plan_codex", side_effect=provider):
            self.submit()
            self.assertTrue(entered.wait(1))
            changed = copy.deepcopy(fixture.SNAPSHOT)
            changed["selection"]["position"]["x"] += 1
            self.exchange(changed)
            self.finished.set()
            self.assertEqual(self.settled()["status"], "stale")
            self.assertFalse(self.state.proposals)
            self.assertEqual(self.apply()[0], 409)

    def test_lease_replaced_during_inference_discards_old_runtime_result(self):
        entered = threading.Event()

        def provider(*args, **kwargs):
            entered.set()
            self.finished.wait(3)
            return self.response()

        with patch("ai_adapter.plan_codex", side_effect=provider):
            self.submit()
            self.assertTrue(entered.wait(1))
            self.now[0] += LEASE_SECONDS + 1
            self.exchange(client_id="fixture-runtime")
            self.finished.set()
            self.assertEqual(self.settled()["status"], "stale")
            self.assertTrue(self.state.clients.ai_worker.acquire(timeout=3))
            self.state.clients.ai_worker.release()
            self.assertFalse(self.state.proposals)
            self.assertFalse(self.state.pending)

    def test_revocation_while_planning_cannot_publish_late_proposal(self):
        entered = threading.Event()

        def provider(*args, **kwargs):
            entered.set()
            self.finished.wait(3)
            return self.response()

        with patch("ai_adapter.plan_codex", side_effect=provider):
            self.submit()
            self.assertTrue(entered.wait(1))
            self.request(f"/api/v1/operator/sessions/{self.session['sessionId']}/revoke", {}, fixture.OWNER)
            self.finished.set()
            self.assertTrue(self.state.clients.ai_worker.acquire(timeout=3))
            self.state.clients.ai_worker.release()
            request = self.state.clients.sessions[self.session["sessionId"]]["requests"]["request-1"]
            self.assertEqual(request["status"], "cancelled")
            self.assertFalse(self.state.proposals)
            self.assertFalse(self.state.pending)

    def test_ar_multi_command_review_apply_and_observed_receipts(self):
        self.exchange(AR_SNAPSHOT)
        second = spawn()
        second["transform"]["position"]["x"] = -.2
        commands = [spawn(), second]
        with patch("ai_adapter.plan_codex", return_value=self.response(commands)) as provider:
            self.submit()
            ready = self.settled()
            self.assertEqual(ready["status"], "ready")
            self.assertEqual(ready["proposal"]["commands"], commands)
            self.assertEqual(provider.call_args.args[3]["roomContext"]["mode"], "ar")
            self.assertFalse(self.state.pending)
            queued = self.apply()[1]
            self.assertEqual(len(queued["commandIds"]), 2)
            self.assertEqual(self.apply()[1], queued)
            observed = copy.deepcopy(AR_SNAPSHOT)
            receipts = []
            for index, (request_id, command) in enumerate(zip(queued["commandIds"], commands)):
                object_id = "new-orb-" + str(index)
                observed["scene"]["objects"].append({"objectId": object_id, **{key: command[key] for key in ("assetId", "anchorId", "transform")}})
                receipts.append({"requestId": request_id, "ok": True, "objectId": object_id, "error": ""})
            self.exchange(observed, receipts)
            final = self.outcome()
            self.assertEqual(final["status"], "succeeded")
            self.assertEqual(final["receipts"], receipts)
            self.assertEqual(final["observed"]["snapshot"]["scene"], observed["scene"])

    def test_ai_output_still_uses_existing_command_validation(self):
        cases = [[{"op": "execute_script", "code": "untrusted"}],
                 [{"op": "spawn", "assetId": "not-installed", "anchorId": "floor", "transform": spawn()["transform"]}]]
        for index, commands in enumerate(cases):
            with self.subTest(commands=commands), patch("ai_adapter.plan_codex", return_value=self.response(commands)):
                self.submit(self.body("invalid-" + str(index)))
                self.assertEqual(self.settled("invalid-" + str(index))["status"], "error")
                self.assertFalse(self.state.proposals)
                self.assertFalse(self.state.pending)

    def test_clarification_never_creates_applyable_proposal(self):
        with patch("ai_adapter.plan_codex", return_value=self.response([])):
            self.submit()
            result = self.settled()
            self.assertEqual((result["status"], result["requiresApply"]), ("needs_clarification", False))
            self.assertNotIn("planId", result["proposal"])
            self.assertEqual(self.apply()[0], 409)
            self.assertFalse(self.state.pending)

    def test_context_change_between_planner_return_and_publish_discards_plan(self):
        def late_change(*args, **kwargs):
            result = plan(*args, **kwargs)
            with self.state.lock:
                self.state.revision += 1
            return result

        self.state.clients.planner = late_change
        with patch("ai_adapter.plan_codex", return_value=self.response()):
            self.submit()
            self.assertEqual(self.settled()["status"], "stale")
            self.assertFalse(self.state.proposals)

    def test_worker_start_failure_is_recorded_and_slot_released(self):
        body = self.body()
        session = self.state.clients.sessions[self.session["sessionId"]]
        with patch("client_api.threading.Thread.start", side_effect=RuntimeError("private-thread-error")):
            result = self.state.clients.propose(session, body)
        self.assertEqual(result["status"], "error")
        self.assertNotIn("private-thread-error", result["error"])
        self.assertTrue(self.state.clients.ai_worker.acquire(blocking=False))
        self.state.clients.ai_worker.release()
        self.assertFalse(self.state.proposals)


if __name__ == "__main__":
    unittest.main()
