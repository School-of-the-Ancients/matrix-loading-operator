"""A headless Citizens owner and a separately authenticated observation route."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from procedural_contract import new_recipe
from server import (APIError, CITIZEN_BENCH_INTERACTION, CITIZEN_BENCH_TRANSFORM,
                    Server, State, validate_citizens_checkpoint,
                    world_checkpoint_digest)


FIXTURE = json.loads((Path(__file__).with_name("testdata") /
                      "hosted_world_fixture.json").read_text(encoding="utf-8"))
OWNER = "test-host-owner-token-0123456789"
VIEWER = "test-host-viewer-token-0123456789"


class HostedWorldTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 0.0
        self.state = State(Path(self.temp.name) / "scenes", clock=lambda: self.now,
                           web_assets_directory=Path(self.temp.name) / "assets")
        self.snapshot = copy.deepcopy(FIXTURE["snapshot"])
        self.world = copy.deepcopy(FIXTURE["world"])

    def tearDown(self):
        self.temp.cleanup()

    def exchange(self, snapshot=None, client_id="host-1", name="AdaBo", **extra):
        return self.state.exchange({"clientId": client_id, "hostWorldId": name,
                                    "snapshot": copy.deepcopy(snapshot or self.snapshot),
                                    "results": [], "captureSupported": False, **extra})

    def procedural_object(self, *, object_id="host-bench-1"):
        pose = copy.deepcopy(self.snapshot["scene"]["objects"][0]["transform"])
        pose["position"].update(x=8, z=8)
        return {"objectId": object_id, "assetId": "matrix:procedural",
                "anchorId": "web-floor", "transform": pose,
                "procedural": new_recipe(self.snapshot["proceduralGenerators"],
                                          "curved-bench")}

    def requested_construction(self):
        """A minimal real reservation: Ada holds the chair while Bo waits."""
        world = copy.deepcopy(self.world)
        state = world["citizens"]
        state["schemaVersion"] = 13
        state["clockTick"] = 1
        state["actionSequence"] = 2
        state["stations"][0]["claim"] = {
            "residentId": "ada", "executionId": 1, "expiresTick": 73}
        state["stations"][0]["waiters"] = [{
            "residentId": "bo", "executionId": 2, "enqueuedTick": 1}]
        state["residents"][0]["activity"] = {
            "kind": "rest", "stationId": "chair", "phase": "travel",
            "remainingTicks": 7, "travelTicks": 1, "target": None,
            "executionId": 1, "routeRetries": 0, "routeGeometryId": None}
        state["construction"] = {
            "intentId": f'citizens-{state["seed"]}-construction-2',
            "residentId": "bo", "blockedStationId": "chair",
            "waitExecutionId": 2, "requestedTick": 1, "status": "requested",
            "requestId": None, "objectId": None,
            "interactionRequestId": None, "useRequestId": None, "reason": ""}
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["citizensState"] = copy.deepcopy(state)
        return snapshot, world

    def requested_service(self, *, budget=1):
        self.state = State(Path(self.temp.name) / f"scenes-budget-{budget}",
                           clock=lambda: self.now,
                           web_assets_directory=Path(self.temp.name) / "assets",
                           citizen_construction_budget=budget)
        snapshot, world = self.requested_construction()
        self.exchange(snapshot)
        self.state.save_world_checkpoint("AdaBo", world)
        return snapshot, world

    def requested_capability(self):
        snapshot, world = self.requested_construction()
        citizens = world["citizens"]
        citizens["schemaVersion"] = 14
        construction = citizens["construction"]
        request = {
            "citizenRequestId": construction["intentId"] + "/procedural.create/1",
            "intentId": construction["intentId"], "residentId": "bo",
            "capability": "procedural", "action": "create",
            "parameters": {"generatorId": "curved-bench", "parameters": {},
                           "transform": copy.deepcopy(CITIZEN_BENCH_TRANSFORM),
                           "interaction": copy.deepcopy(CITIZEN_BENCH_INTERACTION)},
            "checkpoint": {"roomId": world["scene"]["roomId"], "clockTick": 1,
                           "objectIds": sorted(item["objectId"] for item in
                                               world["scene"]["objects"])}}
        citizens["capabilityRequests"] = [{"request": copy.deepcopy(request),
                                           "status": "requested", "policy": None,
                                           "receipts": [], "reason": ""}]
        snapshot["citizensState"] = copy.deepcopy(citizens)
        return snapshot, world, request

    def requested_capability_service(self, *, budget=1):
        self.state = State(Path(self.temp.name) / f"capability-budget-{budget}",
                           clock=lambda: self.now,
                           web_assets_directory=Path(self.temp.name) / "assets",
                           citizen_capability_budget=budget)
        snapshot, world, request = self.requested_capability()
        self.exchange(snapshot)
        self.state.save_world_checkpoint("AdaBo", world)
        return snapshot, world, request

    def test_citizen_capability_dispatches_saved_request_to_typed_procedural_action(self):
        snapshot, world, request = self.requested_capability_service()
        decision = self.state.citizen_capability_request(copy.deepcopy(request))
        self.assertEqual(set(decision),
                         {"allowed", "requestId", "reason", "checkpointSequence"})
        self.assertTrue(decision["allowed"])
        self.assertEqual(decision["reason"], "")
        self.assertEqual(decision["checkpointSequence"], self.state.host_saved_sequence)
        request_id = decision["requestId"]
        self.assertRegex(request_id, r"^[0-9a-f]{32}$")
        command = self.state.pending[request_id]
        self.assertEqual(command["op"], "create_procedural")
        self.assertEqual(command["anchorId"], "web-floor")
        self.assertEqual(command["transform"], CITIZEN_BENCH_TRANSFORM)
        self.assertEqual(command["procedural"], new_recipe(
            snapshot["proceduralGenerators"], "curved-bench"))
        issued = self.state.agent_procedural_ids[request_id]
        self.assertEqual(issued["citizenRequest"], request)
        self.assertEqual(issued["citizenRequestId"], request["citizenRequestId"])
        self.assertEqual(issued["citizenIntentId"], request["intentId"])
        self.assertEqual(issued["residentId"], "bo")
        self.assertEqual(issued["citizenCapability"], "procedural")
        self.assertEqual(issued["citizenAction"], "create")
        self.assertEqual(issued["checkpointSequence"], decision["checkpointSequence"])
        repeated = self.state.citizen_capability_request(copy.deepcopy(request))
        self.assertFalse(repeated["allowed"])
        self.assertEqual(repeated["reason"], "Citizen capability budget is exhausted")
        self.assertEqual(list(self.state.pending), [request_id])

    def test_citizen_capability_denies_unknown_tampered_and_zero_budget_safely(self):
        _, _, request = self.requested_capability_service(budget=0)
        before = copy.deepcopy(self.state.latest)
        denied = self.state.citizen_capability_request(copy.deepcopy(request))
        self.assertEqual(denied["allowed"], False)
        self.assertEqual(denied["requestId"], None)
        self.assertEqual(denied["reason"], "Citizen capability budget is exhausted")
        self.assertEqual(denied["checkpointSequence"], self.state.host_saved_sequence)
        self.assertFalse(self.state.pending)
        self.assertEqual(self.state.latest, before)
        self.state.citizen_capability_budget = 1
        unknown = copy.deepcopy(request)
        unknown["capability"] = "blender"
        self.assertIn("differs from saved intent",
                      self.state.citizen_capability_request(unknown)["reason"])
        tampered = copy.deepcopy(request)
        tampered["parameters"]["transform"]["position"]["x"] = -4
        self.assertIn("differs from saved intent",
                      self.state.citizen_capability_request(tampered)["reason"])
        self.assertFalse(self.state.pending)
        self.assertEqual(self.state.latest, before)

    def test_citizen_capability_unknown_saved_action_denies_without_queue(self):
        snapshot, world, request = self.requested_capability()
        world["citizens"]["construction"] = None
        request["intentId"] = "citizens-29-other-intent-1"
        request["citizenRequestId"] = request["intentId"] + "/blender.generate/1"
        request["capability"] = "blender"
        request["action"] = "generate"
        world["citizens"]["capabilityRequests"][0]["request"] = copy.deepcopy(request)
        snapshot["citizensState"] = copy.deepcopy(world["citizens"])
        # The generic journal accepts future action names; the policy allowlist
        # makes the current slice fail closed.
        validate_citizens_checkpoint(world["citizens"], world["scene"])
        forged_success = copy.deepcopy(world)
        forged_entry = forged_success["citizens"]["capabilityRequests"][0]
        forged_entry.update(status="succeeded",
                            policy={"allowed": True, "requestId": "a" * 32,
                                    "reason": "", "checkpointSequence": 1},
                            receipts=[{"requestId": "a" * 32, "ok": True,
                                       "error": "", "objectId": "phantom"}])
        with self.assertRaisesRegex(APIError, "no observed-world success validator"):
            validate_citizens_checkpoint(forged_success["citizens"],
                                         forged_success["scene"])
        self.exchange(snapshot)
        self.state.save_world_checkpoint("AdaBo", world)
        decision = self.state.citizen_capability_request(request)
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["reason"], "Citizen capability is not allowed")
        self.assertFalse(self.state.pending)

    def test_citizen_capability_endpoint_requires_owner_token(self):
        _, _, request = self.requested_capability_service()
        service = Server(("127.0.0.1", 0), self.state, OWNER, VIEWER)
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()

        def post(token):
            call = urllib.request.Request(
                f"http://127.0.0.1:{service.server_port}/api/citizens/capabilities",
                data=json.dumps(request).encode("utf-8"),
                headers={"Authorization": "Bearer " + token,
                         "Content-Type": "application/json"})
            try:
                response = urllib.request.urlopen(call, timeout=3)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.loads(response.read())

        try:
            self.assertEqual(post(VIEWER)[0], 401)
            self.assertFalse(self.state.pending)
            status, decision = post(OWNER)
            self.assertEqual(status, 200)
            self.assertTrue(decision["allowed"])
            self.assertEqual(list(self.state.pending), [decision["requestId"]])
        finally:
            service.shutdown()
            service.server_close()
            thread.join(timeout=3)

    def test_citizen_capability_requires_a_saved_current_checkpoint(self):
        snapshot, _, request = self.requested_capability_service()
        self.exchange(snapshot)
        before = copy.deepcopy(self.state.latest)
        decision = self.state.citizen_capability_request(request)
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["reason"],
                         "Hosted Citizens state needs a durable checkpoint")
        self.assertFalse(self.state.pending)
        self.assertEqual(self.state.latest, before)

    def test_citizen_capability_receipts_persist_and_restore_with_world(self):
        snapshot, world, request = self.requested_capability_service()
        decision = self.state.citizen_capability_request(request)
        request_id = decision["requestId"]
        forged_checkpoint = copy.deepcopy(world)
        forged_checkpoint["citizens"]["capabilityRequests"][0]["request"][
            "checkpoint"]["objectIds"].pop()
        with self.assertRaisesRegex(APIError, "provenance disagree"):
            validate_citizens_checkpoint(forged_checkpoint["citizens"],
                                         forged_checkpoint["scene"])
        forged_number = copy.deepcopy(world)
        forged_number["citizens"]["capabilityRequests"][0]["request"][
            "parameters"]["transform"]["scale"]["x"] = True
        with self.assertRaisesRegex(APIError, "provenance disagree"):
            validate_citizens_checkpoint(forged_number["citizens"],
                                         forged_number["scene"])
        false_failure = copy.deepcopy(world)
        false_failure["citizens"]["construction"].update(
            status="failed", requestId=request_id, reason="Matrix failed")
        false_entry = false_failure["citizens"]["capabilityRequests"][0]
        false_entry.update(status="failed", policy=copy.deepcopy(decision),
                           receipts=[{"requestId": request_id, "ok": True,
                                      "error": "", "objectId": "phantom"}],
                           reason="Matrix failed")
        with self.assertRaisesRegex(APIError, "Invalid failed Citizens capability"):
            validate_citizens_checkpoint(false_failure["citizens"],
                                         false_failure["scene"])
        created = copy.deepcopy(world)
        addition = self.procedural_object(object_id="citizen-bench-created-1")
        addition["transform"] = copy.deepcopy(CITIZEN_BENCH_TRANSFORM)
        addition["interaction"] = copy.deepcopy(CITIZEN_BENCH_INTERACTION)
        created["scene"]["objects"].append(addition)
        construction = created["citizens"]["construction"]
        construction.update(status="created", requestId=request_id,
                            objectId=addition["objectId"],
                            interactionRequestId=request_id + "-interaction")
        created["citizens"]["stations"][0]["waiters"] = []
        created["citizens"]["stations"].append({
            "id": "citizen-bench", "kind": "rest", "objectId": addition["objectId"],
            "capacity": 1, "claim": {"residentId": "bo", "executionId": 2,
                                      "expiresTick": 73}, "waiters": [],
            "interaction": copy.deepcopy(CITIZEN_BENCH_INTERACTION),
            "approachMode": "selected"})
        created["citizens"]["residents"][1]["activity"] = {
            "kind": "rest", "stationId": "citizen-bench", "phase": "travel",
            "remainingTicks": 4, "travelTicks": 0, "target": None,
            "executionId": 2, "routeRetries": 0, "routeGeometryId": None}
        creation_receipt = {"requestId": request_id, "ok": True,
                            "error": "", "objectId": addition["objectId"]}
        interaction_receipt = {"requestId": request_id + "-interaction",
                               "ok": True, "error": "",
                               "objectId": addition["objectId"]}
        entry = created["citizens"]["capabilityRequests"][0]
        entry.update(status="succeeded", policy=copy.deepcopy(decision),
                     receipts=[creation_receipt, interaction_receipt])
        validate_citizens_checkpoint(created["citizens"], created["scene"])
        altered_recipe = copy.deepcopy(created)
        altered_recipe["scene"]["objects"][-1]["procedural"]["parameters"][
            "lengthMeters"] = 2.4  # Valid generator input, but not the approved request.
        with self.assertRaisesRegex(APIError, "recipe differs from its saved request"):
            validate_citizens_checkpoint(altered_recipe["citizens"],
                                         altered_recipe["scene"])
        forged = copy.deepcopy(created)
        forged["citizens"]["capabilityRequests"][0]["receipts"][0][
            "requestId"] = "different-request"
        with self.assertRaisesRegex(APIError, "receipt IDs|provenance"):
            validate_citizens_checkpoint(forged["citizens"], forged["scene"])
        observed = copy.deepcopy(snapshot)
        observed["scene"] = copy.deepcopy(created["scene"])
        observed["citizensState"] = copy.deepcopy(created["citizens"])
        self.exchange(observed, results=[creation_receipt])
        self.assertEqual(self.state.agent_procedural_status(request_id)["status"],
                         "unconfirmed")
        self.state.save_world_checkpoint("AdaBo", created)
        self.assertEqual(self.state.agent_procedural_status(request_id)["status"],
                         "succeeded")
        self.assertEqual(self.state.hosted_observation()["world"], created)
        restarted = State(self.state.directory, clock=lambda: self.now,
                          web_assets_directory=Path(self.temp.name) / "assets")
        bootstrap = copy.deepcopy(self.snapshot)
        bootstrap["scene"]["objects"] = []
        bootstrap["citizensState"] = None
        bootstrap.pop("citizensObservation", None)
        restarted.exchange({"clientId": "host-after-restart", "hostWorldId": "AdaBo",
                            "snapshot": bootstrap, "results": [],
                            "captureSupported": False})
        self.assertEqual(restarted.load_world_checkpoint("AdaBo")["world"], created)
        self.assertEqual(restarted.citizen_capability_issued, 0)

    def test_citizen_construction_uses_typed_procedural_queue_with_identity(self):
        snapshot, world = self.requested_service()
        record = world["citizens"]["construction"]
        result = self.state.citizen_construction_request({
            "intentId": record["intentId"], "residentId": "bo"})
        self.assertEqual(set(result), {"allowed", "requestId"})
        self.assertTrue(result["allowed"])
        request_id = result["requestId"]
        self.assertRegex(request_id, r"^[0-9a-f]{32}$")
        command = self.state.pending[request_id]
        self.assertEqual(command["op"], "create_procedural")
        self.assertEqual(command["anchorId"], "web-floor")
        self.assertEqual(command["transform"], CITIZEN_BENCH_TRANSFORM)
        self.assertEqual(command["procedural"],
                         new_recipe(snapshot["proceduralGenerators"], "curved-bench"))
        self.assertEqual(self.state.agent_procedural_ids[request_id]["residentId"], "bo")
        self.assertEqual(self.state.agent_procedural_ids[request_id]["citizenIntentId"],
                         record["intentId"])
        denied = self.state.citizen_construction_request({
            "intentId": record["intentId"], "residentId": "bo"})
        self.assertEqual(denied, {"allowed": False,
                                  "reason": "Citizen construction budget is exhausted"})
        self.assertEqual(list(self.state.pending), [request_id])

    def test_zero_budget_and_stale_intent_deny_without_mutation(self):
        snapshot, world = self.requested_service(budget=0)
        before = copy.deepcopy(self.state.latest)
        record = world["citizens"]["construction"]
        denied = self.state.citizen_construction_request({
            "intentId": record["intentId"], "residentId": "bo"})
        self.assertEqual(denied, {"allowed": False,
                                  "reason": "Citizen construction budget is exhausted"})
        self.assertFalse(self.state.pending)
        self.assertEqual(self.state.latest, before)
        self.state.citizen_construction_budget = 1
        stale = self.state.citizen_construction_request({
            "intentId": "different-intent", "residentId": "bo"})
        self.assertFalse(stale["allowed"])
        self.assertFalse(self.state.pending)
        self.assertEqual(self.state.latest, before)
        self.assertEqual(snapshot["scene"], world["scene"])

    def test_citizen_construction_endpoint_requires_owner_token(self):
        _, world = self.requested_service()
        intent = {"intentId": world["citizens"]["construction"]["intentId"],
                  "residentId": "bo"}
        service = Server(("127.0.0.1", 0), self.state, OWNER, VIEWER)
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()

        def post(token):
            request = urllib.request.Request(
                f"http://127.0.0.1:{service.server_port}/api/citizens/construction",
                data=json.dumps(intent).encode("utf-8"),
                headers={"Authorization": "Bearer " + token,
                         "Content-Type": "application/json"})
            try:
                response = urllib.request.urlopen(request, timeout=3)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.loads(response.read())

        try:
            self.assertEqual(post(VIEWER)[0], 401)
            self.assertFalse(self.state.pending)
            status, allowed = post(OWNER)
            self.assertEqual(status, 200)
            self.assertEqual(allowed["allowed"], True)
            self.assertEqual(list(self.state.pending), [allowed["requestId"]])
        finally:
            service.shutdown()
            service.server_close()
            thread.join(timeout=3)

    def test_v13_reviewed_station_and_queued_intermediate_validate(self):
        snapshot, world = self.requested_construction()
        validate_citizens_checkpoint(world["citizens"], world["scene"])
        queued = copy.deepcopy(world)
        queued["citizens"]["construction"]["status"] = "queued"
        queued["citizens"]["construction"]["requestId"] = "a" * 32
        addition = self.procedural_object()
        addition["transform"] = copy.deepcopy(CITIZEN_BENCH_TRANSFORM)
        queued["scene"]["objects"].append(addition)
        validate_citizens_checkpoint(queued["citizens"], queued["scene"])
        exchanged = copy.deepcopy(snapshot)
        exchanged["citizensState"] = copy.deepcopy(queued["citizens"])
        exchanged["scene"] = copy.deepcopy(queued["scene"])
        self.exchange(exchanged)
        created = copy.deepcopy(queued)
        created["citizens"]["construction"].update(
            status="created", objectId=addition["objectId"],
            interactionRequestId="a" * 32 + "-interaction")
        created["scene"]["objects"][-1]["interaction"] = copy.deepcopy(
            CITIZEN_BENCH_INTERACTION)
        created["citizens"]["stations"][0]["waiters"] = []
        created["citizens"]["stations"][2:] = [{
            "id": "citizen-bench", "kind": "rest", "objectId": addition["objectId"],
            "capacity": 1, "claim": {"residentId": "bo", "executionId": 2,
                                      "expiresTick": 73}, "waiters": [],
            "interaction": copy.deepcopy(CITIZEN_BENCH_INTERACTION),
            "approachMode": "selected"}]
        created["citizens"]["residents"][1]["activity"] = {
            "kind": "rest", "stationId": "citizen-bench", "phase": "travel",
            "remainingTicks": 4, "travelTicks": 0, "target": None,
            "executionId": 2, "routeRetries": 0, "routeGeometryId": None}
        validate_citizens_checkpoint(created["citizens"], created["scene"])
        exchanged["citizensState"] = copy.deepcopy(created["citizens"])
        exchanged["scene"] = copy.deepcopy(created["scene"])
        self.exchange(exchanged)
        self.state.save_world_checkpoint("AdaBo", created)
        self.assertEqual(self.state.hosted_observation()["world"]["citizens"][
            "construction"]["objectId"], addition["objectId"])
        used = copy.deepcopy(created)
        used["citizens"]["requestSequence"] = 1
        used["citizens"]["construction"].update(
            status="used", useRequestId="citizens-29-action-2-1")
        validate_citizens_checkpoint(used["citizens"], used["scene"])
        used["citizens"]["construction"]["useRequestId"] = "citizens-29-action-1-1"
        with self.assertRaisesRegex(APIError, "use receipt"):
            validate_citizens_checkpoint(used["citizens"], used["scene"])
        forged = copy.deepcopy(created)
        forged["scene"]["objects"][-1]["interaction"]["effect"]["delta"] = 50
        with self.assertRaises(APIError):
            validate_citizens_checkpoint(forged["citizens"], forged["scene"])

    def test_operator_procedural_receipt_waits_for_atomic_hosted_checkpoint(self):
        self.exchange()
        added = self.procedural_object()
        request = {"action": "create", "room_id": "web-virtual-room-v1",
                   "scene_revision": self.state.revision,
                   "generator_id": "curved-bench", "parameters": {},
                   "transform": added["transform"]}
        with self.assertRaisesRegex(APIError, "durable checkpoint"):
            self.state.agent_procedural_action(request)
        self.assertFalse(self.state.pending)
        self.state.save_world_checkpoint("AdaBo", self.world)
        original_ids = {item["objectId"] for item in self.world["scene"]["objects"]}
        original_citizens = copy.deepcopy(self.world["citizens"])
        queued = self.state.agent_procedural_action(request)
        self.assertEqual(queued["status"], "queued")
        command = self.state.pending[queued["requestId"]]
        self.assertEqual(command["op"], "create_procedural")
        self.assertEqual(command["procedural"], added["procedural"])
        changed = copy.deepcopy(self.snapshot)
        changed["scene"]["objects"].append(added)
        world = copy.deepcopy(self.world)
        world["scene"]["objects"].append(copy.deepcopy(added))
        self.exchange(changed, results=[{"requestId": queued["requestId"],
                                         "ok": True, "error": "",
                                         "objectId": added["objectId"]}])
        self.assertEqual(self.state.agent_procedural_status(queued["requestId"])["status"],
                         "unconfirmed")
        with self.assertRaisesRegex(APIError, "durable checkpoint"):
            self.state.agent_procedural_action({**request,
                                                "scene_revision": self.state.revision})
        with self.assertRaisesRegex(APIError, "durable checkpoint"):
            self.state.queue([{"op": "get_scene"}])
        self.assertFalse(self.state.pending)
        with self.assertRaisesRegex(APIError, "not checkpointed"):
            self.state.hosted_observation()
        self.state.save_world_checkpoint("AdaBo", world)
        receipt = self.state.agent_procedural_status(queued["requestId"])
        self.assertEqual((receipt["status"], receipt["objectId"]),
                         ("succeeded", added["objectId"]))
        self.assertEqual(self.state.hosted_observation()["world"], world)
        self.assertEqual(self.state.load_world_checkpoint("AdaBo")["world"], world)
        self.assertTrue(original_ids <= {item["objectId"] for item in world["scene"]["objects"]})
        self.assertEqual(world["citizens"], original_citizens)
        with self.assertRaisesRegex(APIError, "one procedural creation"):
            self.state.agent_procedural_action({**request,
                                                "scene_revision": self.state.revision})
        self.assertFalse(self.state.pending)

        restarted = State(self.state.directory, clock=lambda: self.now,
                          web_assets_directory=Path(self.temp.name) / "assets")
        bootstrap = copy.deepcopy(self.snapshot)
        bootstrap["scene"]["objects"] = []
        bootstrap["citizensState"] = None
        bootstrap.pop("citizensObservation", None)
        restarted.exchange({"clientId": "host-after-restart", "hostWorldId": "AdaBo",
                            "snapshot": bootstrap, "results": [],
                            "captureSupported": False})
        restored = restarted.load_world_checkpoint("AdaBo")["world"]
        self.assertEqual(restored, world)
        self.assertEqual(restored["citizens"]["residents"], original_citizens["residents"])

    def test_hosted_procedural_queue_requires_typed_agent_path(self):
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        added = self.procedural_object()
        raw = {"op": "create_procedural", "anchorId": "web-floor",
               "transform": added["transform"],
               "procedural": added["procedural"]}
        with self.assertRaisesRegex(APIError, "typed Agent capability"):
            self.state.queue([raw])
        self.assertFalse(self.state.pending)

        browser = State(Path(self.temp.name) / "browser-scenes", clock=lambda: self.now,
                        web_assets_directory=Path(self.temp.name) / "browser-assets")
        browser_snapshot = copy.deepcopy(self.snapshot)
        browser_snapshot["runtimeDescriptor"] = {
            "schemaVersion": 1, "client": "matrix-web",
            "renderer": "threejs-webxr", "presentation": "desktop"}
        browser.exchange({"clientId": "browser-1", "snapshot": browser_snapshot,
                          "results": [], "captureSupported": False})
        self.assertEqual(browser.queue([raw])["commands"][0]["op"],
                         "create_procedural")

    def test_host_rejects_second_or_unreviewed_construction_without_mutating_state(self):
        self.exchange()
        before = copy.deepcopy(self.state.latest)
        valid = copy.deepcopy(self.snapshot)
        valid["scene"]["objects"].append(self.procedural_object())
        second = copy.deepcopy(valid)
        second["scene"]["objects"].append(self.procedural_object(object_id="host-bench-2"))
        unreviewed = copy.deepcopy(valid)
        unreviewed["scene"]["objects"][-1]["behaviors"] = [{
            "kind": "rotate", "enabled": True, "paused": False, "speed": 1}]
        wrong_recipe = copy.deepcopy(valid)
        wrong_recipe["scene"]["objects"][-1]["procedural"]["sourceRevision"] = "unknown"
        for candidate in (second, unreviewed, wrong_recipe):
            with self.assertRaises(APIError):
                self.exchange(candidate)
            self.assertEqual(self.state.latest, before)

    def test_host_descriptor_and_static_fixture_are_truthful(self):
        self.assertEqual(self.snapshot["runtimeDescriptor"], {
            "schemaVersion": 1, "client": "matrix-world-host",
            "renderer": "none", "presentation": "host"})
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        self.assertEqual(self.state.hosted_observation()["world"], self.world)
        changed = copy.deepcopy(self.snapshot)
        changed["scene"]["objects"][0]["behaviors"] = [{
            "kind": "rotate", "enabled": True, "paused": False, "speed": 1}]
        with self.assertRaises(APIError):
            self.exchange(changed)
        self.assertEqual(self.state.latest["scene"], self.world["scene"])
        forged = copy.deepcopy(self.snapshot)
        forged["runtimeDescriptor"]["renderer"] = "threejs-webxr"
        with self.assertRaises(APIError):
            self.exchange(forged)

    def test_bootstrap_observation_and_atomic_checkpoint_freshness(self):
        empty = copy.deepcopy(self.snapshot)
        empty["scene"]["objects"] = []
        empty["citizensState"] = None
        empty.pop("citizensObservation", None)
        self.exchange(empty)
        with self.assertRaises(APIError):
            self.state.hosted_observation()
        with self.assertRaisesRegex(APIError, "full Citizens fixture"):
            self.state.save_world_checkpoint("AdaBo", {
                "version": 2, "scene": empty["scene"], "game": None})
        self.assertFalse(self.state.world_checkpoint_path("AdaBo").exists())
        with self.assertRaises(APIError):
            self.state.hosted_observation()
        self.exchange()
        with self.assertRaisesRegex(APIError, "not checkpointed"):
            self.state.hosted_observation()
        self.assertTrue(self.state.save_world_checkpoint("AdaBo", self.world)["saved"])
        checkpoint = self.state.load_world_checkpoint("AdaBo")
        self.assertEqual(checkpoint["world"], self.world)
        saved = json.loads(self.state.world_checkpoint_path("AdaBo").read_text(encoding="utf-8"))
        self.assertEqual(saved["hostedWorldId"], "AdaBo")
        stale = copy.deepcopy(self.world)
        stale["citizens"]["paused"] = not stale["citizens"]["paused"]
        with self.assertRaisesRegex(APIError, "Hosted Citizens world changed"):
            self.state.save_world_checkpoint("AdaBo", stale)
        with self.assertRaisesRegex(APIError, "Hosted Citizens world changed"):
            self.state.save_world_checkpoint("Other", self.world)
        self.assertFalse((self.state.directory / "world_checkpoints" / "Other.json").exists())

    def test_lease_restart_changes_observation_instance_and_never_catches_up(self):
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        first = self.state.hosted_observation()
        self.assertEqual(first["sequence"], 1)
        with self.assertRaisesRegex(APIError, "Another client"):
            self.exchange(client_id="host-2")
        self.now = 16.0
        with self.assertRaises(APIError):
            self.state.hosted_observation()
        self.exchange(client_id="host-2")
        with self.assertRaisesRegex(APIError, "not checkpointed"):
            self.state.hosted_observation()
        self.state.save_world_checkpoint("AdaBo", self.world)
        second = self.state.hosted_observation()
        self.assertNotEqual(second["instanceId"], first["instanceId"])
        self.assertEqual(second["sequence"], 1)
        self.assertEqual(second["clockTick"], first["clockTick"])
        with self.assertRaisesRegex(APIError, "Hosted world changed"):
            self.exchange(client_id="host-2", name="Other")

    def test_observation_token_is_distinct_and_read_only(self):
        with self.assertRaisesRegex(APIError, "requires a distinct SANDBOX_TOKEN"):
            Server(("127.0.0.1", 0), self.state, "", VIEWER)
        with self.assertRaisesRegex(APIError, "requires a distinct SANDBOX_TOKEN"):
            Server(("127.0.0.1", 0), self.state, OWNER, OWNER)
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        service = Server(("127.0.0.1", 0), self.state, OWNER, VIEWER)
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()

        def get(path, token=""):
            request = urllib.request.Request(
                f"http://127.0.0.1:{service.server_port}{path}",
                headers={"Authorization": "Bearer " + token} if token else {})
            try:
                response = urllib.request.urlopen(request, timeout=3)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.loads(response.read())

        def post(path, token, body):
            request = urllib.request.Request(
                f"http://127.0.0.1:{service.server_port}{path}",
                data=json.dumps(body).encode("utf-8"),
                headers={"Authorization": "Bearer " + token,
                         "Content-Type": "application/json"})
            try:
                response = urllib.request.urlopen(request, timeout=3)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status

        try:
            self.assertEqual(get("/api/web/hosted/observe")[0], 401)
            self.assertEqual(get("/api/web/hosted/observe", OWNER)[0], 401)
            status, value = get("/api/web/hosted/observe", VIEWER)
            self.assertEqual(status, 200)
            self.assertEqual(value["worldId"], "AdaBo")
            self.assertEqual(value["world"], self.world)
            self.assertEqual(get("/api/state", VIEWER)[0], 401)
            self.assertEqual(get("/api/state", OWNER)[0], 200)
            self.assertEqual(post("/api/agent/session", VIEWER, {}), 401)
            self.assertEqual(post("/api/exchange", VIEWER, {}), 401)
            intent = {"intentId": "citizens-29-construction-2", "residentId": "bo"}
            self.assertEqual(post("/api/citizens/construction", VIEWER, intent), 401)
            self.assertEqual(post("/api/citizens/construction", OWNER, intent), 200)
        finally:
            service.shutdown()
            service.server_close()
            thread.join(timeout=3)

    def test_hosted_checkpoint_cannot_take_over_a_browser_checkpoint(self):
        target = self.state.world_checkpoint_path("AdaBo")
        target.parent.mkdir(parents=True)
        browser_document = {"schemaVersion": 1, "world": self.world,
                            "dependencies": [],
                            "payloadSha256": world_checkpoint_digest(self.world, [])}
        original = json.dumps(browser_document).encode("utf-8")
        target.write_bytes(original)
        self.exchange()
        with self.assertRaisesRegex(APIError, "different owner"):
            self.state.load_world_checkpoint("AdaBo")
        with self.assertRaisesRegex(APIError, "different owner"):
            self.state.save_world_checkpoint("AdaBo", self.world)
        self.assertEqual(target.read_bytes(), original)
        with self.assertRaisesRegex(APIError, "not checkpointed"):
            self.state.hosted_observation()

    def test_browser_cannot_load_or_replace_a_hosted_checkpoint(self):
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        original = self.state.world_checkpoint_path("AdaBo").read_bytes()
        browser = State(self.state.directory, clock=lambda: self.now,
                        web_assets_directory=Path(self.temp.name) / "assets")
        browser_snapshot = copy.deepcopy(self.snapshot)
        browser_snapshot["runtimeDescriptor"] = {
            "schemaVersion": 1, "client": "matrix-web",
            "renderer": "threejs-webxr", "presentation": "desktop"}
        browser.exchange({"clientId": "browser-1", "snapshot": browser_snapshot,
                          "results": [], "captureSupported": False})
        with self.assertRaisesRegex(APIError, "different owner"):
            browser.load_world_checkpoint("AdaBo")
        with self.assertRaisesRegex(APIError, "different owner"):
            browser.save_world_checkpoint("AdaBo", self.world)
        self.assertEqual(self.state.world_checkpoint_path("AdaBo").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
