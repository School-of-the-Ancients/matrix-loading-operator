"""Authenticated Matrix Agent Portal API on an isolated loopback service."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from agent_portal import AgentPortal
from server import Server, State
from test_agent_portal import FakeBackend


class AgentPortalHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.persisted = [False]
        self.state = State(self.temp.name)
        self.state.agent_portal = AgentPortal(Path(self.temp.name) / ".agent_portal",
                                             lambda: FakeBackend(self.persisted))
        self.token = "matrix-agent-test-token-0123456789"
        self.server = Server(("127.0.0.1", 0), self.state, self.token)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, path, body, *, auth=True, origin=None):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + self.token
        if origin is not None:
            headers["Origin"] = origin
        request = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_auth_origin_validation_and_reconnect_without_browser_secrets(self):
        self.assertEqual(self.post("/api/agent/session", {}, auth=False)[0], 401)
        self.assertEqual(self.post("/api/agent/session", {}, origin="https://other.example")[0], 403)
        code, opened = self.post("/api/agent/session", {}, origin=self.url)
        self.assertEqual(code, 200)
        session_id = opened["sessionId"]
        self.assertEqual(len(session_id), 32)
        self.assertNotIn("agent_portal", self.state.scenes()["scenes"])
        self.assertNotEqual(self.state.path("agent_portal"), self.state.agent_portal.path)
        self.assertNotIn("native-thread-id", json.dumps(opened))
        self.assertNotIn(self.token, json.dumps(opened))
        self.assertEqual(self.post("/api/agent/turn", {"sessionId": session_id, "text": "Place this there"})[0], 200)
        self.assertEqual(self.post("/api/agent/status", {"sessionId": "wrong", "cursor": 0})[0], 404)
        self.assertEqual(self.post("/api/agent/status", {"sessionId": session_id, "cursor": "bad"})[0], 400)
        code, status = self.post("/api/agent/status", {"sessionId": session_id, "cursor": 0})
        self.assertEqual(code, 200)
        pending = status["pendingApprovals"][0]
        self.assertEqual(self.post("/api/agent/approval", {"sessionId": session_id,
                     "turnId": "wrong", "approvalId": pending["approvalId"], "approve": True})[0], 409)
        self.assertEqual(self.post("/api/agent/approval", {"sessionId": session_id,
                     "turnId": pending["turnId"], "approvalId": pending["approvalId"], "approve": True})[0], 200)
        code, resumed = self.post("/api/agent/session", {})
        self.assertEqual(code, 200)
        self.assertEqual(resumed["sessionId"], session_id)
        self.assertEqual(self.post("/api/agent/session", {"unexpected": 1})[0], 400)


if __name__ == "__main__":
    unittest.main()
