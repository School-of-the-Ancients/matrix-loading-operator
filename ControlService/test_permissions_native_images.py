"""Permission handoffs retain native images before closing their source transport."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from agent_portal import AgentPortal, AgentPortalError
from server import State, agent_portal_action
from test_agent_portal import NativeFakeBackend
from test_browser_permissions import PermissionBackend
from test_concept_store import FakeConceptCatalog, PNG, panorama_png


class ClosingImageBackend(NativeFakeBackend):
    access_mode = "workspace-write"
    approval_mode = "reviewed"

    def close(self):
        super().close()
        if self.native_result and self.native_result.get("transientArtifact"):
            Path(self.native_result["imagePath"]).unlink(missing_ok=True)
        self.native_result = None


class NativeImagePermissionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.persisted = [False]
        self.old = ClosingImageBackend(self.persisted)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
            lambda: self.old, permissions_factory=lambda mode: PermissionBackend(self.persisted, mode))
        self.addCleanup(self.state.agent_portal.close)
        self.catalog = FakeConceptCatalog(Path(self.temp.name) / "catalog")
        self.state.content._catalog = self.catalog
        self.session = self.state.agent_portal.open()["sessionId"]
        self.body = {"sessionId": self.session, "mode": "full-access", "confirmed": True}

    def finish_image_turn(self, result):
        self.old.native_result = result
        self.persisted[0] = True
        self.old.events.append({"sequence": len(self.old.events) + 1, "type": "activity",
                                "conversationId": "native-thread-id", "turnId": "native-image-turn",
                                "activity": "completed"})
        self.assertIsNone(self.state.agent_portal.status(self.session)["activeTurnId"])

    def assert_image_preserved(self, purpose, pixels):
        job = self.state.concepts.create(self.session, "An image", provider_id="codex-native",
                                         purpose=purpose)["job"]
        source = self.state.agent_portal.directory / "native_generated" / "codex-result.png"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(pixels)
        self.finish_image_turn({"status": "ready", "imagePath": str(source),
            "sha256": hashlib.sha256(pixels).hexdigest(), "mimeType": "image/png",
            "transientArtifact": True})
        changed = agent_portal_action(self.state, "/api/agent/permissions", self.body)
        self.assertEqual(changed["approvalMode"], "automatic")
        self.assertTrue(self.old.closed)
        self.assertFalse(source.exists())
        saved = self.state.concepts.status(self.session, refresh=False)
        image = (saved["concepts"] if purpose == "concept" else saved["panoramas"])[0]
        self.assertEqual(image["conceptId"], job["conceptId"])
        self.assertEqual(image["status"], "ready")
        self.assertEqual((self.state.concepts.images / (image["sha256"] + ".png")).read_bytes(), pixels)

    def test_terminal_concept_is_copied_before_source_backend_closes(self):
        self.assert_image_preserved("concept", PNG)

    def test_terminal_panorama_is_copied_before_source_backend_closes(self):
        self.assert_image_preserved("panorama", panorama_png())

    def test_unresolved_native_result_keeps_previous_transport_available(self):
        self.state.concepts.create(self.session, "An image", provider_id="codex-native")
        self.finish_image_turn({"status": "generating"})
        with self.assertRaisesRegex(AgentPortalError, "Native image results are not ready") as caught:
            agent_portal_action(self.state, "/api/agent/permissions", self.body)
        self.assertEqual(caught.exception.status, 409)
        self.assertFalse(self.old.closed)
        self.assertIs(self.state.agent_portal._backend, self.old)
        self.assertTrue(self.state.agent_turn_submission_lock.acquire(blocking=False))
        self.state.agent_turn_submission_lock.release()

    def test_unrelated_comfy_job_is_not_polled_or_blocked_by_permission_handoff(self):
        job = self.state.concepts.create(self.session, "An image", provider_id="comfyui")["job"]
        with patch.object(self.catalog, "poll_generation", side_effect=AssertionError("Do not poll ComfyUI")):
            changed = agent_portal_action(self.state, "/api/agent/permissions", self.body)
        self.assertEqual(changed["approvalMode"], "automatic")
        self.assertTrue(self.old.closed)
        self.assertEqual(self.state.concepts.status(self.session, refresh=False)["jobs"][0]["conceptId"],
                         job["conceptId"])


if __name__ == "__main__":
    unittest.main()
