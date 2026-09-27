"""Isolated real-Blender Citizen asset proof with a full service/host restart.

Run from the repository root after building WebRuntime. The generated GLB,
catalog, job ledger, and hosted world live in one temporary directory until
the probe finishes. Owner and visitor receive separate tokens.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

from citizen_construction_live_probe import (ROOT, Server, State, api, ids,
                                             resident_ids, stop_host,
                                             stop_service, wait_for)

sys.path.insert(0, str(ROOT / "ControlService"))
from web_assets import inspect_glb  # noqa: E402


def start_service(directory, owner, viewer, events, builder_calls, policy_calls):
    state = State(directory / "scenes", web_assets_directory=directory / "assets")
    saved = []
    save = state.save_world_checkpoint
    policy = state.citizen_capability_request
    build = state.blender_authoring.builder

    def capture_save(name, world):
        result = save(name, world)
        if name == "AdaBo":
            saved.append(copy.deepcopy(world))
            events.append("saved:" + str(world["citizens"]["clockTick"]))
        return result

    def capture_policy(request):
        events.append("policy:" + request["citizenRequestId"])
        try:
            decision = policy(request)
        except Exception as error:
            print(f"Citizen policy raised {type(error).__name__}: {error}",
                  file=sys.stderr, flush=True)
            raise
        policy_calls.append({"request": copy.deepcopy(request),
                             "decision": copy.deepcopy(decision)})
        return decision

    def capture_build(recipe, folder):
        builder_calls.append(copy.deepcopy(recipe))
        return build(recipe, folder)

    state.save_world_checkpoint = capture_save
    state.citizen_capability_request = capture_policy
    state.blender_authoring.builder = capture_build
    service = Server(("127.0.0.1", 0), state, owner, viewer)
    thread = threading.Thread(target=service.serve_forever, daemon=True)
    thread.start()
    return state, saved, service, thread


def start_host(port, owner):
    environment = {**os.environ, "SANDBOX_TOKEN": owner}
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.Popen(
        ["node", "src/host_world.js", "--url", f"http://127.0.0.1:{port}",
         "--name", "AdaBo", "--citizen-generated-asset", "--interval-ms", "100"],
        cwd=ROOT / "WebRuntime", env=environment, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, creationflags=flags)


def saved_at(saved, status):
    for world in saved:
        record = world["citizens"].get("generatedConstruction")
        if status is None and record is None or record and record["status"] == status:
            return world
    return None


def read_binary(port, path, token):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        headers={"Authorization": "Bearer " + token})
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read()


def run():
    owner = secrets.token_urlsafe(32)
    viewer = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix="matrix-citizen-blender-") as temporary:
        directory = (Path(os.path.relpath(temporary, Path.cwd()))
                     if "--relative-scenes" in sys.argv else Path(temporary))
        events, builder_calls, policy_calls = [], [], []
        state = service = thread = host = None
        try:
            state, saved, service, thread = start_service(
                directory, owner, viewer, events, builder_calls, policy_calls)
            host = start_host(service.server_port, owner)
            initial = wait_for("initial hosted checkpoint", host,
                               lambda: saved_at(saved, None))
            requested = wait_for("saved Citizen asset request", host,
                                 lambda: saved_at(saved, "requested"))
            created = wait_for("Blender asset spawned in Matrix", host,
                               lambda: saved_at(saved, "created"), timeout=240)
            used = wait_for("Bo used the generated GLB", host,
                            lambda: saved_at(saved, "used"), timeout=120)

            record = used["citizens"]["generatedConstruction"]
            journal = used["citizens"]["capabilityRequests"]
            assert len(journal) == 1
            capability = journal[0]
            requested_capability = requested["citizens"]["capabilityRequests"][0]
            request = requested_capability["request"]
            work = capability["work"]
            assert len(ids(initial)) == 4 and initial["citizens"]["clockTick"] == 0
            assert requested["citizens"]["stations"][0]["claim"]["residentId"] == "ada"
            assert requested["citizens"]["stations"][0]["waiters"][0]["residentId"] == "bo"
            assert request["residentId"] == "bo"
            assert request["intentId"] == record["intentId"]
            assert (request["capability"], request["action"]) == ("asset", "generate")
            assert request["parameters"]["profileId"] == "rest-seat-v1"
            assert request["checkpoint"] == {
                "roomId": requested["scene"]["roomId"],
                "clockTick": requested["citizens"]["clockTick"],
                "objectIds": sorted(ids(requested))}
            assert events.index("saved:" + str(requested["citizens"]["clockTick"])) < next(
                index for index, event in enumerate(events) if event.startswith("policy:"))
            assert len(policy_calls) == 1
            assert policy_calls[0]["request"] == request
            assert policy_calls[0]["decision"] == capability["policy"]
            assert capability["policy"]["allowed"] is True
            assert work["jobId"] == capability["policy"]["requestId"]
            assert len(builder_calls) == 1
            job = state.blender_authoring.status(work["jobId"])
            assert job["phase"] == "ready"
            asset = job["asset"]
            assert asset["assetId"] == work["assetId"]
            assert asset["sha256"] == work["sha256"]
            assert any(item["assetId"] == asset["assetId"]
                       for item in state.web_assets.list())
            glb = state.web_assets.file(asset["sha256"])
            assert hashlib.sha256(glb.read_bytes()).hexdigest() == asset["sha256"]
            inspected = inspect_glb(glb)
            assert inspected["bytes"] == asset["byteLength"]
            assert len(ids(created)) == len(ids(used)) == 5
            assert ids(initial) == ids(used)[:4]
            assert resident_ids(initial) == resident_ids(used)
            assert capability["status"] == "succeeded"
            assert capability["request"] == request
            assert record["status"] == "used" and record["useRequestId"]
            bo = next(item for item in used["citizens"]["residents"]
                      if item["id"] == "bo")
            assert bo["lastOutcome"] == f'Completed rest at minute {used["citizens"]["clockTick"]}'
            assert len(capability["receipts"]) == 2
            spawn_receipt, interaction_receipt = capability["receipts"]
            assert spawn_receipt["ok"] and interaction_receipt["ok"]
            assert spawn_receipt["requestId"] == work["spawnRequestId"]
            assert spawn_receipt["objectId"] == work["objectId"]
            assert interaction_receipt["requestId"] == work["interactionRequestId"]
            assert interaction_receipt["objectId"] == work["objectId"]
            object_ = next(item for item in used["scene"]["objects"]
                           if item["objectId"] == work["objectId"])
            assert object_["assetId"] == asset["assetId"]
            assert object_["interaction"]["assetSha256"] == asset["sha256"]
            assert object_["interaction"]["kind"] == "rest"
            matrix_result = next(item for item in state.results
                                 if item["requestId"] == work["spawnRequestId"])
            assert spawn_receipt == matrix_result
            assert state.agent_spawn_status(work["spawnRequestId"])["status"] == "succeeded"

            assert api(service.server_port, "GET", "/api/state", viewer)[0] == 401
            assert api(service.server_port, "POST", "/api/citizens/capabilities",
                       viewer, request)[0] == 401
            code, visit = api(service.server_port, "GET",
                              "/api/web/hosted/observe", viewer)
            assert code == 200 and visit["readOnly"] is True
            assert ids(visit["world"]) == ids(used)
            assert visit["world"]["citizens"]["capabilityRequests"] == journal
            assert any(item["assetId"] == asset["assetId"]
                       for item in visit["assets"])
            asset_path = "/api/web/assets/" + asset["sha256"] + ".glb"
            asset_code, viewer_glb = read_binary(service.server_port,
                                                  asset_path, viewer)
            assert asset_code == 200
            assert hashlib.sha256(viewer_glb).hexdigest() == asset["sha256"]
            assert api(service.server_port, "GET", "/api/web/assets", viewer)[0] == 401
            on_disk = json.loads(state.world_checkpoint_path("AdaBo").read_text())
            assert on_disk["world"]["citizens"]["capabilityRequests"] == journal
            assert on_disk["world"]["citizens"]["generatedConstruction"] == record
            assert ids(on_disk["world"]) == ids(used)

            if "--browser-hold" in sys.argv:
                print(json.dumps({
                    "browserUrl": f"http://127.0.0.1:{service.server_port}/web/hosted.html",
                    "viewToken": viewer, "objectId": work["objectId"],
                    "assetSha256": asset["sha256"]}), flush=True)
                input("Browser visitor check ready; press Enter to restart the host: ")

            stop_host(host)
            host = None
            stop_service(service, thread)
            service = thread = None
            restart_events, restart_builders, restart_policy = [], [], []
            state, restart_saved, service, thread = start_service(
                directory, owner, viewer, restart_events, restart_builders,
                restart_policy)
            host = start_host(service.server_port, owner)
            restored = wait_for("same generated world after process restart", host,
                                lambda: next((world for world in restart_saved
                                              if world["citizens"]["clockTick"] >
                                              used["citizens"]["clockTick"]), None))
            assert ids(restored) == ids(used)
            assert resident_ids(restored) == resident_ids(used)
            assert restored["citizens"]["generatedConstruction"] == record
            assert restored["citizens"]["capabilityRequests"] == journal
            assert not restart_builders and not restart_policy
            assert not state.agent_spawn_ids
            code, revisit = api(service.server_port, "GET",
                                "/api/web/hosted/observe", viewer)
            assert code == 200 and ids(revisit["world"]) == ids(used)
            if "--browser-hold" in sys.argv:
                print(json.dumps({
                    "browserUrlAfterRestart":
                        f"http://127.0.0.1:{service.server_port}/web/hosted.html",
                    "viewToken": viewer, "objectId": work["objectId"],
                    "assetSha256": asset["sha256"]}), flush=True)
                input("Restarted browser visitor check ready; press Enter to finish: ")
            print(json.dumps({
                "worldAlreadyHostedAtTick": initial["citizens"]["clockTick"],
                "needTick": requested["citizens"]["clockTick"],
                "createdTick": created["citizens"]["clockTick"],
                "usedTick": used["citizens"]["clockTick"],
                "restartTick": restored["citizens"]["clockTick"],
                "residentId": record["residentId"],
                "citizenRequestId": request["citizenRequestId"],
                "citizenRequest": request,
                "policyDecision": capability["policy"],
                "jobId": work["jobId"],
                "profileRevision": job["profileRevision"],
                "assetId": asset["assetId"],
                "assetSha256": asset["sha256"],
                "glbBytes": asset["byteLength"],
                "blenderBuilds": len(builder_calls),
                "matrixSpawnRequestId": work["spawnRequestId"],
                "matrixObjectId": work["objectId"],
                "matrixSpawnReceiptOk": spawn_receipt["ok"],
                "matrixInteractionReceiptOk": interaction_receipt["ok"],
                "matrixSpawnReceipt": spawn_receipt,
                "matrixInteractionReceipt": interaction_receipt,
                "useRequestId": record["useRequestId"],
                "boLastOutcome": bo["lastOutcome"],
                "restartBlenderBuilds": len(restart_builders),
                "restartPolicyCalls": len(restart_policy),
                "restartSpawnRequests": len(state.agent_spawn_ids),
                "visitorReadOnlySameWorld": True,
            }, sort_keys=True), flush=True)
        finally:
            stop_host(host)
            stop_service(service, thread)


if __name__ == "__main__":
    run()
