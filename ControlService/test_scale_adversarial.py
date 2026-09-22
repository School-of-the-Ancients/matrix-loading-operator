"""Independent issue-32 authority/numeric fixtures, using a synthetic runtime only."""
import copy
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from client_api import ClientError
from server import Server, State


def vec(x=0, y=0, z=0):
    return {"x": x, "y": y, "z": z}


def fixture():
    return {
        "scene": {"schemaVersion": 1, "roomId": "scale-review-room", "objects": [
            {"objectId": "review-block", "assetId": "block", "anchorId": "floor",
             "transform": {"position": vec(1, .2, 2), "rotation": vec(), "scale": vec(.3, .4, .5)}}]},
        "assets": [{"assetId": "block", "displayName": "Terracotta block", "spawnScale": .2,
                    "localBounds": {"center": vec(), "size": vec(1, 1, 1)}}],
        "anchors": [{"anchorId": "floor", "displayName": "Floor"}],
        "selection": {"objectId": "review-block", "anchorId": "floor", "position": vec(1, 0, 2)},
    }


class ScaleAdversarialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 100
        self.state = State(self.temp.name, clock=lambda: self.now)
        self.exchange(fixture())
        self.session = self.pair()
        self.number = 0

    def exchange(self, snapshot, receipts=None):
        return self.state.exchange({"clientId": "review-runtime", "snapshot": snapshot,
                                    "results": receipts or []})

    def pair(self):
        code = self.state.clients.pair({"clientName": "Scale independent review"})["pairingCode"]
        result = self.state.clients.claim({"pairingCode": code})
        return self.state.clients.authenticate("Bearer " + result["clientToken"])

    def body(self, intent, session=None, request_id=None):
        self.number += 1
        session = session or self.session
        return {"requestId": request_id or "review-" + str(self.number),
                "expected": {"runtimeSessionId": session["runtimeSessionId"], "revision": self.state.revision},
                "intent": intent}

    def configure(self, factors=None, baseline=None, **fields):
        value = {"kind": "block-scale", "version": 1, "action": "configure", "objectId": "review-block",
                 "factors": factors if factors is not None else vec(2, 2, 2), **fields}
        if baseline is not None:
            value["baselineRequestId"] = baseline
        return value

    def propose(self, intent, session=None):
        return self.state.clients.propose(session or self.session, self.body(intent, session))

    def rejected(self, intent, session=None):
        before = list(self.state.pending)
        try:
            outcome = self.propose(intent, session)
        except ClientError as error:
            self.assertIn(error.status, (400, 404, 409, 422))
        else:
            self.assertIn(outcome["status"], ("error", "stale", "needs_clarification"), outcome)
            self.assertFalse(outcome["requiresApply"], outcome)
        self.assertEqual(list(self.state.pending), before)

    def completed(self, intent=None, mutate=None, receipt_object=None, ok=True):
        result = self.propose(intent or self.configure())
        self.assertEqual(result["status"], "ready", result)
        queued = self.state.clients.apply(self.session["sessionId"], result["requestId"])
        command = self.exchange(copy.deepcopy(self.state.latest))["commands"][0]
        current = copy.deepcopy(self.state.latest)
        current["scene"]["objects"][0]["transform"] = copy.deepcopy(command["transform"])
        if mutate:
            mutate(current)
        self.exchange(current, [{"requestId": command["requestId"], "ok": ok,
                                 "objectId": receipt_object or "review-block", "error": "" if ok else "fixture failure"}])
        return self.state.clients.get_request(self.session, queued["requestId"])

    def test_xyz_factors_multiply_captured_baseline_without_uniform_coercion(self):
        result = self.propose(self.configure(vec(2, .5, 1)))
        self.assertEqual(result["status"], "ready", result)
        commands = result["proposal"]["commands"]
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0]["op"], "set_transform")
        self.assertEqual(commands[0]["objectId"], "review-block")
        self.assertEqual(commands[0]["transform"], {
            "position": vec(1, .2, 2), "rotation": vec(), "scale": vec(.6, .2, .5)})
        self.assertFalse(self.state.pending, "A proposal cannot execute itself")

    def test_invalid_numbers_and_axis_shapes_never_produce_executable_work(self):
        for value in (True, False, None, "2", [], {}, float("nan"), float("inf"), -float("inf"),
                      0, -.25, .249999, 4.000001, 1e308, 10 ** 400):
            with self.subTest(value=repr(value)):
                self.rejected(self.configure(vec(value, 1, 1)))
        for value in ({"x": 1, "y": 1}, {"x": 1, "y": 1, "z": 1, "w": 1}, [1, 1, 1]):
            with self.subTest(value=value):
                self.rejected(self.configure(value))

    def test_version_action_and_unexpected_fields_are_not_coerced(self):
        for change in ({"version": True}, {"version": "1"}, {"version": 2}, {"action": "stop"},
                       {"action": "execute"}, {"script": "dangerous()"}, {"transform": {}}, {"kind": "scale"}):
            with self.subTest(change=change):
                self.rejected(self.configure(**change))
        for action in ([], {}):
            self.rejected({"kind": "block-scale", "version": 1, "action": action,
                           "objectId": "review-block", "baselineRequestId": "not-a-real-baseline"})

    def test_relative_limits_do_not_allow_final_runtime_scale_overflow_or_underflow(self):
        for scale, factors in ((vec(6, 1, 1), vec(4, 1, 1)), (vec(.01, 1, 1), vec(.25, 1, 1))):
            current = fixture()
            current["scene"]["objects"][0]["transform"]["scale"] = scale
            self.exchange(current)
            self.rejected(self.configure(factors))

    def test_another_pairing_cannot_reference_the_original_baseline(self):
        source = self.completed()
        self.assertEqual(source["status"], "succeeded", source)
        other = self.pair()
        self.rejected(self.configure(baseline=source["requestId"]), other)

    def test_unapplied_cancelled_and_failed_requests_cannot_supply_baselines(self):
        ready = self.propose(self.configure())
        self.rejected(self.configure(baseline=ready["requestId"]))
        self.state.clients.cancel(self.session, ready["requestId"])
        self.rejected(self.configure(baseline=ready["requestId"]))
        failed = self.completed(ok=False)
        self.assertEqual(failed["status"], "failed", failed)
        self.rejected(self.configure(baseline=failed["requestId"]))

    def test_followup_rejects_target_scale_position_rotation_or_anchor_edits(self):
        source = self.completed()
        original = copy.deepcopy(self.state.latest)
        changes = [("scale", "x", .9), ("position", "z", 7), ("rotation", "y", 90)]
        for field, axis, value in changes:
            with self.subTest(field=field):
                current = copy.deepcopy(original)
                current["scene"]["objects"][0]["transform"][field][axis] = value
                self.exchange(current)
                self.rejected(self.configure(baseline=source["requestId"]))
        current = copy.deepcopy(original)
        current["anchors"].append({"anchorId": "other-floor", "displayName": "Other floor"})
        current["scene"]["objects"][0]["anchorId"] = "other-floor"
        current["selection"] = {"objectId": "", "anchorId": "floor", "position": vec()}
        self.exchange(current)
        self.rejected(self.configure(baseline=source["requestId"]))

    def test_chained_factors_and_reviewed_reset_reuse_original_baseline(self):
        initial = self.completed(self.configure(vec(2, 2, 2)))
        second = self.completed(self.configure(vec(3, 1, .5), baseline=initial["requestId"]))
        scale = self.state.latest["scene"]["objects"][0]["transform"]["scale"]
        self.assertAlmostEqual(scale["x"], .9)
        self.assertEqual((scale["y"], scale["z"]), (.4, .25))
        reset = {"kind": "block-scale", "version": 1, "action": "reset", "objectId": "review-block",
                 "baselineRequestId": second["requestId"]}
        proposal = self.propose(reset)
        self.assertEqual(proposal["status"], "ready", proposal)
        self.assertEqual(proposal["proposal"]["commands"][0]["transform"], fixture()["scene"]["objects"][0]["transform"])
        self.assertFalse(self.state.pending)
        self.state.clients.cancel(self.session, proposal["requestId"])
        self.assertEqual(self.state.latest["scene"]["objects"][0]["transform"]["scale"], scale,
                         "Cancel is only cancellation before Apply, never a runtime reset")
        self.rejected({**reset, "factors": vec(1, 1, 1)})

    def test_scene_change_after_review_invalidates_apply_before_queueing(self):
        for mutation in ("delete", "move", "undo-scale", "load-room"):
            with self.subTest(mutation=mutation):
                self.exchange(fixture())
                ready = self.propose(self.configure())
                current = copy.deepcopy(self.state.latest)
                if mutation == "delete":
                    current["scene"]["objects"] = []
                    current["selection"]["objectId"] = ""
                elif mutation == "move":
                    current["scene"]["objects"][0]["transform"]["position"]["x"] = 9
                elif mutation == "undo-scale":
                    current["scene"]["objects"][0]["transform"]["scale"]["x"] = .25
                else:
                    current["scene"]["roomId"] = "another-room"
                self.exchange(current)
                with self.assertRaises(ClientError):
                    self.state.clients.apply(self.session["sessionId"], ready["requestId"])
                self.assertFalse(self.state.pending)

    def test_wrong_object_or_wrong_observed_scale_cannot_be_confirmed(self):
        for wrong in ("object", "scale"):
            with self.subTest(wrong=wrong):
                self.exchange(fixture())
                outcome = self.completed(
                    receipt_object="different-block" if wrong == "object" else None,
                    mutate=(lambda s: s["scene"]["objects"][0]["transform"]["scale"].update(x=.3)) if wrong == "scale" else None)
                self.assertEqual(outcome["experiment"]["observationState"], "unconfirmed", outcome)
                self.assertIsNone(outcome["experiment"]["observation"], outcome)
                self.rejected(self.configure(baseline=outcome["requestId"]))

    def test_derived_ratio_uses_acknowledged_xyz_and_is_not_a_physical_measurement(self):
        result = self.completed(self.configure(vec(2, .5, 1)))
        evidence = result["experiment"]["observation"]
        self.assertEqual(result["experiment"]["observationState"], "confirmed")
        self.assertEqual(evidence["relativeFactors"], vec(2, .5, 1))
        self.assertEqual(evidence["mathematicalVolumeRatio"], 1)
        self.assertFalse(evidence["physicalMeasurement"])
        self.assertEqual(evidence["units"], "dimensionless ratio")

    def test_builtin_target_requires_exact_object_and_asset_ids(self):
        for object_id in ("block", "Terracotta block", "selected", "missing", True):
            self.rejected(self.configure(objectId=object_id))
        current = fixture()
        current["assets"][0]["assetId"] = "cube"
        current["scene"]["objects"][0]["assetId"] = "cube"
        self.exchange(current)
        self.rejected(self.configure())

    def test_ar_and_mruk_are_rejected_even_with_valid_authoritative_bounds(self):
        from test_room_context import TABLE
        current = fixture()
        current["anchors"] = [copy.deepcopy(TABLE)]
        current["scene"]["objects"][0]["anchorId"] = TABLE["anchorId"]
        current["selection"]["anchorId"] = TABLE["anchorId"]
        self.exchange(current)
        self.rejected(self.configure())
        current["roomContext"] = {"mode": "ar", "state": "ready", "message": "Review fixture",
                                  "alignmentVerified": True}
        self.exchange(current)
        self.rejected(self.configure())

    def test_malformed_json_values_return_controlled_http_error(self):
        server = Server(("127.0.0.1", 0), self.state, "review-owner-token-at-least-24-characters")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            code = self.state.clients.pair({"clientName": "HTTP review"})["pairingCode"]
            token = self.state.clients.claim({"pairingCode": code})["clientToken"]
            for intent in (self.configure(vec(10 ** 400, 1, 1)),
                           {"kind": "block-scale", "version": 1, "action": [], "objectId": "review-block",
                            "baselineRequestId": "not-a-real-baseline"}):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/v1/requests",
                    data=json.dumps(self.body(intent)).encode(),
                    headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request, timeout=3)
                self.assertIn(caught.exception.code, (400, 422))
                response = json.loads(caught.exception.read())
                self.assertEqual(response["protocolVersion"], "1")
                self.assertEqual(response["code"], "invalid_experiment")
                self.assertFalse(self.state.pending)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_enabled_even_paused_behaviors_block_static_ownership(self):
        from ai_adapter import validate_behavior
        for paused in (False, True):
            with self.subTest(paused=paused):
                current = fixture()
                current["behaviorKinds"] = ["rotate", "bob"]
                current["scene"]["objects"][0]["behaviors"] = [validate_behavior({"kind": "rotate", "paused": paused})]
                self.exchange(current)
                self.rejected(self.configure())
        current["scene"]["objects"][0]["behaviors"][0]["enabled"] = False
        self.exchange(current)
        result = self.propose(self.configure())
        self.assertEqual(result["status"], "ready", result)

    def test_repeated_request_and_apply_are_idempotent_and_changed_factors_conflict(self):
        body = self.body(self.configure())
        first = self.state.clients.propose(self.session, body)
        self.assertEqual(first, self.state.clients.propose(self.session, body))
        queued = self.state.clients.apply(self.session["sessionId"], first["requestId"])
        self.assertEqual(queued, self.state.clients.apply(self.session["sessionId"], first["requestId"]))
        self.assertEqual(len(self.state.pending), 1)
        self.assertEqual(queued, self.state.clients.propose(self.session, body))
        changed = copy.deepcopy(body)
        changed["intent"]["factors"]["x"] = 3
        with self.assertRaises(ClientError) as caught:
            self.state.clients.propose(self.session, changed)
        self.assertEqual(caught.exception.code, "idempotency_conflict")
        with self.assertRaises(ClientError) as caught:
            self.state.clients.cancel(self.session, first["requestId"])
        self.assertEqual(caught.exception.code, "already_dispatched")
        self.assertEqual(len(self.state.pending), 1)

    def test_expired_runtime_does_not_confirm_late_ack_or_replay(self):
        from server import LEASE_SECONDS
        ready = self.propose(self.configure())
        queued = self.state.clients.apply(self.session["sessionId"], ready["requestId"])
        current = copy.deepcopy(self.state.latest)
        current["scene"]["objects"][0]["transform"] = ready["proposal"]["commands"][0]["transform"]
        self.now += LEASE_SECONDS + 1
        self.exchange(current, [{"requestId": queued["commandIds"][0], "ok": True,
                                 "objectId": "review-block", "error": ""}])
        outcome = self.state.clients.get_request(self.session, ready["requestId"])
        self.assertEqual(outcome["status"], "unconfirmed")
        self.assertIsNone(outcome["experiment"]["observation"])
        self.assertEqual(outcome["receipts"], [])
        self.assertFalse(self.state.pending)
        other = self.pair()
        self.rejected(self.configure(baseline=ready["requestId"]), other)

    def test_legacy_text_request_keeps_its_existing_reviewed_path(self):
        result = self.propose({"text": "Make it twice as big.", "mode": "offline-rules"})
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["proposal"]["commands"][0]["transform"]["scale"], vec(.6, .8, 1))
        self.assertFalse(self.state.pending)


if __name__ == "__main__":
    unittest.main()
