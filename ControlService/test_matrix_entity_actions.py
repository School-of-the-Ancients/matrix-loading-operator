import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from matrix_tool_bridge import (MatrixToolBridge, entity_action, entity_status,
                                inspect_entity, list_entities)
from server import APIError, Server, State


POSE = {"position": {"x": 0, "y": .5, "z": 0},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
BODY = {"schemaVersion": 1, "type": "dynamic", "collider": "bounds-box",
        "restitution": .2, "friction": .7, "sensor": False}


def rigid_state(x=0, *, held=False):
    return {"objectId": "block-1", "type": "dynamic", "held": held,
            "position": {"x": x, "y": .5, "z": 0},
            "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
            "linearVelocity": {"x": 0, "y": 0, "z": 0},
            "angularVelocity": {"x": 0, "y": 0, "z": 0}, "sleeping": False}


class MatrixEntityActionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(Path(self.temp.name) / "scenes")
        self.snapshot = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                                   "objects": [{"objectId": "block-1", "assetId": "block",
                                                "anchorId": "web-floor",
                                                "transform": copy.deepcopy(POSE),
                                                "rigidBody": copy.deepcopy(BODY)}]},
                         "assets": [{"assetId": "block", "displayName": "Block",
                                     "localBounds": {"center": {"x": 0, "y": .5, "z": 0},
                                                     "size": {"x": 1, "y": 1, "z": 1}}}],
                         "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                         "rigidSchemaVersion": 1,
                         "rigidGravity": {"x": 0, "y": -9.81, "z": 0},
                         "rigidStates": [rigid_state()],
                         "entityActionSchemaVersion": 1, "agentGrab": None,
                         "creatorMode": {"schemaVersion": 1, "mode": "play",
                                         "simulation": "running", "revision": 1},
                         "gameStatus": None,
                         "roomContext": {"mode": "white-room", "state": "ready",
                                         "message": "Virtual room",
                                         "alignmentVerified": False}}
        self.exchange()

    def exchange(self, *, receipt=None):
        self.state.exchange({"clientId": "web-client", "snapshot": copy.deepcopy(self.snapshot),
                             "results": [receipt] if receipt else []})

    def inspection_outcome(self, actions):
        obj = copy.deepcopy(self.snapshot["scene"]["objects"][0])
        return {"schemaVersion": 1, "kind": "entity-inspection",
                "roomId": "web-virtual-room-v1", "object": obj,
                "rigidState": copy.deepcopy(self.snapshot["rigidStates"][0]),
                "colliderScope": "virtual-floor", "availableActions": actions,
                "creatorMode": copy.deepcopy(self.snapshot["creatorMode"]),
                "gameStatus": None, "gameRoles": [],
                "displayObservation": None,
                "agentGrab": copy.deepcopy(self.snapshot["agentGrab"]),
                "roomContext": {"mode": "white-room", "state": "ready",
                                "alignmentVerified": False}}

    def inspect(self, actions):
        queued = self.state.agent_inspect_entity({"room_id": "web-virtual-room-v1",
                                                  "scene_revision": self.state.revision,
                                                  "object_id": "block-1"})
        self.assertEqual(queued["status"], "queued")
        self.exchange(receipt={"requestId": queued["requestId"], "ok": True,
                               "error": "", "objectId": "block-1",
                               "outcome": self.inspection_outcome(actions)})
        confirmed = self.state.agent_entity_status(queued["requestId"])
        self.assertEqual(confirmed["status"], "succeeded")
        return queued["requestId"]

    def action(self, action, inspection_id, *, target=None):
        request = {"action": action, "room_id": "web-virtual-room-v1",
                   "object_id": "block-1", "inspection_request_id": inspection_id}
        if target is not None:
            request["target_pose"] = target
        return self.state.agent_entity_action(request)

    def action_outcome(self, kind, request_id, grab_id, x, *, held, release=False):
        result = {"schemaVersion": 1, "kind": kind, "objectId": "block-1",
                  "grabId": grab_id, "rigidState": rigid_state(x, held=held),
                  "transform": copy.deepcopy(self.snapshot["scene"]["objects"][0]["transform"]),
                  "creatorMode": copy.deepcopy(self.snapshot["creatorMode"])}
        if release:
            result.update(gameEvent=None, gameStatus=None)
        return result

    def test_inspect_begin_move_release_with_exact_receipts(self):
        first = self.inspect(["begin_grab"])
        began = self.action("begin", first)
        command = self.state.pending[began["requestId"]]
        self.assertEqual(command["expectedTransform"], POSE)
        self.assertEqual(command["expectedCreatorRevision"], 1)
        self.assertEqual(self.state.agent_entity_status(began["requestId"])["status"],
                         "queued")
        grab_id = began["requestId"]
        self.snapshot["agentGrab"] = {"objectId": "block-1", "grabId": grab_id,
                                      "expiresAtMs": 1800000000000}
        self.snapshot["rigidStates"] = [rigid_state(held=True)]
        before_observation = self.state.revision
        self.exchange(receipt={"requestId": grab_id, "ok": True, "error": "",
                               "objectId": "block-1",
                               "outcome": self.action_outcome("grab-began", grab_id,
                                                              grab_id, 0, held=True)})
        self.assertEqual(self.state.revision, before_observation)
        self.assertEqual(self.state.agent_entity_status(grab_id)["status"], "succeeded")
        held_inspection = self.inspect(["move_grab", "release_grab"])
        target = {"position": {"x": 1, "y": .5, "z": 0},
                  "rotation": {"x": 0, "y": 0, "z": 0}}
        with self.assertRaisesRegex(APIError, "bounded move range"):
            self.action("move", held_inspection, target={
                **target, "position": {"x": 4, "y": .5, "z": 0}})
        moved = self.action("move", held_inspection, target=target)
        self.assertEqual(self.state.pending[moved["requestId"]]["grabId"], grab_id)
        with self.assertRaisesRegex(APIError, "not ready"):
            self.action("move", held_inspection, target=target)
        self.snapshot["scene"]["objects"][0]["transform"]["position"]["x"] = 1
        self.snapshot["rigidStates"] = [rigid_state(1, held=True)]
        self.exchange(receipt={"requestId": moved["requestId"], "ok": True,
                               "error": "", "objectId": "block-1",
                               "outcome": self.action_outcome("grab-moved", moved["requestId"],
                                                              grab_id, 1, held=True)})
        self.assertEqual(self.state.agent_entity_status(moved["requestId"])["status"],
                         "succeeded")
        after_move = self.inspect(["move_grab", "release_grab"])
        released = self.action("release", after_move)
        self.snapshot["agentGrab"] = None
        self.snapshot["rigidStates"] = [rigid_state(1, held=False)]
        self.exchange(receipt={"requestId": released["requestId"], "ok": True,
                               "error": "", "objectId": "block-1",
                               "outcome": self.action_outcome("grab-released",
                                                              released["requestId"], grab_id,
                                                              1, held=False, release=True)})
        self.assertEqual(self.state.agent_entity_status(released["requestId"])["status"],
                         "succeeded")

    def test_uncertain_receipt_and_stale_inspection_never_retry(self):
        first = self.inspect(["begin_grab"])
        self.snapshot["scene"]["objects"][0]["transform"]["position"]["x"] = .1
        self.snapshot["rigidStates"] = [rigid_state(.1)]
        self.exchange()
        with self.assertRaisesRegex(APIError, "changed since inspection"):
            self.action("begin", first)
        fresh = self.inspect(["begin_grab"])
        queued = self.action("begin", fresh)
        self.exchange(receipt={"requestId": queued["requestId"], "ok": False,
                               "error": "Client lease expired; command outcome unknown",
                               "objectId": ""})
        self.assertEqual(self.state.agent_entity_status(queued["requestId"])["status"],
                         "unconfirmed")
        with self.assertRaisesRegex(APIError, "Inspect the current entity"):
            self.action("begin", fresh)

    def test_pages_and_private_bridge_cover_all_entities(self):
        for index in range(2, 31):
            self.snapshot["scene"]["objects"].append({
                "objectId": f"block-{index}", "assetId": "block", "anchorId": "web-floor",
                "transform": copy.deepcopy(POSE)})
        self.exchange()
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        first = list_entities(bridge.url, bridge.token, 0, 24)
        self.assertEqual(first["total"], 30)
        self.assertEqual(first["nextOffset"], 24)
        second = list_entities(bridge.url, bridge.token, 24, 24)
        self.assertEqual(second["objects"][-1]["objectId"], "block-30")
        self.assertIsNone(second["nextOffset"])
        import unittest.mock
        with unittest.mock.patch("matrix_tool_bridge.MOVE_WAIT", .02):
            queued = inspect_entity(bridge.url, bridge.token,
                                    {"room_id": "web-virtual-room-v1",
                                     "scene_revision": self.state.revision,
                                     "object_id": "block-1"})
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(entity_status(bridge.url, bridge.token,
                                       queued["requestId"])["status"], "queued")

    def test_http_exchange_accepts_typed_live_display_inspection(self):
        display = {"schemaVersion": 1, "title": "Scale reading", "body": "",
                   "binding": {"kind": "object-transform", "objectId": "block-1"}}
        self.snapshot["scene"]["objects"][0]["display"] = display
        self.exchange()
        queued = self.state.agent_inspect_entity({"room_id": "web-virtual-room-v1",
                                                  "scene_revision": self.state.revision,
                                                  "object_id": "block-1"})
        observation = {"status": "current", "source": "MatrixWorld.scene.objects",
                       "text": "Position (m) (0.00, 0.50, 0.00); rotation (deg) "
                               "(0.00, 0.00, 0.00); scale (unitless) "
                               "(1.000, 1.000, 1.000); local size (m) "
                               "(1.000, 1.000, 1.000)."}
        outcome = self.inspection_outcome([])
        outcome["displayObservation"] = observation
        server = Server(("127.0.0.1", 0), self.state, "test-owner-secret-at-least-24-characters")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/api/exchange"
        def post(result):
            body = {"clientId": "web-client", "snapshot": self.snapshot,
                    "results": [result]}
            request = urllib.request.Request(url, data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json",
                         "Authorization": "Bearer test-owner-secret-at-least-24-characters"})
            try:
                with urllib.request.urlopen(request, timeout=3) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code
        receipt = {"requestId": queued["requestId"], "ok": True, "error": "",
                   "objectId": "block-1", "outcome": outcome}
        self.assertEqual(post(receipt), 200)
        confirmed = self.state.agent_entity_status(queued["requestId"])
        self.assertEqual(confirmed["status"], "succeeded")
        self.assertEqual(confirmed["outcome"]["displayObservation"], observation)

        second = self.state.agent_inspect_entity({"room_id": "web-virtual-room-v1",
                                                  "scene_revision": self.state.revision,
                                                  "object_id": "block-1"})
        bad = copy.deepcopy(outcome)
        bad["displayObservation"]["source"] = "untrusted-source"
        self.assertEqual(post({**receipt, "requestId": second["requestId"],
                               "outcome": bad}), 400)


if __name__ == "__main__":
    unittest.main()
