"""Explicit session rollover preserves prior native history and current policy."""
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from agent_portal import AgentPortal, AgentPortalError
from server import State, Server, agent_concept_create, agent_portal_action
from test_browser_permissions import PermissionBackend


class FreshBackend(PermissionBackend):
    def __init__(self, persisted, mode="reviewed", *, fail_new=False, fail_resume=False):
        super().__init__(persisted, mode)
        self.fail_new = fail_new
        self.fail_resume = fail_resume

    def start_conversation(self):
        if self.fail_new:
            raise RuntimeError("private new-thread failure")
        self.start_calls += 1
        return "native-thread-id" if self.start_calls == 1 else f"fresh-thread-{self.start_calls}"

    def resume_conversation(self, identifier):
        if self.fail_resume:
            raise RuntimeError("thread already has an active writer")
        return super().resume_conversation(identifier)


class NewConversationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.persisted = [False]
        self.backend = FreshBackend(self.persisted)
        self.created = []
        self.portal = AgentPortal(self.temp.name, lambda: self.backend,
                                  permissions_factory=self.factory)
        self.addCleanup(self.portal.close)
        self.session = self.portal.open()["sessionId"]

    def factory(self, mode):
        backend = FreshBackend(self.persisted, mode)
        # Each new process still returns a distinct new native thread in this fake.
        backend.start_calls = 10
        self.created.append(backend)
        return backend

    def finish_old_turn(self):
        started = self.portal.send_text(self.session, "Keep the previous history")
        approval = self.portal.status(self.session)["pendingApprovals"][0]
        self.portal.decide(self.session, approval["approvalId"], started["turnId"], True)
        return self.portal.status(self.session)

    def archive(self):
        paths = list((Path(self.temp.name) / "history").glob("*.json"))
        self.assertEqual(len(paths), 1)
        return json.loads(paths[0].read_text(encoding="utf-8"))

    def test_new_thread_archives_prior_history_rotates_session_and_resets_events(self):
        before = self.finish_old_turn()
        self.portal._native_turns.append("previous-image")
        self.portal._reviewed_approvals.add(("old-review",))
        changed = self.portal.new_conversation(self.session)
        self.assertNotEqual(changed["sessionId"], self.session)
        self.assertEqual(changed["transcript"], [])
        self.assertEqual(changed["events"], [])
        self.assertEqual(changed["cursor"], 0)
        self.assertIsNone(changed["activeTurnId"])
        self.assertEqual(changed["pendingApprovals"], [])
        self.assertEqual(changed["activity"], "idle")
        self.assertEqual(changed["approvalMode"], "reviewed")
        self.assertIs(self.portal._backend, self.backend)
        self.assertFalse(self.backend.closed)
        self.assertEqual(self.backend.start_calls, 1)
        self.assertEqual(len(self.backend.sent_texts), 1)  # No new model turn.
        self.assertIsNone(self.portal._conversation_id)
        self.assertFalse(self.portal._native_turns)
        self.assertFalse(self.portal._reviewed_approvals)
        saved = self.archive()
        self.assertEqual(saved["sessionId"], self.session)
        self.assertEqual(saved["conversationId"], "native-thread-id")
        self.assertEqual(saved["transcript"], before["transcript"])
        self.assertEqual(saved["eventSequence"], before["cursor"])
        with self.assertRaises(AgentPortalError) as error:
            self.portal.send_text(self.session, "Stale browser input")
        self.assertEqual(error.exception.status, 404)
        reopened = self.portal.open()
        self.assertEqual(reopened["sessionId"], changed["sessionId"])
        self.assertEqual(self.backend.start_calls, 1)
        self.portal.send_text(changed["sessionId"], "First message in new context")
        self.assertEqual(self.backend.start_calls, 2)
        self.assertEqual(self.portal._conversation_id, "fresh-thread-2")

    def test_current_full_access_is_preserved(self):
        self.finish_old_turn()
        self.portal.change_permissions(self.session, "full-access", True)
        full = self.portal._backend
        changed = self.portal.new_conversation(self.session)
        self.assertIs(self.portal._backend, full)
        self.assertEqual((changed["accessMode"], changed["approvalMode"]),
                         ("danger-full-access", "automatic"))
        self.assertEqual(self.portal._permissions_mode, "full-access")
        self.assertEqual(full.sent_texts, [])

    def test_pc_archive_restore_recovers_previous_session_transcript_and_native_id(self):
        before = self.finish_old_turn()
        self.portal.new_conversation(self.session)
        archive = next((Path(self.temp.name) / "history").glob("*.json"))
        self.portal.close()  # Restore is a stopped-service PC operation.
        self.portal.path.write_bytes(archive.read_bytes())
        backend = FreshBackend(self.persisted)
        restored = AgentPortal(self.temp.name, lambda: backend)
        self.addCleanup(restored.close)
        snapshot = restored.open()
        self.assertEqual(snapshot["sessionId"], self.session)
        self.assertEqual(snapshot["transcript"], before["transcript"])
        self.assertEqual(restored._conversation_id, "native-thread-id")
        self.assertEqual(backend.resume_calls, ["native-thread-id"])
        self.assertEqual(backend.start_calls, 0)

    def test_active_starting_stopping_and_pending_approval_block_rollover(self):
        for key, value in (("_starting_turn", True), ("_native_starting", True),
                           ("_stopping_turn", "stopping")):
            with self.subTest(key=key):
                previous = getattr(self.portal, key)
                setattr(self.portal, key, value)
                with self.assertRaises(AgentPortalError) as error:
                    self.portal.new_conversation(self.session)
                self.assertEqual(error.exception.status, 409)
                setattr(self.portal, key, previous)
        self.backend.approval = {"approvalId": 123}
        with self.assertRaises(AgentPortalError) as error:
            self.portal.new_conversation(self.session)
        self.assertEqual(error.exception.status, 409)
        self.backend.approval = None
        self.portal.send_text(self.session, "Keep running")
        with self.assertRaises(AgentPortalError) as error:
            self.portal.new_conversation(self.session)
        self.assertEqual(error.exception.status, 409)
        self.assertFalse((Path(self.temp.name) / "history").exists())

    def test_unavailable_previous_writer_can_be_left_without_resuming_it(self):
        before = self.finish_old_turn()
        self.portal.change_permissions(self.session, "full-access", True)
        self.portal._backend.close()
        self.portal._backend = None
        with patch.object(FreshBackend, "resume_conversation", side_effect=AssertionError("Do not resume old thread")):
            changed = self.portal.new_conversation(self.session)
        self.assertEqual(changed["approvalMode"], "automatic")
        self.assertEqual(self.portal._backend.sent_texts, [])
        self.assertEqual(self.archive()["transcript"], before["transcript"])

    def test_saved_previous_writer_failure_does_not_prevent_explicit_new_session(self):
        before = self.finish_old_turn()
        self.portal.close()
        attempts = []
        def factory():
            recovered = FreshBackend(self.persisted, fail_resume=True)
            recovered.start_calls = 10
            attempts.append(recovered)
            return recovered
        restarted = AgentPortal(self.temp.name, factory)
        self.addCleanup(restarted.close)
        with self.assertRaisesRegex(AgentPortalError, "could not be resumed"):
            restarted.open()
        changed = restarted.new_conversation(self.session)
        self.assertEqual(len(attempts), 2)
        self.assertTrue(attempts[0].closed)
        self.assertEqual(changed["transcript"], [])
        self.assertEqual(attempts[1].resume_calls, [])
        self.assertNotEqual(changed["sessionId"], self.session)
        self.assertEqual(self.archive()["transcript"], before["transcript"])

    def test_archive_failure_retains_old_session_and_starts_no_native_thread(self):
        before = self.finish_old_turn()
        calls = self.backend.start_calls
        replace = os.replace
        def fail_archive(source, destination):
            if Path(destination).parent.name == "history":
                raise OSError("archive disk failure")
            return replace(source, destination)
        with patch("agent_portal.os.replace", side_effect=fail_archive):
            with self.assertRaises(AgentPortalError) as error:
                self.portal.new_conversation(self.session)
        self.assertEqual(error.exception.status, 507)
        self.assertEqual(self.portal.status(self.session)["transcript"], before["transcript"])
        self.assertEqual(self.backend.start_calls, calls)

    def test_two_requests_for_same_session_cannot_create_two_conversations(self):
        self.finish_old_turn()
        results = []
        ready = threading.Barrier(3)
        def rollover():
            ready.wait()
            try:
                results.append(self.portal.new_conversation(self.session)["sessionId"])
            except AgentPortalError as error:
                results.append(error.status)
        workers = [threading.Thread(target=rollover) for _ in range(2)]
        for worker in workers:
            worker.start()
        ready.wait()
        for worker in workers:
            worker.join(2)
        self.assertEqual(sum(isinstance(value, str) for value in results), 1)
        self.assertIn(404, results)
        self.assertEqual(self.backend.start_calls, 1)
        self.assertEqual(self.archive()["sessionId"], self.session)

    def test_new_backend_failure_keeps_prior_mapping_and_archive(self):
        before = self.finish_old_turn()
        original = self.portal.path.read_bytes()
        self.portal._backend = None
        failing = FreshBackend(self.persisted)
        failing.failure = "start"
        with patch.object(self.portal, "_create_selected_backend", return_value=failing):
            with self.assertRaisesRegex(AgentPortalError, "previous history is preserved"):
                self.portal.new_conversation(self.session)
        self.assertTrue(failing.closed)
        self.portal._backend = self.backend
        self.assertEqual(self.portal.path.read_bytes(), original)
        self.assertEqual(self.portal.status(self.session)["transcript"], before["transcript"])
        self.assertEqual(self.archive()["conversationId"], "native-thread-id")

    def test_new_context_can_switch_permissions_before_first_message(self):
        self.finish_old_turn()
        changed = self.portal.new_conversation(self.session)
        with patch.object(FreshBackend, "resume_conversation", side_effect=AssertionError("No provisional thread resume")):
            full = self.portal.change_permissions(changed["sessionId"], "full-access", True)
            reviewed = self.portal.change_permissions(changed["sessionId"], "reviewed", False)
        self.assertEqual(full["approvalMode"], "automatic")
        self.assertEqual(reviewed["approvalMode"], "reviewed")
        self.assertEqual(reviewed["sessionId"], changed["sessionId"])
        self.assertIsNone(self.portal._conversation_id)
        self.assertEqual(reviewed["transcript"], [])

    def test_new_mapping_save_failure_restores_prior_mapping_in_memory_and_on_disk(self):
        before = self.finish_old_turn()
        original = self.portal.path.read_bytes()
        persist = self.portal._persist
        def fail_new_save():
            if self.portal._session_id != self.session:
                raise AgentPortalError(507, "injected new mapping failure")
            persist()
        with patch.object(self.portal, "_persist", side_effect=fail_new_save):
            with self.assertRaises(AgentPortalError):
                self.portal.new_conversation(self.session)
        self.assertEqual(self.portal.path.read_bytes(), original)
        self.assertEqual(self.portal.status(self.session)["transcript"], before["transcript"])
        self.assertIs(self.portal._backend, self.backend)
        self.assertFalse(self.backend.closed)
        self.assertEqual(self.archive()["sessionId"], self.session)


class NewConversationHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = State(self.temp.name)
        self.backend = FreshBackend([False])
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / "portal", lambda: self.backend)
        self.session = self.state.agent_portal.open()["sessionId"]
        self.token = "operator-012345678901234567890123"
        self.viewer = "viewer-01234567890123456789012345"
        self.server = Server(("127.0.0.1", 0), self.state, self.token, self.viewer)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, body, *, origin="same", token="operator"):
        headers = {"Content-Type": "application/json"}
        if origin is not None:
            headers["Origin"] = self.url if origin == "same" else origin
        if token is not None:
            headers["Authorization"] = "Bearer " + (self.token if token == "operator" else self.viewer)
        request = urllib.request.Request(self.url + "/api/agent/new-conversation",
                                         data=json.dumps(body).encode(), headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_owner_origin_exact_body_and_stale_session(self):
        body = {"sessionId": self.session}
        self.assertEqual(self.post(body, token=None)[0], 401)
        self.assertEqual(self.post(body, token="viewer")[0], 401)
        self.assertEqual(self.post(body, origin=None)[0], 403)
        self.assertEqual(self.post(body, origin="https://elsewhere.example")[0], 403)
        self.assertEqual(self.post({**body, "resetWorld": True})[0], 400)
        self.assertEqual(self.post({"sessionId": "wrong"})[0], 404)
        status, changed = self.post(body)
        self.assertEqual(status, 200)
        self.assertNotEqual(changed["sessionId"], self.session)
        self.assertEqual(changed["cursor"], 0)
        self.assertEqual(changed["transcript"], [])
        self.assertNotIn("native-thread", json.dumps(changed))
        self.assertEqual(self.post(body)[0], 404)

    def test_turn_admission_and_all_pending_owned_jobs_block_new_conversation(self):
        body = {"sessionId": self.session}
        with self.state.agent_turn_submission_lock:
            self.assertEqual(self.post(body)[0], 409)
        for provider in ("codex-native", "comfyui"):
            for purpose in ("concept", "panorama"):
                for status in ("queued", "generating"):
                    with self.subTest(provider=provider, purpose=purpose, status=status):
                        self.state.concepts.data["sessions"][self.session] = {"jobs": [
                            {"providerId": provider, "purpose": purpose, "status": status}], "builds": []}
                        self.assertEqual(self.post(body)[0], 409)
        self.state.concepts.data["sessions"][self.session] = {"jobs": [], "builds": [{"status": "requested"}]}
        self.assertEqual(self.post(body)[0], 409)
        self.assertEqual(self.backend.start_calls, 0)
        self.state.concepts.data["sessions"][self.session] = {"jobs": [{"status": "ready"}], "builds": [{"status": "completed"}]}
        self.assertEqual(self.post(body)[0], 200)

    def test_image_request_cannot_reserve_old_session_after_rollover(self):
        entered, release = threading.Event(), threading.Event()
        failures = []
        def reserve_after_wait(session_id, prompt, **kwargs):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("test reservation timed out")
            self.state.concepts.data["sessions"][session_id] = {
                "jobs": [{"providerId": "comfyui", "status": "queued"}], "builds": []}
            return {"job": {"status": "queued"}}
        def submit():
            try:
                agent_concept_create(self.state, {"sessionId": self.session, "prompt": "Pending image"})
            except Exception as error:
                failures.append(error)
        with patch.object(self.state.concepts, "create", side_effect=reserve_after_wait):
            worker = threading.Thread(target=submit)
            worker.start()
            self.assertTrue(entered.wait(2))
            try:
                self.assertEqual(self.post({"sessionId": self.session})[0], 409)
            finally:
                release.set()
                worker.join(3)
        self.assertEqual(failures, [])
        self.assertEqual(self.post({"sessionId": self.session})[0], 409)
        self.assertEqual(self.backend.start_calls, 0)
        self.state.concepts.data["sessions"][self.session]["jobs"][0]["status"] = "ready"
        self.assertEqual(self.post({"sessionId": self.session})[0], 200)
        with patch.object(self.state.concepts, "create") as create:
            with self.assertRaises(AgentPortalError) as error:
                agent_concept_create(self.state, {"sessionId": self.session, "prompt": "Stale image request"})
            self.assertEqual(error.exception.status, 404)
            create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
