"""Operator adapter checks against a contract fake; no headset or live core required."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from learning import LearningBridge, LearningError
from server import APIError, LEASE_SECONDS, State


POSE = {"position": {"x": 0.1, "y": 0, "z": -0.1},
        "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 0.2, "y": 0.2, "z": 0.2}}
SNAPSHOT = {"scene": {"schemaVersion": 1, "roomId": "room-a", "objects": [
    {"objectId": "lesson-block", "assetId": "block", "anchorId": "table-a", "transform": POSE}]},
    "assets": [{"assetId": "block", "displayName": "Block"}, {"assetId": "orb", "displayName": "Orb"}],
    "anchors": [{"anchorId": "table-a", "displayName": "Table"}, {"anchorId": "table-b", "displayName": "Table"}],
    "selection": {"objectId": "lesson-block", "anchorId": "table-a", "position": {"x": 0.1, "y": 0, "z": -0.1}}}


class FakeCore:
    """Enforces the relevant canonical HTTP contract, including durable request receipts."""

    def __init__(self):
        self.calls = []
        self.sessions = {}
        self.checkpoints = {}
        self.receipts = {}
        self.unavailable = False
        self.lose_once = set()
        self.restore_count = 0

    def call(self, path, body=None):
        body = copy.deepcopy(body)
        self.calls.append((path, body))
        if self.unavailable:
            raise LearningError(503, "Learning core unavailable")
        if body is not None:
            key = body["requestId"]
            if key in self.receipts:
                prior_path, prior_body, response = self.receipts[key]
                if (path, body) != (prior_path, prior_body):
                    raise LearningError(409, "requestId was already used for a different operation")
                return copy.deepcopy(response)
        if path == "/lessons":
            return {"apiVersion": 1, "lessons": [{"id": "observation-scale"}]}
        if path == "/sessions":
            session_id = "session-" + str(len(self.sessions) + 1)
            session = {"id": session_id, "revision": 1, "lessonId": body["lessonId"],
                       "context": copy.deepcopy(body["context"]), "stage": "explain", "stageLabel": "Observe",
                       "content": {"title": "Observation and scale", "body": "Observe the block.",
                                   "prompt": "What do you notice?", "hint": "Compare lengths.", "sources": []},
                       "progress": {"index": 1, "total": 6}, "messages": [], "evidence": []}
            self.sessions[session_id] = session
            response = {"apiVersion": 1, "session": session}
        elif path.startswith("/sessions/") and path.endswith("/actions"):
            session = self.sessions[path.split("/")[2]]
            if "evidence" in body and body["action"] != "submit_practice":
                raise LearningError(400, "Transform evidence is only accepted with practice submission")
            if body["expectedRevision"] != session["revision"]:
                raise LearningError(409, "Session revision changed")
            if body["action"] == "submit_practice":
                session["evidence"].append(copy.deepcopy(body["evidence"]))
            if body.get("message"):
                session["messages"].append(body["message"])
            session["revision"] += 1
            response = {"apiVersion": 1, "session": session}
        elif path.startswith("/sessions/") and path.endswith("/checkpoints"):
            session = self.sessions[path.split("/")[2]]
            if body["expectedRevision"] != session["revision"]:
                raise LearningError(409, "Session revision changed")
            checkpoint = {"id": "checkpoint-" + str(len(self.checkpoints) + 1),
                          "sessionId": session["id"], "revision": session["revision"]}
            self.checkpoints[checkpoint["id"]] = {"apiVersion": 1, "checkpoint": checkpoint,
                                                 "session": copy.deepcopy(session)}
            response = {"apiVersion": 1, "checkpoint": checkpoint}
        elif path.startswith("/checkpoints/") and path.endswith("/restore"):
            checkpoint_id = path.split("/")[2]
            saved = self.checkpoints[checkpoint_id]
            session = copy.deepcopy(saved["session"])
            session["id"] = "session-" + str(len(self.sessions) + 1)
            session["revision"] = 1
            session["restoredFrom"] = {"checkpointId": checkpoint_id,
                                       "sessionId": saved["checkpoint"]["sessionId"],
                                       "revision": saved["checkpoint"]["revision"]}
            self.sessions[session["id"]] = session
            self.restore_count += 1
            response = {"apiVersion": 1, "session": session}
        elif path.startswith("/checkpoints/") and body is None:
            found = self.checkpoints.get(path.split("/")[2])
            if found is None:
                raise LearningError(404, "Checkpoint not found")
            return copy.deepcopy(found)
        else:
            raise AssertionError("Unexpected core call: " + path)
        self.receipts[body["requestId"]] = (path, copy.deepcopy(body), copy.deepcopy(response))
        if path in self.lose_once:
            self.lose_once.remove(path)
            raise LearningError(503, "Response lost after the core committed the action")
        return copy.deepcopy(response)


class LearningAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = [100.0]
        self.core = FakeCore()
        self.bridge = LearningBridge(self.core)
        self.state = State(self.temp.name, clock=lambda: self.now[0], learning=self.bridge)
        self.snap = copy.deepcopy(SNAPSHOT)
        self.exchange()

    def exchange(self, results=None, snap=None):
        return self.state.exchange({"clientId": "runtime-a", "snapshot": self.snap if snap is None else snap,
                                    "results": results or []})

    def start(self, **extra):
        return self.bridge.start(self.state, {"requestId": "start-1", "lessonId": "observation-scale", **extra})

    def save_lesson(self, name="lesson"):
        if self.bridge.session is None:
            self.start()
        self.state.save(name)
        return json.loads(Path(self.temp.name, name + ".json").read_text(encoding="utf-8"))

    def clear_runtime(self):
        self.snap["scene"]["objects"] = []
        self.snap["selection"]["objectId"] = ""
        self.exchange()

    def ack(self, queued, ok=True, snap=None):
        return self.exchange([{"requestId": queued["commands"][0]["requestId"], "ok": ok,
                               "error": "" if ok else "Target unavailable; original objects preserved", "objectId": ""}], snap)

    def assert_rejected(self, action, status=None):
        with self.assertRaises((APIError, LearningError)) as result:
            action()
        if status is not None:
            self.assertEqual(result.exception.status, status)
        return result.exception

    def test_start_binds_actual_selected_block_not_browser_context(self):
        self.start(context={"roomId": "spoofed", "objectId": "other"})
        sent = self.core.calls[-1][1]
        self.assertEqual(sent["context"], {"roomId": "room-a", "anchorId": "table-a", "objectId": "lesson-block",
                                           "baselineScale": POSE["scale"]})
        self.assertEqual(set(sent), {"requestId", "lessonId", "context"})

    def test_start_requires_selected_existing_block_and_scale_headroom(self):
        for mutate in (lambda s: s["selection"].update(objectId=""),
                       lambda s: s["scene"]["objects"][0].update(assetId="orb"),
                       lambda s: s["scene"]["objects"][0]["transform"]["scale"].update(x=11)):
            with self.subTest(mutate=mutate):
                altered = copy.deepcopy(SNAPSHOT)
                mutate(altered)
                self.exchange(snap=altered)
                self.assert_rejected(self.start, 409)
        self.assertEqual(self.core.calls, [])

    def test_start_requires_online_settled_runtime(self):
        self.state.queue([{"op": "get_scene"}])
        self.assert_rejected(self.start, 409)
        self.now[0] += LEASE_SECONDS + 1
        self.assert_rejected(self.start, 409)
        self.assertEqual(self.core.calls, [])

    def test_browser_spoofed_practice_evidence_is_replaced_by_runtime(self):
        self.start()
        self.snap["scene"]["objects"][0]["transform"]["scale"] = {"x": .4, "y": .4, "z": .4}
        self.exchange()
        self.bridge.act(self.state, {"requestId": "act-1", "sessionId": "session-1", "expectedRevision": 1,
                                     "action": "submit_practice", "message": "The side lengths doubled.",
                                     "evidence": {"roomId": "fake", "scale": {"x": 20, "y": 20, "z": 20}},
                                     "transform": "ignored", "stage": "ended"})
        payload = self.core.calls[-1][1]
        self.assertEqual(payload["evidence"], {"roomId": "room-a", "anchorId": "table-a", "objectId": "lesson-block",
                                               "scale": {"x": .4, "y": .4, "z": .4}})
        self.assertEqual(set(payload), {"requestId", "expectedRevision", "action", "message", "evidence"})

    def test_non_practice_actions_do_not_send_transform_evidence(self):
        self.start()
        self.bridge.act(self.state, {"requestId": "act-1", "sessionId": "session-1", "expectedRevision": 1,
                                     "action": "advance", "evidence": {"scale": "spoofed"}})
        self.assertNotIn("evidence", self.core.calls[-1][1])
        self.assertEqual(self.bridge.session["revision"], 2)

    def test_action_rejects_changed_session_room_or_bound_object(self):
        self.start()
        body = {"requestId": "act-1", "sessionId": "session-1", "expectedRevision": 1, "action": "submit_practice"}
        self.assert_rejected(lambda: self.bridge.act(self.state, {**body, "sessionId": "other"}), 409)
        for change in (lambda s: s["scene"].update(roomId="room-b"),
                       lambda s: s["scene"]["objects"][0].update(anchorId="table-b"),
                       lambda s: s["scene"]["objects"][0].update(assetId="orb")):
            with self.subTest(change=change):
                altered = copy.deepcopy(SNAPSHOT)
                change(altered)
                self.exchange(snap=altered)
                self.assert_rejected(lambda: self.bridge.act(self.state, body), 409)
        self.assertEqual(len(self.core.calls), 1)

    def test_save_records_exact_scene_with_matching_canonical_checkpoint(self):
        saved = self.save_lesson()
        self.assertEqual(saved["scene"], self.snap["scene"])
        self.assertEqual(saved["selection"], self.snap["selection"])
        reference = saved["learningCheckpoint"]
        self.assertEqual(reference["apiVersion"], 1)
        checkpoint = reference["checkpoint"]
        self.assertEqual(checkpoint, {"id": "checkpoint-1", "sessionId": "session-1", "revision": 1})
        self.assertEqual(self.core.checkpoints[checkpoint["id"]]["session"]["context"], self.bridge.session["context"])
        self.assertEqual(list(Path(self.temp.name).glob(".saving-*")), [])

    def test_restore_forks_canonical_session_only_after_matching_success_ack(self):
        saved = self.save_lesson()
        self.clear_runtime()
        queued = self.state.load("lesson", "load-1")
        self.assertEqual(queued["commands"][0]["scene"], saved["scene"])
        self.assertEqual(self.core.restore_count, 0)
        self.exchange()
        self.assertEqual(self.core.restore_count, 0)
        self.exchange([{"requestId": "unrelated", "ok": True, "error": "", "objectId": ""}])
        self.assertEqual(self.core.restore_count, 0)
        response = self.ack(queued, snap=SNAPSHOT)
        self.assertEqual(self.core.restore_count, 1)
        self.assertIsNone(self.bridge.restore)
        self.assertEqual(self.bridge.session["id"], "session-2")
        self.assertEqual(response["lesson"]["sessionId"], "session-2")
        self.ack(queued, snap=SNAPSHOT)
        self.assertEqual(self.core.restore_count, 1)

    def test_success_ack_with_changed_snapshot_does_not_fork(self):
        self.save_lesson()
        original_id = self.bridge.session["id"]
        queued = self.state.load("lesson", "load-mismatch")
        altered = copy.deepcopy(SNAPSHOT)
        altered["scene"]["objects"][0]["transform"]["scale"]["x"] *= 1.5
        self.ack(queued, snap=altered)
        self.assertTrue(self.bridge.restore["failed"])
        self.assertEqual(self.core.restore_count, 0)
        self.assertEqual(self.bridge.session["id"], original_id)

    def test_failed_ack_preserves_session_without_canonical_fork(self):
        self.save_lesson()
        queued = self.state.load("lesson", "load-1")
        self.ack(queued, ok=False)
        self.assertEqual(self.core.restore_count, 0)
        self.assertEqual(self.bridge.session["id"], "session-1")
        self.assertTrue(self.bridge.status(self.state)["restoreFailed"])
        self.assert_rejected(lambda: self.bridge.retry_restore(self.state), 409)

    def test_expired_ack_and_late_success_cannot_fork_canonical_session(self):
        self.save_lesson()
        queued = self.state.load("lesson", "load-1")
        self.now[0] += LEASE_SECONDS + 1
        self.ack(queued)
        self.assertEqual(self.core.restore_count, 0)
        self.assertTrue(self.bridge.status(self.state)["restoreFailed"])
        self.assertIn("outcome unknown", self.bridge.restore["error"])

    def test_core_restore_timeout_retries_same_request_without_second_fork(self):
        self.save_lesson()
        queued = self.state.load("lesson", "load-1")
        self.core.lose_once.add("/checkpoints/checkpoint-1/restore")
        self.ack(queued)
        self.assertEqual(self.core.restore_count, 1)
        self.assertIsNotNone(self.bridge.restore)
        self.assertIn("Response lost", self.bridge.restore["error"])
        self.exchange()
        self.assertEqual(len([p for p, _ in self.core.calls if p.endswith("/restore")]), 1)
        self.bridge.retry_restore(self.state)
        restores = [body for path, body in self.core.calls if path.endswith("/restore")]
        self.assertEqual(restores, [{"requestId": "load-1"}, {"requestId": "load-1"}])
        self.assertEqual(self.core.restore_count, 1)
        self.assertEqual(self.bridge.session["id"], "session-2")
        self.assertIsNone(self.bridge.restore)

    def test_pending_restore_blocks_edit_save_start_and_action(self):
        self.save_lesson()
        self.state.load("lesson", "load-1")
        self.assert_rejected(lambda: self.state.queue([{"op": "clear"}]), 409)
        self.assert_rejected(lambda: self.state.save("next"), 409)
        self.assert_rejected(lambda: self.start(requestId="new-start"), 409)
        self.assert_rejected(lambda: self.bridge.act(self.state, {"requestId": "new-action"}), 409)

    def test_start_timeout_retry_uses_original_context_and_same_id(self):
        self.core.lose_once.add("/sessions")
        self.assert_rejected(self.start, 503)
        self.assertIsNone(self.bridge.session)
        self.snap["scene"]["objects"][0]["transform"]["scale"] = {"x": .3, "y": .3, "z": .3}
        self.exchange()
        self.start()
        starts = [body for path, body in self.core.calls if path == "/sessions"]
        self.assertEqual(starts[0], starts[1])
        self.assertEqual(len(self.core.sessions), 1)
        self.assertEqual(self.bridge.session["context"]["baselineScale"], POSE["scale"])

    def test_action_timeout_retry_freezes_original_runtime_evidence(self):
        self.start()
        self.snap["scene"]["objects"][0]["transform"]["scale"] = {"x": .4, "y": .4, "z": .4}
        self.exchange()
        request = {"requestId": "act-1", "sessionId": "session-1", "expectedRevision": 1,
                   "action": "submit_practice", "message": "The lengths doubled."}
        self.core.lose_once.add("/sessions/session-1/actions")
        self.assert_rejected(lambda: self.bridge.act(self.state, request), 503)
        self.snap["scene"]["objects"][0]["transform"]["scale"] = {"x": .5, "y": .5, "z": .5}
        self.exchange()
        self.bridge.act(self.state, request)
        actions = [body for path, body in self.core.calls if path.endswith("/actions")]
        self.assertEqual(actions[0], actions[1])
        self.assertEqual(actions[1]["evidence"]["scale"], {"x": .4, "y": .4, "z": .4})
        self.assertEqual(self.bridge.session["revision"], 2)
        self.assertEqual(len(self.core.sessions["session-1"]["evidence"]), 1)

    def test_repeated_request_id_rejects_changed_browser_payload(self):
        self.start()
        self.assert_rejected(lambda: self.start(lessonId="another-lesson"), 409)
        self.assertEqual(len(self.core.sessions), 1)

    def test_old_start_receipt_replay_does_not_reactivate_previous_session(self):
        original = self.start()
        self.start(requestId="start-2")
        self.assertEqual(self.bridge.session["id"], "session-2")
        replayed = self.start()
        self.assertEqual(replayed, original)
        self.assertEqual(self.bridge.session["id"], "session-2")

    def test_old_action_replay_does_not_replace_restored_session(self):
        self.start()
        request = {"requestId": "act-1", "sessionId": "session-1", "expectedRevision": 1,
                   "action": "advance"}
        original = self.bridge.act(self.state, request)
        self.save_lesson()
        queued = self.state.load("lesson", "load-1")
        self.ack(queued)
        restored_id = self.bridge.session["id"]
        replayed = self.bridge.act(self.state, request)
        self.assertEqual(replayed, original)
        self.assertEqual(self.bridge.session["id"], restored_id)

    def test_same_load_request_returns_original_receipt_without_requeue(self):
        self.save_lesson()
        first = self.state.load("lesson", "load-1")
        self.assertEqual(self.state.load("lesson", "load-1"), first)
        self.assertEqual(len(self.state.pending), 1)
        self.ack(first)
        self.assertEqual(self.state.load("lesson", "load-1"), first)
        self.assertEqual(len(self.state.pending), 0)
        self.assertEqual(self.core.restore_count, 1)

    def test_load_request_id_cannot_be_reused_for_another_save(self):
        self.save_lesson("one")
        self.save_lesson("two")
        self.state.load("one", "load-1")
        self.assert_rejected(lambda: self.state.load("two", "load-1"), 409)
        self.assertEqual(len(self.state.pending), 1)

    def test_plain_scene_save_and_restore_do_not_require_core(self):
        self.core.unavailable = True
        self.state.save("plain")
        saved = json.loads(Path(self.temp.name, "plain.json").read_text())
        self.assertNotIn("learningCheckpoint", saved)
        queued = self.state.load("plain", "load-plain")
        self.ack(queued)
        self.assertEqual(self.core.calls, [])
        self.assertIsNone(self.bridge.session)
        self.assertIsNone(self.bridge.restore)

    def test_plain_scene_clears_active_lesson_only_after_ack(self):
        Path(self.temp.name, "old.json").write_text(json.dumps(SNAPSHOT), encoding="utf-8")
        self.start()
        self.core.unavailable = True
        queued = self.state.load("old", "load-old")
        self.assertIsNotNone(self.bridge.session)
        response = self.ack(queued)
        self.assertIsNone(self.bridge.session)
        self.assertNotIn("lesson", response)
        self.assertEqual(len(self.core.calls), 1)

    def test_missing_core_save_preserves_existing_file_and_latest_runtime(self):
        self.save_lesson()
        path = Path(self.temp.name, "lesson.json")
        original = path.read_bytes()
        self.core.unavailable = True
        self.assert_rejected(lambda: self.state.save("lesson"), 503)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(self.state.latest["scene"], SNAPSHOT["scene"])
        self.assertEqual(len(self.state.pending), 0)

    def test_missing_core_load_fails_before_runtime_queue(self):
        self.save_lesson()
        self.core.unavailable = True
        self.assert_rejected(lambda: self.state.load("lesson", "load-1"), 503)
        self.assertEqual(len(self.state.pending), 0)
        self.assertIsNone(self.bridge.restore)
        self.assertEqual(self.core.restore_count, 0)

    def test_learning_save_cannot_be_loaded_without_adapter(self):
        self.save_lesson()
        plain_state = State(self.temp.name, clock=lambda: self.now[0])
        plain_state.exchange({"clientId": "runtime-b", "snapshot": SNAPSHOT})
        self.assert_rejected(lambda: plain_state.load("lesson"), 503)
        self.assertEqual(len(plain_state.pending), 0)

    def test_malformed_checkpoint_metadata_rejected_before_queue(self):
        valid = self.save_lesson()
        for reference in ([], "not-a-reference", {}, {"apiVersion": 2, "checkpoint": {}},
                          {"apiVersion": 1, "checkpoint": []},
                          {"apiVersion": 1, "checkpoint": {"id": "../escape"}},
                          {"apiVersion": 1, "checkpoint": {"id": "checkpoint-1", "sessionId": "wrong", "revision": 1}}):
            with self.subTest(reference=reference):
                altered = copy.deepcopy(valid)
                altered["learningCheckpoint"] = reference
                Path(self.temp.name, "bad.json").write_text(json.dumps(altered), encoding="utf-8")
                self.assert_rejected(lambda: self.state.load("bad", "load-bad"))
                self.assertEqual(len(self.state.pending), 0)
                self.assertIsNone(self.bridge.restore)

    def test_checkpoint_saved_scene_must_match_bound_room_anchor_asset_and_object(self):
        valid = self.save_lesson()
        for change in (lambda s: s["scene"].update(roomId="room-b"),
                       lambda s: s["scene"]["objects"][0].update(anchorId="table-b"),
                       lambda s: s["scene"]["objects"][0].update(assetId="orb"),
                       lambda s: s["scene"]["objects"][0].update(objectId="other-block")):
            with self.subTest(change=change):
                altered = copy.deepcopy(valid)
                altered.pop("selection", None)
                change(altered)
                Path(self.temp.name, "bad.json").write_text(json.dumps(altered), encoding="utf-8")
                self.assert_rejected(lambda: self.state.load("bad", "load-bad"), 409)
                self.assertEqual(len(self.state.pending), 0)
                self.assertEqual(self.core.restore_count, 0)


if __name__ == "__main__":
    unittest.main()
