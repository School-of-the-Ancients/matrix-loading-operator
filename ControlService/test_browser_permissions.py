"""Browser access choices replace transport policy without replacing the conversation."""
import json
from pathlib import Path
import tempfile
import sys
import textwrap
import threading
import time
from types import SimpleNamespace
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from agent_portal import AgentPortal, AgentPortalError
from agent_session import LocalCodexAgentBackend
from codex_app_server import AppServerError, AppServerTransport
from codex_provider import CodexConfig
from server import Server, State, agent_portal_action, local_agent_backend
from test_agent_portal import FakeBackend, PCBackend, PCInput, PCOutput
from test_codex_app_server import FAKE_SERVER


class PermissionBackend(FakeBackend):
    def __init__(self, persisted, mode="reviewed", failure=None):
        super().__init__(persisted)
        self.access_mode = "danger-full-access" if mode == "full-access" else "workspace-write"
        self.approval_mode = "automatic" if mode == "full-access" else "reviewed"
        self.failure = failure

    def start(self):
        if self.failure == "start":
            raise RuntimeError("private startup detail")

    def resume_conversation(self, identifier):
        if self.failure == "resume":
            raise RuntimeError("private resume detail")
        if self.failure == "identity":
            return "different-native-thread"
        return super().resume_conversation(identifier)

    def start_native_image(self, identifier, text):
        return "native-image-turn"


class BrowserPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.persisted = [False]
        self.backends = []
        self.failure = None
        self.portal = AgentPortal(self.temp.name, self.initial, permissions_factory=self.factory)
        self.addCleanup(self.portal.close)
        self.session = self.portal.open()["sessionId"]

    def initial(self):
        return self.factory("reviewed")

    def factory(self, mode):
        if self.failure == "factory":
            raise RuntimeError("private factory detail")
        backend = PermissionBackend(self.persisted, "reviewed" if self.failure == "mode" else mode,
                                    self.failure)
        self.backends.append(backend)
        return backend

    def complete_turn(self):
        sent = self.portal.send_text(self.session, "Keep this conversation")
        approval = self.portal.status(self.session)["pendingApprovals"][0]
        self.portal.decide(self.session, approval["approvalId"], sent["turnId"], True)
        return self.portal.status(self.session)

    def test_switch_resume_reconnect_revert_preserves_transcript_and_next_events(self):
        before = self.complete_turn()
        old = self.backends[-1]
        self.portal._native_capability = (True, None)
        self.portal._reviewed_approvals.add(("old",))
        changed = self.portal.change_permissions(self.session, "full-access", True)
        full = self.backends[-1]
        self.assertEqual((changed["accessMode"], changed["approvalMode"]),
                         ("danger-full-access", "automatic"))
        self.assertEqual(changed["transcript"], before["transcript"])
        self.assertEqual(changed["sessionId"], self.session)
        self.assertEqual(full.resume_calls, ["native-thread-id"])
        self.assertEqual(full.start_calls, 0)
        self.assertTrue(old.closed)
        self.assertEqual(self.portal._backend_cursor, 0)
        self.assertIsNone(self.portal._native_capability)
        self.assertFalse(self.portal._reviewed_approvals)
        self.assertTrue(changed["permissionsChangeAllowed"])
        self.assertEqual(self.portal.open()["approvalMode"], "automatic")
        self.assertEqual(len(self.backends), 2)
        with self.portal.lock:
            full.close()
            self.portal._backend = None
        self.assertEqual(self.portal.open()["approvalMode"], "automatic")
        self.assertEqual(self.backends[-1].resume_calls, ["native-thread-id"])
        self.complete_turn()
        reviewed = self.portal.change_permissions(self.session, "reviewed", False)
        self.assertEqual((reviewed["accessMode"], reviewed["approvalMode"]),
                         ("workspace-write", "reviewed"))
        self.assertEqual(len(reviewed["transcript"]), 2)
        saved = json.loads(self.portal.path.read_text(encoding="utf-8"))
        self.assertNotIn("permissionsMode", saved)
        self.assertNotIn("approvalMode", saved)

    def test_service_restart_restores_startup_policy_and_same_conversation(self):
        before = self.complete_turn()
        self.portal.change_permissions(self.session, "full-access", True)
        self.portal.close()
        restarted = AgentPortal(self.temp.name, self.initial, permissions_factory=self.factory)
        self.addCleanup(restarted.close)
        snapshot = restarted.open()
        self.assertEqual(snapshot["approvalMode"], "reviewed")
        self.assertEqual(snapshot["sessionId"], self.session)
        self.assertEqual(snapshot["transcript"], before["transcript"])
        self.assertEqual(self.backends[-1].resume_calls, ["native-thread-id"])

    def test_empty_session_switch_does_not_start_a_provisional_conversation(self):
        self.portal.change_permissions(self.session, "full-access", True)
        self.assertEqual(self.backends[-1].start_calls, 0)
        self.assertEqual(self.backends[-1].resume_calls, [])
        self.portal.send_text(self.session, "First turn")
        self.assertEqual(self.backends[-1].start_calls, 1)

    def test_strict_confirmation_and_modes(self):
        for mode, confirmation in (("full-access", False), ("full-access", 1),
                                   ("full-access", "true"), ("full-access", None),
                                   ("reviewed", 0), ("danger-full-access", True), (None, True)):
            with self.subTest(mode=mode, confirmation=confirmation):
                with self.assertRaises(AgentPortalError) as error:
                    self.portal.change_permissions(self.session, mode, confirmation)
                self.assertEqual(error.exception.status, 400)
                self.assertEqual(len(self.backends), 1)
        with self.assertRaises(AgentPortalError) as error:
            self.portal.change_permissions("wrong-session", "full-access", True)
        self.assertEqual(error.exception.status, 404)

    def test_active_native_starting_stopping_and_orphan_approval_rejected(self):
        for attribute, value in (("_starting_turn", True), ("_native_starting", True),
                                 ("_stopping_turn", "stopping")):
            with self.subTest(attribute=attribute), self.portal.lock:
                previous = getattr(self.portal, attribute)
                setattr(self.portal, attribute, value)
                self.assertFalse(self.portal.status(self.session)["permissionsChangeAllowed"])
                with self.assertRaises(AgentPortalError) as error:
                    self.portal.change_permissions(self.session, "full-access", True)
                self.assertEqual(error.exception.status, 409)
                setattr(self.portal, attribute, previous)
        self.backends[-1].approval = {"approvalId": 9}
        with self.assertRaises(AgentPortalError) as error:
            self.portal.change_permissions(self.session, "full-access", True)
        self.assertEqual(error.exception.status, 409)
        self.backends[-1].approval = None
        sent = self.portal.send_text(self.session, "Wait for approval")
        with self.assertRaises(AgentPortalError) as error:
            self.portal.change_permissions(self.session, "full-access", True)
        self.assertEqual(error.exception.status, 409)
        self.assertFalse(self.portal.status(self.session)["permissionsChangeAllowed"])
        self.portal.cancel(self.session, sent["turnId"])
        self.portal.status(self.session)
        self.portal.send_text(self.session, "Image", native_image=True)
        with self.assertRaises(AgentPortalError) as error:
            self.portal.change_permissions(self.session, "full-access", True)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(len(self.backends), 1)

    def test_failed_candidate_keeps_previous_backend_usable_and_mode_unchanged(self):
        before = self.complete_turn()
        original = self.portal._backend
        for failure in ("factory", "start", "resume", "identity", "mode"):
            with self.subTest(failure=failure):
                self.failure = failure
                with self.assertRaises(AgentPortalError) as error:
                    self.portal.change_permissions(self.session, "full-access", True)
                self.assertEqual(error.exception.status, 503)
                self.assertNotIn("private", str(error.exception))
                self.assertIs(self.portal._backend, original)
                self.assertFalse(original.closed)
                self.assertEqual(self.portal.status(self.session)["approvalMode"], "reviewed")
                self.assertEqual(self.portal.status(self.session)["transcript"], before["transcript"])
                if failure != "factory":
                    self.assertTrue(self.backends[-1].closed)
        self.failure = None
        self.complete_turn()

    def test_no_argument_factory_remains_compatible_and_marks_change_unsupported(self):
        with tempfile.TemporaryDirectory() as directory:
            portal = AgentPortal(directory, lambda: PermissionBackend([False]))
            self.addCleanup(portal.close)
            snapshot = portal.open()
            self.assertFalse(snapshot["permissionsChangeAllowed"])
            with self.assertRaises(AgentPortalError) as error:
                portal.change_permissions(snapshot["sessionId"], "full-access", True)
            self.assertEqual(error.exception.status, 409)

    def test_old_pc_reader_cannot_approve_after_backend_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            old = PCBackend(self.persisted)
            pc_input, pc_output = PCInput(), PCOutput()
            portal = AgentPortal(directory, lambda: old, permissions_factory=self.factory,
                                 pc_input=pc_input, pc_output=pc_output)
            self.addCleanup(lambda: pc_input.lines.put("\n"))
            self.addCleanup(portal.close)
            session = portal.open()["sessionId"]
            sent = portal.send_text(session, "Need PC approval")
            self.assertTrue(pc_output.prompted.wait(2))
            portal.cancel(session, sent["turnId"])
            portal.status(session)
            portal.change_permissions(session, "full-access", True)
            portal.send_text(session, "Another turn reuses test IDs")
            pc_input.lines.put("approve\n")
            time.sleep(0.15)
            self.assertEqual(old.decisions, [])
            self.assertIsNotNone(self.backends[-1].approval)

    def test_stop_without_request_resolved_allows_switch_after_terminal_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "fake_server.py"
            script.write_text(textwrap.dedent(FAKE_SERVER), encoding="utf-8")
            transport = AppServerTransport([sys.executable, "-u", str(script)], directory, timeout=2)
            backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
            backend.config = CodexConfig("unused.exe")
            backend.enabled_matrix_tools = ()
            backend.transport = transport
            portal = AgentPortal(Path(directory) / "portal", lambda: backend,
                                 permissions_factory=lambda mode: PermissionBackend([True], mode))
            self.addCleanup(portal.close)
            session = portal.open()["sessionId"]
            sent = portal.send_text(session, "Wait for permission")
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if portal.status(session)["pendingApprovals"]:
                    break
                time.sleep(0.01)
            self.assertFalse(portal.status(session)["permissionsChangeAllowed"])
            self.assertEqual(len(transport.pending_approvals()), 1)
            portal.cancel(session, sent["turnId"])
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                status = portal.status(session)
                if status["activeTurnId"] is None:
                    break
                time.sleep(0.01)
            self.assertEqual(status["activity"], "cancelled")
            self.assertIsNone(status["activeTurnId"])
            self.assertTrue(status["permissionsChangeAllowed"])
            self.assertEqual(status["pendingApprovals"], [])
            self.assertEqual(transport.pending_approvals(), [])
            self.assertNotIn("serverRequest/resolved", [event["method"] for event in transport.events_since()])
            with self.assertRaisesRegex(AppServerError, "no longer pending"):
                transport.respond_approval(901, "thread-test", sent["turnId"], "accept")
            changed = portal.change_permissions(session, "full-access", True)
            self.assertEqual(changed["approvalMode"], "automatic")
            self.assertEqual(changed["transcript"], status["transcript"])


class BrowserPermissionsHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = State(self.temp.name)
        self.persisted = [False]
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / "portal",
            lambda: PermissionBackend(self.persisted),
            permissions_factory=lambda mode: PermissionBackend(self.persisted, mode))
        self.token = "operator-012345678901234567890123"
        self.viewer = "viewer-01234567890123456789012345"
        self.server = Server(("127.0.0.1", 0), self.state, self.token, self.viewer)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.session = self.state.agent_portal.open()["sessionId"]

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
        request = urllib.request.Request(self.url + "/api/agent/permissions",
                                         data=json.dumps(body).encode(), headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_auth_same_origin_exact_body_and_confirm(self):
        body = {"sessionId": self.session, "mode": "full-access", "confirmed": True}
        self.assertEqual(self.post(body, token=None)[0], 401)
        self.assertEqual(self.post(body, token="viewer")[0], 401)
        self.assertEqual(self.post(body, origin=None)[0], 403)
        self.assertEqual(self.post(body, origin="null")[0], 403)
        self.assertEqual(self.post(body, origin="https://other.example")[0], 403)
        self.assertEqual(self.post({**body, "extra": "not allowed"})[0], 400)
        self.assertEqual(self.post({**body, "confirmed": 1})[0], 400)
        code, snapshot = self.post(body)
        self.assertEqual(code, 200)
        self.assertEqual(snapshot["approvalMode"], "automatic")
        self.assertIn("transcript", snapshot)
        self.assertTrue(snapshot["permissionsChangeAllowed"])
        self.assertNotIn("nativeParams", json.dumps(snapshot))
        self.assertNotIn(self.token, json.dumps(snapshot))
        self.assertEqual(self.post({**body, "mode": "reviewed", "confirmed": False})[0], 200)

    def test_permissions_and_turn_share_admission_lock(self):
        body = {"sessionId": self.session, "mode": "full-access", "confirmed": True}
        with self.state.agent_turn_submission_lock:
            self.assertEqual(self.post(body)[0], 409)
        old_factory = self.state.agent_portal.permissions_factory
        entered, release = threading.Event(), threading.Event()
        errors = []
        def slow_factory(mode):
            entered.set()
            release.wait(2)
            return old_factory(mode)
        self.state.agent_portal.permissions_factory = slow_factory
        def change():
            try:
                agent_portal_action(self.state, "/api/agent/permissions", body)
            except Exception as error:
                errors.append(error)
        worker = threading.Thread(target=change)
        worker.start()
        self.assertTrue(entered.wait(2))
        try:
            with patch("server.agent_portal_turn") as turn:
                with self.assertRaises(AgentPortalError) as error:
                    agent_portal_action(self.state, "/api/agent/turn", {"sessionId": self.session, "text": "Race"})
                self.assertEqual(error.exception.status, 409)
                turn.assert_not_called()
        finally:
            release.set()
            worker.join(3)
        self.assertEqual(errors, [])


class LocalPermissionsConfigTests(unittest.TestCase):
    def test_config_is_service_local_and_reviewed_restores_original_sandbox(self):
        for sandbox, policy, restored in (("read-only", "on-request", "read-only"),
                                         ("workspace-write", "on-request", "workspace-write"),
                                         ("danger-full-access", "never", "workspace-write")):
            with self.subTest(sandbox=sandbox), tempfile.TemporaryDirectory() as directory:
                original = CodexConfig("test.exe", agent_sandbox=sandbox, agent_approval_policy=policy)
                state = SimpleNamespace(agent_startup_config=None, matrix_tool_bridge=object(),
                                        agent_portal=SimpleNamespace(directory=Path(directory)))
                with patch("server.CodexConfig.from_environment", return_value=original) as read, \
                        patch.object(CodexConfig, "validate"), \
                        patch("server.LocalCodexAgentBackend") as backend:
                    local_agent_backend(state)
                    local_agent_backend(state, "full-access")
                    full = backend.call_args.args[0]
                    self.assertEqual((full.agent_sandbox, full.agent_approval_policy),
                                     ("danger-full-access", "never"))
                    local_agent_backend(state, "reviewed")
                    reviewed = backend.call_args.args[0]
                    self.assertEqual((reviewed.agent_sandbox, reviewed.agent_approval_policy),
                                     (restored, "on-request"))
                    self.assertIs(state.agent_startup_config, original)
                    read.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
