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

from server import APIError, Server, State, world_checkpoint_digest
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

    def citizens_world(self):
        world = copy.deepcopy(self.world)
        for object_id, asset_id, x in (("citizen-ada", "orb", -2),
                                       ("citizen-bo", "orb", 2),
                                       ("citizen-chair", "chair", 0),
                                       ("citizen-table", "table", 1)):
            pose = copy.deepcopy(POSE)
            pose["position"]["x"] = x
            if asset_id == "orb":
                pose["scale"] = {"x": .7, "y": .7, "z": .7}
            world["scene"]["objects"].append({"objectId": object_id, "assetId": asset_id,
                                                "anchorId": "web-floor", "transform": pose})
        active = copy.deepcopy(self.snapshot)
        active["scene"] = copy.deepcopy(world["scene"])
        active["assets"].extend({"assetId": asset_id, "displayName": asset_id.title()}
                                for asset_id in ("orb", "chair", "table"))
        self.state.exchange({"clientId": "browser", "snapshot": active, "results": []})
        world["version"] = 3
        world["citizens"] = {
            "schemaVersion": 1, "world": {"schemaVersion": 1, "roomId": "web-virtual-room-v1"},
            "seed": 73, "rngState": 14362, "requestSequence": 9, "clockTick": 12,
            "paused": True,
            "residents": [
                {"id": "ada", "name": "Ada", "objectId": "citizen-ada",
                 "needs": {"hunger": 70, "energy": 25, "fun": 60},
                 "preferences": {"rest": 1.2, "eat": .85, "explore": .75},
                 "activity": {"kind": "rest", "stationId": "chair", "phase": "travel",
                              "remainingTicks": 7, "travelTicks": 2, "target": None},
                 "cooldowns": {"rest": 0, "eat": 0, "explore": 0}, "lastOutcome": ""},
                {"id": "bo", "name": "Bo", "objectId": "citizen-bo",
                 "needs": {"hunger": 40, "energy": 32, "fun": 55},
                 "preferences": {"rest": 1.1, "eat": 1, "explore": .75},
                 "activity": None, "cooldowns": {"rest": 0, "eat": 0, "explore": 0},
                 "lastOutcome": "Completed explore at minute 8"}],
            "stations": [{"id": "chair", "kind": "rest", "objectId": "citizen-chair",
                          "capacity": 1, "holder": "ada"},
                         {"id": "food", "kind": "eat", "objectId": "citizen-table",
                          "capacity": 1, "holder": None}],
            "log": [{"tick": 10, "residentId": "ada", "event": "selected",
                     "message": "Ada chose rest."},
                    {"tick": 11, "residentId": "bo", "event": "blocked",
                     "message": "Chair occupied by Ada."}]}
        return world

    def citizens_v2_world(self):
        world = self.citizens_world()
        state = world["citizens"]
        state.update(schemaVersion=2, actionSequence=2, retiredResidentIds=[])
        state["residents"][0]["activity"]["executionId"] = 1
        chair, food = state["stations"]
        chair.pop("holder")
        chair.update(claim={"residentId": "ada", "executionId": 1, "expiresTick": 24},
                     waiters=[{"residentId": "bo", "executionId": 2, "enqueuedTick": 11}])
        food.pop("holder")
        food.update(claim=None, waiters=[])
        state["log"].append({"tick": 11, "residentId": "bo", "event": "waiting",
                             "message": "Bo queued for the chair."})
        return world

    def citizens_v3_world(self):
        world = self.citizens_v2_world()
        state = world["citizens"]
        state.update(schemaVersion=3, socialSession=None, socialEvents=[],
                     relationships=[{"a": "ada", "b": "bo", "score": 50}], nextSocialTick=35)
        state["residents"][0]["activity"] = None
        state["stations"][0]["claim"] = None
        state["stations"][0]["waiters"] = []
        for resident in state["residents"]:
            resident["socialSessionId"] = None
        return world

    def citizens_v3_offered_world(self):
        world = self.citizens_v3_world()
        state = world["citizens"]
        state["actionSequence"] = 3
        state["socialSession"] = {
            "id": "social-73-3", "executionId": 3, "initiatorId": "ada", "inviteeId": "bo",
            "phase": "offered", "startedTick": 12, "expiresTick": 16,
            "acceptedTick": None, "travelTicks": 0, "remainingTicks": 3}
        state["socialEvents"] = [{"id": "social-73-3-initiated-12", "event": "initiated",
                                  "tick": 12, "initiatorId": "ada", "inviteeId": "bo",
                                  "requestId": ""}]
        for resident in state["residents"]:
            resident["socialSessionId"] = "social-73-3"
        return world

    def citizens_v4_completed_world(self):
        world = self.citizens_v3_world()
        state = world["citizens"]
        state.update(schemaVersion=4, actionSequence=3, requestSequence=10,
                     clockTick=15, nextSocialTick=39)
        state["relationships"] = [{"a": "ada", "b": "bo", "score": 55,
                                   "completed": [{"sessionId": "social-73-3",
                                                  "requestId": "citizens-73-social-3-10",
                                                  "tick": 15}]}]
        state["socialEvents"] = [
            {"id": f"social-73-3-{event}-{tick}", "event": event, "tick": tick,
             "initiatorId": "ada", "inviteeId": "bo", "requestId": request_id}
            for event, tick, request_id in (("initiated", 12, ""),
                                            ("accepted", 13, ""),
                                            ("ended", 15, "citizens-73-social-3-10"))]
        return world

    def citizens_v5_rerouting_world(self):
        world = self.citizens_v4_completed_world()
        state = world["citizens"]
        state.update(schemaVersion=5, actionSequence=4)
        state["residents"][0]["activity"] = {
            "kind": "rest", "stationId": "chair", "phase": "travel",
            "remainingTicks": 7, "travelTicks": 2, "target": None,
            "executionId": 4, "routeRetries": 2,
            "routeGeometryId": "sha256:" + "a" * 64}
        state["stations"][0]["claim"] = {
            "residentId": "ada", "executionId": 4, "expiresTick": 24}
        state["log"].append({"tick": 15, "residentId": "ada", "event": "rerouted",
                             "message": "Ada found a new route to the chair."})
        return world

    def citizens_v4_authored_furniture_world(self, kind):
        world = self.citizens_v4_completed_world()
        state = world["citizens"]
        selected = next(station for station in state["stations"] if station["kind"] == kind)
        state["stations"] = [selected]
        selected_id = f"authored-{kind}-resource"
        selected_object = next(item for item in world["scene"]["objects"]
                               if item["objectId"] == selected["objectId"])
        selected_object["objectId"] = selected_id
        selected_object["transform"]["position"].update(x=3.25, z=-3.5)
        selected_object["transform"]["rotation"]["y"] = 35
        selected["objectId"] = selected_id
        # The other furniture and these wall/GLB objects remain ordinary
        # authored scene content; no checkpoint field stores UI selection.
        wall = {"objectId": "authored-wall", "assetId": "wall", "anchorId": "web-floor",
                "transform": copy.deepcopy(POSE)}
        wall["transform"]["position"].update(x=-3, z=1)
        world["scene"]["objects"].append(wall)
        for item in world["scene"]["objects"]:
            item.pop("component", None)
        active = copy.deepcopy(self.state.latest)
        active["scene"] = copy.deepcopy(world["scene"])
        active["assets"].append({"assetId": "wall", "displayName": "Wall"})
        self.state.exchange({"clientId": "browser", "snapshot": active, "results": []})
        return world, selected_id

    def test_citizens_v4_selected_authored_furniture_checkpoint_roundtrip(self):
        for kind in ("rest", "eat"):
            with self.subTest(kind=kind):
                world, selected_id = self.citizens_v4_authored_furniture_world(kind)
                before_runtime = copy.deepcopy(self.state.latest)
                self.assertTrue(self.state.save_world_checkpoint("AuthoredFurniture", world)["saved"])
                loaded = self.state.load_world_checkpoint("AuthoredFurniture")["world"]
                self.assertEqual(loaded, world)
                self.assertEqual(loaded["citizens"]["stations"],
                                 [{"id": "chair" if kind == "rest" else "food", "kind": kind,
                                   "objectId": selected_id, "capacity": 1,
                                   "claim": None, "waiters": []}])
                self.assertIn("authored-wall", {item["objectId"] for item in loaded["scene"]["objects"]})
                self.assertIn("pickup-1", {item["objectId"] for item in loaded["scene"]["objects"]})
                self.assertEqual(self.state.latest, before_runtime)

    def test_citizens_v4_exploration_target_uses_bounded_world_coordinates(self):
        world, _ = self.citizens_v4_authored_furniture_world("rest")
        state = world["citizens"]
        state["actionSequence"] = 4
        state["residents"][0]["activity"] = {
            "kind": "explore", "stationId": None, "phase": "travel",
            "remainingTicks": 1, "travelTicks": 0,
            "target": {"x": 51.25, "z": -3.5}, "executionId": 4}
        self.assertTrue(self.state.save_world_checkpoint("FarExplore", world)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("FarExplore")["world"], world)

        outside_floor = copy.deepcopy(world)
        outside_floor["citizens"]["residents"][0]["activity"]["target"]["x"] = 100.01
        with self.assertRaisesRegex(APIError, "Invalid Citizens exploration target"):
            self.state.save_world_checkpoint("FarExplore", outside_floor)

        old = self.citizens_v3_world()
        old["citizens"]["actionSequence"] = 4
        old["citizens"]["residents"][0]["activity"] = copy.deepcopy(
            state["residents"][0]["activity"])
        with self.assertRaisesRegex(APIError, "Invalid Citizens exploration target"):
            self.state.save_world_checkpoint("OldFarExplore", old)

    def test_citizens_v5_route_retries_and_geometry_roundtrip_with_raw_v4(self):
        world = self.citizens_v5_rerouting_world()
        before_runtime = copy.deepcopy(self.state.latest)
        for retries, geometry in ((0, None), (2, "sha256:" + "a" * 64),
                                  (3, "\U0001f642" * 64)):
            with self.subTest(retries=retries, geometry=geometry):
                candidate = copy.deepcopy(world)
                activity = candidate["citizens"]["residents"][0]["activity"]
                activity.update(routeRetries=retries, routeGeometryId=geometry)
                self.assertTrue(self.state.save_world_checkpoint("RouteRecovery", candidate)["saved"])
                self.assertEqual(self.state.load_world_checkpoint("RouteRecovery")["world"]["citizens"],
                                 candidate["citizens"])
                self.assertEqual(self.state.latest, before_runtime)

        # PC persistence keeps older snapshots exactly in their original
        # nested schema. The browser adds the v5 defaults when restoring them.
        legacy = copy.deepcopy(world)
        old_state = legacy["citizens"]
        old_state["schemaVersion"] = 4
        old_activity = old_state["residents"][0]["activity"]
        old_activity.pop("routeRetries")
        old_activity.pop("routeGeometryId")
        old_state["log"].pop()
        self.assertTrue(self.state.save_world_checkpoint("LegacyRoute", legacy)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("LegacyRoute")["world"]["citizens"],
                         legacy["citizens"])
        self.assertEqual(self.state.latest, before_runtime)

    def test_citizens_v5_rejects_invalid_route_state_without_overwriting_checkpoint(self):
        world = self.citizens_v5_rerouting_world()
        self.assertTrue(self.state.save_world_checkpoint("RouteRecovery", world)["saved"])
        path = self.scenes / "world_checkpoints" / "RouteRecovery.json"
        original = path.read_bytes()
        original_runtime = copy.deepcopy(self.state.latest)

        def activity(item):
            return item["citizens"]["residents"][0]["activity"]

        cases = (
            ("missing retry count", lambda item: activity(item).pop("routeRetries")),
            ("missing geometry ID", lambda item: activity(item).pop("routeGeometryId")),
            ("extra route field", lambda item: activity(item).update(routeLength=1)),
            ("boolean retry count", lambda item: activity(item).update(routeRetries=True)),
            ("fractional retry count", lambda item: activity(item).update(routeRetries=1.5)),
            ("negative retry count", lambda item: activity(item).update(routeRetries=-1)),
            ("unbounded retry count", lambda item: activity(item).update(routeRetries=4)),
            ("numeric geometry ID", lambda item: activity(item).update(routeGeometryId=4)),
            ("empty geometry ID", lambda item: activity(item).update(routeGeometryId="")),
            ("overlong geometry ID", lambda item: activity(item).update(routeGeometryId="x" * 129)),
            ("UTF-16 geometry overflow", lambda item: activity(item).update(
                routeGeometryId="\U0001f642" * 65)),
            ("control in geometry ID", lambda item: activity(item).update(routeGeometryId="bad\nID")),
            ("surrogate geometry ID", lambda item: activity(item).update(routeGeometryId="\ud800")),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with self.assertRaises(APIError) as rejected:
                    self.state.save_world_checkpoint("RouteRecovery", invalid)
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(self.state.latest, original_runtime)

        load_cases = {"missing retry count", "missing geometry ID", "negative retry count",
                      "unbounded retry count", "overlong geometry ID"}
        for label, mutate in cases:
            if label not in load_cases:
                continue
            with self.subTest(load=label):
                document = json.loads(original)
                mutate(document["world"])
                document["payloadSha256"] = world_checkpoint_digest(
                    document["world"], document["dependencies"])
                path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaises(APIError) as rejected:
                    self.state.load_world_checkpoint("RouteRecovery")
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(self.state.latest, original_runtime)
                path.write_bytes(original)

        for has_route_fields in (True, False):
            with self.subTest(v4_has_route_fields=has_route_fields):
                legacy = copy.deepcopy(world)
                legacy["citizens"]["schemaVersion"] = 4
                if not has_route_fields:
                    activity(legacy).pop("routeRetries")
                    activity(legacy).pop("routeGeometryId")
                # V4 rejects the new fields, then separately rejects the
                # v5-only rerouted event after the activity shape is restored.
                with self.assertRaises(APIError):
                    self.state.save_world_checkpoint("RouteRecovery", legacy)
                self.assertEqual(path.read_bytes(), original)

    def test_citizens_v4_rejects_resized_or_elevated_resident(self):
        world, _ = self.citizens_v4_authored_furniture_world("rest")
        self.assertTrue(self.state.save_world_checkpoint("SizedResident", world)["saved"])
        path = self.scenes / "world_checkpoints" / "SizedResident.json"
        original = path.read_bytes()
        for field, value in (("scale", 1), ("height", 1)):
            with self.subTest(field=field):
                invalid = copy.deepcopy(world)
                resident = next(item for item in invalid["scene"]["objects"]
                                if item["objectId"] == "citizen-ada")
                if field == "scale":
                    resident["transform"]["scale"]["x"] = value
                else:
                    resident["transform"]["position"]["y"] = value
                with self.assertRaisesRegex(APIError, "unsupported size or height"):
                    self.state.save_world_checkpoint("SizedResident", invalid)
                self.assertEqual(path.read_bytes(), original)

                document = json.loads(original)
                saved_resident = next(item for item in document["world"]["scene"]["objects"]
                                      if item["objectId"] == "citizen-ada")
                saved_resident["transform"]["scale" if field == "scale" else "position"]["x" if field == "scale" else "y"] = value
                document["payloadSha256"] = world_checkpoint_digest(
                    document["world"], document["dependencies"])
                path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaisesRegex(APIError, "unsupported size or height"):
                    self.state.load_world_checkpoint("SizedResident")
                path.write_bytes(original)

    def test_citizens_v4_authored_furniture_missing_or_incompatible_rejected_atomically(self):
        world, selected_id = self.citizens_v4_authored_furniture_world("rest")
        self.state.save_world_checkpoint("AuthoredFurniture", world)
        path = self.scenes / "world_checkpoints" / "AuthoredFurniture.json"
        original = path.read_bytes()
        original_runtime = copy.deepcopy(self.state.latest)

        def remove_selected(item):
            item["scene"]["objects"] = [obj for obj in item["scene"]["objects"]
                                        if obj["objectId"] != selected_id]

        def make_incompatible(item):
            selected = next(obj for obj in item["scene"]["objects"]
                            if obj["objectId"] == selected_id)
            selected["assetId"] = "wall"

        for label, mutate in (("missing selected chair", remove_selected),
                              ("incompatible selected chair", make_incompatible)):
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with self.assertRaisesRegex(APIError, "Citizens station object is missing or incompatible"):
                    self.state.save_world_checkpoint("AuthoredFurniture", invalid)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(self.state.latest, original_runtime)

                document = json.loads(original)
                mutate(document["world"])
                document["payloadSha256"] = world_checkpoint_digest(
                    document["world"], document["dependencies"])
                path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaisesRegex(APIError, "Citizens station object is missing or incompatible"):
                    self.state.load_world_checkpoint("AuthoredFurniture")
                self.assertEqual(self.state.latest, original_runtime)
                path.write_bytes(original)

    def test_citizens_v4_relationship_proof_roundtrip_and_v3_shape(self):
        world = self.citizens_v4_completed_world()
        self.assertTrue(self.state.save_world_checkpoint("RelationshipProof", world)["saved"])
        loaded = self.state.load_world_checkpoint("RelationshipProof")["world"]
        self.assertEqual(loaded["citizens"], world["citizens"])
        self.assertEqual(loaded["citizens"]["relationships"][0]["score"], 55)

        # The bounded event ring can evict old events while retaining the last
        # ten completion records. A record is not required to be in that ring.
        history_rolled = copy.deepcopy(world)
        history_rolled["citizens"]["socialEvents"] = []
        self.assertTrue(self.state.save_world_checkpoint("RolledEvents", history_rolled)["saved"])

        saturated = copy.deepcopy(history_rolled)
        state = saturated["citizens"]
        state["actionSequence"] = 10
        state["relationships"][0]["score"] = 100
        state["relationships"][0]["completed"] = [
            {"sessionId": f"social-73-{index}",
             "requestId": f"citizens-73-social-{index}-{index}", "tick": index}
            for index in range(1, 11)]
        self.assertTrue(self.state.save_world_checkpoint("SaturatedRelation", saturated)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("SaturatedRelation")["world"]["citizens"],
                         state)
        overflow = copy.deepcopy(saturated)
        overflow_state = overflow["citizens"]
        overflow_state["actionSequence"] = 11
        overflow_state["requestSequence"] = 11
        overflow_state["relationships"][0]["completed"].append(
            {"sessionId": "social-73-11", "requestId": "citizens-73-social-11-11", "tick": 11})
        with self.assertRaisesRegex(APIError, "history is incomplete"):
            self.state.save_world_checkpoint("SaturatedRelation", overflow)

        older = self.citizens_v3_world()
        self.assertTrue(self.state.save_world_checkpoint("ExactV3", older)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("ExactV3")["world"]["citizens"],
                         older["citizens"])

    def test_citizens_v4_rejects_forged_relationship_proofs_atomically(self):
        world = self.citizens_v4_completed_world()
        self.state.save_world_checkpoint("RelationshipProof", world)
        path = self.scenes / "world_checkpoints" / "RelationshipProof.json"
        original = path.read_bytes()
        original_runtime = copy.deepcopy(self.state.latest)

        def completion(item):
            return item["citizens"]["relationships"][0]["completed"][0]

        def relation(item):
            return item["citizens"]["relationships"][0]

        def duplicate_completion(item):
            relation(item)["completed"].append(copy.deepcopy(completion(item)))
            relation(item)["score"] = 60

        def out_of_order(item):
            state = item["citizens"]
            state["actionSequence"] = 4
            state["requestSequence"] = 11
            state["clockTick"] = 16
            relation(item)["score"] = 60
            relation(item)["completed"].insert(0, {"sessionId": "social-73-4",
                                                   "requestId": "citizens-73-social-4-11",
                                                   "tick": 16})

        cases = (
            ("missing completion field", lambda item: relation(item).pop("completed")),
            ("forged score", lambda item: relation(item).update(score=60)),
            ("missing proof for retained end", lambda item: relation(item).update(
                completed=[], score=50)),
            ("noncanonical session", lambda item: completion(item).update(
                sessionId="social-73-03")),
            ("wrong seed in session", lambda item: completion(item).update(
                sessionId="social-74-3")),
            ("execution beyond action sequence", lambda item: completion(item).update(
                sessionId="social-73-4")),
            ("noncanonical request", lambda item: completion(item).update(
                requestId="citizens-73-social-3-010")),
            ("wrong request execution", lambda item: completion(item).update(
                requestId="citizens-73-social-2-10")),
            ("request beyond sequence", lambda item: completion(item).update(
                requestId="citizens-73-social-3-11")),
            ("future completion", lambda item: completion(item).update(tick=16)),
            ("duplicate completion", duplicate_completion),
            ("out of order completion", out_of_order),
            ("retained end points elsewhere", lambda item: item["citizens"]["socialEvents"][-1].update(
                requestId="citizens-73-social-3-9")),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with self.assertRaises(APIError) as rejected:
                    self.state.save_world_checkpoint("RelationshipProof", invalid)
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(self.state.latest, original_runtime)

                document = json.loads(original)
                mutate(document["world"])
                document["payloadSha256"] = world_checkpoint_digest(
                    document["world"], document["dependencies"])
                path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaises(APIError) as rejected:
                    self.state.load_world_checkpoint("RelationshipProof")
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(self.state.latest, original_runtime)
                path.write_bytes(original)

    def test_citizens_v3_social_roundtrip_and_older_shapes(self):
        world = self.citizens_v3_offered_world()
        self.assertTrue(self.state.save_world_checkpoint("SocialOffer", world)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("SocialOffer")["world"]["citizens"],
                         world["citizens"])

        active = copy.deepcopy(world)
        state = active["citizens"]
        state["clockTick"] = 13
        state["socialSession"].update(phase="active", acceptedTick=13, expiresTick=85)
        state["socialEvents"].append({"id": "social-73-3-accepted-13", "event": "accepted",
                                      "tick": 13, "initiatorId": "ada", "inviteeId": "bo",
                                      "requestId": ""})
        self.assertTrue(self.state.save_world_checkpoint("SocialActive", active)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("SocialActive")["world"]["citizens"],
                         state)

        completed = copy.deepcopy(active)
        state = completed["citizens"]
        state["socialSession"] = None
        for resident in state["residents"]:
            resident["socialSessionId"] = None
        state["requestSequence"] = 10
        state["relationships"][0]["score"] = 55
        state["socialEvents"].append({"id": "social-73-3-ended-13", "event": "ended",
                                      "tick": 13, "initiatorId": "ada", "inviteeId": "bo",
                                      "requestId": "citizens-73-social-3-10"})
        self.assertTrue(self.state.save_world_checkpoint("SocialEnded", completed)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("SocialEnded")["world"]["citizens"],
                         state)

        for name, older in (("V1", self.citizens_world()),
                            ("V2", self.citizens_v2_world())):
            with self.subTest(name=name):
                self.assertTrue(self.state.save_world_checkpoint(name, older)["saved"])
                self.assertEqual(self.state.load_world_checkpoint(name)["world"]["citizens"],
                                 older["citizens"])

    def test_citizens_v3_rejects_corrupt_social_state_atomically(self):
        world = self.citizens_v3_offered_world()
        self.state.save_world_checkpoint("SocialOffer", world)
        path = self.scenes / "world_checkpoints" / "SocialOffer.json"
        original = path.read_bytes()
        original_runtime = copy.deepcopy(self.state.latest)

        def add_waiter(item):
            item["citizens"]["stations"][0]["waiters"].append(
                {"residentId": "bo", "executionId": 2, "enqueuedTick": 11})

        def duplicate_event(item):
            item["citizens"]["socialEvents"].append(
                copy.deepcopy(item["citizens"]["socialEvents"][0]))

        def active_without_acceptance(item):
            item["citizens"]["socialSession"].update(phase="active", expiresTick=84)

        def forged_score_without_events(item):
            item["citizens"]["socialEvents"] = []
            item["citizens"]["relationships"][0]["score"] = 99

        def truncated_completion_evidence(item):
            item["citizens"]["relationships"][0]["score"] = 55

        cases = (
            ("orphan resident session", lambda item: item["citizens"]["residents"][0].update(
                socialSessionId=None)),
            ("missing social session", lambda item: item["citizens"].update(socialSession=None)),
            ("participant waits", add_waiter),
            ("session execution out of range", lambda item: item["citizens"]["socialSession"].update(
                executionId=4)),
            ("session ID differs", lambda item: item["citizens"]["socialSession"].update(
                id="social-73-2")),
            ("stale offer", lambda item: item["citizens"]["socialSession"].update(
                expiresTick=12)),
            ("offer accepted field", lambda item: item["citizens"]["socialSession"].update(
                acceptedTick=12)),
            ("active without acceptance", active_without_acceptance),
            ("event from future", lambda item: item["citizens"]["socialEvents"][0].update(
                tick=13)),
            ("duplicate event", duplicate_event),
            ("forged v3 score without events", forged_score_without_events),
            ("truncated v3 completion evidence", truncated_completion_evidence),
            ("bad event receipt", lambda item: item["citizens"]["socialEvents"][0].update(
                requestId="citizens-73-social-3-9")),
            ("reversed pair", lambda item: item["citizens"]["relationships"][0].update(
                a="bo", b="ada")),
            ("unknown pair member", lambda item: item["citizens"]["relationships"][0].update(
                b="missing")),
            ("next tick out of range", lambda item: item["citizens"].update(
                nextSocialTick=-1)),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with self.assertRaises(APIError) as rejected:
                    self.state.save_world_checkpoint("SocialOffer", invalid)
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(self.state.latest, original_runtime)

                document = json.loads(original)
                mutate(document["world"])
                document["payloadSha256"] = world_checkpoint_digest(
                    document["world"], document["dependencies"])
                path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaises(APIError) as rejected:
                    self.state.load_world_checkpoint("SocialOffer")
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(self.state.latest, original_runtime)
                path.write_bytes(original)

    def test_citizens_v3_roundtrip_keeps_intent_ids_and_legacy_v2_exact(self):
        world = self.citizens_world()
        saved = self.state.save_world_checkpoint("Citizens", world)
        self.assertTrue(saved["saved"])
        document = json.loads((self.scenes / "world_checkpoints" / "Citizens.json").read_text(encoding="utf-8"))
        self.assertEqual(document["world"]["citizens"], world["citizens"])
        fresh = State(self.scenes, web_assets_directory=self.assets)
        active = copy.deepcopy(self.state.latest)
        active["scene"]["objects"] = []
        fresh.exchange({"clientId": "reopened-browser", "snapshot": active, "results": []})
        before = copy.deepcopy(fresh.latest)
        loaded = fresh.load_world_checkpoint("Citizens")
        self.assertEqual(loaded["world"]["version"], 3)
        self.assertEqual(loaded["world"]["citizens"], world["citizens"])
        self.assertEqual(loaded["world"]["citizens"]["residents"][0]["activity"]["phase"], "travel")
        self.assertEqual(fresh.latest, before, "load returns a staged world; it does not replace the runtime")
        staged = copy.deepcopy(active)
        staged["scene"] = copy.deepcopy(loaded["world"]["scene"])
        accepted = fresh.exchange({"clientId": "reopened-browser", "snapshot": staged, "results": [],
                                   "worldRestoreExpectedRevision": loaded["expectedRevision"]})
        self.assertEqual(accepted["commands"], [])
        self.assertEqual(fresh.latest["scene"], loaded["world"]["scene"])
        self.state.save_world_checkpoint("LegacyV2", self.world | {"scene": self.state.latest["scene"]})
        legacy = self.state.load_world_checkpoint("LegacyV2")["world"]
        self.assertEqual(set(legacy), {"version", "scene", "game"})
        self.assertEqual(legacy["version"], 2)

    def test_citizens_v2_claim_queue_roundtrip_and_raw_v1_compatibility(self):
        world = self.citizens_v2_world()
        self.assertTrue(self.state.save_world_checkpoint("Reservations", world)["saved"])
        loaded = self.state.load_world_checkpoint("Reservations")["world"]
        self.assertEqual(loaded["citizens"], world["citizens"])
        self.assertEqual(loaded["citizens"]["stations"][0]["claim"]["executionId"], 1)
        self.assertEqual(loaded["citizens"]["stations"][0]["waiters"][0]["residentId"], "bo")
        self.assertEqual(self.state.latest["scene"], world["scene"],
                         "loading a PC checkpoint must not replace the live runtime")

        legacy = self.citizens_world()
        self.assertTrue(self.state.save_world_checkpoint("LegacyCitizens", legacy)["saved"])
        raw = self.state.load_world_checkpoint("LegacyCitizens")["world"]["citizens"]
        self.assertEqual(raw, legacy["citizens"])
        self.assertEqual(raw["schemaVersion"], 1,
                         "the browser migrates v1 after the PC returns its original checkpoint")

    def test_citizens_v2_rejects_missing_bindings_and_invalid_reservations_atomically(self):
        world = self.citizens_v2_world()
        self.state.save_world_checkpoint("Reservations", world)
        path = self.scenes / "world_checkpoints" / "Reservations.json"
        before_bytes = path.read_bytes()
        before_runtime = copy.deepcopy(self.state.latest)

        def scene_object(item, object_id):
            return next(obj for obj in item["scene"]["objects"]
                        if obj["objectId"] == object_id)

        def delete_object(item, object_id):
            item["scene"]["objects"].remove(scene_object(item, object_id))

        def duplicate_waiter(item):
            item["citizens"]["actionSequence"] = 3
            item["citizens"]["stations"][0]["waiters"].append(
                {"residentId": "bo", "executionId": 3, "enqueuedTick": 12})

        def out_of_order_waiters(item):
            state = item["citizens"]
            state["actionSequence"] = 3
            state["residents"][0]["activity"] = None
            state["stations"][0]["claim"] = None
            state["stations"][0]["waiters"].append(
                {"residentId": "ada", "executionId": 3, "enqueuedTick": 10})

        def stale_waiter(item):
            state = item["citizens"]
            state["clockTick"] = 107
            state["stations"][0]["claim"]["expiresTick"] = 130

        cases = (
            ("deleted actor remains bound", lambda item: delete_object(item, "citizen-ada")),
            ("deleted resource remains bound", lambda item: delete_object(item, "citizen-chair")),
            ("claim names idle resident", lambda item: item["citizens"]["stations"][0]["claim"].update(
                residentId="bo")),
            ("claim execution differs", lambda item: item["citizens"]["stations"][0]["claim"].update(
                executionId=2)),
            ("expired claim", lambda item: item["citizens"]["stations"][0]["claim"].update(
                expiresTick=12)),
            ("overlong claim", lambda item: item["citizens"]["stations"][0]["claim"].update(
                expiresTick=85)),
            ("future waiter", lambda item: item["citizens"]["stations"][0]["waiters"][0].update(
                enqueuedTick=13)),
            ("waiter shares active execution", lambda item: item["citizens"]["stations"][0]["waiters"][0].update(
                executionId=1)),
            ("duplicate waiter", duplicate_waiter),
            ("waiters out of FIFO order", out_of_order_waiters),
            ("stale waiter", stale_waiter),
            ("retired resident remains active", lambda item: item["citizens"]["retiredResidentIds"].append(
                "bo")),
            ("live and retired exceed four", lambda item: item["citizens"]["retiredResidentIds"].extend(
                ("former-c", "former-d", "former-e"))),
            ("missing claim", lambda item: item["citizens"]["stations"][0].update(claim=None)),
            ("unhashable log event", lambda item: item["citizens"]["log"][0].update(event=[])),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with self.assertRaises(APIError) as rejected:
                    self.state.save_world_checkpoint("Reservations", invalid)
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(path.read_bytes(), before_bytes)
                self.assertEqual(self.state.latest, before_runtime)

                document = json.loads(before_bytes)
                mutate(document["world"])
                document["payloadSha256"] = world_checkpoint_digest(
                    document["world"], document["dependencies"])
                path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaises(APIError) as rejected:
                    self.state.load_world_checkpoint("Reservations")
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(self.state.latest, before_runtime)
                path.write_bytes(before_bytes)

    def test_citizens_v2_retired_actor_and_removed_station_roundtrip(self):
        world = self.citizens_v2_world()
        state = world["citizens"]
        state["residents"] = [resident for resident in state["residents"]
                              if resident["id"] != "bo"]
        state["retiredResidentIds"] = ["bo"]
        state["stations"][0]["waiters"] = []
        world["scene"]["objects"] = [obj for obj in world["scene"]["objects"]
                                      if obj["objectId"] != "citizen-bo"]
        current = copy.deepcopy(self.state.latest)
        current["scene"] = copy.deepcopy(world["scene"])
        self.state.exchange({"clientId": "browser", "snapshot": current, "results": []})
        self.assertTrue(self.state.save_world_checkpoint("RetiredActor", world)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("RetiredActor")["world"]["citizens"], state)

        state["residents"][0]["activity"] = None
        state["stations"] = [station for station in state["stations"]
                             if station["id"] != "chair"]
        world["scene"]["objects"] = [obj for obj in world["scene"]["objects"]
                                      if obj["objectId"] != "citizen-chair"]
        current["scene"] = copy.deepcopy(world["scene"])
        self.state.exchange({"clientId": "browser", "snapshot": current, "results": []})
        self.assertTrue(self.state.save_world_checkpoint("RemovedStation", world)["saved"])
        self.assertEqual(self.state.load_world_checkpoint("RemovedStation")["world"]["citizens"], state)

        state["residents"] = []
        state["retiredResidentIds"] = ["bo", "ada"]
        state["paused"] = True
        self.assertTrue(self.state.save_world_checkpoint("NoResidents", world)["saved"])
        state["paused"] = False
        with self.assertRaisesRegex(APIError, "must be paused"):
            self.state.save_world_checkpoint("NoResidents", world)

    def test_citizens_invalid_bindings_do_not_overwrite_or_replace(self):
        world = self.citizens_world()
        self.state.save_world_checkpoint("Citizens", world)
        path = self.scenes / "world_checkpoints" / "Citizens.json"
        before_bytes = path.read_bytes()
        before_runtime = copy.deepcopy(self.state.latest)
        cases = (
            ("missing resident", lambda item: item["citizens"]["residents"][0].update(objectId="missing")),
            ("wrong station asset", lambda item: item["citizens"]["stations"][0].update(objectId="citizen-table")),
            ("stale reservation", lambda item: item["citizens"]["stations"][0].update(holder=None)),
            ("duplicate station kind", lambda item: item["citizens"]["stations"][1].update(kind="rest")),
            ("unknown citizens schema", lambda item: item["citizens"].update(schemaVersion=9)),
            ("invalid need", lambda item: item["citizens"]["residents"][0]["needs"].update(energy=-1)),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with self.assertRaises(APIError):
                    self.state.save_world_checkpoint("Citizens", invalid)
                self.assertEqual(path.read_bytes(), before_bytes)
                self.assertEqual(self.state.latest, before_runtime)
        for invalid in (dict(self.world, citizens=world["citizens"]),
                        dict(world, citizens=None)):
            with self.assertRaisesRegex(APIError, "Unsupported world checkpoint envelope"):
                self.state.save_world_checkpoint("Citizens", invalid)
            self.assertEqual(path.read_bytes(), before_bytes)
        document = json.loads(before_bytes)
        document["world"]["citizens"]["residents"][0]["objectId"] = "missing"
        document["payloadSha256"] = world_checkpoint_digest(document["world"], document["dependencies"])
        path.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaisesRegex(APIError, "Citizens resident object"):
            self.state.load_world_checkpoint("Citizens")
        self.assertEqual(self.state.latest, before_runtime)

    def test_citizens_strings_use_utf16_limits_and_reject_surrogates_before_digest(self):
        world = self.citizens_world()
        face = "\U0001f642"
        world["citizens"]["residents"][0]["name"] = face * 20  # 40 UTF-16 units.
        world["citizens"]["residents"][0]["lastOutcome"] = face * 80
        world["citizens"]["log"][0]["message"] = face * 80
        self.assertTrue(self.state.save_world_checkpoint("UnicodeCitizens", world)["saved"])
        path = self.scenes / "world_checkpoints" / "UnicodeCitizens.json"
        before_bytes = path.read_bytes()
        before_runtime = copy.deepcopy(self.state.latest)
        cases = (
            ("astral name over 40 units", lambda item: item["citizens"]["residents"][0].update(
                name=face * 21)),
            ("astral outcome over 160 units", lambda item: item["citizens"]["residents"][0].update(
                lastOutcome=face * 81)),
            ("astral log over 160 units", lambda item: item["citizens"]["log"][0].update(
                message=face * 81)),
            ("lone high surrogate", lambda item: item["citizens"]["residents"][0].update(
                name="\ud800")),
            ("lone low surrogate", lambda item: item["citizens"]["log"][0].update(
                message="\udfff")),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with patch("server.world_checkpoint_digest", side_effect=AssertionError("digest called")) as digest:
                    with self.assertRaisesRegex(APIError, "Invalid Citizens"):
                        self.state.save_world_checkpoint("UnicodeCitizens", invalid)
                    digest.assert_not_called()
                self.assertEqual(path.read_bytes(), before_bytes)
                self.assertEqual(self.state.latest, before_runtime)

    def test_citizens_bound_motion_owner_rejects_save_and_load(self):
        world = self.citizens_world()
        self.state.save_world_checkpoint("Citizens", world)
        path = self.scenes / "world_checkpoints" / "Citizens.json"
        before_bytes = path.read_bytes()
        before_runtime = copy.deepcopy(self.state.latest)

        def chair(item):
            return next(obj for obj in item["scene"]["objects"]
                        if obj["objectId"] == "citizen-chair")

        def resident(item):
            return next(obj for obj in item["scene"]["objects"]
                        if obj["objectId"] == "citizen-ada")

        moving = {"kind": "bob", "enabled": True, "paused": False,
                  "axis": "y", "speedDegreesPerSecond": 30,
                  "amplitudeMeters": .05, "frequencyHz": .5}

        def running_component(item):
            chair(item)["component"] = copy.deepcopy(self.world["scene"]["objects"][2]["component"])

        def active_behavior(item):
            chair(item)["behaviors"] = [copy.deepcopy(moving)]

        def resident_behavior(item):
            resident(item)["behaviors"] = [copy.deepcopy(moving)]

        cases = (("running station component", running_component, "station"),
                 ("active station behavior", active_behavior, "station"),
                 ("active resident behavior", resident_behavior, "resident"))
        for label, mutate, kind in cases:
            with self.subTest(label=label):
                invalid = copy.deepcopy(world)
                mutate(invalid)
                with self.assertRaisesRegex(APIError, f"Citizens {kind} object is missing or incompatible"):
                    self.state.save_world_checkpoint("Citizens", invalid)
                self.assertEqual(path.read_bytes(), before_bytes)
                self.assertEqual(self.state.latest, before_runtime)

                document = json.loads(before_bytes)
                mutate(document["world"])
                document["payloadSha256"] = world_checkpoint_digest(
                    document["world"], document["dependencies"])
                path.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaisesRegex(APIError, f"Citizens {kind} object is missing or incompatible"):
                    self.state.load_world_checkpoint("Citizens")
                self.assertEqual(self.state.latest, before_runtime)
                path.write_bytes(before_bytes)

        for label, mutate in (("stopped component", lambda item: chair(item).update(
                component={**copy.deepcopy(self.world["scene"]["objects"][2]["component"]),
                           "status": "stopped"})),
                              ("paused behavior", lambda item: chair(item).update(
                                  behaviors=[{**moving, "paused": True}]))):
            with self.subTest(label=label):
                inactive = copy.deepcopy(world)
                mutate(inactive)
                current = copy.deepcopy(before_runtime)
                current["scene"] = copy.deepcopy(inactive["scene"])
                self.state.exchange({"clientId": "browser", "snapshot": current, "results": []})
                self.assertTrue(self.state.save_world_checkpoint(
                    "InactiveStation", inactive)["saved"])

    def test_restart_restores_exact_ids_game_progress_component_and_animation(self):
        saved = self.state.save_world_checkpoint("Demo", self.world)
        self.assertEqual(saved["dependencies"],
                         [{"assetId": self.asset["assetId"], "sha256": self.asset["sha256"],
                           "spawnScale": 1, "animationClips": ["Flight"]}])
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
        staged = copy.deepcopy(empty)
        staged["scene"] = copy.deepcopy(restored["world"]["scene"])
        accepted = fresh.exchange({"clientId": "reopened-browser", "snapshot": staged, "results": [],
                                   "worldRestoreExpectedRevision": restored["expectedRevision"]})
        self.assertEqual(accepted["commands"], [])
        self.assertEqual(fresh.latest["scene"], restored["world"]["scene"])

    def test_queued_command_cannot_enter_the_staged_restored_world(self):
        self.state.save_world_checkpoint("Demo", self.world)
        active = copy.deepcopy(self.snapshot)
        active["scene"]["objects"][0]["transform"]["position"]["x"] = 1
        self.state.exchange({"clientId": "browser", "snapshot": active, "results": []})
        loaded = self.state.load_world_checkpoint("Demo")
        staged = copy.deepcopy(active)
        staged["scene"] = copy.deepcopy(loaded["world"]["scene"])
        moved = copy.deepcopy(POSE)
        moved["position"]["x"] = 2
        queued = self.state.queue([{"op": "set_transform", "objectId": "pickup-1", "transform": moved}])["commands"][0]
        before = copy.deepcopy(self.state.latest)
        with self.assertRaisesRegex(APIError, "command was queued") as failure:
            self.state.exchange({"clientId": "browser", "snapshot": staged, "results": [],
                                 "worldRestoreExpectedRevision": loaded["expectedRevision"]})
        self.assertEqual(failure.exception.status, 409)
        self.assertEqual(self.state.latest, before)
        self.assertIn(queued["requestId"], self.state.pending)
        resumed = self.state.exchange({"clientId": "browser", "snapshot": active, "results": []})
        self.assertEqual([item["requestId"] for item in resumed["commands"]], [queued["requestId"]])

    def test_registered_glb_physics_config_survives_world_checkpoint_without_solver_state(self):
        physics = {"schemaVersion": 1, "kind": "gravity-floor",
                   "collider": "rendered-bounds-box", "restitution": 0.25}
        world = copy.deepcopy(self.world)
        world["scene"]["objects"][0]["physics"] = physics
        observed = copy.deepcopy(self.snapshot)
        observed["scene"] = copy.deepcopy(world["scene"])
        observed["physicsSchemaVersion"] = 1
        observed["physicsStates"] = [{
            "objectId": "pickup-1", "executionId": "drop-1", "status": "settled",
            "position": {"x": 0, "y": 0, "z": -2}, "verticalVelocityMps": 0,
            "contactCount": 1, "lastContact": {"index": 1, "surface": "web-floor",
                                               "impactSpeedMps": 1.2, "approximate": True}}]
        self.state.exchange({"clientId": "browser", "snapshot": observed, "results": []})
        self.assertEqual(self.state.latest["physicsStates"][0]["status"], "settled")

        self.state.save_world_checkpoint("Physics", world)
        path = self.scenes / "world_checkpoints" / "Physics.json"
        stored = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(stored["world"]["scene"]["objects"][0]["physics"], physics)
        self.assertNotIn("physicsStates", stored["world"])
        self.assertNotIn("physicsStates", stored)

        reopened = State(self.scenes, web_assets_directory=self.assets)
        reconnect = copy.deepcopy(observed)
        reconnect["scene"]["objects"] = []
        reconnect.pop("physicsStates")
        reopened.exchange({"clientId": "reopened-browser", "snapshot": reconnect, "results": []})
        restored = reopened.load_world_checkpoint("Physics")
        self.assertEqual(restored["world"]["scene"]["objects"][0]["physics"], physics)
        self.assertEqual(restored["world"]["game"], world["game"])
        self.assertNotIn("physicsStates", restored["world"])

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

    def test_changed_catalog_scale_or_bounds_rejects_the_same_glb(self):
        self.state.save_world_checkpoint("Demo", self.world)
        before = copy.deepcopy(self.state.latest)
        source = self.root / "flight.glb"
        self.state.web_assets.register(source, "Flight", spawn_scale=0.5)
        with self.assertRaisesRegex(APIError, "metadata is stale"):
            self.state.load_world_checkpoint("Demo")
        refreshed = copy.deepcopy(self.snapshot)
        refreshed["assets"][1]["spawnScale"] = 0.5
        self.state.exchange({"clientId": "browser", "snapshot": refreshed, "results": []})
        with self.assertRaisesRegex(APIError, "asset version changed"):
            self.state.load_world_checkpoint("Demo")
        bounds = {"center": {"x": 0, "y": 0.5, "z": 0},
                  "size": {"x": 1, "y": 1, "z": 1}}
        self.state.web_assets.register(source, "Flight", spawn_scale=1, local_bounds=bounds)
        refreshed["assets"][1]["spawnScale"] = 1
        refreshed["assets"][1]["localBounds"] = bounds
        self.state.exchange({"clientId": "browser", "snapshot": refreshed, "results": []})
        with self.assertRaisesRegex(APIError, "asset version changed"):
            self.state.load_world_checkpoint("Demo")
        self.assertEqual(self.state.latest["scene"], before["scene"])

    def test_unreachable_score_cannot_be_saved_as_earned_progress(self):
        world = copy.deepcopy(self.world)
        world["scene"]["objects"].append({"objectId": "zone-2", "assetId": "pedestal",
                                          "anchorId": "web-floor", "transform": copy.deepcopy(POSE)})
        spec = world["game"]["spec"]
        spec["roles"].append({"roleId": "other-zone", "kind": "delivery-zone",
                              "assetId": "pedestal", "count": 1})
        spec["rules"][0]["scorePoints"] = 2
        spec["rules"].append({"event": "release-near", "actorRoleId": "flyers",
                              "targetRoleId": "other-zone", "distanceMeters": 0.6,
                              "scorePoints": 4})
        world["game"]["bindings"]["other-zone"] = ["zone-2"]
        world["game"]["state"]["score"] = 3
        current = copy.deepcopy(self.snapshot)
        current["scene"] = copy.deepcopy(world["scene"])
        self.state.exchange({"clientId": "browser", "snapshot": current, "results": []})
        with self.assertRaisesRegex(APIError, "score"):
            self.state.save_world_checkpoint("Impossible", world)
        world["game"]["state"]["score"] = 2
        self.assertTrue(self.state.save_world_checkpoint("Possible", world)["saved"])

    def test_repeated_or_post_win_deliveries_cannot_be_saved(self):
        world = copy.deepcopy(self.world)
        spec = world["game"]["spec"]
        spec["objectives"] = [{"kind": "delivered-count", "roleId": "flyers", "targetCount": 1}]
        progress = world["game"]["state"]
        progress.update({"phase": "won", "score": 6,
                         "deliveries": ["pickup-1", "pickup-2"],
                         "objectiveProgress": {"flyers": 2}})
        with self.assertRaisesRegex(APIError, "score"):
            self.state.save_world_checkpoint("PostWin", world)
        progress.update({"deliveries": ["pickup-1", "pickup-1"],
                         "objectiveProgress": {"flyers": 1}})
        with self.assertRaisesRegex(APIError, "deliveries"):
            self.state.save_world_checkpoint("Repeated", world)

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
            citizens_world = self.citizens_world()
            self.assertEqual(request("/api/web/world/save",
                                     {"name": "Citizens", "world": citizens_world})[0], 200)
            citizens_loaded = request("/api/web/world/load", {"name": "Citizens"})[1]["world"]
            self.assertEqual(citizens_loaded["version"], 3)
            self.assertEqual(citizens_loaded["citizens"], citizens_world["citizens"])
            self.assertEqual(request("/api/web/world/load", {"name": "Demo", "extra": True})[0], 400)
            self.assertEqual(request("/api/scenes")[1], {"scenes": []})
        finally:
            service.shutdown()
            service.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
