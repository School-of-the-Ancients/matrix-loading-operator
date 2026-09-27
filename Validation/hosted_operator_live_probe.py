"""Manual isolated end-to-end probe for the PC Agent Portal and world host.

Run with a Python environment containing mcp<2, a logged-in native Codex CLI,
and SANDBOX_CODEX_EXE set to its absolute codex.exe path. Nothing is written to
an existing Matrix service or checkpoint directory.
"""
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
from codex_provider import CodexConfig  # noqa: E402
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
        payload = json.loads(response.read())
        return response.status, payload


def start_service(directory, owner, viewer):
    state = State(directory / "scenes", web_assets_directory=directory / "assets")
    service = Server(("127.0.0.1", 0), state, owner, viewer)
    thread = threading.Thread(target=service.serve_forever, daemon=True)
    thread.start()
    return state, service, thread


def start_host(port, owner):
    environment = {**os.environ, "SANDBOX_TOKEN": owner}
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.Popen(
        ["node", "src/host_world.js", "--url", f"http://127.0.0.1:{port}",
         "--name", "AdaBo"], cwd=ROOT / "WebRuntime", env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        creationflags=flags)


def wait_observation(port, viewer, host, *, object_count, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if host.poll() is not None:
            raise RuntimeError("World host exited: " + host.stderr.read().decode(errors="replace")[-500:])
        status, result = api(port, "GET", "/api/web/hosted/observe", viewer)
        if status == 200 and len(result["world"]["scene"]["objects"]) == object_count:
            return result
        time.sleep(.25)
    raise TimeoutError(f"No saved observation with {object_count} objects")


def stop_host(host):
    if host is not None and host.poll() is None:
        host.terminate()
        try:
            host.wait(timeout=10)
        except subprocess.TimeoutExpired:
            host.kill()
            host.wait(timeout=10)
    if host is not None and host.stderr:
        host.stderr.close()


def stop_service(service, thread):
    if service is not None:
        service.shutdown()
        service.server_close()
        thread.join(timeout=10)


def run():
    config = CodexConfig.from_environment()
    if config is None:
        raise RuntimeError("Set SANDBOX_AI_MODE=codex-cli and SANDBOX_CODEX_EXE")
    config.validate()
    if config.agent_sandbox != "read-only" or config.agent_approval_policy != "on-request":
        raise RuntimeError("Use read-only Agent sandbox and on-request approvals for this probe")
    from mcp.server.fastmcp import FastMCP  # noqa: F401

    owner = secrets.token_urlsafe(32)
    viewer = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix="matrix-hosted-operator-") as temporary:
        directory = Path(temporary)
        state = service = thread = host = None
        try:
            state, service, thread = start_service(directory, owner, viewer)
            host = start_host(service.server_port, owner)
            first = wait_observation(service.server_port, viewer, host, object_count=4)
            assert api(service.server_port, "GET", "/api/web/hosted/observe", owner)[0] == 401
            assert api(service.server_port, "GET", "/api/state", viewer)[0] == 401
            assert api(service.server_port, "POST", "/api/agent/session", viewer, {})[0] == 401

            code, opened = api(service.server_port, "POST", "/api/agent/session", owner, {})
            assert code == 200
            session_id = opened["sessionId"]
            request = ("Operator, create exactly one curved bench in the hosted AdaBo world "
                       "at room position x=-2, y=0, z=-4 with unit scale and zero rotation. "
                       "Inspect the live scene and generator list, use the typed Matrix "
                       "procedural creation capability, wait for its saved receipt, and "
                       "report the request ID. Do not edit files or run shell commands.")
            code, turn = api(service.server_port, "POST", "/api/agent/turn", owner,
                             {"sessionId": session_id, "text": request})
            assert code == 200
            approved = []
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                code, status = api(service.server_port, "POST", "/api/agent/status", owner,
                                   {"sessionId": session_id})
                assert code == 200
                for pending in status["pendingApprovals"]:
                    if pending["approvalId"] in approved:
                        continue
                    summary = pending["summary"]
                    if not (pending["reviewable"] and pending["action"] == "using_tool" and
                            summary.startswith("Create procedural curved-bench in web-virtual-room-v1 ") and
                            "p=(-2,0,-4), r=(0,0,0), s=(1,1,1)" in summary):
                        raise RuntimeError("Unexpected Agent approval: " + summary[:200])
                    code, _ = api(service.server_port, "POST", "/api/agent/approval", owner,
                                  {"sessionId": session_id,
                                   "turnId": pending["turnId"],
                                   "approvalId": pending["approvalId"], "approve": True})
                    assert code == 200
                    approved.append(pending["approvalId"])
                if status["activity"] in ("completed", "failed", "cancelled"):
                    break
                time.sleep(.5)
            else:
                raise TimeoutError("Agent turn did not finish")
            if status["activity"] != "completed":
                transport = state.agent_portal._backend.transport
                native = [{"method": item.get("method"),
                           "status": (item.get("params", {}).get("turn") or {}).get("status"),
                           "error": (item.get("params", {}).get("turn") or {}).get("error")}
                          for item in transport.events_since(0)[-4:]]
                raise RuntimeError("Agent turn ended: " + status["activity"] + " " +
                                   str(status["transcript"][-1].get("assistant", ""))[:250] +
                                   " native=" + json.dumps(native)[:1000])

            created = wait_observation(service.server_port, viewer, host, object_count=5)
            issued = list(state.agent_procedural_ids)
            assert len(issued) == 1
            receipt = state.agent_procedural_status(issued[0])
            assert receipt["status"] == "succeeded"
            assistant_text = status["transcript"][-1]["assistant"]
            assert issued[0] in assistant_text, "Operator omitted the matching request ID"
            core_ids = [item["objectId"] for item in first["world"]["scene"]["objects"]]
            created_ids = [item["objectId"] for item in created["world"]["scene"]["objects"]]
            assert set(core_ids) < set(created_ids)
            assert created_ids[-1] == receipt["objectId"]
            assert created["clockTick"] > first["clockTick"]
            assert not created["world"]["citizens"]["paused"]
            residents = {item["id"]: item["objectId"]
                         for item in created["world"]["citizens"]["residents"]}
            assert residents == {item["id"]: item["objectId"]
                                 for item in first["world"]["citizens"]["residents"]}

            stop_host(host)
            host = None
            stop_service(service, thread)
            service = thread = None
            state, service, thread = start_service(directory, owner, viewer)
            host = start_host(service.server_port, owner)
            restored = wait_observation(service.server_port, viewer, host, object_count=5)
            assert [item["objectId"] for item in restored["world"]["scene"]["objects"]] == created_ids
            assert {item["id"]: item["objectId"] for item in
                    restored["world"]["citizens"]["residents"]} == residents
            assert restored["clockTick"] >= created["clockTick"]
            print(json.dumps({"agentActivity": status["activity"], "approvedTools": len(approved),
                              "requestId": issued[0], "receipt": receipt["status"],
                              "agentReportedRequestId": True,
                              "objectId": receipt["objectId"],
                              "clockBefore": first["clockTick"],
                              "clockCreated": created["clockTick"],
                              "clockRestarted": restored["clockTick"],
                              "sameCoreIds": core_ids == created_ids[:4],
                              "sameResidentBindings": residents ==
                              {item["id"]: item["objectId"] for item in
                               restored["world"]["citizens"]["residents"]},
                              "viewerOwnerRoutesDenied": True}, sort_keys=True), flush=True)
            hold = int(os.environ.get("MATRIX_BROWSER_HOLD_SECONDS", "0"))
            if not 0 <= hold <= 300:
                raise ValueError("MATRIX_BROWSER_HOLD_SECONDS must be 0-300")
            if hold:
                # These random credentials belong only to this temporary probe.
                print(json.dumps({"viewUrl": f"http://127.0.0.1:{service.server_port}/web/hosted.html",
                                  "temporaryViewToken": viewer}), flush=True)
                time.sleep(hold)
        finally:
            stop_host(host)
            stop_service(service, thread)


if __name__ == "__main__":
    run()
