"""Browser runtime contract smoke; no headset or AI provider required."""
import json
import copy
from pathlib import Path
import tempfile
import threading
import time
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

    def test_webxr_room_requires_alignment_and_keeps_proposal_revision_when_plane_pose_refines(self):
        room = copy.deepcopy(SNAPSHOT)
        room["scene"]["roomId"] = "webxr-session-test"
        room["anchors"] = [{"anchorId": "webxr-plane-floor", "displayName": "FLOOR", "source": "webxr",
                            "semanticLabels": ["FLOOR"], "surface": {"kind": "support", "boundary": [
                                {"x": -2, "y": 0, "z": -2}, {"x": 2, "y": 0, "z": -2},
                                {"x": 2, "y": 0, "z": 2}, {"x": -2, "y": 0, "z": 2}]},
                            "roomPose": {"position": {"x": 0, "y": 0, "z": 0},
                                         "rotation": {"x": 0, "y": 0, "z": 0},
                                         "scale": {"x": 1, "y": 1, "z": 1}}}]
        room["selection"] = {"anchorId": "webxr-plane-floor", "objectId": "",
                             "position": {"x": 0, "y": 0, "z": 0}}
        room["roomContext"] = {"mode": "ar", "state": "ready", "message": "1 WebXR room plane",
                               "alignmentVerified": False}
        code, body = self.post("/api/exchange", {"clientId": "web-client", "snapshot": room,
                                                  "results": [], "captureSupported": False})
        self.assertEqual(code, 200, body)
        command = {"op": "spawn", "assetId": "chair", "anchorId": "webxr-plane-floor",
                   "placement": "surface", "transform": {"position": {"x": 0, "y": 0, "z": 0},
                   "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}}
        self.assertEqual(self.post("/api/command", command)[0], 409)
        code, queued = self.post("/api/command", {"op": "confirm_room"})
        self.assertEqual(code, 200, queued)
        request_id = queued["commands"][0]["requestId"]
        room["roomContext"]["alignmentVerified"] = True
        code, delivered = self.post("/api/exchange", {"clientId": "web-client", "snapshot": room,
                                                      "results": [{"requestId": request_id, "ok": True}],
                                                      "captureSupported": False})
        self.assertEqual(code, 200, delivered)
        revision = self.server.state.revision
        refined = copy.deepcopy(room)
        refined["anchors"][0]["roomPose"]["position"]["x"] += .03
        refined["anchors"][0]["surface"]["boundary"][0]["x"] += .03
        self.assertEqual(self.post("/api/exchange", {"clientId": "web-client", "snapshot": refined,
                                                     "results": [], "captureSupported": False})[0], 200)
        self.assertEqual(self.server.state.revision, revision)
        code, queued = self.post("/api/command", command)
        self.assertEqual(code, 200, queued)
        code, delivered = self.post("/api/exchange", {"clientId": "web-client", "snapshot": refined,
                                                      "results": [], "captureSupported": False})
        self.assertEqual(code, 200, delivered)
        self.assertEqual(delivered["commands"][0]["placement"], "surface")

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

    def test_on_request_prototype_becomes_spawnable_asset(self):
        spec = {"name": "Slate Gate", "brief": "Quiet ruins", "shape": "arch", "palette": "slate",
                "width": 1.8, "height": 2.2, "depth": .5}
        code, job = self.post("/api/web/authoring", spec)
        self.assertEqual(code, 200, job)
        for _ in range(100):
            code, raw = self.get("/api/web/authoring/" + job["jobId"])
            job = json.loads(raw)
            if job["phase"] in ("ready", "error"):
                break
            time.sleep(.02)
        self.assertEqual(job["phase"], "ready", job)
        self.assertGreaterEqual(job["elapsedMs"], 0)
        asset = job["asset"]
        code, data = self.get(asset["url"])
        self.assertEqual(code, 200)
        self.assertEqual(data[:4], b"glTF")
        current = copy.deepcopy(SNAPSHOT)
        current["assets"].append({key: asset[key] for key in
                                  ("assetId", "displayName", "description", "spawnScale")})
        code, _ = self.post("/api/exchange", {"clientId": "web-client", "snapshot": current,
                                              "results": [], "captureSupported": False})
        self.assertEqual(code, 200)
        code, queued = self.post("/api/command", {"op": "spawn", "assetId": asset["assetId"],
                                                  "anchorId": "web-floor", "transform": {
                                                      "position": {"x": 0, "y": 0, "z": -2},
                                                      "rotation": {"x": 0, "y": 0, "z": 0},
                                                      "scale": {"x": 1, "y": 1, "z": 1}}})
        self.assertEqual(code, 200, queued)
        code, delivered = self.post("/api/exchange", {"clientId": "web-client", "snapshot": current,
                                                      "results": [], "captureSupported": False})
        self.assertEqual(code, 200)
        self.assertEqual(delivered["commands"][0]["assetId"], asset["assetId"])

    def test_bad_authoring_recipe_is_rejected_before_queueing(self):
        code, body = self.post("/api/web/authoring", {"name": "Bad Gate", "brief": "", "shape": "arch",
                                                       "palette": "slate", "width": 4.1, "height": .5, "depth": .2})
        self.assertEqual(code, 400, body)
        code, raw = self.get("/api/web/authoring")
        self.assertEqual(json.loads(raw)["jobs"], [])


if __name__ == "__main__":
    unittest.main()
