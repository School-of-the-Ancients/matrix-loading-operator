"""Validate the real Windows white-room player through its PC HTTP bridge.

Uses the production service CLI with its default learning bridge, an unavailable
learning core, explicit offline language rules, and two fresh player processes.
No fabricated client snapshots or headset claims.
"""
import copy
import datetime
import json
import os
from pathlib import Path
import queue
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "ControlService"))
from server import LEASE_SECONDS


def main():
    checks = []
    report = {
        "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scope": "Actual Windows Unity white-room player with PC HTTP service and fresh-player restore",
        "languageMode": "offline-rules (not a model)",
        "hardwareTested": False,
        "visualRenderingTested": False,
        "clientSnapshots": "Sent only by the real Unity players",
        "serviceStartup": "Production server.py CLI with default LearningBridge",
        "learningCore": "Unavailable (reserved non-listening loopback port)",
        "leaseSeconds": LEASE_SECONDS,
    }
    validation = PROJECT / "Validation"
    validation.mkdir(parents=True, exist_ok=True)
    executable = PROJECT / "Builds/WhiteRoomDesktop/MatrixOperator.exe"
    player = None
    player_logs = []
    temporary = tempfile.TemporaryDirectory(prefix="matrix-white-room-loop-")
    save_directory = Path(temporary.name) / "scenes"
    service_process = None
    base = None
    unavailable_core = socket.socket()
    unavailable_core.bind(("127.0.0.1", 0))

    def start_service():
        nonlocal service_process, base
        environment = os.environ.copy()
        environment.pop("SANDBOX_TOKEN", None)
        environment["SOTA_CORE_URL"] = "http://127.0.0.1:" + str(unavailable_core.getsockname()[1])
        options = {}
        if sys.platform == "win32":
            options["creationflags"] = subprocess.CREATE_NO_WINDOW
        service_process = subprocess.Popen(
            [sys.executable, "-u", str(PROJECT / "ControlService/server.py"), "--port", "0",
             "--scenes", str(save_directory)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
            env=environment, **options,
        )
        lines = queue.Queue()
        threading.Thread(target=lambda: lines.put(service_process.stdout.readline()), daemon=True).start()
        try:
            startup = lines.get(timeout=15)
        except queue.Empty:
            raise TimeoutError("Production service CLI did not announce its listening port") from None
        match = re.search(r"listening on 127\.0\.0\.1:(\d+);", startup)
        if match is None:
            raise RuntimeError("Production service CLI failed to start")
        base = "http://127.0.0.1:" + match[1]

    def check(condition, description):
        if not condition:
            raise AssertionError(description)
        checks.append(description)

    def request(path, body=None, expected_status=200):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status != expected_status:
                    raise AssertionError(f"{path}: expected HTTP {expected_status}, received {response.status}")
                return json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                detail = error.read(2048).decode("utf-8", errors="replace")
            if error.code == expected_status:
                return json.loads(detail)
            raise RuntimeError(f"{path} returned HTTP {error.code}: {detail}") from None

    def wait(predicate, seconds=30, require_player=True):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if require_player and player is not None and player.poll() is not None:
                raise RuntimeError(f"Test player exited unexpectedly with code {player.returncode}")
            current = request("/api/state")
            if predicate(current):
                return current
            time.sleep(0.15)
        raise TimeoutError("Runtime did not reach expected state")

    def start_player(number):
        nonlocal player
        log = validation / f"white-room-player-{number}.log"
        player_logs.append(log)
        options = {}
        if sys.platform == "win32":
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
            options["startupinfo"] = startup
        player = subprocess.Popen(
            [str(executable), "-batchmode", "-nographics", "-serviceUrl", base, "-logFile", str(log)],
            **options,
        )
        return wait(lambda current: current["online"])["snapshot"]

    def stop_player():
        nonlocal player
        if player is not None:
            if player.poll() is None:
                player.terminate()
                try:
                    player.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    player.kill()
                    player.wait(timeout=10)
            player = None

    def language(prompt):
        proposal = request("/api/plan", {"text": prompt, "mode": "offline-rules"})
        check(proposal["mode"] == "offline-rules", prompt + ": explicitly uses offline language rules")
        check(request("/api/state")["pendingCount"] == 0, prompt + ": proposal waits for Apply")
        response = request("/api/apply_plan", {"planId": proposal["planId"]})
        identifiers = {command["requestId"] for command in response.get("commands", [])}
        if identifiers:
            current = wait(lambda state: state["pendingCount"] == 0 and
                           identifiers <= {result["requestId"] for result in state["results"]})
            results = [result for result in current["results"] if result["requestId"] in identifiers]
            check(len(results) == len(identifiers) and all(result["ok"] for result in results),
                  prompt + ": real player acknowledged every command" +
                  ("" if all(result["ok"] for result in results) else " (" + json.dumps(results) + ")"))
        else:
            check(response.get("saved") is True, prompt + ": PC save acknowledged")
        return request("/api/state")["snapshot"]

    def find(snapshot, identifier):
        return next(item for item in snapshot["scene"]["objects"] if item["objectId"] == identifier)

    try:
        check(executable.is_file(), "Fresh white-room desktop executable is available")
        start_service()
        check(request("/api/health") == {"ok": True}, "Production service CLI starts with an unavailable optional learning core")
        unavailable = request("/api/lessons", expected_status=503)
        check("unavailable" in unavailable.get("error", "").lower(), "Optional learning catalog reports unavailable without stopping the service")
        check(request("/api/learning")["session"] is None, "Default learning bridge has no active lesson")
        current = start_player(1)
        check(current["scene"]["roomId"] == "white-room-v1" and current["scene"]["objects"] == [],
              "Fresh player starts with an empty virtual white room")
        check({item["assetId"] for item in current["assets"]} ==
              {"chair", "table", "wall", "pedestal", "block", "orb", "column"},
              "All seven bundled white-room prefabs are available")
        check([item["anchorId"] for item in current["anchors"]] == ["white-floor"],
              "White room publishes its fixed virtual floor coordinate frame")
        catalog = {item["assetId"]: item for item in current["assets"]}
        check(all(catalog[name]["spawnScale"] == 1 for name in ("chair", "table", "wall", "pedestal")) and
              all(abs(catalog[name]["spawnScale"] - 0.2) < 1e-6 for name in ("block", "orb", "column")),
              "Furniture and small props publish their authored spawn scales")

        current = language("Summon a chair")
        chair_id = current["selection"]["objectId"]
        chair = copy.deepcopy(find(current, chair_id))
        check(chair["assetId"] == "chair" and chair["anchorId"] == "white-floor" and
              chair["transform"]["scale"] == {"x": 1, "y": 1, "z": 1},
              "Chair spawns at full authored size and is selected by stable ID")
        current = language("Move it 20 cm left")
        check(abs(find(current, chair_id)["transform"]["position"]["x"] -
                  (chair["transform"]["position"]["x"] - 0.2)) < 1e-5,
              "Natural language moves the same chair in floor-local metres")
        current = language("Rotate it 45 degrees")
        check(abs(find(current, chair_id)["transform"]["rotation"]["y"] - 45) < 1e-5,
              "Natural language rotates the original chair ID")
        current = language("Make it twice as big")
        check(find(current, chair_id)["transform"]["scale"] == {"x": 2, "y": 2, "z": 2} and
              len(current["scene"]["objects"]) == 1,
              "Natural language resizes the original chair without respawning")
        current = language("Load a table")
        table_id = current["selection"]["objectId"]
        check(table_id != chair_id and find(current, table_id)["assetId"] == "table" and
              find(current, table_id)["transform"]["scale"] == {"x": 1, "y": 1, "z": 1},
              "Load a table summons a separate full-size bundled table")
        current = language("Select the chair")
        check(current["selection"]["objectId"] == chair_id, "Natural language selects the existing chair")
        before_duplicate = copy.deepcopy(current["scene"])
        current = language("Duplicate it")
        duplicate_id = current["selection"]["objectId"]
        duplicate = find(current, duplicate_id)
        original = find(current, chair_id)
        check(duplicate_id not in {chair_id, table_id} and duplicate["assetId"] == original["assetId"] and
              duplicate["anchorId"] == original["anchorId"] and duplicate["transform"]["scale"] == original["transform"]["scale"] and
              duplicate["transform"]["rotation"] == original["transform"]["rotation"] and
              abs(duplicate["transform"]["position"]["x"] - original["transform"]["position"]["x"] - 0.3) < 1e-5,
              "Duplicate receives a new selected ID and copies the edited pose with its offset")
        duplicated_scene = copy.deepcopy(current["scene"])
        current = language("Undo")
        check(current["scene"] == before_duplicate and not current["selection"]["objectId"],
              "Undo duplicate restores the exact previous scene and clears missing selection")
        current = language("Redo")
        check(current["scene"] == duplicated_scene, "Redo duplicate restores its original stable ID and exact pose")
        current = language("Select " + duplicate_id)
        check(current["selection"]["objectId"] == duplicate_id, "Exact object ID selects one of two chairs")
        current = language("Delete it")
        check(current["scene"] == before_duplicate, "Delete removes only the selected duplicated chair")
        current = language("Undo")
        check(current["scene"] == duplicated_scene, "Undo delete restores the same object ID and pose")
        current = language("Clear the scene")
        check(current["scene"]["objects"] == [], "Clear removes all virtual props")
        current = language("Undo")
        check(current["scene"] == duplicated_scene, "Undo clear restores all original IDs and transforms")

        saved_scene = copy.deepcopy(current["scene"])
        language("Save scene as WhiteRoomLoop")
        saved_path = save_directory / "WhiteRoomLoop.json"
        check(saved_path.is_file(), "PC save creates a real scene file")
        saved_bytes = saved_path.read_bytes()
        check(json.loads(saved_bytes)["scene"] == saved_scene,
              "PC save records exact IDs assets floor frame and local transforms")
        current = language("Clear the scene")
        check(current["scene"]["objects"] == [], "Pre-restore scene is empty")
        current = language("Restore WhiteRoomLoop")
        check(current["scene"] == saved_scene, "Same-player restore reconstructs the exact saved scene")

        wrong_room = json.loads(saved_bytes)
        wrong_room["scene"]["roomId"] = "another-room"
        (save_directory / "OtherRoom.json").write_text(json.dumps(wrong_room), encoding="utf-8")
        rejected = request("/api/load", {"name": "OtherRoom", "requestId": "wrong-room-load"})
        rejected_id = rejected["commands"][0]["requestId"]
        state = wait(lambda value: value["pendingCount"] == 0 and
                     any(result["requestId"] == rejected_id for result in value["results"]))
        outcome = next(result for result in state["results"] if result["requestId"] == rejected_id)
        check(not outcome["ok"] and state["snapshot"]["scene"] == saved_scene,
              "Real player rejects another room's plain save and preserves existing props")
        check(not request("/api/learning")["restorePending"], "Rejected plain restore creates no lesson recovery barrier")
        language("Select " + chair_id)
        check(request("/api/save", {"name": "AfterRejectedRestore"})["saved"],
              "Ordinary editing and save remain available after rejected plain restore")

        first_pid = player.pid
        stop_player()
        expired = request("/api/load", {"name": "WhiteRoomLoop", "requestId": "expire-before-reconnect"})
        expired_id = expired["commands"][0]["requestId"]
        stopped_at = time.monotonic()
        expired_state = wait(lambda state: not state["online"], seconds=LEASE_SECONDS + 8, require_player=False)
        report["observedLeaseExpiryWaitSeconds"] = round(time.monotonic() - stopped_at, 3)
        check(any(result["requestId"] == expired_id and not result["ok"] for result in expired_state["results"]),
              "Unacknowledged plain restore expires through the actual client lease")
        check(not request("/api/learning")["restorePending"], "Expired plain restore does not require learning recovery")
        check(saved_path.read_bytes() == saved_bytes, "Saved scene remains intact after the first player exits")
        current = start_player(2)
        check(player.pid != first_pid and current["scene"]["objects"] == [] and
              current["scene"]["roomId"] == "white-room-v1",
              "A fresh player acquires the expired lease and starts without the previous runtime state")
        current = language("Restore WhiteRoomLoop")
        check(current["scene"] == saved_scene,
              "Fresh-player restore preserves every saved ID asset anchor and transform")
        check(saved_path.read_bytes() == saved_bytes, "Restoring does not rewrite the PC save")
        check(player.poll() is None, "Fresh player remains running after restore")
        stop_player()
        for log in player_logs:
            contents = log.read_text(encoding="utf-8", errors="replace")
            check("Exception:" not in contents and "Crash!!!" not in contents,
                  log.name + ": real player log contains no runtime exceptions or crash marker")
        report.update(passed=len(checks), failed=0)
    except Exception as error:
        report.update(passed=len(checks), failed=1, error=str(error))
        raise
    finally:
        stop_player()
        if service_process is not None:
            if service_process.poll() is None:
                service_process.terminate()
                try:
                    service_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    service_process.kill()
                    service_process.wait(timeout=10)
            service_process.stdout.close()
        unavailable_core.close()
        temporary.cleanup()
        report["checks"] = checks
        report["completedUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (validation / "white-room-loop-results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
