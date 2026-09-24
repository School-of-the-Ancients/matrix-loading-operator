"""Browser runtime contract smoke; no headset or AI provider required."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from server import Server, State
from test_web_assets import glb


SNAPSHOT = {
    "scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": []},
    "assets": [{"assetId": "chair", "displayName": "Chair", "spawnScale": 1,
                "localBounds": {"center": {"x": 0, "y": .45, "z": 0},
                                "size": {"x": .6, "y": .9, "z": .6}}}],
    "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
    "selection": {"anchorId": "web-floor", "objectId": "", "position": {"x": 0, "y": 0, "z": -2}},
    "behaviorKinds": ["rotate", "bob"],
    "roomContext": {"mode": "white-room", "state": "ready",
                    "message": "Browser virtual floor; physical room alignment is not verified.",
                    "alignmentVerified": False},
}


class WebRuntimeContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = Server(("127.0.0.1", 0), State(self.temp.name,
                              web_assets_directory=Path(self.temp.name) / "web_assets"))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, path, body):
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", "Origin": self.base})
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=3) as response:
            return response.status, response.read()

    def test_web_snapshot_uses_existing_review_and_receipt_flow(self):
        code, _ = self.post("/api/exchange", {"clientId": "web-client", "snapshot": SNAPSHOT,
                                              "results": [], "captureSupported": False})
        self.assertEqual(code, 200)
        code, proposal = self.post("/api/plan", {"text": "Summon a chair here", "mode": "offline-rules"})
        self.assertEqual(code, 200, proposal)
        self.assertTrue(proposal["requiresApply"])
        self.assertEqual(proposal["commands"][0]["assetId"], "chair")
        code, _ = self.post("/api/apply_plan", {"planId": proposal["planId"]})
        self.assertEqual(code, 200)
        code, delivery = self.post("/api/exchange", {"clientId": "web-client", "snapshot": SNAPSHOT,
                                                     "results": [], "captureSupported": False})
        self.assertEqual(code, 200)
        command = delivery["commands"][0]
        self.assertEqual(command["op"], "spawn")
        self.assertEqual(command["anchorId"], "web-floor")
        self.assertTrue(command["requestId"])

    def test_registered_asset_is_visible_without_service_restart(self):
        source = Path(self.temp.name) / "test.glb"
        source.write_bytes(glb())
        asset = self.server.state.web_assets.register(source, "Test Triangle")
        code, body = self.get("/api/web/assets")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["assets"][0]["assetId"], asset["assetId"])
        code, body = self.get(asset["url"])
        self.assertEqual(code, 200)
        self.assertEqual(body, source.read_bytes())


if __name__ == "__main__":
    unittest.main()
