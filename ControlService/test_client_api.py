"""Client-neutral v1 HTTP acceptance against a synthetic runtime, never hardware."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from client_api import ACTIVE_LIMIT, MAX_REQUESTS, MAX_SESSIONS, PAIR_SECONDS, SESSION_SECONDS
from server import Handler, LEASE_SECONDS, Server, State, plan


OWNER = "test-owner-secret-at-least-24-characters"
SNAPSHOT = {"scene": {"schemaVersion": 1, "roomId": "fixture-room", "objects": []},
            "assets": [{"assetId": "cube", "displayName": "Cube"}],
            "anchors": [{"anchorId": "floor", "displayName": "Floor"}],
            "selection": {"anchorId": "floor", "objectId": "", "position": {"x": 1, "y": 0, "z": 2}}}


class ClientApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = [100.0]
        self.state = State(self.temp.name, clock=lambda: self.now[0])
        self.server = Server(("127.0.0.1", 0), self.state, OWNER)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.exchange()
        self.session = self.pair()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, body=None, token=None, headers=None):
        request_headers = {**({"Authorization": "Bearer " + token} if token else {}), **(headers or {})}
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, headers=request_headers,
                                         data=None if body is None else json.dumps(body).encode())
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, json.loads(raw) if response.headers.get_content_type() == "application/json" else raw

    def exchange(self, snapshot=None, results=None, client_id="fixture-runtime"):
        code, body = self.request("/api/exchange", {"clientId": client_id, "snapshot": snapshot or SNAPSHOT,
                                                   "results": results or []}, OWNER)
        self.assertEqual(code, 200, body)
        return body

    def pairing_code(self):
        code, body = self.request("/api/v1/pairings", {"clientName": "Independent test client"}, OWNER)
        self.assertEqual(code, 200, body)
        return body

    def pair(self):
        code, session = self.request("/api/v1/sessions", {"pairingCode": self.pairing_code()["pairingCode"]})
        self.assertEqual(code, 200, session)
        return session

    def scene(self, session=None):
        code, scene = self.request("/api/v1/scene", token=(session or self.session)["clientToken"])
        self.assertEqual(code, 200, scene)
        return scene

    def body(self, request_id="request-1", session=None, text="Place a block here."):
        scene = self.scene(session)
        return {"requestId": request_id, "correlationId": "opaque-turn-1",
                "expected": {"runtimeSessionId": scene["runtimeSessionId"], "revision": scene["revision"]},
                "intent": {"text": text, "mode": "offline-rules"}}

    def propose(self, request_id="request-1", session=None, text="Place a block here."):
        session = session or self.session
        code, proposed = self.request("/api/v1/requests", self.body(request_id, session, text), session["clientToken"])
        self.assertEqual(code, 200, proposed)
        return proposed

    def apply(self, request_id="request-1", session=None):
        session = session or self.session
        return self.request(f"/api/v1/operator/requests/{session['sessionId']}/{request_id}/apply", {}, OWNER)

    def outcome(self, request_id="request-1", session=None):
        code, outcome = self.request("/api/v1/requests/" + request_id, token=(session or self.session)["clientToken"])
        self.assertEqual(code, 200, outcome)
        return outcome

    def test_proposal_review_apply_receipt_snapshot_roundtrip(self):
        proposed = self.propose()
        self.assertEqual((proposed["protocolVersion"], proposed["status"], proposed["requiresApply"]), ("1", "ready", True))
        self.assertEqual(proposed["commandIds"], [])
        self.assertEqual(len(self.state.pending), 0)
        owner = self.request("/api/v1/operator", token=OWNER)[1]
        self.assertEqual(owner["sessions"][0]["requests"][0], proposed)
        self.assertNotIn(self.session["clientToken"], json.dumps(owner))
        code, queued = self.apply()
        self.assertEqual((code, queued["status"]), (200, "queued"))
        delivered = self.exchange()["commands"]
        self.assertEqual([value["requestId"] for value in delivered], queued["commandIds"])
        self.assertEqual(self.outcome()["status"], "running")
        snapshot = copy.deepcopy(SNAPSHOT)
        snapshot["scene"]["objects"] = [{"objectId": "fixture-object", **{key: delivered[0][key] for key in ("assetId", "anchorId", "transform")}}]
        receipt = {"requestId": queued["commandIds"][0], "ok": True, "objectId": "fixture-object", "error": ""}
        self.exchange(snapshot, [receipt])
        final = self.outcome()
        self.assertEqual(final["status"], "succeeded")
        self.assertEqual(final["receipts"], [receipt])
        self.assertEqual(final["observed"]["snapshot"]["scene"], snapshot["scene"])
        self.assertGreater(final["sequence"], queued["sequence"])
        self.assertFalse(final["requiresApply"])
        self.assertEqual(final["correlationId"], "opaque-turn-1")

    def test_request_and_apply_retries_never_queue_twice(self):
        body = self.body()
        first = self.request("/api/v1/requests", body, self.session["clientToken"])[1]
        self.assertEqual(self.request("/api/v1/requests", body, self.session["clientToken"])[1], first)
        self.assertEqual(len(self.state.proposals), 1)
        first_apply = self.apply()[1]
        self.assertEqual(self.apply()[1], first_apply)
        self.assertEqual(len(self.state.pending), 1)
        self.assertEqual(self.request("/api/v1/requests", body, self.session["clientToken"])[1], first_apply)
        changed = copy.deepcopy(body)
        changed["intent"]["text"] = "Clear the scene."
        code, error = self.request("/api/v1/requests", changed, self.session["clientToken"])
        self.assertEqual((code, error["code"]), (409, "idempotency_conflict"))

    def test_partial_out_of_order_and_duplicate_receipts_keep_first_acknowledgement(self):
        commands = [{"op": "get_scene"}, {"op": "list_assets"}]
        with patch("server.Planner.plan", return_value={"commands": commands, "requiresApply": True, "summary": "Inspect the scene"}):
            self.propose()
        queued = self.apply()[1]
        first, second = queued["commandIds"]
        failed = {"requestId": second, "ok": False, "objectId": "", "error": "Synthetic rejection"}
        self.exchange(results=[failed])
        intermediate = self.outcome()
        self.assertEqual(intermediate["status"], "running")
        self.assertEqual(intermediate["receipts"], [failed])
        self.exchange(results=[{**failed, "ok": True, "error": ""}])
        self.assertEqual(self.outcome(), intermediate, "Duplicate conflicting receipts cannot rewrite accepted evidence")
        succeeded = {"requestId": first, "ok": True, "objectId": "", "error": ""}
        self.exchange(results=[succeeded])
        final = self.outcome()
        self.assertEqual(final["status"], "partial")
        self.assertEqual(final["receipts"], [succeeded, failed], "Receipt order follows commandIds, not arrival order")
        self.exchange(results=[failed, succeeded])
        self.assertEqual(self.outcome(), final)

    def test_percent_encoded_legal_request_id_is_queryable(self):
        self.propose("request:one")
        code, outcome = self.request("/api/v1/requests/request%3Aone", token=self.session["clientToken"])
        self.assertEqual((code, outcome["requestId"]), (200, "request:one"))
        self.assertEqual(self.request("/api/v1/requests/request%2Fone", token=self.session["clientToken"])[0], 400)

    def test_cancel_is_idempotent_before_apply_and_rejected_after(self):
        self.propose()
        path = "/api/v1/requests/request-1/cancel"
        code, cancelled = self.request(path, {}, self.session["clientToken"])
        self.assertEqual((code, cancelled["status"]), (200, "cancelled"))
        self.assertEqual(self.request(path, {}, self.session["clientToken"])[1], cancelled)
        self.assertEqual(self.apply()[0], 409)
        self.assertFalse(self.state.pending)
        self.propose("request-2")
        self.apply("request-2")
        code, error = self.request("/api/v1/requests/request-2/cancel", {}, self.session["clientToken"])
        self.assertEqual((code, error["code"]), (409, "already_dispatched"))
        self.assertEqual(len(self.state.pending), 1)

    def test_client_scope_cannot_apply_capture_pair_or_use_legacy_control(self):
        self.propose()
        for path, body in (("/api/v1/pairings", {"clientName": "Escalate"}),
                           (f"/api/v1/operator/requests/{self.session['sessionId']}/request-1/apply", {}),
                           ("/api/apply_plan", {"planId": self.outcome()["proposal"]["planId"]}),
                           ("/api/command", {"op": "clear"}), ("/api/capture", {}), ("/api/content/install", {})):
            with self.subTest(path=path):
                self.assertEqual(self.request(path, body, self.session["clientToken"])[0], 401)
        self.assertFalse(self.state.pending)
        self.assertEqual(self.request("/api/v1/scene", token=OWNER)[0], 401)

    def test_pairing_is_one_use_expiring_and_bound_to_runtime(self):
        pairing = self.pairing_code()
        self.assertEqual(self.request("/api/v1/sessions", {"pairingCode": pairing["pairingCode"]})[0], 200)
        self.assertEqual(self.request("/api/v1/sessions", {"pairingCode": pairing["pairingCode"]})[0], 401)
        pairing = self.pairing_code()
        self.now[0] += PAIR_SECONDS + 1
        self.exchange()
        self.assertEqual(self.request("/api/v1/sessions", {"pairingCode": pairing["pairingCode"]})[0], 401)
        pairing = self.pairing_code()
        self.now[0] += LEASE_SECONDS + 1
        self.exchange(client_id="replacement-runtime")
        self.assertEqual(self.request("/api/v1/sessions", {"pairingCode": pairing["pairingCode"]})[0], 409)

    def test_discovery_is_private_data_free_and_pairing_requires_strong_owner_token(self):
        code, discovery = self.request("/api/v1/discovery")
        self.assertEqual(code, 200)
        self.assertEqual(discovery["protocolVersion"], "1")
        self.assertFalse(discovery["capabilities"]["hostedBrowserConnection"])
        self.assertNotIn("fixture-room", json.dumps(discovery))
        self.assertNotIn("fixture-runtime", json.dumps(discovery))
        self.server.token = ""
        self.assertFalse(self.request("/api/v1/discovery")[1]["pairingAvailable"])
        self.assertEqual(self.request("/api/v1/pairings", {"clientName": "Unsafe"})[0], 503)
        self.assertEqual(self.request("/api/health")[0], 200, "Standalone Operator remains available without client pairing")

    def test_loopback_host_origin_and_version_guards(self):
        self.assertEqual(self.request("/api/v2/discovery")[0], 426)
        self.assertEqual(self.request("/api/v1/discovery?token=secret")[0], 400)
        self.assertEqual(self.request("/api/v1/discovery", headers={"Origin": "https://school.example"})[0], 403)
        self.assertEqual(self.request("/api/v1/discovery", headers={"Host": "evil.test"})[0], 403)
        original = Handler.setup

        def remote(handler):
            original(handler)
            handler.client_address = ("192.0.2.55", handler.client_address[1])

        with patch.object(Handler, "setup", remote):
            self.assertEqual(self.request("/api/v1/scene", token=self.session["clientToken"])[0], 403)
            self.assertEqual(self.request("/api/v1/pairings", {"clientName": "Remote"}, OWNER)[0], 403)

    def test_body_and_schema_limits_reject_control_injection(self):
        for change in ({"unexpected": True}, {"intent": {"text": "clear", "mode": "openai-compatible"}},
                       {"intent": {"text": "clear", "mode": "offline-rules", "captureId": "private-image"}},
                       {"requestId": "../unsafe"}, {"correlationId": {"learner": "record"}},
                       {"expected": {"runtimeSessionId": self.session["runtimeSessionId"], "revision": True}}):
            body = self.body()
            body.update(change)
            self.assertEqual(self.request("/api/v1/requests", body, self.session["clientToken"])[0], 400)
        huge = self.body()
        huge["intent"]["text"] = "x" * 17000
        self.assertEqual(self.request("/api/v1/requests", huge, self.session["clientToken"])[0], 413)
        self.assertFalse(self.state.pending)
        self.assertEqual(self.session_requests(), {})

    def session_requests(self):
        return self.state.clients.sessions[self.session["sessionId"]]["requests"]

    def test_stale_expected_and_later_scene_changes_cannot_apply(self):
        body = self.body()
        moved = copy.deepcopy(SNAPSHOT)
        moved["selection"]["position"]["x"] = 2
        self.exchange(moved)
        self.assertEqual(self.request("/api/v1/requests", body, self.session["clientToken"])[0], 409)
        self.propose()
        self.exchange()
        self.assertEqual(self.outcome()["status"], "stale")
        self.assertEqual(self.apply()[0], 409)
        self.assertFalse(self.state.pending)

    def test_two_clients_cannot_read_each_other_or_apply_same_revision(self):
        second = self.pair()
        self.propose()
        self.assertEqual(self.request("/api/v1/requests/request-1", token=second["clientToken"])[0], 404)
        self.propose("second-request", second)
        self.assertEqual(self.apply()[0], 200)
        self.assertEqual(self.apply("second-request", second)[0], 409)
        self.assertEqual(self.outcome("second-request", second)["status"], "stale")
        self.assertEqual(len(self.state.pending), 1)

    def test_runtime_loss_is_unconfirmed_and_same_process_reconnect_is_new_generation(self):
        self.propose()
        queued = self.apply()[1]
        self.now[0] += LEASE_SECONDS + 1
        old = self.outcome()
        self.assertEqual(old["status"], "unconfirmed")
        self.assertEqual(old["receipts"], [])
        self.assertIsNone(old["observed"])
        self.assertFalse(self.state.pending)
        self.exchange(results=[{"requestId": queued["commandIds"][0], "ok": True, "objectId": "too-late", "error": ""}])
        self.assertEqual(self.outcome()["status"], "unconfirmed", "A later lease must not claim an old request's completion")
        self.assertEqual(self.request("/api/v1/scene", token=self.session["clientToken"])[0], 409)
        new_session = self.pair()
        self.assertNotEqual(new_session["runtimeSessionId"], self.session["runtimeSessionId"])

    def test_room_loss_retires_pending_work_without_claiming_failure_or_a_snapshot(self):
        self.propose()
        queued = self.apply()[1]
        self.exchange()
        missing = {"mode": "ar", "state": "missing", "message": "Complete room setup.", "alignmentVerified": False}
        code, _ = self.request("/api/exchange", {"clientId": "fixture-runtime", "snapshot": None, "runtime": missing, "results": []}, OWNER)
        self.assertEqual(code, 200)
        self.assertTrue(self.state.online())
        self.assertFalse(self.state.pending)
        outcome = self.outcome()
        self.assertEqual(outcome["status"], "unconfirmed")
        self.assertIsNone(outcome["observed"])
        code, error = self.request("/api/v1/scene", token=self.session["clientToken"])
        self.assertEqual((code, error["code"]), (409, "room_unavailable"))
        # Preserve a late same-lease receipt without inventing an observation or
        # marking the end-to-end outcome confirmed while room data is missing.
        receipt = {"requestId": queued["commandIds"][0], "ok": True, "objectId": "late-object", "error": ""}
        self.request("/api/exchange", {"clientId": "fixture-runtime", "snapshot": None, "runtime": missing, "results": [receipt]}, OWNER)
        final = self.outcome()
        self.assertEqual(final["status"], "unconfirmed")
        self.assertEqual(final["receipts"], [receipt])
        self.assertIsNone(final["observed"])
        self.exchange()
        self.assertEqual(self.outcome(), final, "A later room snapshot must not be relabeled as an ack-time observation")

    def test_retired_unknown_outcomes_do_not_permanently_fill_active_work_slots(self):
        missing = {"mode": "ar", "state": "missing", "message": "Complete room setup.", "alignmentVerified": False}
        for index in range(ACTIVE_LIMIT):
            request_id = "retired-" + str(index)
            self.propose(request_id)
            self.apply(request_id)
            self.request("/api/exchange", {"clientId": "fixture-runtime", "snapshot": None, "runtime": missing, "results": []}, OWNER)
            self.assertEqual(self.outcome(request_id)["status"], "unconfirmed")
            self.exchange()
        self.assertEqual(self.propose("new-reviewed-request")["status"], "ready")

    def test_partial_receipt_in_room_loss_exchange_is_retained(self):
        with patch("server.Planner.plan", return_value={"commands": [{"op": "get_scene"}, {"op": "list_assets"}],
                                                         "requiresApply": True, "summary": "Inspect the scene"}):
            self.propose()
        queued = self.apply()[1]
        first, second = queued["commandIds"]
        receipt = {"requestId": first, "ok": True, "objectId": "", "error": ""}
        missing = {"mode": "ar", "state": "missing", "message": "Complete room setup.", "alignmentVerified": False}
        self.request("/api/exchange", {"clientId": "fixture-runtime", "snapshot": None, "runtime": missing, "results": [receipt]}, OWNER)
        partial = self.outcome()
        self.assertEqual(partial["status"], "unconfirmed")
        self.assertEqual(partial["receipts"], [receipt])
        self.assertFalse(self.state.pending)
        self.exchange(results=[{**receipt, "requestId": second}])
        final = self.outcome()
        self.assertEqual(final["status"], "unconfirmed")
        self.assertEqual(len(final["receipts"]), 2)
        self.assertIsNone(final["observed"])

    def test_revocation_cancels_unapplied_work_and_preserves_dispatched_receipts_for_owner(self):
        self.propose()
        self.apply()
        request_id = self.outcome()["commandIds"][0]
        code, revoked = self.request(f"/api/v1/operator/sessions/{self.session['sessionId']}/revoke", {}, OWNER)
        self.assertEqual((code, revoked["status"]), (200, "revoked"))
        self.assertEqual(self.request("/api/v1/scene", token=self.session["clientToken"])[0], 401)
        self.assertEqual(self.request("/api/v1/requests/request-1", token=self.session["clientToken"])[0], 401)
        self.exchange(results=[{"requestId": request_id, "ok": False, "objectId": "", "error": "Runtime fixture rejected it"}])
        owner = self.request("/api/v1/operator", token=OWNER)[1]
        self.assertEqual(owner["sessions"][0]["requests"][0]["status"], "failed")
        second = self.pair()
        self.propose("second", second)
        self.request(f"/api/v1/operator/sessions/{second['sessionId']}/revoke", {}, OWNER)
        self.assertEqual(self.state.clients.sessions[second["sessionId"]]["requests"]["second"]["status"], "cancelled")
        self.assertFalse(self.state.proposals)

    def test_cancel_while_planning_discards_late_proposal_and_does_not_block_exchange(self):
        entered, finish = threading.Event(), threading.Event()
        body = self.body()

        def delayed(*args, **kwargs):
            entered.set()
            finish.wait(3)
            return plan(*args, **kwargs)

        self.state.clients.planner = delayed
        result = []
        worker = threading.Thread(target=lambda: result.append(self.request("/api/v1/requests", body, self.session["clientToken"])))
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertEqual(self.exchange()["commands"], [])
            duplicate = self.request("/api/v1/requests", body, self.session["clientToken"])[1]
            self.assertEqual(duplicate["status"], "planning")
            self.assertEqual(self.request("/api/v1/requests/request-1/cancel", {}, self.session["clientToken"])[1]["status"], "cancelled")
        finally:
            finish.set()
            worker.join(5)
        self.assertEqual(result[0][1]["status"], "cancelled")
        self.assertFalse(self.state.proposals)
        self.assertFalse(self.state.pending)

    def test_expired_proposal_session_and_backpressure(self):
        self.propose()
        self.now[0] += 121
        self.state.last_seen = self.now[0]
        self.assertEqual(self.outcome()["status"], "stale")
        for index in range(ACTIVE_LIMIT):
            self.propose("active-" + str(index))
        code, error = self.request("/api/v1/requests", self.body("one-too-many"), self.session["clientToken"])
        self.assertEqual((code, error["code"]), (429, "request_limit"))
        self.now[0] += SESSION_SECONDS
        self.state.last_seen = self.now[0]
        self.assertEqual(self.request("/api/v1/scene", token=self.session["clientToken"])[0], 401)

    def test_retained_ledger_limits_do_not_evict_idempotency(self):
        with patch("client_api.MAX_REQUESTS", 2):
            first = self.body("first")
            self.request("/api/v1/requests", first, self.session["clientToken"])
            self.request("/api/v1/requests/first/cancel", {}, self.session["clientToken"])
            self.propose("second")
            self.request("/api/v1/requests/second/cancel", {}, self.session["clientToken"])
            self.assertEqual(self.request("/api/v1/requests", self.body("third"), self.session["clientToken"])[0], 429)
            self.assertEqual(self.request("/api/v1/requests", first, self.session["clientToken"])[1]["status"], "cancelled")
        with patch("client_api.MAX_SESSIONS", 1):
            self.assertEqual(self.request("/api/v1/pairings", {"clientName": "Extra"}, OWNER)[0], 429)

    def test_service_restart_does_not_accept_old_client_token_or_pairing(self):
        pairing = self.pairing_code()
        from client_api import ClientAPI
        self.state.clients = ClientAPI(self.state, plan)
        self.assertEqual(self.request("/api/v1/scene", token=self.session["clientToken"])[0], 401)
        self.assertEqual(self.request("/api/v1/sessions", {"pairingCode": pairing["pairingCode"]})[0], 401)

    def test_stale_session_token_still_expires_at_its_original_deadline(self):
        self.propose()
        self.now[0] += LEASE_SECONDS + 1
        self.assertEqual(self.outcome()["status"], "stale")
        session = self.state.clients.sessions[self.session["sessionId"]]
        self.assertEqual(session["status"], "stale")
        self.now[0] = session["expires"]
        self.assertEqual(self.request("/api/v1/requests/request-1", token=self.session["clientToken"])[0], 401)
        self.assertEqual(session["status"], "expired")

    def test_missing_provider_invalid_input_and_save_use_existing_paths(self):
        unsupported = self.propose("nonsense", text="abracadabra frobnicate")
        self.assertIn(unsupported["status"], {"error", "needs_clarification"})
        self.assertFalse(self.state.pending)
        saved = self.propose("save", text="Save as Client Demo")
        self.assertEqual(saved["status"], "ready")
        code, applied = self.apply("save")
        self.assertEqual((code, applied["status"]), (200, "succeeded"))
        self.assertEqual(applied["commandIds"], [])
        self.assertEqual(applied["observed"]["savedScene"], "Client Demo")
        self.assertTrue(Path(self.temp.name, "Client Demo.json").is_file())
        self.assertEqual(self.apply("save")[1], applied)

    def test_unexpected_apply_io_failure_is_unconfirmed_not_safe_to_replay(self):
        self.propose()
        with patch.object(self.state, "apply_plan", side_effect=OSError("private storage path")) as apply:
            code, error = self.apply()
            self.assertEqual(code, 500)
            self.assertEqual(error["protocolVersion"], "1")
            self.assertNotIn("private storage path", json.dumps(error))
            outcome = self.outcome()
            self.assertEqual(outcome["status"], "unconfirmed")
            self.assertIn("not confirmed", outcome["error"])
            self.assertEqual(self.apply()[0], 409)
            apply.assert_called_once()

    def test_unknown_routes_and_existing_operator_continue(self):
        self.assertEqual(self.request("/clients")[0], 200)
        self.assertEqual(self.request("/api/v1/unknown", token=self.session["clientToken"])[0], 404)
        self.assertEqual(self.request("/api/v1/operator/nonsense", {}, OWNER)[0], 404)
        self.assertEqual(self.request("/api/state", token=OWNER)[0], 200)
        self.assertEqual(self.request("/api/command", {"op": "get_scene"}, OWNER)[0], 200)

    def collect_fixture(self):
        """Record actual HTTP responses, replacing only generated identities."""
        discovery = self.request("/api/v1/discovery")[1]
        scene = self.scene()
        request_body = self.body("fixture-request")
        ready = self.request("/api/v1/requests", request_body, self.session["clientToken"])[1]
        queued = self.apply("fixture-request")[1]
        command = self.exchange()["commands"][0]
        running = self.outcome("fixture-request")
        observed = copy.deepcopy(SNAPSHOT)
        observed["scene"]["objects"] = [{"objectId": "fixture-object", **{key: command[key] for key in ("assetId", "anchorId", "transform")}}]
        self.exchange(observed, [{"requestId": command["requestId"], "ok": True, "error": "", "objectId": "fixture-object"}])
        completed = self.outcome("fixture-request")
        identities = {self.session["sessionId"]: "fixture-session", self.session["runtimeSessionId"]: "fixture-runtime.1",
                      ready["proposal"]["planId"]: "fixture-plan", command["requestId"]: "fixture-command"}

        def canonical(value):
            if isinstance(value, dict):
                return {key: canonical(item) for key, item in value.items()}
            if isinstance(value, list):
                return [canonical(item) for item in value]
            return identities.get(value, value) if isinstance(value, str) else value

        return canonical({"protocolVersion": "1", "evidence": "Synthetic authenticated HTTP runtime; no headset or hosted School validation.",
                          "discovery": discovery, "scene": scene, "request": request_body, "ready": ready,
                          "queued": queued, "running": running, "succeeded": completed})

    def test_recorded_contract_fixture_matches_http_behavior(self):
        expected = json.loads(Path(__file__).parents[1].joinpath("Validation/client-api-v1-fixtures.json").read_text(encoding="utf-8"))
        self.assertEqual(self.collect_fixture(), expected)


if __name__ == "__main__":
    unittest.main()
