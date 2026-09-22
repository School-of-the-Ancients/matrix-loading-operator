"""Exercise a real Windows player's downloadable pack through an isolated PC service.

Start the owned test service/player separately. Default is read-only preflight.
--run --isolated-fixture installs the pack and tests ordinary scene commands,
then restores the original scene. The installed registry remains until that
isolated player exits. --real-codex additionally makes one real model request.
No Unity build, headset, synthetic runtime snapshot or mocked provider is used.
"""
import argparse
import copy
import datetime
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class CheckFailed(Exception):
    pass


class Harness:
    def __init__(self, args):
        self.args = args
        parsed = urllib.parse.urlsplit(args.service_url)
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or
                parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise CheckFailed("Use the isolated local service's plain loopback origin")
        self.url = args.service_url.rstrip("/")
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.client_id = None
        self.expected_scene = None
        self.original = None
        self.backup = None
        self.mutated = False
        self.report = {"mode": "content-pack-desktop-run" if args.run else "content-pack-desktop-preflight",
                       "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "status": "blocked",
                       "scope": "Actual isolated Windows player and PC catalog/assetbundle/command bridge",
                       "checks": [], "languageModelUsed": False, "runtimeExecutionObserved": False,
                       "headsetTested": False, "renderingInspected": False, "pretestSceneRestored": None}

    def check(self, condition, text):
        if not condition:
            raise CheckFailed(text)
        self.report["checks"].append(text)
        print("CONTENT_PACK: " + text, flush=True)

    def request(self, path, body=None, expected_status=200):
        headers = {"Content-Type": "application/json"}
        token = os.environ.get("SANDBOX_TOKEN", "")
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(self.url + path, data=None if body is None else json.dumps(body, allow_nan=False).encode(), headers=headers)
        try:
            with self.http.open(request, timeout=180 if path == "/api/plan" else 10) as response:
                status, raw = response.status, response.read(3 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read(8192)
            error.close()
        if len(raw) > 3 * 1024 * 1024:
            raise CheckFailed("Service JSON response exceeded 3 MiB")
        value = json.loads(raw)
        if status != expected_status:
            raise CheckFailed(path + " returned HTTP " + str(status) + ": " + str(value.get("error", "unexpected response"))[:1000])
        return value

    def settled(self, check_scene=True):
        deadline = time.monotonic() + self.args.timeout
        while time.monotonic() < deadline:
            state = self.request("/api/state")
            if state.get("online") and state.get("snapshot") and state.get("pendingCount") == 0:
                if self.client_id is not None and state.get("clientId") != self.client_id:
                    raise CheckFailed("Runtime session changed; stopping the test")
                if state["snapshot"]["scene"]["roomId"] != "white-room-v1":
                    raise CheckFailed("This runner requires the isolated desktop white-room fixture")
                if check_scene and self.expected_scene is not None and state["snapshot"]["scene"] != self.expected_scene:
                    raise CheckFailed("Scene changed outside this test; no further controlled edit was sent")
                return state
            time.sleep(.2)
        raise CheckFailed("Player did not reach an online settled state")

    def wait_ack(self, queued, expect_rejection=False):
        commands = queued.get("commands")
        if not commands:
            raise CheckFailed("PC did not return queued command IDs")
        identifiers = {item["requestId"] for item in commands}
        deadline = time.monotonic() + self.args.timeout
        while time.monotonic() < deadline:
            state = self.request("/api/state")
            if state.get("clientId") != self.client_id or not state.get("online"):
                raise CheckFailed("Player session changed during a command")
            results = [item for item in state.get("results", []) if item.get("requestId") in identifiers]
            if state.get("pendingCount") == 0 and len(results) == len(identifiers):
                if expect_rejection:
                    if not all(item.get("ok") is False and item.get("error") for item in results):
                        raise CheckFailed("Expected an explicit runtime rejection, but the command was accepted")
                elif not all(item.get("ok") is True for item in results):
                    raise CheckFailed("Runtime rejected command: " + "; ".join(item.get("error", "") for item in results))
                self.expected_scene = copy.deepcopy(state["snapshot"]["scene"])
                self.report["runtimeExecutionObserved"] = True
                return state["snapshot"], results
            time.sleep(.2)
        raise CheckFailed("Command acknowledgement timed out; its outcome is uncertain")

    def command(self, command):
        self.settled()
        self.mutated = True
        return self.wait_ack(self.request("/api/command", command))

    def save(self, name):
        before = copy.deepcopy(self.settled()["snapshot"]["scene"])
        response = self.request("/api/save", {"name": name})
        if response.get("saved") is not True or response.get("name") != name:
            raise CheckFailed("PC did not confirm the scene save")
        if self.settled()["snapshot"]["scene"] != before:
            raise CheckFailed("Scene changed during save")
        return before

    def load(self, name, recovery=False):
        self.settled(check_scene=not recovery)
        self.mutated = True
        return self.wait_ack(self.request("/api/load", {"name": name, "requestId": uuid.uuid4().hex}))[0]

    def wait_job(self, request_id):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            self.settled()
            job = next((item for item in self.request("/api/content")["jobs"] if item["requestId"] == request_id), None)
            if job and job["phase"] in ("ready", "error", "cancelled"):
                return job
            time.sleep(.25)
        raise CheckFailed("Content job did not reach an acknowledged terminal phase")

    def preflight(self):
        initial = self.settled()
        self.client_id = initial["clientId"]
        self.original = copy.deepcopy(initial["snapshot"])
        self.expected_scene = copy.deepcopy(self.original["scene"])
        content = self.request("/api/content")
        runtime = content["runtime"]
        self.check(runtime.get("supported") is True and runtime.get("platform") == "StandaloneWindows64",
                   "Real connected Windows player advertises downloadable content support")
        self.check(not self.original.get("readOnly"), "Desktop fixture is editable")
        self.check(not any(job["phase"] in ("preparing", "installing") for job in content.get("jobs", [])), "No other content job is active")
        results = self.request("/api/content/search", {"query": self.args.pack_id, "category": "objects", "providerId": self.args.provider_id})
        matches = [asset for asset in results["assets"] if asset["assetId"] == self.args.pack_id and asset["version"] == self.args.version and asset["targetPlatform"] == runtime["platform"]]
        self.check(len(matches) == 1, "Configured real provider returns exactly the requested pack version/platform")
        asset = matches[0]
        manifest = asset["metadata"]["contentPack"]
        self.check(manifest["unityVersion"] == runtime["unityVersion"], "Exported bundle matches the real player's exact Unity version")
        self.check(manifest["sha256"] == asset["sha256"] and manifest["byteLength"] == asset["byteLength"], "Catalog and runtime manifest agree on exact bundle bytes")
        self.report.update(runtime=runtime, pack={key: manifest[key] for key in ("providerId", "packId", "version", "platform", "unityVersion", "sha256", "byteLength")},
                           initialAssetCount=len(self.original["assets"]), initialObjectCount=len(self.original["scene"]["objects"]))
        return manifest

    def run(self, manifest):
        ids = {asset["assetId"] for asset in manifest["assets"]}
        self.check(not (ids & {asset["assetId"] for asset in self.original["assets"]}), "Pack props are absent from the player's original registry before download")
        suffix = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        backup = "ContentPackBackup_" + suffix
        self.save(backup)
        self.backup = backup
        self.report["pretestBackupName"] = backup
        self.check(backup in self.request("/api/scenes")["scenes"], "Original fixture scene is saved before installation or edits")
        body = {"providerId": self.args.provider_id, "assetId": self.args.pack_id, "version": self.args.version, "targetPlatform": "StandaloneWindows64"}
        job = self.wait_job(self.request("/api/content/install", body)["requestId"])
        self.report["installationReceipt"] = job
        self.check(job["phase"] == "ready", "Actual player acknowledges the downloaded bundle installation: " + job.get("error", ""))
        installed = self.settled()["snapshot"]
        self.check(ids <= {asset["assetId"] for asset in installed["assets"]}, "Installed prefab IDs appear in the real runtime registry")
        self.check(installed["scene"] == self.original["scene"], "Registering a downloaded pack preserves the complete original scene")
        chosen_id = self.args.asset_id or manifest["assets"][0]["assetId"]
        chosen = next(asset for asset in installed["assets"] if asset["assetId"] == chosen_id)
        source = {key: manifest[key] for key in ("providerId", "packId", "version", "sha256", "platform", "unityVersion")}
        self.check(chosen.get("source") == source, "Runtime catalog retains exact provider pack version digest and platform")
        bounds = chosen.get("localBounds", {}).get("size", {})
        self.check(all(isinstance(bounds.get(axis), (int, float)) and math.isfinite(bounds[axis]) and bounds[axis] > 0 for axis in "xyz"), "Loaded prefab advertises measured positive geometry bounds")
        self.report["installedAsset"] = chosen
        original_count = len(installed["scene"]["objects"])
        scale = chosen["spawnScale"]
        pose = {"position": {"x": 0, "y": 0, "z": 2}, "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {axis: scale for axis in "xyz"}}
        spawned, results = self.command({"op": "spawn", "assetId": chosen_id, "anchorId": "white-floor", "transform": pose})
        object_id = results[0]["objectId"]
        item = next(item for item in spawned["scene"]["objects"] if item["objectId"] == object_id)
        self.check(item["source"] == source and item["assetId"] == chosen_id and len(spawned["scene"]["objects"]) == original_count + 1,
                   "Actual player spawns downloaded content through the ordinary executor with saved provenance")
        spawned_scene = copy.deepcopy(spawned["scene"])
        undone, _ = self.command({"op": "undo"})
        self.check(undone["scene"] == self.original["scene"], "Undo removes only the downloaded prop and restores the pre-spawn scene")
        redone, _ = self.command({"op": "redo"})
        self.check(redone["scene"] == spawned_scene, "Redo restores exact downloaded object ID pose and provenance")
        moved_pose = copy.deepcopy(pose); moved_pose["position"]["x"] = .4
        moved, _ = self.command({"op": "set_transform", "objectId": object_id, "transform": moved_pose})
        actual = next(item for item in moved["scene"]["objects"] if item["objectId"] == object_id)
        self.check(math.isclose(actual["transform"]["position"]["x"], .4, abs_tol=1e-6) and actual["source"] == source, "Ordinary transform edit keeps the downloaded object identity and source")
        saved_name = "ContentPackScene_" + suffix
        saved = self.save(saved_name)
        cleared, _ = self.command({"op": "clear"})
        self.check(cleared["scene"]["objects"] == [], "Clear is acknowledged by the real player")
        self.check(self.load(saved_name)["scene"] == saved, "PC save clear and restore retain exact downloaded IDs transforms and source version")
        self.report["testSaveName"] = saved_name
        rejected = self.wait_job(self.request("/api/content/install", {**body, "version": "missing-version-for-check"})["requestId"])
        self.check(rejected["phase"] == "error" and bool(rejected.get("error")), "Unavailable exact pack version reports an explicit installation error")
        self.check(self.settled()["snapshot"]["scene"] == saved, "Failed content preparation preserves the saved live scene")
        self.report["missingVersionReceipt"] = rejected
        missing_scene = copy.deepcopy(saved)
        missing_object = next(item for item in missing_scene["objects"] if item["objectId"] == object_id)
        parts = missing_object["assetId"].split(":")
        parts[2] = "missing-version"
        missing_object["assetId"] = ":".join(parts)
        missing_object["source"]["version"] = "missing-version"
        rejected_snapshot, rejected_results = self.wait_ack(self.request("/api/command", {"op": "load", "scene": missing_scene}), expect_rejection=True)
        self.check(rejected_snapshot["scene"] == saved and "assetId" in rejected_results[0]["error"],
                   "Actual runtime rejects restoring an unavailable content version and preserves every existing object")
        self.report["missingRestoreReceipt"] = rejected_results[0]
        if self.args.real_codex:
            self.infer(chosen_id)

    def infer(self, asset_id):
        before = copy.deepcopy(self.settled()["snapshot"]["scene"])
        prompt = "Place exactly one more Sci-fi Beacon from the installed downloadable content catalog on white-floor at x=1, y=0, z=2 metres. Use exactly one spawn command with the advertised asset ID, its advertised spawnScale on all three axes, and zero rotation. Do not change existing objects."
        proposal = self.request("/api/plan", {"text": prompt, "mode": "codex-cli", "codex": {"model": self.args.model, "reasoningEffort": self.args.reasoning}})
        self.report["languageModelUsed"] = True
        commands = proposal.get("commands", [])
        self.check(len(commands) == 1 and commands[0].get("op") == "spawn" and commands[0].get("assetId") == asset_id and commands[0].get("anchorId") == "white-floor",
                   "Real Codex proposes one supported spawn using the newly installed asset ID")
        self.check(self.settled()["snapshot"]["scene"] == before, "Live model proposal does not edit the scene before review and Apply")
        inference = proposal.get("inference", {})
        self.check(inference.get("transport") == "codex-cli" and inference.get("completedTurn") is True and inference.get("toolCallCount") == 0,
                   "Provider receipt confirms a real completed Codex turn with no tool execution")
        self.report["inference"] = {"summary": proposal.get("summary"), "commands": commands, "receipt": inference, "reviewed": True}
        self.mutated = True
        after, _ = self.wait_ack(self.request("/api/apply_plan", {"planId": proposal["planId"]}))
        self.check(len(after["scene"]["objects"]) == len(before["objects"]) + 1, "Reviewed real model plan applies to the downloaded prefab through the same executor")

    def execute(self):
        try:
            manifest = self.preflight()
            if self.args.run:
                self.run(manifest)
            self.report["status"] = "passed" if self.args.run else "ready"
        except KeyboardInterrupt:
            self.report.update(status="interrupted", error="Operator interrupted content validation")
        except Exception as error:
            self.report.update(status="failed", error=str(error))
        finally:
            if self.mutated and self.backup:
                try:
                    if self.report["status"] not in ("passed", "ready"):
                        recovery = "ContentRecovery_" + uuid.uuid4().hex
                        if not self.request("/api/save", {"name": recovery}).get("saved"):
                            raise CheckFailed("Could not save the uncertain scene before restoring")
                        self.report["recoverySaveName"] = recovery
                    restored = self.load(self.backup, recovery=True)
                    self.check(restored["scene"] == self.original["scene"], "Finally restored the complete pretest scene from its backup")
                    selection = self.original.get("selection") or {}
                    if selection.get("objectId"):
                        self.command({"op": "select", "objectId": selection["objectId"]})
                    self.report["pretestSceneRestored"] = True
                except KeyboardInterrupt:
                    self.report.update(status="interrupted", pretestSceneRestored=False,
                                       recoveryError="Operator interrupted automatic scene restoration", manualRecovery="Load PC save " + self.backup + " after reconnecting the same fixture")
                except Exception as error:
                    self.report.update(status="failed", pretestSceneRestored=False, recoveryError=str(error), manualRecovery="Load PC save " + self.backup + " after reconnecting the same fixture")
            self.report.update(passed=len(self.report["checks"]), failed=0 if self.report["status"] in ("passed", "ready") else 1,
                               completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
            self.args.output.parent.mkdir(parents=True, exist_ok=True)
            self.args.output.write_text(json.dumps(self.report, indent=2), encoding="utf-8")
        print(json.dumps({key: self.report[key] for key in ("status", "passed", "failed", "pretestSceneRestored")}, indent=2))
        return 0 if self.report["status"] in ("passed", "ready") else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--service-url", required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--isolated-fixture", action="store_true", help="Confirm this service/player is owned and disposable; registry installation persists until exit")
    parser.add_argument("--provider-id", default="matrix-fixture")
    parser.add_argument("--pack-id", default="scifi-props")
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--asset-id")
    parser.add_argument("--real-codex", action="store_true")
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--reasoning", default="medium")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("content-pack-desktop-results.json"))
    args = parser.parse_args()
    if args.run and not args.isolated_fixture:
        parser.error("--run requires --isolated-fixture")
    if args.real_codex and not args.run:
        parser.error("--real-codex requires --run")
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    try:
        return Harness(args).execute()
    except CheckFailed as error:
        parser.error(str(error))


if __name__ == "__main__":
    sys.exit(main())
