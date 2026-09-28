"""Authenticated Operator concept routes and same-origin image previews."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import patch

import hashlib

from agent_portal import AgentPortal
from concept_store import ConceptStore
from server import Server, State
from test_agent_portal import FakeBackend
from test_concept_store import FakeConceptCatalog, PNG


class ConceptHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
                                             lambda: FakeBackend([False]))
        self.catalog = FakeConceptCatalog(Path(self.temp.name) / "fake-cache")
        self.state.content._catalog = self.catalog
        self.token = "matrix-concepts-test-token-0123456789"
        self.server = Server(("127.0.0.1", 0), self.state, self.token)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, body=None, *, auth=True, origin=None):
        headers = {"Authorization": "Bearer " + self.token} if auth else {}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if origin is not None:
            headers["Origin"] = origin
        request = urllib.request.Request(self.url + path,
                                         data=json.dumps(body).encode() if body is not None else None,
                                         headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=8)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers.get("Content-Type"), response.read()

    def json(self, path, body=None, **options):
        status, _, raw = self.request(path, body, **options)
        return status, json.loads(raw)

    def test_generate_preview_select_variation_and_reconnect(self):
        page = urllib.request.Request(self.url + "/web/",
                                      headers={"Authorization": "Bearer " + self.token})
        try:
            with urllib.request.urlopen(page, timeout=8) as response:
                csp = response.headers.get("Content-Security-Policy", "")
        except urllib.error.HTTPError as error:
            # A source checkout may not have Vite dist yet. All responses from
            # send_data carry the same policy, including the missing-build error.
            with error:
                csp = error.headers.get("Content-Security-Policy", "")
        self.assertIn("img-src 'self' data: blob:", csp)
        session = self.json("/api/agent/session", {})[1]["sessionId"]
        providers = self.json("/api/agent/concepts?sessionId=" + session)[1]
        self.assertEqual(providers["defaultProviderId"], "comfyui")
        self.assertEqual([item["id"] for item in providers["providers"]],
                         ["codex-native", "comfyui"])
        self.assertFalse(providers["providers"][0]["available"])
        initial = {"sessionId": session, "prompt": "Forest temple"}
        self.assertEqual(self.json("/api/agent/concepts", initial, auth=False)[0], 401)
        self.assertEqual(self.json("/api/agent/concepts", initial,
                                   origin="https://other.example")[0], 403)
        code, started = self.json("/api/agent/concepts", initial)
        self.assertEqual(code, 200)
        first = started["job"]
        self.assertEqual(first["version"], 1)
        self.assertEqual(first["status"], "queued")
        self.assertEqual(first["providerId"], "comfyui")
        self.assertEqual(first["connectorProviderId"], "worker")
        self.assertTrue(first["cancellable"])
        self.assertEqual(self.json("/api/agent/concepts", {**initial,
                             "providerId": "codex-native"})[0], 409)
        self.assertEqual(self.json("/api/agent/concepts?sessionId=wrong")[0], 404)
        catalog_id = self.state.concepts.data["sessions"][session]["jobs"][0]["catalogJobId"]
        self.catalog.states[catalog_id] = "completed"
        code, status = self.json("/api/agent/concepts?" + urllib.parse.urlencode({"sessionId": session}))
        self.assertEqual(code, 200)
        self.assertEqual(status["jobs"][0]["status"], "ready")
        self.assertEqual(status["selectedConceptId"], None)
        self.assertNotIn("imagePath", json.dumps(status))
        preview = status["concepts"][0]["previewUrl"]
        self.assertEqual(self.request(preview, auth=False)[0], 401)
        code, mime, image = self.request(preview)
        self.assertEqual((code, mime, image), (200, "image/png", PNG))

        code, selected = self.json("/api/agent/concepts/select", {
            "sessionId": session, "conceptId": first["conceptId"], "designNotes": "Tall trees"})
        self.assertEqual(code, 200)
        self.assertEqual(selected["selectedConceptId"], first["conceptId"])
        code, variant = self.json("/api/agent/concepts/variation", {
            "sessionId": session, "sourceConceptId": first["conceptId"],
            "providerId": "comfyui"})
        self.assertEqual(code, 200)
        self.assertEqual(variant["job"]["version"], 2)
        self.assertEqual(variant["job"]["parentConceptId"], first["conceptId"])
        second_id = self.state.concepts.data["sessions"][session]["jobs"][1]["catalogJobId"]
        self.catalog.states[second_id] = "completed"
        self.state.concepts = ConceptStore(Path(self.temp.name) / ".agent_portal" / "concepts",
                                           lambda: self.state.content.catalog)
        status = self.json("/api/agent/concepts?sessionId=" + session)[1]
        self.assertEqual(len(status["concepts"]), 2)
        self.assertEqual(status["selectedConceptId"], first["conceptId"])
        self.assertEqual(self.state.concepts.selected(session)["designNotes"], "Tall trees")

    def test_cancel_and_bad_selection(self):
        session = self.json("/api/agent/session", {})[1]["sessionId"]
        job = self.json("/api/agent/concepts", {"sessionId": session, "prompt": "Rocket"})[1]["job"]
        self.assertEqual(self.json("/api/agent/concepts/select", {
            "sessionId": session, "conceptId": job["conceptId"]})[0], 409)
        code, cancelled = self.json("/api/agent/concepts/cancel", {
            "sessionId": session, "conceptId": job["conceptId"]})
        self.assertEqual(code, 200)
        self.assertEqual(cancelled["job"]["status"], "cancelled")
        self.assertEqual(self.json("/api/agent/concepts/cancel", {
            "sessionId": session, "conceptId": job["conceptId"]})[0], 409)

    def test_native_provider_http_ready_preview_and_explicit_selection(self):
        session = self.json("/api/agent/session", {})[1]["sessionId"]
        image = Path(self.temp.name) / "native.png"
        image.write_bytes(PNG)
        with (patch.object(self.state.agent_portal, "native_image_available", create=True,
                           return_value={"available": True, "reason": None}),
              patch.object(self.state.agent_portal, "start_native_image", create=True,
                           return_value={"turnId": "native-turn-1"}),
              patch.object(self.state.agent_portal, "native_image_result", create=True,
                           return_value={"status": "ready", "imagePath": str(image),
                                         "sha256": hashlib.sha256(PNG).hexdigest(),
                                         "mimeType": "image/png", "revisedPrompt": "A blue orb"})):
            initial = self.json("/api/agent/concepts?sessionId=" + session)[1]
            self.assertEqual(initial["defaultProviderId"], "codex-native")
            code, created = self.json("/api/agent/concepts", {
                "sessionId": session, "prompt": "Blue orb", "providerId": "codex-native"})
            self.assertEqual(code, 200)
            concept_id = created["job"]["conceptId"]
            self.assertEqual(created["job"]["providerId"], "codex-native")
            self.assertFalse(created["job"]["cancellable"])
            status = self.json("/api/agent/concepts?sessionId=" + session)[1]
            self.assertEqual(status["concepts"][0]["revisedPrompt"], "A blue orb")
            self.assertIsNone(status["selectedConceptId"])
            self.assertNotIn(str(image), json.dumps(status))
            self.assertNotIn("nativeTurnId", json.dumps(status))
            preview = status["concepts"][0]["previewUrl"]
            self.assertEqual(self.request(preview), (200, "image/png", PNG))
            selected = self.json("/api/agent/concepts/select", {
                "sessionId": session, "conceptId": concept_id})[1]
            self.assertEqual(selected["selectedConceptId"], concept_id)


if __name__ == "__main__":
    unittest.main()
