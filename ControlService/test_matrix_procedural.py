"""Procedural tools use the ordinary queue, observed receipts and world saves."""
import copy
from pathlib import Path
import tempfile
import unittest

from matrix_tool_bridge import (MatrixToolBridge, list_procedural_generators,
                                procedural_action, procedural_status)
from procedural_contract import (ProceduralError, available_recipe,
                                 checked_generators, new_recipe, revised_recipe)
from server import APIError, State, scene, snapshot


POSE = {"position": {"x": 0, "y": 0, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
GENERATOR = {"generatorId": "bridge", "generatorVersion": "1.0.0",
             "sourceRevision": "bridge-v1", "description": "A reviewed bridge generator",
             "parameterSchema": {
                 "lengthMeters": {"type": "number", "default": 6, "min": 2, "max": 12},
                 "widthMeters": {"type": "number", "default": 1.5, "min": .8, "max": 4},
                 "railings": {"type": "boolean", "default": True}},
             "dependencies": []}
RIGID = {"schemaVersion": 1, "type": "static", "collider": "procedural-mesh",
         "restitution": .2, "friction": .8, "sensor": False}


class MatrixProceduralTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(Path(self.temp.name) / "scenes")
        self.snapshot = {"scene": {"schemaVersion": 1,
                                   "roomId": "web-virtual-room-v1", "objects": []},
                         "assets": [{"assetId": "matrix:procedural",
                                     "displayName": "Procedural object"}],
                         "anchors": [{"anchorId": "web-floor",
                                      "displayName": "Virtual floor"}],
                         "proceduralGenerators": [copy.deepcopy(GENERATOR)],
                         "rigidSchemaVersion": 1,
                         "rigidGravity": {"x": 0, "y": -9.81, "z": 0},
                         "rigidStates": [],
                         "creatorMode": {"schemaVersion": 1, "mode": "creator",
                                         "simulation": "paused", "revision": 0},
                         "gameStatus": None,
                         "roomContext": {"mode": "white-room", "state": "ready",
                                         "message": "Virtual room",
                                         "alignmentVerified": False}}
        self.exchange()

    def exchange(self, *, objects=None, request_id=None, ok=True, error="", object_id=""):
        value = copy.deepcopy(self.snapshot)
        if objects is not None:
            value["scene"]["objects"] = copy.deepcopy(objects)
        results = ([{"requestId": request_id, "ok": ok, "error": error,
                    "objectId": object_id}] if request_id else [])
        self.state.exchange({"clientId": "web-client", "snapshot": value,
                             "results": results})

    def request(self, **overrides):
        return {"action": "create", "room_id": "web-virtual-room-v1",
                "scene_revision": self.state.revision, "generator_id": "bridge",
                "parameters": {"lengthMeters": 7},
                "transform": copy.deepcopy(POSE), **overrides}

    def object(self, recipe=None, *, object_id="bridge-1", rigid=False):
        value = {"objectId": object_id, "assetId": "matrix:procedural",
                 "anchorId": "web-floor", "transform": copy.deepcopy(POSE),
                 "procedural": copy.deepcopy(recipe or new_recipe([GENERATOR], "bridge",
                                                              {"lengthMeters": 7}))}
        if rigid:
            value["rigidBody"] = copy.deepcopy(RIGID)
        return value

    def test_discovery_and_create_update_require_matching_observed_receipts(self):
        metadata = self.state.agent_list_procedural_generators()
        self.assertEqual(metadata["generators"], [GENERATOR])
        queued = self.state.agent_procedural_action(self.request())
        self.assertEqual(queued["status"], "queued")
        command = self.state.pending[queued["requestId"]]
        self.assertEqual(command["op"], "create_procedural")
        self.assertEqual(command["procedural"]["parameters"]["lengthMeters"], 7)
        self.exchange(request_id=queued["requestId"], object_id="bridge-1")
        self.assertEqual(self.state.agent_procedural_status(queued["requestId"])["status"],
                         "unconfirmed")
        # A new request, not an implicit retry, creates one observed object.
        second = self.state.agent_procedural_action(self.request())
        created = self.object()
        self.exchange(objects=[created], request_id=second["requestId"], object_id="bridge-1")
        self.assertEqual(self.state.agent_procedural_status(second["requestId"])["status"],
                         "succeeded")
        self.assertEqual(self.state.agent_procedural_status(second["requestId"])["objectId"],
                         "bridge-1")
        old = created["procedural"]
        update = self.state.agent_procedural_action({
            "action": "update", "room_id": "web-virtual-room-v1",
            "scene_revision": self.state.revision, "object_id": "bridge-1",
            "expected_source_revision": "bridge-v1",
            "parameters_patch": {"widthMeters": 2}})
        self.assertEqual(update["status"], "queued")
        self.assertEqual(self.state.pending[update["requestId"]]["expectedProcedural"], old)
        self.assertEqual(self.state.pending[update["requestId"]]["expectedTransform"], POSE)
        revised = self.object(revised_recipe([GENERATOR], old, {"widthMeters": 2}))
        self.exchange(objects=[revised], request_id=update["requestId"])
        self.assertEqual(self.state.agent_procedural_status(update["requestId"])["status"],
                         "succeeded")
        self.assertEqual(self.state.latest["scene"]["objects"][0]["objectId"], "bridge-1")

    def test_stale_versions_invalid_parameters_and_failed_receipts_leave_scene_intact(self):
        for bad in (self.request(scene_revision=0),
                    self.request(generator_id="missing"),
                    self.request(parameters={"lengthMeters": 100}),
                    self.request(parameters={"extra": 1})):
            with self.assertRaises(APIError):
                self.state.agent_procedural_action(bad)
        self.assertFalse(self.state.pending)
        queued = self.state.agent_procedural_action(self.request())
        self.exchange(request_id=queued["requestId"], ok=False,
                      error="Generator rejected geometry")
        failed = self.state.agent_procedural_status(queued["requestId"])
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(self.state.latest["scene"]["objects"], [])
        self.assertEqual(self.state.agent_procedural_status(queued["requestId"])["status"],
                         "failed")

    def test_browser_and_pc_checkpoint_preserve_recipe_rigid_body_and_mode(self):
        created = self.object(rigid=True)
        active = copy.deepcopy(self.snapshot)
        active["scene"]["objects"] = [created]
        active["rigidGravity"] = {"x": 0, "y": -4.5, "z": 0}
        active["creatorMode"]["revision"] = 2
        self.state.exchange({"clientId": "web-client", "snapshot": active, "results": []})
        world = {"version": 2, "scene": copy.deepcopy(active["scene"]),
                 "game": None, "creatorMode": copy.deepcopy(active["creatorMode"]),
                 "rigidGravity": copy.deepcopy(active["rigidGravity"])}
        self.state.save_world_checkpoint("procedural", world)
        restored = self.state.load_world_checkpoint("procedural")["world"]
        self.assertEqual(restored, world)
        self.assertEqual(restored["scene"]["objects"][0]["rigidBody"], RIGID)
        self.assertEqual(restored["scene"]["objects"][0]["procedural"], created["procedural"])
        self.state.latest["proceduralGenerators"] = []
        with self.assertRaisesRegex(APIError, "unavailable"):
            self.state.load_world_checkpoint("procedural")
        self.assertEqual(self.state.latest["scene"]["objects"][0]["objectId"], "bridge-1")

    def test_contract_rejects_malformed_metadata_and_incompatible_scene(self):
        with self.assertRaises(ProceduralError):
            checked_generators([{**GENERATOR, "parameterSchema": {
                "lengthMeters": {"type": "number", "default": True,
                                 "min": 2, "max": 12}}}])
        recipe = new_recipe([GENERATOR], "bridge")
        with self.assertRaises(ProceduralError):
            available_recipe({**recipe, "generatorVersion": "2.0.0"}, [GENERATOR])
        with self.assertRaisesRegex(APIError, "virtual-floor recipe"):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [{**self.object(), "anchorId": "measured-plane"}]})
        with self.assertRaisesRegex(APIError, "procedural asset"):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [{**self.object(), "assetId": "block"}]})
        with self.assertRaisesRegex(APIError, "rigid body"):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [{**self.object(rigid=True),
                                "rigidBody": {**RIGID, "type": "dynamic"}}]})
        with self.assertRaisesRegex(APIError, "generator registry"):
            snapshot({key: value for key, value in self.snapshot.items()
                      if key != "proceduralGenerators"} |
                     {"scene": {"schemaVersion": 1,
                                "roomId": "web-virtual-room-v1",
                                "objects": [self.object()]}})

    def test_private_bridge_uses_auth_and_same_generic_contract(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        self.assertEqual(list_procedural_generators(bridge.url, bridge.token)
                         ["generators"], [GENERATOR])
        import unittest.mock
        with unittest.mock.patch("matrix_tool_bridge.MOVE_WAIT", .02):
            result = procedural_action(bridge.url, bridge.token, self.request())
        self.assertEqual(result["status"], "queued")
        self.assertEqual(procedural_status(bridge.url, bridge.token,
                                           result["requestId"])["status"], "queued")


if __name__ == "__main__":
    unittest.main()
