"""Isolated Citizen capability probe; no Agent or resident credentials.

Run after building WebRuntime. Uses temporary service data and distinct owner/view
tokens, then removes both when complete. MATRIX_BROWSER_HOLD_SECONDS can keep the
restarted read-only visitor available briefly for desktop inspection.
"""
import copy
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


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ControlService"))
from server import Server, State  # noqa: E402


def api(port, method, path, token, body=None):
    headers = {"Authorization": "Bearer " + token}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method, headers=headers,
        data=json.dumps(body).encode() if body is not None else None)
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.loads(response.read())


def start_service(directory, owner, viewer, policy_calls):
    state = State(directory / "scenes", web_assets_directory=directory / "assets")
    saved = []
    save = state.save_world_checkpoint

    def capture(name, world):
        result = save(name, world)
        if name == "AdaBo":
            saved.append(copy.deepcopy(world))
        return result

    state.save_world_checkpoint = capture
    policy = state.citizen_capability_request

    def capture_policy(request):
        decision = policy(request)
        policy_calls.append({"request": copy.deepcopy(request),
                             "decision": copy.deepcopy(decision)})
        return decision

    state.citizen_capability_request = capture_policy
    service = Server(("127.0.0.1", 0), state, owner, viewer)
    thread = threading.Thread(target=service.serve_forever, daemon=True)
    thread.start()
    return state, saved, service, thread


def start_host(port, owner):
    environment = {**os.environ, "SANDBOX_TOKEN": owner}
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.Popen(
        ["node", "src/host_world.js", "--url", f"http://127.0.0.1:{port}",
         "--name", "AdaBo", "--citizen-capabilities", "--interval-ms", "100"],
        cwd=ROOT / "WebRuntime", env=environment, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, creationflags=flags)


def wait_for(label, host, predicate, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result is not None:
            return result
        if host.poll() is not None:
            raise RuntimeError("World host exited: " +
                               host.stderr.read().decode(errors="replace")[-800:])
        time.sleep(.05)
    raise TimeoutError(label)


def saved_at(saved, status):
    for world in saved:
        record = world["citizens"].get("construction")
        if status is None and record is None or record and record["status"] == status:
            return world
    return None


def stop_host(host):
    if host is not None and host.poll() is None:
        host.terminate()
        try:
            host.wait(timeout=10)
        except subprocess.TimeoutExpired:
            host.kill()
            host.wait(timeout=10)
    if host is not None:
        host.stdout.close()
        host.stderr.close()


def stop_service(service, thread):
    if service is not None:
        service.shutdown()
        service.server_close()
        thread.join(timeout=10)


def ids(world):
    return [item["objectId"] for item in world["scene"]["objects"]]


def resident_ids(world):
    return {item["id"]: item["objectId"]
            for item in world["citizens"]["residents"]}


def run():
    owner = secrets.token_urlsafe(32)
    viewer = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix="matrix-citizen-construction-") as temporary:
        directory = Path(temporary)
        state = saved = service = thread = host = None
        policy_calls = []
        try:
            state, saved, service, thread = start_service(directory, owner, viewer,
                                                         policy_calls)
            host = start_host(service.server_port, owner)
            initial = wait_for("initial hosted checkpoint", host,
                               lambda: saved_at(saved, None))
            requested = wait_for("Bo's saved chair-contention request", host,
                                 lambda: saved_at(saved, "requested"))
            created = wait_for("saved reviewed bench", host,
                               lambda: saved_at(saved, "created"))
            used = wait_for("Bo's saved bench interaction", host,
                            lambda: saved_at(saved, "used"))
            record = used["citizens"]["construction"]
            journal = used["citizens"]["capabilityRequests"]
            assert len(journal) == 1
            capability = journal[0]
            requested_capability = requested["citizens"]["capabilityRequests"][0]
            request_id = record["requestId"]
            object_id = record["objectId"]
            assert len(ids(initial)) == 4
            assert initial["citizens"]["clockTick"] == 0
            assert requested["citizens"]["construction"]["residentId"] == "bo"
            assert requested_capability["status"] == "requested"
            assert requested_capability["request"]["intentId"] == record["intentId"]
            assert requested_capability["request"]["residentId"] == "bo"
            assert requested_capability["request"]["capability"] == "procedural"
            assert requested_capability["request"]["action"] == "create"
            assert requested_capability["request"]["checkpoint"] == {
                "roomId": requested["scene"]["roomId"],
                "clockTick": requested["citizens"]["clockTick"],
                "objectIds": sorted(ids(requested))}
            assert requested["citizens"]["stations"][0]["claim"]["residentId"] == "ada"
            assert requested["citizens"]["stations"][0]["waiters"][0]["residentId"] == "bo"
            assert len(policy_calls) == 1
            assert policy_calls[0]["request"] == requested_capability["request"]
            assert policy_calls[0]["decision"] == capability["policy"]
            assert capability["policy"] == {
                "allowed": True, "requestId": request_id, "reason": "",
                "checkpointSequence": capability["policy"]["checkpointSequence"]}
            assert capability["status"] == "succeeded"
            assert capability["request"] == requested_capability["request"]
            assert len(capability["receipts"]) == 2
            assert all(receipt["ok"] for receipt in capability["receipts"])
            assert len(ids(created)) == len(ids(used)) == 5
            assert ids(initial) == ids(used)[:4]
            assert resident_ids(initial) == resident_ids(used)
            assert record["status"] == "used" and record["useRequestId"]
            assert record["interactionRequestId"] and request_id and object_id
            assert used["citizens"]["stations"][2]["objectId"] == object_id
            assert used["scene"]["objects"][4]["interaction"]["kind"] == "rest"
            result = next(item for item in state.results if item["requestId"] == request_id)
            assert result["ok"] and result["objectId"] == object_id
            assert capability["receipts"][0] == result
            assert capability["receipts"][1]["requestId"] == record["interactionRequestId"]
            assert capability["receipts"][1]["objectId"] == object_id
            issued = state.agent_procedural_ids[request_id]
            assert issued["citizenRequest"] == capability["request"]
            assert issued["citizenCapability"] == "procedural"
            assert issued["citizenAction"] == "create"
            assert issued["residentId"] == "bo"
            assert state.agent_procedural_status(request_id)["status"] == "succeeded"
            assert api(service.server_port, "GET", "/api/web/hosted/observe", owner)[0] == 401
            assert api(service.server_port, "GET", "/api/state", viewer)[0] == 401
            assert api(service.server_port, "POST", "/api/citizens/capabilities",
                       viewer, capability["request"])[0] == 401
            code, visit = api(service.server_port, "GET", "/api/web/hosted/observe", viewer)
            assert code == 200 and visit["readOnly"] is True
            assert ids(visit["world"]) == ids(used)
            assert visit["world"]["citizens"]["construction"] == record
            assert visit["world"]["citizens"]["capabilityRequests"] == journal
            on_disk = json.loads(state.world_checkpoint_path("AdaBo").read_text())
            assert on_disk["world"]["citizens"]["construction"] == record
            assert on_disk["world"]["citizens"]["capabilityRequests"] == journal
            assert ids(on_disk["world"]) == ids(used)

            stop_host(host)
            host = None
            stop_service(service, thread)
            service = thread = None
            restart_policy_calls = []
            state, restart_saved, service, thread = start_service(
                directory, owner, viewer, restart_policy_calls)
            host = start_host(service.server_port, owner)
            restored = wait_for("same saved world after process restart", host,
                                lambda: next((world for world in restart_saved
                                              if world["citizens"]["clockTick"] >
                                              used["citizens"]["clockTick"]), None))
            assert ids(restored) == ids(used)
            assert resident_ids(restored) == resident_ids(used)
            assert restored["citizens"]["construction"] == record
            assert restored["citizens"]["capabilityRequests"] == journal
            assert not state.agent_procedural_ids, "Restart unexpectedly issued a second build"
            assert not restart_policy_calls, "Restart repeated the capability policy call"
            code, revisit = api(service.server_port, "GET", "/api/web/hosted/observe", viewer)
            assert code == 200 and ids(revisit["world"]) == ids(used)
            print(json.dumps({
                "worldAlreadyHostedAtTick": initial["citizens"]["clockTick"],
                "needTick": requested["citizens"]["clockTick"],
                "createdTick": created["citizens"]["clockTick"],
                "usedTick": used["citizens"]["clockTick"],
                "restartTick": restored["citizens"]["clockTick"],
                "residentId": record["residentId"],
                "intentId": record["intentId"],
                "citizenRequestId": capability["request"]["citizenRequestId"],
                "capability": capability["request"]["capability"],
                "action": capability["request"]["action"],
                "policyAllowed": capability["policy"]["allowed"],
                "checkpointSequence": capability["policy"]["checkpointSequence"],
                "requestId": request_id,
                "typedDispatch": issued["action"],
                "matrixCreationReceiptOk": result["ok"],
                "matrixInteractionReceiptOk": capability["receipts"][1]["ok"],
                "objectId": object_id,
                "interactionRequestId": record["interactionRequestId"],
                "useRequestId": record["useRequestId"],
                "sameCoreIds": True,
                "sameResidentIds": True,
                "visitorReadOnlySameWorld": True,
                "checkpointAndRestartPreservedProvenance": True,
                "capabilityJournalPreservedAcrossRestart": True,
                "viewTokenDeniedOwnerRoutes": True,
                "autonomousRequestsAfterRestart": len(restart_policy_calls),
            }, sort_keys=True), flush=True)
            hold = int(os.environ.get("MATRIX_BROWSER_HOLD_SECONDS", "0"))
            if not 0 <= hold <= 300:
                raise ValueError("MATRIX_BROWSER_HOLD_SECONDS must be 0-300")
            if hold:
                print(json.dumps({"viewUrl":
                                  f"http://127.0.0.1:{service.server_port}/web/hosted.html",
                                  "temporaryViewToken": viewer}), flush=True)
                time.sleep(hold)
        finally:
            stop_host(host)
            stop_service(service, thread)


if __name__ == "__main__":
    run()
