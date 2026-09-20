"""Controlled stage-one test of an already running Quest app and PC service.

Without --run this performs read-only preflight. --run confirms that the operator
is ready, the selected headset owns this service connection, and other clients
and controller/browser edits are stopped for the test. A unique PC backup is
saved before edits; the original scene is restored in finally.

This script never launches a desktop player, installs/launches/stops an app,
injects client snapshots, automates headset input, or calls an AI/language parser.
ADB is used only to list devices and inspect the exact package's running PID.
The current bridge does not expose device identity, so service-to-headset pairing
is an operator-confirmed prerequisite, not something this protocol proves.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_PACKAGE = "com.matt.matrixoperator.whiteroom"
UNITY_ADB = Path(r"C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe")
MAX_BODY = 1024 * 1024


class CheckFailed(RuntimeError):
    pass


class HttpFailure(CheckFailed):
    def __init__(self, path, status):
        self.status = status
        super().__init__(f"{path} returned HTTP {status}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def scene_digest(scene):
    return hashlib.sha256(json.dumps(scene, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def same_scene(left, right):
    """Compare complete portable scene state, independent of object array order."""
    def normalized(value):
        result = copy.deepcopy(value)
        result["objects"].sort(key=lambda item: item["objectId"])
        return result
    return normalized(left) == normalized(right)


def same_transform(actual, expected):
    return all(math.isclose(actual[part][axis], expected[part][axis], rel_tol=1e-5, abs_tol=1e-5)
               for part in ("position", "rotation", "scale") for axis in ("x", "y", "z"))


class Harness:
    def __init__(self, args):
        self.args = args
        self.adb = args.adb or shutil.which("adb") or (str(UNITY_ADB) if UNITY_ADB.is_file() else None)
        self.serial = None
        self.pid = None
        self.token = os.environ.get("SANDBOX_TOKEN", "")
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.expected_scene = None
        self.original = None
        self.backup_name = None
        self.mutation_attempted = False
        self.checks = []
        self.report = {
            "status": "not_started",
            "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "scope": "Connected app process and existing executor HTTP loop; no synthetic client snapshots",
            "mode": "controlled-run" if args.run else "read-only-preflight",
            "deviceProcessObserved": False,
            "runtimeExecutionObserved": False,
            "wearerVisualCheck": "Not performed by this harness",
            "trackingAndControllerInputTested": False,
            "languageModelUsed": False,
            "commandPath": "Typed commands through the existing executor; no natural-language parser",
            "runtimeAttribution": "Operator must confirm this service is paired with the selected headset; the bridge exposes no device identity",
            "operatorConfirmedPairing": args.run,
            "deviceSerialRecorded": False,
            "package": args.package,
            "pretestSceneRestored": None,
            "undoHistoryRestored": False,
        }
        self.base = self.validate_service(args.service_url)

    @staticmethod
    def validate_service(value):
        parsed = urllib.parse.urlsplit(value)
        try:
            local = parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname or "").is_loopback
            port = parsed.port
        except ValueError:
            local, port = False, None
        if not (parsed.scheme == "http" and local and port is not None and
                not parsed.username and not parsed.password and parsed.path in ("", "/") and
                not parsed.query and not parsed.fragment):
            raise CheckFailed("Use a local PC service URL with an explicit port, for example http://127.0.0.1:8765")
        return value.rstrip("/")

    def check(self, condition, description):
        if not condition:
            raise CheckFailed(description)
        self.checks.append(description)

    def adb_call(self, arguments, device=True, allow_absent=False):
        command = [self.adb]
        if device:
            command += ["-s", self.serial]
        command += arguments
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                    errors="replace", timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise CheckFailed("ADB package inspection failed or timed out") from None
        if result.returncode != 0:
            if allow_absent and result.returncode == 1:
                return ""
            raise CheckFailed("ADB inspection failed; check the USB connection and debugging authorization")
        return result.stdout

    def choose_device(self):
        self.check(self.adb is not None, "ADB executable is available")
        devices = {}
        for line in self.adb_call(["devices"], device=False).splitlines():
            fields = line.split()
            if len(fields) >= 2 and fields[1] in ("device", "unauthorized", "offline"):
                devices[fields[0]] = fields[1]
        if self.args.serial is not None:
            self.check(devices.get(self.args.serial) == "device",
                       "Requested device is connected and USB debugging is authorized")
            self.serial = self.args.serial
        else:
            ready = [serial for serial, state in devices.items() if state == "device"]
            if not ready:
                if any(state == "unauthorized" for state in devices.values()):
                    raise CheckFailed("Headset detected but unauthorized; accept Allow USB debugging inside it")
                if devices:
                    raise CheckFailed("ADB detects only offline devices; reconnect the awake headset")
                raise CheckFailed("ADB detects no device; reconnect the awake headset to this PC with a USB data cable")
            self.check(len(ready) == 1,
                       "Exactly one authorized device is required; use --serial when several are connected")
            self.serial = ready[0]
        self.pid = self.read_pid()
        if self.pid is None:
            raise CheckFailed("Expected app is not running on the selected headset; open Matrix Operator from Unknown Sources")
        self.check(True, "The exact expected package is already running on the selected device")
        self.report.update(deviceProcessObserved=True, appPid=self.pid)

    def read_pid(self):
        value = self.adb_call(["shell", "pidof", "-s", self.args.package], allow_absent=True).strip()
        return int(value) if re.fullmatch(r"[0-9]+", value) else None

    def ensure_same_process(self):
        if self.read_pid() != self.pid:
            raise CheckFailed("The selected app process stopped or changed; no further scene command was sent")

    def request(self, path, body=None):
        raw = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.base + path, data=raw, headers=headers)
        try:
            with self.http.open(request, timeout=5) as response:
                data = response.read(MAX_BODY + 1)
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise HttpFailure(path, status) from None
        except (OSError, TimeoutError):
            raise CheckFailed("PC service connection failed or timed out") from None
        if len(data) > MAX_BODY:
            raise CheckFailed("PC service response exceeded the size limit")
        try:
            result = json.loads(data)
        except (UnicodeError, ValueError):
            raise CheckFailed("PC service returned invalid JSON") from None
        if not isinstance(result, dict):
            raise CheckFailed("PC service returned an unexpected response shape")
        return result

    def settled(self, timeout=None):
        deadline = time.monotonic() + (self.args.timeout if timeout is None else timeout)
        while time.monotonic() < deadline:
            state = self.request("/api/state")
            if state.get("online") and state.get("snapshot") and state.get("pendingCount") == 0:
                if state["snapshot"]["scene"]["roomId"] != self.args.room_id:
                    raise CheckFailed("The runtime room changed; no scene command was sent")
                return state
            time.sleep(.2)
        raise CheckFailed("Runtime did not become connected with an empty command queue")

    def assert_context(self):
        self.ensure_same_process()
        state = self.settled()
        if self.expected_scene is not None and not same_scene(state["snapshot"]["scene"], self.expected_scene):
            raise CheckFailed("The scene changed outside the test; stopping controlled edits")
        return state

    def wait_ack(self, queued):
        commands = queued.get("commands")
        if not isinstance(commands, list) or not commands:
            raise CheckFailed("Service did not acknowledge a queued command")
        identifiers = {command["requestId"] for command in commands}
        deadline = time.monotonic() + self.args.timeout
        while time.monotonic() < deadline:
            state = self.request("/api/state")
            matches = [result for result in state.get("results", []) if result.get("requestId") in identifiers]
            if state.get("pendingCount") == 0 and len(matches) == len(identifiers):
                self.ensure_same_process()
                if not state.get("online"):
                    raise CheckFailed("Runtime disconnected before completion could be confirmed")
                if not all(result.get("ok") is True for result in matches):
                    raise CheckFailed("Runtime rejected a controlled command; inspect the Operator result list")
                if state["snapshot"]["scene"]["roomId"] != self.args.room_id:
                    raise CheckFailed("Runtime room changed during the test")
                self.report["runtimeExecutionObserved"] = True
                self.expected_scene = copy.deepcopy(state["snapshot"]["scene"])
                return state["snapshot"], matches
            time.sleep(.2)
        raise CheckFailed("Command acknowledgement timed out; its outcome is uncertain")

    def command(self, value):
        self.assert_context()
        self.mutation_attempted = True  # Even a lost HTTP response may have enqueued the command.
        return self.wait_ack(self.request("/api/command", value))

    def save(self, name):
        before = self.assert_context()["snapshot"]["scene"]
        response = self.request("/api/save", {"name": name})
        if response.get("saved") is not True or response.get("name") != name:
            raise CheckFailed("PC service did not confirm the named scene save")
        after = self.settled()["snapshot"]["scene"]
        if not same_scene(before, after):
            raise CheckFailed("Scene changed while saving; no subsequent test edit was sent")
        return before

    def load(self, name, check_context=True):
        if check_context:
            self.assert_context()
        else:
            self.ensure_same_process()
            self.settled()
        self.mutation_attempted = True
        return self.wait_ack(self.request("/api/load", {"name": name, "requestId": uuid.uuid4().hex}))[0]

    def preflight(self):
        self.choose_device()
        self.check(self.request("/api/health").get("ok") is True, "Existing PC service is healthy")
        try:
            learning = self.request("/api/learning")
        except HttpFailure as error:
            if error.status not in (404, 503):
                raise
        else:
            self.check(learning.get("session") is None and not learning.get("restorePending"),
                       "No active learning session or checkpoint restore will be disturbed")
        state = self.settled()
        snap = state["snapshot"]
        self.check(snap["scene"].get("schemaVersion") == 1, "Runtime uses the supported portable scene schema")
        self.check(any(item["anchorId"] == self.args.anchor_id for item in snap["anchors"]),
                   "Expected virtual floor anchor is present")
        chair = next((item for item in snap["assets"] if item["assetId"] == "chair"), None)
        self.check(chair is not None, "Bundled chair prefab is available")
        scale = chair.get("spawnScale", .2)
        self.check(type(scale) in (int, float) and math.isfinite(scale) and .01 <= scale <= 10,
                   "Chair catalog scale can safely double within executor limits")
        self.check(len(snap["scene"]["objects"]) < 100, "The scene has capacity for one temporary test chair")
        self.original = copy.deepcopy(snap)
        self.expected_scene = copy.deepcopy(snap["scene"])
        self.report.update(roomId=snap["scene"]["roomId"], pretestObjectCount=len(snap["scene"]["objects"]),
                           pretestSceneDigest=scene_digest(snap["scene"]))
        return scale

    def run_controlled(self, scale):
        suffix = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        backup = "HeadsetBackup_" + suffix
        saved_name = "HeadsetLoop_" + suffix
        names = self.request("/api/scenes").get("scenes", [])
        self.check(backup not in names and saved_name not in names, "Unique test saves will not overwrite an existing save")
        self.save(backup)
        self.backup_name = backup
        self.report["pretestBackupName"] = backup
        self.check(backup in self.request("/api/scenes").get("scenes", []), "Original scene is saved on the PC before any edit")
        selected = self.original.get("selection") or {}
        position = selected.get("position") if selected.get("anchorId") == self.args.anchor_id else None
        position = copy.deepcopy(position or {"x": 0, "y": 0, "z": 2})
        # Keep a fixed margin so the later 20 cm translation is always in bounds.
        position["x"] = max(-99, min(99, position["x"]))
        pose = {"position": position, "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": scale, "y": scale, "z": scale}}
        snapshot, results = self.command({"op": "spawn", "assetId": "chair", "anchorId": self.args.anchor_id, "transform": pose})
        identifier = results[0].get("objectId")
        self.check(bool(identifier) and identifier not in {item["objectId"] for item in self.original["scene"]["objects"]},
                   "Runtime spawned the temporary chair with a new stable ID")
        self.report["testObjectId"] = identifier
        item = next(obj for obj in snapshot["scene"]["objects"] if obj["objectId"] == identifier)
        self.check(item["assetId"] == "chair" and item["anchorId"] == self.args.anchor_id and same_transform(item["transform"], pose),
                   "Spawned chair uses the requested asset anchor and authored scale")
        edited = copy.deepcopy(pose)
        edited["scale"] = {axis: value * 2 for axis, value in pose["scale"].items()}
        snapshot, _ = self.command({"op": "set_transform", "objectId": identifier, "transform": edited})
        self.check(same_transform(next(obj for obj in snapshot["scene"]["objects"] if obj["objectId"] == identifier)["transform"], edited),
                   "Scaling edits the same object ID instead of respawning")
        edited["position"]["x"] += .2
        edited["rotation"]["y"] = 45
        snapshot, _ = self.command({"op": "set_transform", "objectId": identifier, "transform": edited})
        actual = next(obj for obj in snapshot["scene"]["objects"] if obj["objectId"] == identifier)
        retained = copy.deepcopy(snapshot["scene"])
        retained["objects"] = [obj for obj in retained["objects"] if obj["objectId"] != identifier]
        self.check(same_transform(actual["transform"], edited) and same_scene(retained, self.original["scene"]),
                   "Move and rotation preserve the test identity and all pre-existing objects")
        saved_scene = copy.deepcopy(snapshot["scene"])
        self.save(saved_name)
        self.report["testSaveName"] = saved_name
        self.check(saved_name in self.request("/api/scenes").get("scenes", []), "Edited headset scene is saved on the PC")
        cleared, _ = self.command({"op": "clear"})
        self.check(cleared["scene"]["objects"] == [], "Runtime acknowledged a cleared scene")
        restored = self.load(saved_name)
        self.check(same_scene(restored["scene"], saved_scene),
                   "Restore exactly preserves object IDs assets room anchors and local transforms")

    def restore_original(self):
        if not self.mutation_attempted or self.backup_name is None:
            return
        self.report["pretestSceneRestored"] = False
        try:
            self.ensure_same_process()
            current = self.settled()["snapshot"]["scene"]
            if self.report.get("status") in ("failed", "interrupted") or self.expected_scene is None or not same_scene(current, self.expected_scene):
                # Preserve unexpected concurrent edits or an uncertain command outcome before replacement.
                recovery = "HeadsetRecovery_" + uuid.uuid4().hex
                response = self.request("/api/save", {"name": recovery})
                if not response.get("saved"):
                    raise CheckFailed("Could not preserve the changed scene before restoring the original")
                self.report["recoverySaveName"] = recovery
            restored = self.load(self.backup_name, check_context=False)
            self.check(same_scene(restored["scene"], self.original["scene"]),
                       "Finally restored the complete pretest scene from its PC backup")
            original_selection = (self.original.get("selection") or {}).get("objectId")
            if original_selection:
                selected, _ = self.command({"op": "select", "objectId": original_selection})
                self.check(selected["selection"]["objectId"] == original_selection, "Original object selection is restored")
            self.report["pretestSceneRestored"] = True
        except Exception as error:
            self.report["recoveryError"] = str(error)
            self.report["manualRecovery"] = "Reconnect the same runtime and load PC save " + self.backup_name

    def execute(self):
        try:
            scale = self.preflight()
            if self.args.run:
                self.run_controlled(scale)
            self.report["status"] = "passed" if self.args.run else "ready"
        except KeyboardInterrupt:
            self.report.update(status="interrupted", error="Operator interrupted the test")
        except Exception as error:
            self.report.update(status="failed" if self.mutation_attempted else "blocked", error=str(error))
        finally:
            # Keep the recovery instruction available before attempting any cleanup:
            # a second Ctrl+C must not discard the original backup's identity.
            if self.mutation_attempted and self.backup_name:
                self.report["pretestBackupName"] = self.backup_name
                self.report["manualRecovery"] = "Reconnect the same runtime and load PC save " + self.backup_name
            try:
                self.restore_original()
            except KeyboardInterrupt:
                self.report.update(status="interrupted", recoveryError="Operator interrupted automatic scene recovery")
                if self.mutation_attempted:
                    self.report["pretestSceneRestored"] = False
            except Exception as error:
                self.report.update(status="failed", recoveryError=str(error))
                if self.mutation_attempted:
                    self.report["pretestSceneRestored"] = False
            if self.report.get("pretestSceneRestored") is False:
                if self.report["status"] != "interrupted":
                    self.report["status"] = "failed"
            elif self.report.get("pretestSceneRestored") is True:
                self.report.pop("manualRecovery", None)
            self.report.update(checks=self.checks, passed=len(self.checks),
                               failed=0 if self.report["status"] in ("passed", "ready") else 1,
                               completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
            self.args.report.parent.mkdir(parents=True, exist_ok=True)
            self.args.report.write_text(json.dumps(self.report, indent=2), encoding="utf-8")
        print(json.dumps(self.report, indent=2))
        return 0 if self.report["status"] in ("passed", "ready") else 1


def test_interrupt_reporting():
    """Isolated control-flow regressions; no ADB, HTTP, snapshots, or scene edits."""
    import contextlib
    import io
    import tempfile

    class InterruptBeforeEdits(Harness):
        def preflight(self):
            raise KeyboardInterrupt()

        def restore_original(self):
            return  # There were no edits to recover.

    class InterruptDuringRecovery(Harness):
        def preflight(self):
            # Model only the local bookkeeping after a backup and uncertain edit.
            # This is not a runtime snapshot and no PC save or command is sent.
            self.backup_name = "IsolatedRegressionBackup"
            self.mutation_attempted = True
            raise KeyboardInterrupt()

        def restore_original(self):
            raise KeyboardInterrupt()

    with tempfile.TemporaryDirectory(prefix="headset-interrupt-check-") as directory:
        for name, harness_type in (("before-edits", InterruptBeforeEdits), ("during-recovery", InterruptDuringRecovery)):
            args = argparse.Namespace(adb="not-executed", serial=None, run=True, package=DEFAULT_PACKAGE,
                                      service_url="http://127.0.0.1:8765", room_id="white-room-v1",
                                      anchor_id="white-floor", timeout=1, report=Path(directory) / (name + ".json"))
            harness = harness_type(args)
            harness.report["scope"] = "Isolated interruption regression; no device, HTTP, or scene operations"
            with contextlib.redirect_stdout(io.StringIO()):
                result = harness.execute()
            report = json.loads(args.report.read_text(encoding="utf-8"))
            assert result != 0 and report["status"] == "interrupted" and report["failed"] == 1, name
            assert report["deviceProcessObserved"] is False and report["runtimeExecutionObserved"] is False, name
            assert report["checks"] == [], name
            if name == "during-recovery":
                assert report["pretestSceneRestored"] is False
                assert report["pretestBackupName"] == "IsolatedRegressionBackup"
                assert "IsolatedRegressionBackup" in report["manualRecovery"]
                assert report["recoveryError"] == "Operator interrupted automatic scene recovery"
            else:
                assert report["pretestSceneRestored"] is None and "manualRecovery" not in report
    print("HEADSET_INTERRUPT_CHECKS_OK: 2 isolated regressions passed; no ADB, HTTP, snapshots, or scene mutations")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="Confirm headset pairing/operator readiness and execute the reversible test")
    parser.add_argument("--self-test-interrupts", action="store_true",
                        help="Run only isolated interruption-reporting regressions; never access ADB or HTTP")
    parser.add_argument("--serial", help="Explicit authorized ADB device; omitted only when exactly one is connected")
    parser.add_argument("--adb", help="ADB executable (otherwise PATH or Unity 6000.6.0f1 Android SDK)")
    parser.add_argument("--service-url", default="http://127.0.0.1:8765", help="Existing local PC service; token from SANDBOX_TOKEN")
    parser.add_argument("--package", default=DEFAULT_PACKAGE, help="Exact already-running Android package")
    parser.add_argument("--room-id", default="white-room-v1")
    parser.add_argument("--anchor-id", default="white-floor")
    parser.add_argument("--timeout", type=float, default=30, help="Seconds to wait for an executor acknowledgement (1-60)")
    parser.add_argument("--report", type=Path, help="Report JSON; defaults to Validation/headset-loop-results.json with --run")
    args = parser.parse_args()
    if args.self_test_interrupts:
        return test_interrupt_reporting()
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+", args.package):
        parser.error("--package must be an Android package identifier")
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    if args.report is None:
        args.report = PROJECT / "Validation" / ("headset-loop-results.json" if args.run else "headset-preflight-results.json")
    try:
        return Harness(args).execute()
    except CheckFailed as error:
        parser.error(str(error))


if __name__ == "__main__":
    sys.exit(main())
