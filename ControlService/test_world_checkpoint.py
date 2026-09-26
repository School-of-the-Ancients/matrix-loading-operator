"""PC world checkpoints keep browser game progress without changing legacy scene saves."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from server import APIError, Server, State
from test_web_assets import animated_glb


POSE = {"position": {"x": 0, "y": 0, "z": -2}, "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}


class WorldCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.scenes = self.root / "scenes"
        self.assets = self.root / "web_assets"
        source = self.root / "flight.glb"
        source.write_bytes(animated_glb())
        self.state = State(self.scenes, web_assets_directory=self.assets)
        self.asset = self.state.web_assets.register(source, "Flight")
        package = {"schemaVersion": 1, "name": "Pulse", "outputs": {
            "scale.y": {"op": "add", "args": [{"op": "self", "path": "scale.y"},
                                              {"op": "const", "value": 0.2}]}}}
        component_id = self.state.web_components.publish(package)["componentId"]
        scene = {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": [
            {"objectId": "pickup-1", "assetId": self.asset["assetId"], "anchorId": "web-floor",
             "transform": copy.deepcopy(POSE), "animation": {"loopClip": "Flight", "selectClip": None}},
            {"objectId": "pickup-2", "assetId": self.asset["assetId"], "anchorId": "web-floor",
             "transform": copy.deepcopy(POSE)},
            {"objectId": "zone-1", "assetId": "pedestal", "anchorId": "web-floor",
             "transform": copy.deepcopy(POSE),
             "component": {"componentId": component_id, "package": package,
                           "targetObjectId": "pickup-1", "startedAtMs": 1000, "status": "running"}}]}
        game = {"spec": {"kind": "game", "title": "Flight Courier", "summary": "Carry two flyers.",
                         "roles": [{"roleId": "flyers", "kind": "pickup", "assetId": self.asset["assetId"], "count": 2},
                                   {"roleId": "zone", "kind": "delivery-zone", "assetId": "pedestal", "count": 1}],
                         "rules": [{"event": "release-near", "actorRoleId": "flyers", "targetRoleId": "zone",
                                    "distanceMeters": 0.6, "scorePoints": 3}],
                         "objectives": [{"kind": "delivered-count", "roleId": "flyers", "targetCount": 2},
                                        {"kind": "score-at-least", "targetPoints": 6}]},
                "bindings": {"flyers": ["pickup-1", "pickup-2"], "zone": ["zone-1"]},
                "state": {"phase": "playing", "score": 3, "deliveries": ["pickup-1"],
                          "objectiveProgress": {"flyers": 1}}}
        self.world = {"version": 2, "scene": scene, "game": game}
        self.snapshot = {"scene": copy.deepcopy(scene), "assets": [
            {"assetId": "pedestal", "displayName": "Pedestal"},
            {"assetId": self.asset["assetId"], "displayName": "Flight", "animationClips": ["Flight"]}],
            "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
            "componentSchemaVersion": 1, "animationSchemaVersion": 1, "behaviorKinds": ["rotate", "bob"],
            "roomContext": {"mode": "white-room", "state": "ready", "message": "",
                            "alignmentVerified": False}}
        self.state.exchange({"clientId": "browser", "snapshot": self.snapshot, "results": []})

    def tearDown(self):
        self.temp.cleanup()

    def test_restart_restores_exact_ids_game_progress_component_and_animation(self):
        saved = self.state.save_world_checkpoint("Demo", self.world)
        self.assertEqual(saved["dependencies"],
                         [{"assetId": self.asset["assetId"], "sha256": self.asset["sha256"]}])
        path = self.scenes / "world_checkpoints" / "Demo.json"
        stored = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(stored["schemaVersion"], 1)
        self.assertEqual(stored["world"]["scene"]["objects"][2]["component"]["startedAtMs"], 0)
        self.assertEqual(self.state.world_checkpoints(), {"worlds": ["Demo"]})
        fresh = State(self.scenes, web_assets_directory=self.assets)
        empty = copy.deepcopy(self.snapshot)
        empty["scene"]["objects"] = []
        fresh.exchange({"clientId": "reopened-browser", "snapshot": empty, "results": []})
        before = copy.deepcopy(fresh.latest)
        restored = fresh.load_world_checkpoint("Demo")
        expected = copy.deepcopy(self.world)
        started_at_ms = restored["world"]["scene"]["objects"][2]["component"]["startedAtMs"]
        self.assertGreater(started_at_ms, 1000, "running component restarts instead of resuming wall-clock phase")
        expected["scene"]["objects"][2]["component"]["startedAtMs"] = started_at_ms
        self.assertEqual(restored["world"], expected)
        self.assertEqual(restored["world"]["game"]["state"]["score"], 3)
        self.assertEqual(restored["world"]["scene"]["objects"][2]["component"]["status"], "running")
        self.assertEqual(restored["world"]["scene"]["objects"][0]["animation"]["loopClip"], "Flight")
        self.assertEqual(fresh.latest, before, "load returns data for browser validation; it does not queue or replace")

    def test_missing_or_corrupt_glb_rejects_without_replacing_active_world(self):
        self.state.save_world_checkpoint("Demo", self.world)
        path = self.assets / (self.asset["sha256"] + ".glb")
        before = copy.deepcopy(self.state.latest)
        path.write_bytes(b"corrupt")
        with self.assertRaisesRegex(APIError, "missing or corrupt") as failure:
            self.state.load_world_checkpoint("Demo")
        self.assertEqual(failure.exception.status, 409)
        self.assertEqual(self.state.latest, before)
        self.assertTrue((self.scenes / "world_checkpoints" / "Demo.json").is_file())

    def test_bad_progress_and_unsynced_scene_cannot_overwrite_checkpoint(self):
        self.state.save_world_checkpoint("Demo", self.world)
        path = self.scenes / "world_checkpoints" / "Demo.json"
        before = path.read_bytes()
        bad = copy.deepcopy(self.world)
        bad["game"]["state"]["score"] = 999
        with self.assertRaisesRegex(APIError, "score"):
            self.state.save_world_checkpoint("Demo", bad)
        bad = copy.deepcopy(self.world)
        bad["scene"]["objects"].pop()
        with self.assertRaisesRegex(APIError, "bindings"):
            self.state.save_world_checkpoint("Demo", bad)
        bad = copy.deepcopy(self.world)
        bad["scene"]["objects"][0]["transform"]["position"]["x"] = 2
        with self.assertRaisesRegex(APIError, "last exchange"):
            self.state.save_world_checkpoint("Demo", bad)
        self.assertEqual(path.read_bytes(), before)

    def test_corrupt_payload_version_and_interrupted_write_preserve_prior_save(self):
        self.state.save_world_checkpoint("Demo", self.world)
        path = self.scenes / "world_checkpoints" / "Demo.json"
        before = path.read_bytes()
        with patch("server.os.replace", side_effect=OSError("interrupted write")):
            with self.assertRaisesRegex(OSError, "interrupted write"):
                self.state.save_world_checkpoint("Demo", self.world)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(path.parent.glob(".saving-world-*")), [])
        document = json.loads(before)
        document["world"]["game"]["state"]["score"] = 4
        path.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaisesRegex(APIError, "corrupt"):
            self.state.load_world_checkpoint("Demo")
        document = json.loads(before)
        document["schemaVersion"] = 9
        path.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaisesRegex(APIError, "Unsupported"):
            self.state.load_world_checkpoint("Demo")

    def test_legacy_scene_save_is_separate_and_ar_checkpoint_is_rejected(self):
        self.state.save("Legacy")
        self.assertTrue((self.scenes / "Legacy.json").is_file())
        self.assertEqual(self.state.world_checkpoints(), {"worlds": []})
        ar = copy.deepcopy(self.snapshot)
        ar["scene"]["roomId"] = "webxr-session-test"
        ar["roomContext"] = {"mode": "ar", "state": "ready", "message": "", "alignmentVerified": True}
        self.state.exchange({"clientId": "browser", "snapshot": ar, "results": []})
        with self.assertRaisesRegex(APIError, "desktop virtual room"):
            self.state.save_world_checkpoint("AR", self.world)
        self.assertFalse((self.scenes / "world_checkpoints" / "AR.json").exists())

    def test_http_routes_roundtrip_and_require_exact_body(self):
        service = Server(("127.0.0.1", 0), self.state)
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{service.server_port}"

        def request(path, body=None):
            data = None if body is None else json.dumps(body).encode("utf-8")
            req = urllib.request.Request(base + path, data=data,
                                         headers={"Content-Type": "application/json"} if data else {})
            try:
                response = urllib.request.urlopen(req, timeout=3)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.loads(response.read())

        try:
            self.assertEqual(request("/api/web/world/save", {"name": "Demo", "world": self.world})[0], 200)
            self.assertEqual(request("/api/web/worlds")[1], {"worlds": ["Demo"]})
            loaded = request("/api/web/world/load", {"name": "Demo"})[1]["world"]
            self.assertEqual(loaded["game"], self.world["game"])
            self.assertEqual([item["objectId"] for item in loaded["scene"]["objects"]],
                             ["pickup-1", "pickup-2", "zone-1"])
            self.assertEqual(request("/api/web/world/load", {"name": "Demo", "extra": True})[0], 400)
            self.assertEqual(request("/api/scenes")[1], {"scenes": []})
        finally:
            service.shutdown()
            service.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
