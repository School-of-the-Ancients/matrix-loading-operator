"""Web gravity-floor schema, authority, and observed-state boundaries."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from server import (APIError, MAX_PHYSICS_BODIES, State, command, physics_config,
                    scene, snapshot)
from test_web_assets import glb


PHYSICS = {"schemaVersion": 1, "kind": "gravity-floor",
           "collider": "rendered-bounds-box", "restitution": .25}
POSE = {"position": {"x": 0, "y": 2, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
GLB_BYTES = glb()
ASSET_ID = "web:physics-fixture:" + hashlib.sha256(GLB_BYTES).hexdigest()[:12]
ASSET = {"assetId": ASSET_ID, "displayName": "Physics fixture",
         "spawnScale": 1}
CONTACT = {"index": 1, "surface": "web-floor", "impactSpeedMps": 4.2,
           "approximate": True}


def object_value(index=0, physics=False):
    value = {"objectId": f"glb-{index}", "assetId": ASSET_ID,
             "anchorId": "web-floor", "transform": copy.deepcopy(POSE)}
    if physics:
        value["physics"] = copy.deepcopy(PHYSICS)
    return value


def snapshot_value(objects=None, mode="white-room", physics_capability=True):
    value = {"scene": {"schemaVersion": 1,
                       "roomId": "web-virtual-room-v1" if mode == "white-room" else "webxr-session-1",
                       "objects": copy.deepcopy(objects if objects is not None else [object_value()])},
             "assets": [copy.deepcopy(ASSET)],
             "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
             "roomContext": {"mode": mode, "state": "ready", "message": "Ready",
                             "alignmentVerified": False}}
    if physics_capability:
        value["physicsSchemaVersion"] = 1
    return value


def state_with_asset(directory, value):
    state = State(directory, web_assets_directory=Path(directory) / "web-assets")
    source = Path(directory) / "physics-fixture.glb"
    source.write_bytes(GLB_BYTES)
    registered = state.web_assets.register(source, "Physics fixture")
    assert registered["assetId"] == ASSET_ID and "localBounds" not in registered
    state.exchange({"clientId": "web-physics-test", "snapshot": value})
    return state


class WebPhysicsContractTests(unittest.TestCase):
    def test_exact_physics_config_and_scene_budget(self):
        self.assertEqual(physics_config(PHYSICS), PHYSICS)
        legacy = {**PHYSICS, "collider": "catalog-bounds-box"}
        self.assertEqual(physics_config(legacy), PHYSICS)
        self.assertEqual(scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                                "objects": [object_value(physics=True) | {"physics": legacy}]})
                         ["objects"][0]["physics"], PHYSICS)
        self.assertEqual(command({"op": "set_physics", "objectId": "glb-0",
                                  "physics": PHYSICS})["physics"], PHYSICS)
        self.assertEqual(command({"op": "remove_physics", "objectId": "glb-0"}),
                         {"op": "remove_physics", "objectId": "glb-0"})
        for invalid in ({**PHYSICS, "restitution": True},
                        {**PHYSICS, "restitution": -.1},
                        {**PHYSICS, "restitution": .76},
                        {**PHYSICS, "restitution": float("nan")},
                        {**PHYSICS, "source": "eval('x')"}):
            with self.subTest(invalid=invalid), self.assertRaises(APIError):
                command({"op": "set_physics", "objectId": "glb-0", "physics": invalid})
        room = {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                "objects": [object_value(i, True) for i in range(MAX_PHYSICS_BODIES)]}
        self.assertEqual(len(scene(room)["objects"]), MAX_PHYSICS_BODIES)
        room["objects"].append(object_value(MAX_PHYSICS_BODIES, True))
        with self.assertRaisesRegex(APIError, "physics body limit"):
            scene(room)

    def test_snapshot_observations_are_transient_and_do_not_advance_scene_revision(self):
        value = snapshot_value([object_value(physics=True)])
        state_value = {"objectId": "glb-0", "executionId": "run-1", "status": "falling",
                       "position": copy.deepcopy(POSE["position"]),
                       "verticalVelocityMps": -1, "contactCount": 0, "lastContact": None}
        value["physicsStates"] = [state_value]
        self.assertEqual(snapshot(value)["physicsStates"], [state_value])
        with tempfile.TemporaryDirectory() as directory:
            state = state_with_asset(directory, value)
            revision = state.revision
            value["physicsStates"][0].update(status="settled", verticalVelocityMps=0,
                                             contactCount=1, lastContact=CONTACT)
            value["physicsStates"][0]["position"]["y"] = 0
            state.exchange({"clientId": "web-physics-test", "snapshot": value})
            self.assertEqual(state.revision, revision)
            self.assertEqual(state.latest["physicsStates"][0]["lastContact"], CONTACT)
            state.save("Physics Scene")
            saved = json.loads((state.directory / "Physics Scene.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["scene"]["objects"][0]["physics"], PHYSICS)
            self.assertNotIn("physicsStates", saved)
        without_capability = copy.deepcopy(value)
        del without_capability["physicsSchemaVersion"]
        with self.assertRaises(APIError):
            snapshot(without_capability)
        in_ar = copy.deepcopy(value)
        in_ar["roomContext"]["mode"] = "ar"
        with self.assertRaisesRegex(APIError, "White Room"):
            snapshot(in_ar)
        in_ar.pop("physicsStates")
        self.assertEqual(snapshot(in_ar)["scene"]["objects"][0]["physics"], PHYSICS)

    def test_observation_rejects_forged_or_duplicate_contacts(self):
        value = snapshot_value([object_value(physics=True)])
        observed = {"objectId": "glb-0", "executionId": "run-1", "status": "settled",
                    "position": copy.deepcopy(POSE["position"]),
                    "verticalVelocityMps": 0, "contactCount": 1,
                    "lastContact": copy.deepcopy(CONTACT)}
        for edit in (lambda v: v.update(objectId="unknown"),
                     lambda v: v.update(verticalVelocityMps=float("inf")),
                     lambda v: v["lastContact"].update(index=2),
                     lambda v: v["lastContact"].update(approximate=False)):
            invalid = copy.deepcopy(observed)
            edit(invalid)
            value["physicsStates"] = [invalid]
            with self.assertRaises(APIError):
                snapshot(value)
        value["physicsStates"] = [observed, copy.deepcopy(observed)]
        with self.assertRaisesRegex(APIError, "duplicate"):
            snapshot(value)

    def test_queue_requires_registered_glb_identity_and_current_scale_not_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            value = snapshot_value()
            state = state_with_asset(directory, value)
            registered = state.web_assets.list()
            self.assertNotIn("localBounds", registered[0])
            op = {"op": "set_physics", "objectId": "glb-0", "physics": PHYSICS}
            saved_revision = state.revision
            state.web_assets.root.joinpath("manifest.json").write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(APIError, "registered GLB"):
                state.queue([op])
            self.assertEqual(state.revision, saved_revision)
            self.assertFalse(state.pending)
            state.web_assets.register(Path(directory) / "physics-fixture.glb", "Physics fixture")
            state.latest["assets"][0]["spawnScale"] = 2
            with self.assertRaisesRegex(APIError, "identity and scale"):
                state.queue([op])
            state.latest["assets"][0]["spawnScale"] = 1
            queued = state.queue([op])["commands"][0]
            self.assertEqual(queued["op"], "set_physics")
            self.assertEqual(queued["physics"], PHYSICS)
            self.assertIn(queued["requestId"], state.pending)
            updated = snapshot_value([object_value(physics=True)])
            state.exchange({"clientId": "web-physics-test", "snapshot": updated,
                            "results": [{"requestId": queued["requestId"], "ok": True,
                                         "objectId": "glb-0"}]})
            self.assertEqual(state.results[-1]["requestId"], queued["requestId"])
            removed = state.queue([{"op": "remove_physics", "objectId": "glb-0"}])["commands"][0]
            self.assertEqual(removed["op"], "remove_physics")
        with tempfile.TemporaryDirectory() as directory:
            ar = snapshot_value(mode="ar")
            state = state_with_asset(directory, ar)
            with self.assertRaisesRegex(APIError, "White Room"):
                state.queue([op])

    def test_queue_rejects_competing_writers_and_invalid_rebase(self):
        with tempfile.TemporaryDirectory() as directory:
            state = state_with_asset(directory, snapshot_value([object_value(physics=True)]))
            revision = state.revision
            package = {"schemaVersion": 1, "name": "Static",
                       "outputs": {"position.y": {"op": "const", "value": 1}}}
            commands = [
                {"op": "set_behavior", "objectId": "glb-0",
                 "behavior": {"kind": "bob"}},
                {"op": "attach_component", "objectId": "glb-0", "targetObjectId": "another",
                 "componentId": "webcomp:static:0123456789ab", "package": package},
                {"op": "set_transform", "objectId": "glb-0",
                 "transform": {**copy.deepcopy(POSE),
                               "rotation": {"x": 10, "y": 0, "z": 0}}},
            ]
            for op in commands:
                with self.subTest(op=op["op"]), self.assertRaises(APIError):
                    state.queue([op])
            self.assertEqual(state.revision, revision)
            self.assertFalse(state.pending)

    def test_batch_cannot_overfill_physics_body_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            objects = [object_value(i) for i in range(MAX_PHYSICS_BODIES + 1)]
            state = state_with_asset(directory, snapshot_value(objects))
            revision = state.revision
            operations = [{"op": "set_physics", "objectId": item["objectId"],
                           "physics": PHYSICS} for item in objects]
            with self.assertRaisesRegex(APIError, "physics body limit"):
                state.queue(operations)
            self.assertEqual(state.revision, revision)
            self.assertFalse(state.pending)

    def test_batch_rejects_same_object_physics_writer_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            state = state_with_asset(directory, snapshot_value())
            revision = state.revision
            operations = [{"op": "set_physics", "objectId": "glb-0", "physics": PHYSICS},
                          {"op": "set_transform", "objectId": "glb-0",
                           "transform": copy.deepcopy(POSE)}]
            with self.assertRaisesRegex(APIError, "conflicting physics"):
                state.queue(operations)
            self.assertEqual(state.revision, revision)
            self.assertFalse(state.pending)


if __name__ == "__main__":
    unittest.main()
