"""Durable Matrix-to-agent session mapping, without starting real Codex."""
import io
import json
import queue
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from agent_portal import AgentPortal, AgentPortalError, MAX_STORE


class FakeBackend:
    access_mode = "workspace-write"
    approval_mode = "reviewed"

    def __init__(self, persisted):
        self.persisted = persisted
        self.events = []
        self.turn_number = 0
        self.approval = None
        self.closed = False
        self.resume_calls = []
        self.start_calls = 0
        self.sent_texts = []

    def start(self):
        pass

    def start_conversation(self):
        self.start_calls += 1
        return "native-thread-id"

    def resume_conversation(self, identifier):
        self.resume_calls.append(identifier)
        if not self.persisted[0]:
            raise RuntimeError("no rollout found")
        return identifier

    def send_text(self, identifier, text):
        self.sent_texts.append(text)
        self.turn_number += 1
        self.approval = {"approvalId": 100 + self.turn_number, "conversationId": identifier,
                         "turnId": f"native-turn-{self.turn_number}", "action": "running_command",
                         "summary": "Create one new test file in the Matrix repository.",
                         "reviewable": True}
        self.events.append({"sequence": len(self.events) + 1, "type": "approval",
                            "conversationId": identifier,
                            "turnId": self.approval["turnId"],
                            "approvalId": self.approval["approvalId"],
                            "activity": "waiting_for_approval", "action": "running_command"})
        self.events.append({"sequence": len(self.events) + 1, "type": "text",
                            "conversationId": "foreign-thread", "turnId": self.approval["turnId"],
                            "text": "FOREIGN SECRET"})
        return self.approval["turnId"]

    def poll(self, cursor):
        return len(self.events), [item for item in self.events if item["sequence"] > cursor]

    def pending_approvals(self):
        return [self.approval] if self.approval else []

    def pending_pc_commands(self):
        return []

    def decide(self, approval_id, conversation_id, turn_id, approve):
        assert self.approval["approvalId"] == approval_id
        assert conversation_id == "native-thread-id"
        assert self.approval["turnId"] == turn_id
        self.approval = None
        self.events.append({"sequence": len(self.events) + 1, "type": "text",
                            "conversationId": conversation_id,
                            "turnId": turn_id, "text": "Done."})
        self.events.append({"sequence": len(self.events) + 1, "type": "activity",
                            "conversationId": conversation_id,
                            "turnId": turn_id, "activity": "completed"})
        self.persisted[0] = True

    def cancel(self, conversation_id, turn_id):
        self.approval = None
        self.events.append({"sequence": len(self.events) + 1, "type": "activity",
                            "conversationId": conversation_id,
                            "turnId": turn_id, "activity": "cancelled"})
        self.persisted[0] = True

    def close(self):
        self.closed = True


class AgentPortalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.persisted = [False]
        self.backends = []

    def factory(self):
        backend = FakeBackend(self.persisted)
        self.backends.append(backend)
        return backend

    def portal(self):
        portal = AgentPortal(self.temp.name, self.factory)
        self.addCleanup(portal.close)
        return portal

    def wait_for(self, portal, session_id, predicate):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            value = portal.status(session_id)
            if predicate(value):
                return value
            time.sleep(0.01)
        self.fail("portal did not reach expected state")

    def test_persists_opaque_session_and_followup_after_restart(self):
        portal = self.portal()
        opened = portal.open()
        self.assertEqual(opened["accessMode"], "workspace-write")
        self.assertEqual(opened["approvalMode"], "reviewed")
        session_id = opened["sessionId"]
        self.assertEqual(len(session_id), 32)
        self.assertNotEqual(session_id, "native-thread-id")
        first = portal.send_text(session_id, "Put this there")
        turn_id = first["turnId"]
        status = self.wait_for(portal, session_id, lambda value: bool(value["pendingApprovals"]))
        self.assertEqual(status["pendingApprovals"][0]["action"], "running_command")
        self.assertNotIn("FOREIGN SECRET", str(status))
        self.assertNotIn("native-thread-id", str(status))
        with self.assertRaises(AgentPortalError):
            portal.decide(session_id, 999, turn_id, True)
        portal.decide(session_id, status["pendingApprovals"][0]["approvalId"], turn_id, True)
        status = self.wait_for(portal, session_id, lambda value: value["activity"] == "completed")
        self.assertEqual(status["transcript"][0]["assistant"], "Done.")
        self.assertEqual(portal.cancel(session_id, turn_id)["activity"], "completed")
        self.assertTrue(status["events"])
        cursor = status["cursor"]
        self.assertEqual(portal.status(session_id, cursor)["events"], [])
        old_watcher = portal._watcher
        same_process_turn = portal.send_text(session_id, "Move it again")
        portal.cancel(session_id, same_process_turn["turnId"])
        self.wait_for(portal, session_id, lambda value: value["activity"] == "cancelled")
        old_watcher.join(timeout=1)
        self.assertFalse(old_watcher.is_alive())
        portal.close()

        saved = json.loads((Path(self.temp.name) / "agent_portal.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["conversationId"], "native-thread-id")
        self.assertEqual(saved["sessionId"], session_id)
        restarted = self.portal()
        resumed = restarted.open()
        self.assertEqual(resumed["sessionId"], session_id)
        self.assertEqual(resumed["transcript"][0]["assistant"], "Done.")
        self.assertEqual(self.backends[-1].resume_calls, ["native-thread-id"])
        second = restarted.send_text(session_id, "Make it taller")
        restarted.cancel(session_id, second["turnId"])
        status = self.wait_for(restarted, session_id, lambda value: value["activity"] == "cancelled")
        self.assertEqual(status["transcript"][-1]["status"], "cancelled")

    def test_provisional_portal_survives_restart_before_first_turn(self):
        portal = self.portal()
        session_id = portal.open()["sessionId"]
        self.assertEqual(self.backends[-1].start_calls, 0)
        self.assertIsNone(json.loads((Path(self.temp.name) / "agent_portal.json").read_text())["conversationId"])
        portal.close()
        restarted = self.portal()
        self.assertEqual(restarted.open()["sessionId"], session_id)
        self.assertEqual(self.backends[-1].resume_calls, [])
        first = restarted.send_text(session_id, "First turn after restart")
        self.assertEqual(self.backends[-1].start_calls, 1)
        restarted.cancel(session_id, first["turnId"])
        self.assertEqual(json.loads((Path(self.temp.name) / "agent_portal.json").read_text())["sessionId"], session_id)
        self.assertEqual(json.loads((Path(self.temp.name) / "agent_portal.json").read_text())["conversationId"],
                         "native-thread-id")

    def test_restarted_portal_reports_new_pc_approval_mode_on_same_conversation(self):
        portal = self.portal()
        session_id = portal.open()["sessionId"]
        turn_id = portal.send_text(session_id, "First turn")["turnId"]
        portal.decide(session_id, self.backends[-1].approval["approvalId"], turn_id, True)
        self.wait_for(portal, session_id, lambda value: value["activity"] == "completed")
        portal.close()

        class AutomaticBackend(FakeBackend):
            approval_mode = "automatic"
            access_mode = "danger-full-access"

        backend = AutomaticBackend(self.persisted)
        restarted = AgentPortal(self.temp.name, lambda: backend)
        self.addCleanup(restarted.close)
        resumed = restarted.open()
        self.assertEqual(resumed["sessionId"], session_id)
        self.assertNotIn("conversationId", resumed)
        self.assertEqual(resumed["approvalMode"], "automatic")
        self.assertEqual(resumed["accessMode"], "danger-full-access")
        self.assertEqual(backend.resume_calls, ["native-thread-id"])

    def test_old_empty_native_thread_migrates_without_resuming_it(self):
        session_id = "a" * 32
        path = Path(self.temp.name) / "agent_portal.json"
        path.write_text(json.dumps({"version": 1, "sessionId": session_id,
                                    "conversationId": "unresumable-empty-thread",
                                    "transcript": [], "eventSequence": 0}), encoding="utf-8")
        portal = self.portal()
        self.assertEqual(portal.open()["sessionId"], session_id)
        self.assertEqual(self.backends[-1].resume_calls, [])
        self.assertIsNone(json.loads(path.read_text())["conversationId"])

    def test_first_turn_persistence_failure_keeps_provisional_mapping(self):
        portal = self.portal()
        session_id = portal.open()["sessionId"]
        with patch.object(portal, "_persist", side_effect=AgentPortalError(507, "disk full")):
            with self.assertRaisesRegex(AgentPortalError, "disk full"):
                portal.send_text(session_id, "First request")
        self.assertTrue(self.backends[-1].closed)
        self.assertIsNone(portal._conversation_id)
        self.assertEqual(portal.open()["sessionId"], session_id)
        self.assertEqual(portal.status(session_id)["transcript"], [])
        self.assertIsNone(json.loads((Path(self.temp.name) / "agent_portal.json").read_text())["conversationId"])

    def test_unreviewable_approval_can_be_denied_but_not_approved(self):
        portal = self.portal()
        session_id = portal.open()["sessionId"]
        turn_id = portal.send_text(session_id, "Test approval")["turnId"]
        backend = self.backends[-1]
        backend.approval["reviewable"] = False
        backend.approval["summary"] = "Command effect cannot be reviewed in XR."
        pending = portal.status(session_id)["pendingApprovals"][0]
        self.assertFalse(pending["reviewable"])
        with self.assertRaisesRegex(AgentPortalError, "cannot be reviewed"):
            portal.decide(session_id, pending["approvalId"], turn_id, True)
        portal.decide(session_id, pending["approvalId"], turn_id, False)

    def test_corrupt_mapping_is_not_overwritten(self):
        path = Path(self.temp.name) / "agent_portal.json"
        path.write_text("{broken", encoding="utf-8")
        portal = self.portal()
        with self.assertRaisesRegex(AgentPortalError, "requires PC repair"):
            portal.open()
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")

    def test_bounded_transcript_marks_omitted_prefix(self):
        portal = self.portal()
        session_id = portal.open()["sessionId"]
        turn_id = portal.send_text(session_id, "A long answer")["turnId"]
        backend = self.backends[-1]
        backend.events.append({"sequence": len(backend.events) + 1, "type": "text",
                               "conversationId": "native-thread-id", "turnId": turn_id,
                               "text": "x" * 25000})
        status = portal.status(session_id)
        self.assertEqual(len(status["transcript"][-1]["assistant"]), 24000)
        self.assertTrue(status["transcript"][-1]["assistantTruncated"])

    def test_large_utf8_transcript_fits_store_and_marks_both_omissions(self):
        portal = self.portal()
        session_id = portal.open()["sessionId"]
        turn_id = portal.send_text(session_id, "😀" * 16000)["turnId"]
        backend = self.backends[-1]
        backend.events.append({"sequence": len(backend.events) + 1, "type": "text",
                               "conversationId": "native-thread-id", "turnId": turn_id,
                               "text": "😀" * 24000})
        status = portal.status(session_id)
        self.assertTrue(status["transcript"][-1]["userTruncated"])
        self.assertTrue(status["transcript"][-1]["assistantTruncated"])
        self.assertLessEqual((Path(self.temp.name) / "agent_portal.json").stat().st_size, MAX_STORE)
        portal.decide(session_id, backend.approval["approvalId"], turn_id, True)
        self.wait_for(portal, session_id, lambda value: value["activity"] == "completed")
        self.assertEqual(portal.send_text(session_id, "Another turn")["activity"], "working")


class PCInput:
    def __init__(self, interactive=True):
        self.interactive = interactive
        self.lines = queue.Queue()

    def isatty(self):
        return self.interactive

    def readline(self):
        return self.lines.get()


class PCOutput(io.StringIO):
    def __init__(self, interactive=True):
        super().__init__()
        self.interactive = interactive
        self.prompted = threading.Event()

    def isatty(self):
        return self.interactive

    def write(self, value):
        result = super().write(value)
        if "Enter defaults to deny" in value:
            self.prompted.set()
        return result


class PCBackend(FakeBackend):
    def __init__(self, persisted):
        super().__init__(persisted)
        self.decisions = []
        self.native_params = None
        self.pc_checks = 0
        self.command = "blender --background --python create.py SECRET_COMMAND"

    def send_text(self, identifier, text):
        turn_id = super().send_text(identifier, text)
        self.approval.update(summary="Codex requests a command. Its effect cannot be reviewed in XR.",
                             reviewable=False)
        self.native_params = {"threadId": identifier, "turnId": turn_id, "itemId": "command-item-1",
                              "command": self.command,
                              "cwd": "C:/Matrix workspace", "reason": "Create an animated asset",
                              "networkApprovalContext": {"host": "assets.example.invalid"}}
        return turn_id

    def pending_pc_commands(self):
        self.pc_checks += 1
        if not self.approval or not self.native_params:
            return []
        return [{"approvalId": self.approval["approvalId"],
                 "conversationId": self.native_params["threadId"],
                 "turnId": self.native_params["turnId"],
                 "itemId": self.native_params["itemId"],
                 "nativeParams": json.dumps(self.native_params, sort_keys=True,
                                            ensure_ascii=True, separators=(",", ":"))}]

    def decide(self, approval_id, conversation_id, turn_id, approve):
        self.decisions.append((approval_id, conversation_id, turn_id, approve))
        super().decide(approval_id, conversation_id, turn_id, approve)


class PCReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pc_input = PCInput()
        self.pc_output = PCOutput()
        self.backend = PCBackend([False])
        self.portal = AgentPortal(self.temp.name, lambda: self.backend,
                                  pc_input=self.pc_input, pc_output=self.pc_output)
        self.addCleanup(self.portal.close)
        self.addCleanup(lambda: self.pc_input.lines.put("\n"))

    def wait_for(self, predicate):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.01)
        self.fail("PC review did not reach expected state")

    def start_review(self):
        session_id = self.portal.open()["sessionId"]
        turn_id = self.portal.send_text(session_id, "Create the asset")["turnId"]
        self.assertTrue(self.pc_output.prompted.wait(2))
        return session_id, turn_id

    def test_pc_approve_once_while_browser_remains_redacted(self):
        session_id, turn_id = self.start_review()
        shown = self.pc_output.getvalue()
        for expected in ("Approval ID: 101", "SECRET_COMMAND", "C:/Matrix workspace",
                         "Create an animated asset", "assets.example.invalid", "command-item-1"):
            self.assertIn(expected, shown)
        started = time.monotonic()
        status = self.portal.status(session_id)
        self.assertLess(time.monotonic() - started, 1)
        self.assertFalse(status["pendingApprovals"][0]["reviewable"])
        for secret in ("SECRET_COMMAND", "C:/Matrix workspace", "assets.example.invalid"):
            self.assertNotIn(secret, json.dumps(status))
        with self.assertRaisesRegex(AgentPortalError, "cannot be reviewed in XR"):
            self.portal.decide(session_id, 101, turn_id, True)
        self.pc_input.lines.put("approve\n")
        self.wait_for(lambda: len(self.backend.decisions) == 1)
        self.assertEqual(self.backend.decisions, [(101, "native-thread-id", turn_id, True)])

    def test_empty_input_defaults_to_deny_once(self):
        _, turn_id = self.start_review()
        self.pc_input.lines.put("\n")
        self.wait_for(lambda: len(self.backend.decisions) == 1)
        self.assertEqual(self.backend.decisions, [(101, "native-thread-id", turn_id, False)])

    def test_stop_or_changed_native_request_cannot_be_approved_late(self):
        session_id, turn_id = self.start_review()
        started = time.monotonic()
        self.portal.cancel(session_id, turn_id)
        self.assertLess(time.monotonic() - started, 1)
        self.pc_input.lines.put("approve\n")
        self.wait_for(lambda: not self.backend.approval)
        self.assertEqual(self.backend.decisions, [])

    def test_old_prompt_cannot_approve_next_turn(self):
        session_id, first_turn = self.start_review()
        self.portal.cancel(session_id, first_turn)
        self.portal.status(session_id)
        second_turn = self.portal.send_text(session_id, "Try again")["turnId"]
        self.pc_input.lines.put("approve\n")
        self.wait_for(lambda: self.pc_output.getvalue().count("Matrix PC command approval") == 2)
        self.assertEqual(self.backend.decisions, [])
        self.pc_input.lines.put("deny\n")
        self.wait_for(lambda: len(self.backend.decisions) == 1)
        self.assertEqual(self.backend.decisions, [(102, "native-thread-id", second_turn, False)])

    def test_changed_native_command_invalidates_displayed_approval(self):
        self.start_review()
        self.backend.native_params["command"] = "different command"
        self.pc_input.lines.put("approve\n")
        self.wait_for(lambda: self.backend.pc_checks >= 2)
        self.assertEqual(self.backend.decisions, [])
        self.assertIsNotNone(self.backend.approval)

    def test_no_interactive_console_leaves_command_for_stop(self):
        self.pc_input.interactive = False
        portal = AgentPortal(self.temp.name, lambda: self.backend,
                             pc_input=self.pc_input, pc_output=self.pc_output)
        self.addCleanup(portal.close)
        session_id = portal.open()["sessionId"]
        turn_id = portal.send_text(session_id, "Create the asset")["turnId"]
        self.assertIsNone(portal._pc_reviewer)
        self.assertFalse(portal.status(session_id)["pendingApprovals"][0]["reviewable"])
        self.assertEqual(self.pc_output.getvalue(), "")
        self.assertEqual(self.backend.decisions, [])
        portal.cancel(session_id, turn_id)

    def test_terminal_control_characters_are_escaped(self):
        self.backend.command = "echo \x1b[31msecret\x7f"
        self.start_review()
        shown = self.pc_output.getvalue()
        self.assertNotIn("\x1b", shown)
        self.assertNotIn("\x7f", shown)
        self.assertIn("\\u001b", shown)
        self.assertIn("\\u007f", shown)


if __name__ == "__main__":
    unittest.main()
