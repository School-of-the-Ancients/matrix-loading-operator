"""Durable Matrix-to-agent session mapping, without starting real Codex."""
import json
import tempfile
import time
import unittest
from pathlib import Path

from agent_portal import AgentPortal, AgentPortalError


class FakeBackend:
    def __init__(self, persisted):
        self.persisted = persisted
        self.events = []
        self.turn_number = 0
        self.approval = None
        self.closed = False
        self.resume_calls = []

    def start(self):
        pass

    def start_conversation(self):
        return "native-thread-id"

    def resume_conversation(self, identifier):
        self.resume_calls.append(identifier)
        if not self.persisted[0]:
            raise RuntimeError("no rollout found")
        return identifier

    def send_text(self, identifier, text):
        self.turn_number += 1
        self.approval = {"approvalId": 100 + self.turn_number,
                         "turnId": f"native-turn-{self.turn_number}", "action": "running_command"}
        self.events.append({"sequence": len(self.events) + 1, "type": "approval",
                            "turnId": self.approval["turnId"],
                            "approvalId": self.approval["approvalId"],
                            "activity": "waiting_for_approval", "action": "running_command"})
        return self.approval["turnId"]

    def poll(self, cursor):
        return len(self.events), [item for item in self.events if item["sequence"] > cursor]

    def pending_approvals(self):
        return [self.approval] if self.approval else []

    def decide(self, approval_id, conversation_id, turn_id, approve):
        assert self.approval["approvalId"] == approval_id
        assert conversation_id == "native-thread-id"
        assert self.approval["turnId"] == turn_id
        self.approval = None
        self.events.append({"sequence": len(self.events) + 1, "type": "text",
                            "turnId": turn_id, "text": "Done."})
        self.events.append({"sequence": len(self.events) + 1, "type": "activity",
                            "turnId": turn_id, "activity": "completed"})
        self.persisted[0] = True

    def cancel(self, conversation_id, turn_id):
        self.approval = None
        self.events.append({"sequence": len(self.events) + 1, "type": "activity",
                            "turnId": turn_id, "activity": "failed"})
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
        session_id = opened["sessionId"]
        self.assertEqual(len(session_id), 32)
        self.assertNotEqual(session_id, "native-thread-id")
        first = portal.send_text(session_id, "Put this there")
        turn_id = first["turnId"]
        status = self.wait_for(portal, session_id, lambda value: bool(value["pendingApprovals"]))
        self.assertEqual(status["pendingApprovals"][0]["action"], "running_command")
        with self.assertRaises(AgentPortalError):
            portal.decide(session_id, 999, turn_id, True)
        portal.decide(session_id, status["pendingApprovals"][0]["approvalId"], turn_id, True)
        status = self.wait_for(portal, session_id, lambda value: value["activity"] == "completed")
        self.assertEqual(status["transcript"][0]["assistant"], "Done.")
        self.assertTrue(status["events"])
        cursor = status["cursor"]
        self.assertEqual(portal.status(session_id, cursor)["events"], [])
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
        status = self.wait_for(restarted, session_id, lambda value: value["activity"] == "failed")
        self.assertEqual(status["transcript"][-1]["status"], "failed")

    def test_empty_thread_fails_explicitly_after_restart(self):
        portal = self.portal()
        session_id = portal.open()["sessionId"]
        portal.close()
        restarted = self.portal()
        with self.assertRaisesRegex(AgentPortalError, "could not be resumed"):
            restarted.open()
        self.assertEqual(json.loads((Path(self.temp.name) / "agent_portal.json").read_text())["sessionId"], session_id)

    def test_corrupt_mapping_is_not_overwritten(self):
        path = Path(self.temp.name) / "agent_portal.json"
        path.write_text("{broken", encoding="utf-8")
        portal = self.portal()
        with self.assertRaisesRegex(AgentPortalError, "requires PC repair"):
            portal.open()
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")


if __name__ == "__main__":
    unittest.main()
