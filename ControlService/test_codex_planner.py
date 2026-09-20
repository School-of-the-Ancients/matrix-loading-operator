"""Codex planner and HTTP integration with stubbed inference transport only.

These are contract regressions, not live-model or headset evidence. A subprocess
tripwire prevents native Codex execution even if an adapter path changes.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from ai_adapter import Planner, PlannerError, ProviderConfig, SYSTEM_PROMPT
from codex_provider import CodexConfig, CodexProviderError
from server import LEASE_SECONDS, Server, State


POSE = {"position": {"x": .4, "y": 0, "z": .8},
        "rotation": {"x": 0, "y": 10, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}
SNAPSHOT = {
    "scene": {"schemaVersion": 1, "roomId": "white-room-v1", "objects": [
        {"objectId": "chair-1", "assetId": "chair", "anchorId": "white-floor", "transform": POSE}]},
    "assets": [{"assetId": "chair", "displayName": "Chair", "spawnScale": 1},
               {"assetId": "block", "displayName": "Terracotta block", "spawnScale": .2}],
    "anchors": [{"anchorId": "white-floor", "displayName": "White room floor"}],
    "selection": {"objectId": "chair-1", "anchorId": "white-floor", "position": {"x": 1, "y": 0, "z": 2}},
}
RECEIPT = {"transport": "codex-cli", "completedTurn": True,
           "usage": {"input_tokens": 240, "cached_input_tokens": 120, "output_tokens": 45},
           "toolCallCount": 0}


def inference(commands=None):
    return {"proposal": {"commands": copy.deepcopy(commands or [{"op": "duplicate", "objectId": "chair-1"}]),
                         "summary": "Duplicate the selected chair beside it."},
            "receipt": copy.deepcopy(RECEIPT)}


def config_fixture(directory):
    # Configuration validation reads only metadata/MZ. This inert fixture is never
    # executed; the subprocess tripwire would fail the test if transport escaped.
    executable = Path(directory, "codex-config-fixture.exe")
    executable.write_bytes(b"MZ configuration fixture; never execute")
    return CodexConfig(executable=str(executable.resolve()), model="test-model")


class CodexPlannerTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.native = patch.object(subprocess, "Popen", side_effect=AssertionError("Native inference is forbidden in these integration tests"))
        self.native.start()
        self.addCleanup(self.native.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = config_fixture(self.temp.name)
        self.planner = Planner(config=self.config)
        self.snapshot = copy.deepcopy(SNAPSHOT)
        self.transport = patch("ai_adapter.plan_codex", return_value=inference())
        self.plan_codex = self.transport.start()
        self.addCleanup(self.transport.stop)

    def codex_plan(self, text="Please make a second seat beside this one", **kwargs):
        with patch("ai_adapter._offline_plan", side_effect=AssertionError("Codex mode must not fall back to offline rules")):
            return self.planner.plan(text, self.snapshot, mode="codex-cli", **kwargs)

    def test_public_status_advertises_codex_without_running_inference(self):
        status = self.planner.public_status()
        self.assertEqual(status["mode"], "codex-cli")
        self.assertEqual(status["model"], "test-model")
        self.assertTrue(status["configured"])
        self.assertEqual(set(status["availableModes"]), {"codex-cli", "offline-rules"})
        self.assertIn("Codex", status["provider"])
        self.assertNotIn("inference", status)
        self.assertNotIn("receipt", status)
        self.plan_codex.assert_not_called()

    def test_codex_uses_transport_with_live_context_and_preserves_receipt(self):
        result = self.codex_plan(saved_scenes=["Demo"])
        self.plan_codex.assert_called_once_with(
            self.config, SYSTEM_PROMPT, "Please make a second seat beside this one", SNAPSHOT, ["Demo"])
        self.assertEqual(result["commands"], [{"op": "duplicate", "objectId": "chair-1"}])
        self.assertEqual(result["mode"], "codex-cli")
        self.assertEqual(result["inference"], RECEIPT)
        self.assertTrue(result["requiresApply"])
        self.assertEqual(self.snapshot, SNAPSHOT)
        self.assertNotIn("model", result["inference"])  # Requested model is not an observed transport receipt.

    def test_default_mode_uses_configured_codex_not_rules(self):
        with patch("ai_adapter._offline_plan", side_effect=AssertionError("No fallback")):
            result = self.planner.plan("Arrange another seat alongside this one", self.snapshot)
        self.assertEqual(result["mode"], "codex-cli")
        self.plan_codex.assert_called_once()

    def test_explicit_offline_mode_does_not_claim_codex_inference(self):
        result = self.planner.plan("make it twice as big", self.snapshot, mode="offline-rules")
        self.assertEqual(result["mode"], "offline-rules")
        self.assertEqual(result["commands"][0]["objectId"], "chair-1")
        self.assertEqual(result["commands"][0]["transform"]["scale"], {"x": 2, "y": 2, "z": 2})
        self.assertNotIn("inference", result)
        self.plan_codex.assert_not_called()

    def test_transport_failure_becomes_planner_error_without_fallback(self):
        self.plan_codex.side_effect = CodexProviderError("Codex turn did not complete", status=502)
        with self.assertRaises(PlannerError) as error:
            self.codex_plan("duplicate it")
        self.assertEqual(error.exception.status, 502)
        self.assertEqual(str(error.exception), "Codex turn did not complete")
        self.plan_codex.assert_called_once()

    def test_codex_request_without_configuration_never_uses_offline_rules(self):
        with patch("ai_adapter._offline_plan", side_effect=AssertionError("No fallback")), self.assertRaises(PlannerError) as error:
            Planner().plan("duplicate it", self.snapshot, mode="codex-cli")
        self.assertEqual(error.exception.status, 503)
        self.plan_codex.assert_not_called()

    def test_explicit_modes_reject_the_other_provider_type(self):
        remote = ProviderConfig("http://127.0.0.1:9999/v1", "test-http-model")
        with patch("ai_adapter._offline_plan", side_effect=AssertionError("No fallback")), \
                patch.object(Planner, "_remote_plan", side_effect=AssertionError("Wrong transport must not run")):
            for planner, mode in ((self.planner, "openai-compatible"), (Planner(config=remote), "codex-cli")):
                with self.subTest(mode=mode), self.assertRaises(PlannerError):
                    planner.plan("duplicate it", self.snapshot, mode=mode)
        self.plan_codex.assert_not_called()

    def test_codex_output_still_obeys_registry_bounds_and_command_shape(self):
        oversize = copy.deepcopy(POSE)
        oversize["scale"]["x"] = 21
        invalid = [
            [{"op": "duplicate", "objectId": "invented-id"}],
            [{"op": "set_transform", "objectId": "chair-1", "transform": oversize}],
            [{"op": "spawn", "assetId": "downloaded-chair", "anchorId": "white-floor", "transform": POSE}],
            [{"op": "download_catalog", "url": "https://example.invalid/catalog"}],
            [{"op": "undo"}, {"op": "get_scene"}],
            [{"op": "load_scene", "name": "Missing"}],
        ]
        for commands in invalid:
            with self.subTest(commands=commands):
                self.plan_codex.return_value = inference(commands)
                with self.assertRaises(PlannerError):
                    self.codex_plan(saved_scenes=["Demo"])
                self.assertEqual(self.snapshot, SNAPSHOT)

    def test_codex_persistence_intent_is_validated_without_execution(self):
        self.plan_codex.return_value = inference([{"op": "load_scene", "name": "Demo"}])
        result = self.codex_plan("Bring back my saved arrangement", saved_scenes=["Demo"])
        self.assertEqual(result["commands"], [{"op": "load_scene", "name": "Demo"}])
        self.assertTrue(result["requiresApply"])
        self.assertEqual(result["inference"], RECEIPT)


class CodexPlannerHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = [100.0]
        self.config = config_fixture(self.temp.name)
        self.environment = patch.dict(os.environ, {"SANDBOX_AI_MODE": "codex-cli"}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.config_patch = patch.object(CodexConfig, "from_environment", return_value=self.config)
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)
        self.native = patch.object(subprocess, "Popen", side_effect=AssertionError("Native inference is forbidden in HTTP integration tests"))
        self.native.start()
        self.addCleanup(self.native.stop)
        self.offline = patch("ai_adapter._offline_plan", side_effect=AssertionError("HTTP Codex mode must not use offline rules"))
        self.offline.start()
        self.addCleanup(self.offline.stop)
        self.transport = patch("ai_adapter.plan_codex", return_value=inference())
        self.plan_codex = self.transport.start()
        self.addCleanup(self.transport.stop)
        self.state = State(self.temp.name, clock=lambda: self.now[0])
        self.server = Server(("127.0.0.1", 0), self.state)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.snapshot = copy.deepcopy(SNAPSHOT)
        self.assertEqual(self.exchange(), (200, {"commands": []}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def request(self, path, body=None):
        raw = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(self.base + path, data=raw, headers={"Content-Type": "application/json"})
        try:
            response = self.http.open(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def exchange(self, snapshot=None, results=None, client="runtime-a"):
        return self.request("/api/exchange", {"clientId": client, "snapshot": snapshot or self.snapshot, "results": results or []})

    def propose(self):
        code, proposal = self.request("/api/plan", {"text": "Give me another seat beside this one", "mode": "codex-cli"})
        self.assertEqual(code, 200, proposal)
        self.assertEqual(proposal["mode"], "codex-cli")
        self.assertEqual(proposal["inference"], RECEIPT)
        self.assertTrue(proposal["requiresApply"])
        return proposal

    def test_http_codex_proposal_waits_for_apply_then_uses_executor_ack_path(self):
        code, status = self.request("/api/planner")
        self.assertEqual(code, 200)
        self.assertEqual(status["mode"], "codex-cli")
        self.plan_codex.assert_not_called()
        self.state.save("Existing")
        proposal = self.propose()
        self.assertEqual(self.state.pending, {})
        self.assertEqual(self.exchange(), (200, {"commands": []}))
        self.assertEqual(self.plan_codex.call_args.args[3], SNAPSHOT)
        self.assertEqual(self.plan_codex.call_args.args[4], ["Existing"])
        code, queued = self.request("/api/apply_plan", {"planId": proposal["planId"]})
        self.assertEqual(code, 200)
        command = queued["commands"][0]
        self.assertEqual({key: value for key, value in command.items() if key != "requestId"},
                         {"op": "duplicate", "objectId": "chair-1"})
        self.assertTrue(command["requestId"])
        self.assertEqual(self.exchange(), (200, queued))
        duplicate = copy.deepcopy(self.snapshot["scene"]["objects"][0])
        duplicate["objectId"] = "runtime-assigned-copy"
        duplicate["transform"]["position"]["x"] += .3
        self.snapshot["scene"]["objects"].append(duplicate)
        self.snapshot["selection"]["objectId"] = duplicate["objectId"]
        result = {"requestId": command["requestId"], "ok": True, "error": "", "objectId": duplicate["objectId"]}
        self.assertEqual(self.exchange(results=[result]), (200, {"commands": []}))
        final = self.request("/api/state")[1]
        self.assertEqual(final["pendingCount"], 0)
        self.assertEqual(final["results"][-1], result)
        self.assertEqual(final["snapshot"]["selection"]["objectId"], duplicate["objectId"])
        self.assertEqual(self.request("/api/save", {"name": "AfterApply"})[0], 200)
        self.assertEqual(json.loads(Path(self.temp.name, "AfterApply.json").read_text())["scene"], self.snapshot["scene"])
        self.plan_codex.assert_called_once()  # Apply and acknowledgement cannot invoke another model turn.

    def test_http_stale_selection_is_rejected_without_queueing_codex_plan(self):
        proposal = self.propose()
        self.snapshot["selection"]["objectId"] = ""
        self.exchange()
        self.assertEqual(self.request("/api/apply_plan", {"planId": proposal["planId"]})[0], 409)
        self.assertEqual(len(self.state.pending), 0)

    def test_http_scene_change_during_inference_rejects_proposal(self):
        def changing_transport(*_args):
            changed = copy.deepcopy(self.snapshot)
            changed["scene"]["objects"][0]["transform"]["position"]["x"] += .1
            self.state.exchange({"clientId": "runtime-a", "snapshot": changed, "results": []})
            return inference()
        self.plan_codex.side_effect = changing_transport
        code, _ = self.request("/api/plan", {"text": "Duplicate it", "mode": "codex-cli"})
        self.assertEqual(code, 409)
        self.assertEqual(len(self.state.pending), 0)
        self.assertEqual(len(self.state.proposals), 0)

    def test_http_codex_plan_cannot_replay_or_cross_runtime_lease(self):
        proposal = self.propose()
        body = {"planId": proposal["planId"]}
        self.assertEqual(self.request("/api/apply_plan", body)[0], 200)
        self.assertEqual(self.request("/api/apply_plan", body)[0], 409)
        self.assertEqual(len(self.state.pending), 1)
        self.now[0] += LEASE_SECONDS + 1
        self.exchange(client="runtime-b")
        second = self.propose()
        self.now[0] += LEASE_SECONDS + 1
        self.exchange(client="runtime-c")
        self.assertEqual(self.request("/api/apply_plan", {"planId": second["planId"]})[0], 409)
        self.assertEqual(len(self.state.pending), 0)

    def test_http_transport_failure_never_queues_or_falls_back(self):
        self.plan_codex.side_effect = CodexProviderError("Codex authentication is unavailable", status=503)
        code, response = self.request("/api/plan", {"text": "duplicate it", "mode": "codex-cli"})
        self.assertEqual(code, 503)
        self.assertEqual(response, {"error": "Codex authentication is unavailable"})
        self.assertEqual(len(self.state.pending), 0)
        self.assertEqual(len(self.state.proposals), 0)

    def test_http_invalid_codex_commands_never_reach_executor(self):
        self.plan_codex.return_value = inference([{"op": "delete", "objectId": "not-in-runtime"}])
        code, response = self.request("/api/plan", {"text": "Remove that object", "mode": "codex-cli"})
        self.assertEqual(code, 422, response)
        self.assertEqual(len(self.state.pending), 0)
        self.assertEqual(len(self.state.proposals), 0)


if __name__ == "__main__":
    unittest.main()
