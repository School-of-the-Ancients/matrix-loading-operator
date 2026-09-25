"""Matrix tools can edit AR previews without granting physical-surface placement."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from server import APIError, State
from test_web_assets import animated_glb


POSE = {"position": {"x": 0, "y": 0, "z": -3},
        "rotation": {"x": 0, "y": 180, "z": 0},
        "scale": {"x": .6, "y": .6, "z": .6}}
PACKAGE = {"schemaVersion": 1, "name": "Glow pulse", "outputs": {
    "scale.y": {"op": "const", "value": .7}}}


class MatrixARVirtualFloorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = State(root / "state", web_assets_directory=root / "assets")
        source = root / "dragon.glb"
        source.write_bytes(animated_glb())
        self.asset = self.state.web_assets.register(source, "Ice Dragon")
        self.asset_id = self.asset["assetId"]
        self.room_id = "webxr-session-test"
        self.room = {"scene": {"schemaVersion": 1, "roomId": self.room_id, "objects": []},
                     "assets": [{"assetId": self.asset_id, "displayName": "Ice Dragon",
                                 "animationClips": ["Flight"]}],
                     "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                     "animationSchemaVersion": 1, "componentSchemaVersion": 1,
                     "roomContext": {"mode": "ar", "state": "ready", "alignmentVerified": False,
                                     "message": "Virtual-floor objects are unanchored previews"}}
        self.exchange()

    def exchange(self, *, request_id=None, object_id="", ok=True):
        results = ([{"requestId": request_id, "ok": ok, "error": "", "objectId": object_id}]
                   if request_id else [])
        self.state.exchange({"clientId": "web-client", "snapshot": deepcopy(self.room),
                             "results": results})

    def request(self, **extra):
        return {"room_id": self.room_id, "scene_revision": self.state.revision, **extra}

    def test_spawn_move_bind_and_component_keep_runtime_receipts_in_unaligned_ar(self):
        spawn = self.state.agent_spawn(self.request(asset_id=self.asset_id, transform=deepcopy(POSE)))
        self.assertEqual(spawn["status"], "queued")
        self.room["scene"]["objects"] = [
            {"objectId": "dragon-1", "assetId": self.asset_id, "anchorId": "web-floor",
             "transform": deepcopy(POSE)},
            {"objectId": "dragon-2", "assetId": self.asset_id, "anchorId": "web-floor",
             "transform": deepcopy(POSE)}]
        self.exchange(request_id=spawn["requestId"], object_id="dragon-1")
        self.assertEqual(self.state.agent_spawn_status(spawn["requestId"])["status"], "succeeded")

        position = {"x": 1, "y": 0, "z": -3}
        move = self.state.agent_move(self.request(object_id="dragon-1",
            expected_asset_id=self.asset_id, position=position))
        self.assertEqual(move["status"], "queued")
        self.room["scene"]["objects"][0]["transform"]["position"] = position
        self.exchange(request_id=move["requestId"], object_id="dragon-1")
        self.assertEqual(self.state.agent_move_status(move["requestId"])["status"], "succeeded")

        animation = self.state.agent_bind_animation(self.request(object_id="dragon-1",
            expected_asset_id=self.asset_id, loop_clip="Flight", select_clip=None))
        self.assertEqual(animation["status"], "queued")
        self.room["scene"]["objects"][0]["animation"] = {"loopClip": "Flight", "selectClip": None}
        self.exchange(request_id=animation["requestId"], object_id="dragon-1")
        self.assertEqual(self.state.agent_animation_status(animation["requestId"])["status"], "succeeded")

        component_id = self.state.agent_publish_component({"package": PACKAGE})["componentId"]
        attach = self.state.agent_component_action(self.request(action="attach",
            object_id="dragon-1", expected_asset_id=self.asset_id, component_id=component_id,
            target_object_id="dragon-2"))
        self.assertEqual(attach["status"], "queued")
        self.room["scene"]["objects"][0]["component"] = {
            "componentId": component_id, "package": PACKAGE, "targetObjectId": "dragon-2",
            "startedAtMs": 1000, "status": "running"}
        self.exchange(request_id=attach["requestId"], object_id="dragon-1")
        self.assertEqual(self.state.agent_component_status(attach["requestId"])["status"], "succeeded")

    def test_unaligned_ar_still_rejects_physical_edits_and_unavailable_origin(self):
        with self.assertRaisesRegex(APIError, "confirm room alignment"):
            self.state.queue([{"op": "spawn", "assetId": self.asset_id,
                               "anchorId": "physical-floor", "transform": POSE}])
        with self.assertRaisesRegex(APIError, "confirm room alignment"):
            self.state.queue([{"op": "spawn", "assetId": self.asset_id,
                               "anchorId": "web-floor", "placement": "surface", "transform": POSE}])
        self.assertFalse(self.state.pending)

        self.room["roomContext"]["state"] = "missing"
        self.room["readOnly"] = True
        self.exchange()
        with self.assertRaises(APIError):
            self.state.agent_spawn(self.request(asset_id=self.asset_id, transform=POSE))
        self.assertFalse(self.state.pending)


if __name__ == "__main__":
    unittest.main()
