"""Actual isolated Windows-player restart -> provider disabled -> cached restore.

Requires a Desktop build made with Build-WhiteRoom.ps1 -ValidationId <unique-id>
and an exported procedural fixture pack. Starts its own loopback service on a
free port, and only stops player processes it creates. No headset or live service.
Mutates only this uniquely named validation player's cache; preserves all files
after the report for inspection. Use a new ID/directory for each run.
"""
import argparse
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "ControlService"))
from content_catalog import ContentCatalog
from server import Handler, Server, State


class ColdRestore:
    def __init__(self, args):
        self.args = args
        self.work = args.work.resolve()
        self.work.mkdir(parents=True, exist_ok=False)
        self.player = None
        self.server = None
        self.starts = 0
        self.downloads = 0
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.report = {"status": "failed", "startedUtc": self.now(), "checks": [],
                       "scope": "Actual isolated Windows player, real bundle, PC HTTP, process restart and disabled provider",
                       "headsetTested": False, "renderingInspected": False, "languageModelUsed": False}
        self.report["runtimeSourceSha256"] = {name: hashlib.sha256((REPO / "Assets/Sandbox/Runtime" / name).read_bytes()).hexdigest()
            for name in ("PcBridge.cs", "SandboxContentLoader.cs", "SandboxWorld.cs")}
        core = json.loads((REPO / "Validation/white-room-desktop-core-results.json").read_text())
        self.report["unityCoreChecks"] = {key: core[key] for key in ("passed", "failed", "unityVersion", "completedUtc")}
        product = "Matrix Operator Validation " + args.validation_id
        info = args.player.with_name(args.player.stem + "_Data") / "app.info"
        if os.name != "nt" or info.read_text().splitlines() != ["School of the Ancients", product]:
            raise ValueError("Player must be a Windows Desktop build with the exact isolated ValidationId")
        self.cache = Path(os.environ["USERPROFILE"]) / "AppData" / "LocalLow" / "School of the Ancients" / product / "content-packs-v1"
        # Editor builds may create an empty Unity diagnostics directory here.
        # Reject existing application state and previous harness ownership.
        if self.cache.exists() or (self.cache.parent / "control.json").exists() or (self.cache.parent / "cached-restore-validation.json").exists():
            raise ValueError("Validation profile already exists; use a new ID to protect previous files")
        self.manifest = json.loads((args.pack / "content-pack.json").read_text())
        self.source = {key: self.manifest[key] for key in ("providerId", "packId", "version", "sha256", "platform", "unityVersion")}
        self.asset = self.manifest["assets"][0]["assetId"]
        self.bundle = self.cache / (self.source["sha256"] + ".bundle")
        self.metadata = self.cache / (self.source["sha256"] + ".json")
        config = self.work / "content-config.json"
        config.write_text(json.dumps({"schemaVersion": 1, "providers": [{"id": self.source["providerId"],
            "type": "local", "enabled": True, "manifest": str((args.pack / "catalog.json").resolve())}]}))
        self.state = State(self.work / "scenes")
        self.state.content._catalog = ContentCatalog(config, self.work / "pc-cache")
        owner = self
        class CountingHandler(Handler):
            def do_GET(self):
                if self.path.startswith("/api/content/files/"):
                    owner.downloads += 1
                super().do_GET()
        self.server = Server(("127.0.0.1", 0), self.state)
        self.server.RequestHandlerClass = CountingHandler
        self.url = "http://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.cache.parent.mkdir(parents=True, exist_ok=True)
        (self.cache.parent / "cached-restore-validation.json").write_text(json.dumps({"work": str(self.work), "validationId": args.validation_id}))

    @staticmethod
    def now():
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

    def check(self, condition, name):
        if not condition:
            raise AssertionError(name)
        self.report["checks"].append(name)
        print("CACHED_RESTORE: " + name, flush=True)

    def request(self, path, body=None):
        request = urllib.request.Request(self.url + path, data=None if body is None else json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
        try:
            with self.http.open(request, timeout=10) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise AssertionError(path + ": " + error.read().decode()) from error

    def wait(self, fn, timeout=90):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            value = fn()
            if value:
                return value
            if self.player is not None and self.player.poll() is not None:
                raise AssertionError("Owned test player exited unexpectedly")
            time.sleep(.15)
        raise TimeoutError("Owned fixture did not reach the required state")

    def start(self):
        self.starts += 1
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        self.player = subprocess.Popen([str(self.args.player.resolve()), "-batchmode", "-nographics",
            "-serviceUrl", self.url, "-logFile", str(self.work / ("player-" + str(self.starts) + ".log"))],
            startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW)
        return self.wait(lambda: (value if (value := self.request("/api/state")).get("online") and value.get("snapshot") else None))

    def stop(self):
        if self.player is not None:
            self.player.terminate()
            self.player.wait(timeout=15)
            self.player = None
        self.wait(lambda: not self.request("/api/state")["online"], timeout=25)

    def command(self, body, rejected=False, path="/api/command"):
        queued = self.request(path, body)
        ids = {item["requestId"] for item in queued["commands"]}
        def result():
            state = self.request("/api/state")
            receipts = [item for item in state["results"] if item["requestId"] in ids]
            if state["pendingCount"] == 0 and len(receipts) == len(ids):
                if any(item["ok"] != (not rejected) for item in receipts):
                    raise AssertionError("Unexpected command receipt: " + json.dumps(receipts))
                return state, receipts
        return self.wait(result)

    @staticmethod
    def spawn(asset):
        return {"op": "spawn", "assetId": asset, "anchorId": "white-floor", "transform": {
            "position": {"x": .75, "y": 0, "z": 2}, "rotation": {"x": 0, "y": 45, "z": 0},
            "scale": {"x": 1, "y": 1, "z": 1}}}

    def run(self):
        initial = self.start()
        self.check(initial["snapshot"]["scene"]["roomId"] == "white-room-v1", "Owned player uses the desktop WhiteRoom fixture")
        self.check(self.asset not in {item["assetId"] for item in initial["snapshot"]["assets"]}, "Exported pack is absent from the player's baked registry")
        job = self.request("/api/content/install", {"providerId": self.source["providerId"], "assetId": self.source["packId"],
            "version": self.source["version"], "targetPlatform": "StandaloneWindows64"})
        def installed():
            value = next(item for item in self.request("/api/content")["jobs"] if item["requestId"] == job["requestId"])
            if value["phase"] in ("ready", "error", "cancelled"):
                return value
        receipt = self.wait(installed)
        self.check(receipt["phase"] == "ready", "First process downloads and acknowledges the actual exported bundle")
        spawned, acknowledgements = self.command(self.spawn(self.asset))
        object_id = acknowledgements[0]["objectId"]
        rotated, _ = self.command({"op": "set_behavior", "objectId": object_id, "behavior": {"kind": "rotate", "axis": "y", "speedDegreesPerSecond": 30}})
        saved = copy.deepcopy(rotated["snapshot"]["scene"])
        self.request("/api/save", {"name": "ColdRestore"})
        self.check(self.metadata.is_file() and self.bundle.is_file(), "First process persists bundle and manifest in its isolated private cache")
        original_metadata, original_bundle = self.metadata.read_bytes(), self.bundle.read_bytes()
        self.stop()
        self.request("/api/content/providers/enable", {"providerId": self.source["providerId"], "enabled": False})
        download_count = self.downloads
        restarted = self.start()
        self.check(restarted["clientId"] != initial["clientId"] and self.asset not in {item["assetId"] for item in restarted["snapshot"]["assets"]}, "New process has a new client ID and no registered downloaded pack")
        baseline, _ = self.command(self.spawn("block"))
        before = copy.deepcopy(baseline["snapshot"]["scene"])
        cases = ["missing manifest", "malformed manifest", "wrong version", "wrong platform", "wrong Unity version", "wrong digest", "external dependency", "missing asset", "missing bundle", "truncated bundle", "corrupt bundle"]
        self.report["rejections"] = []
        for case in cases:
            try:
                changed = copy.deepcopy(self.manifest)
                if case == "missing manifest": self.metadata.unlink()
                elif case == "malformed manifest": self.metadata.write_text("not-json")
                elif case == "missing bundle": self.bundle.unlink()
                elif case == "truncated bundle": self.bundle.write_bytes(original_bundle[:10])
                elif case == "corrupt bundle": self.bundle.write_bytes(bytes([original_bundle[0] ^ 1]) + original_bundle[1:])
                else:
                    if case == "wrong version":
                        changed["version"] = "2.0.0"
                        for asset in changed["assets"]: asset["assetId"] = asset["assetId"].replace(":" + self.source["version"] + ":", ":2.0.0:")
                    elif case == "wrong platform": changed["platform"] = "Android"
                    elif case == "wrong Unity version": changed["unityVersion"] = "6000.0.0f1"
                    elif case == "wrong digest": changed["sha256"] = "f" * 64
                    elif case == "external dependency": changed["dependencies"] = ["missing-external"]
                    elif case == "missing asset": changed["assets"][0]["assetId"] = self.asset.rsplit(":", 1)[0] + ":absent"
                    self.metadata.write_text(json.dumps(changed))
                rejected, receipts = self.command({"commands": [{"op": "load", "scene": saved}, {"op": "clear"}]}, rejected=True)
                self.check(rejected["snapshot"]["scene"] == before and bool(receipts[0].get("error")), "Cold restore rejects " + case + " and preserves the existing scene")
                self.check(len(receipts) == 2 and "restore" in receipts[1].get("error", ""), "Rejected " + case + " also retires its queued clear with an explicit receipt")
                self.check(self.asset not in {item["assetId"] for item in rejected["snapshot"]["assets"]}, "Rejected " + case + " registers no prefab")
                self.report["rejections"].append({"case": case, "error": receipts[0]["error"]})
            finally:
                self.metadata.write_bytes(original_metadata)
                self.bundle.write_bytes(original_bundle)
        try:
            self.metadata.chmod(stat.S_IREAD)
            restored, _ = self.command({"name": "ColdRestore"}, path="/api/load")
            self.check(self.metadata.read_bytes() == original_metadata, "Cached restore accepts read-only metadata and leaves it byte-identical")
        finally:
            self.metadata.chmod(stat.S_IREAD | stat.S_IWRITE)
        self.check(restored["snapshot"]["scene"] == saved, "Cold process restores exact saved IDs poses behaviors and provenance without catalog reinstall")
        self.check(self.asset in {item["assetId"] for item in restored["snapshot"]["assets"]}, "Cached bundle reappears in the real runtime registry")
        self.check(self.downloads == download_count, "Disabled-provider restore and all failures make zero additional PC bundle requests")
        undone, _ = self.command({"op": "undo"})
        self.check(undone["snapshot"]["scene"] == before, "Undo after cold restore recovers the entire pre-restore scene")
        redone, _ = self.command({"op": "redo"})
        self.check(redone["snapshot"]["scene"] == saved, "Redo after cold restore recovers exact saved content")
        self.report.update(status="passed", playerStarts=self.starts, initialBundleRequests=download_count,
                           additionalRestoreBundleRequests=self.downloads - download_count, pack=self.source)

    def close(self):
        if self.player is not None and self.player.poll() is None:
            self.player.terminate()
            self.player.wait(timeout=15)
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=5)
        self.report["completedUtc"] = self.now()
        self.args.report.parent.mkdir(parents=True, exist_ok=True)
        self.args.report.write_text(json.dumps(self.report, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--player", type=Path, required=True)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--validation-id", required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,48}", args.validation_id):
        parser.error("Validation ID must be the exact bounded ID used to build this isolated player")
    run = ColdRestore(args)
    try:
        run.run()
    except Exception as error:
        run.report["error"] = str(error)
        raise
    finally:
        run.close()


if __name__ == "__main__":
    main()
