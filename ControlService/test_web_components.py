"""Component command and snapshot validation on the PC boundary."""
import copy
import tempfile
import unittest

from server import APIError, State, command, scene, snapshot
from web_components import ComponentError, validate_package


EXPRESSION = {"op": "add", "args": [{"op": "target", "path": "position.x"},
                                   {"op": "cos", "arg": {"op": "time"}}]}
PACKAGE = {"schemaVersion": 1, "name": "Orbit pulse", "outputs": {"position.x": EXPRESSION}}
POSE = {"position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
ID = "webcomp:orbit-pulse:0123456789ab"


class WebComponentTests(unittest.TestCase):
    def test_component_roundtrips_through_command_scene_and_snapshot(self):
        sent = command({"op": "attach_component", "objectId": "orb", "targetObjectId": "table",
                        "componentId": ID, "package": PACKAGE})
        self.assertEqual(sent["package"], PACKAGE)
        objects = [{"objectId": key, "assetId": key, "anchorId": "web-floor", "transform": POSE}
                   for key in ("table", "orb")]
        objects[1]["component"] = {"componentId": ID, "package": PACKAGE,
                                   "targetObjectId": "table", "startedAtMs": 1000, "status": "running"}
        room = scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": objects})
        self.assertEqual(room["objects"][1]["component"], objects[1]["component"])
        self.assertEqual(snapshot({"scene": room, "assets": [], "anchors": [],
                                   "componentSchemaVersion": 1})["componentSchemaVersion"], 1)
        with self.assertRaises(APIError):
            snapshot({"scene": room, "assets": [], "anchors": [], "componentSchemaVersion": 2})

    def test_rejects_executable_shape_and_unbounded_component(self):
        for invalid in ({"op": "eval", "source": "window.localStorage"},
                        {"op": "target", "path": ["position.x"]},
                        {"op": "const", "value": float("nan")},
                        {"op": "sin", "arg": {"op": "sin", "arg": {"op": "sin", "arg":
                         {"op": "sin", "arg": {"op": "sin", "arg": {"op": "sin", "arg":
                         {"op": "sin", "arg": {"op": "sin", "arg": {"op": "time"}}}}}}}}}):
            package = copy.deepcopy(PACKAGE)
            package["outputs"]["position.x"] = invalid
            with self.assertRaises(ComponentError):
                validate_package(package)
        with self.assertRaises(APIError):
            command({"op": "attach_component", "objectId": "orb", "targetObjectId": "table",
                     "componentId": ID, "package": {**PACKAGE, "source": "fetch('/token')"}})

    def test_queue_requires_webxr_component_capability_and_uses_normal_receipt_path(self):
        with tempfile.TemporaryDirectory() as directory:
            state = State(directory)
            objects = [{"objectId": key, "assetId": key, "anchorId": "web-floor", "transform": POSE}
                       for key in ("table", "orb")]
            current = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": objects},
                       "assets": [], "anchors": [],
                       "roomContext": {"mode": "white-room", "state": "ready",
                                       "message": "Virtual room", "alignmentVerified": False}}
            state.exchange({"clientId": "web-test", "snapshot": current})
            attach = {"op": "attach_component", "objectId": "orb", "targetObjectId": "table",
                      "componentId": ID, "package": PACKAGE}
            with self.assertRaises(APIError):
                state.queue([attach])
            current["componentSchemaVersion"] = 1
            state.exchange({"clientId": "web-test", "snapshot": current})
            published = state.web_components.publish(PACKAGE)
            attach["componentId"] = published["componentId"]
            with self.assertRaises(APIError):
                state.queue([{**attach, "componentId": ID}])
            with self.assertRaises(APIError):
                state.queue([{**attach, "package": {**PACKAGE, "name": "Forged"}}])
            queued = state.queue([attach])["commands"][0]
            self.assertEqual(queued["op"], "attach_component")
            self.assertEqual(queued["package"], PACKAGE)
            self.assertEqual(len(state.pending), 1)
            state.exchange({"clientId": "web-test", "snapshot": current,
                            "results": [{"requestId": queued["requestId"], "ok": True,
                                         "objectId": "orb"}]})
            self.assertEqual(len(state.pending), 0)
            self.assertEqual(state.results[-1]["requestId"], queued["requestId"])


if __name__ == "__main__":
    unittest.main()
