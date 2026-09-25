"""Isolated real-player/PC-service acceptance for the 4616 miniature slice.

Runs only with --run. The optional one-turn AI proposal is reviewed before Apply.
This exercises runtime state, not pixels, physical room alignment, or headset input.
"""
import argparse
import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("miniature_desktop_base", Path(__file__).with_name("Run-Composition-Desktop-Loop.py"))
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


def run(args):
    report = {"status": "failed", "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope": "Actual Windows player, isolated PC service and save folder",
              "checks": [], "headsetTested": False, "pixelsInspected": False, "inference": None}
    workspace = Path(tempfile.mkdtemp(prefix="matrix-miniature-"))
    service = player = None
    log = (workspace / "service.log").open("wb")

    def check(condition, label):
        report["checks"].append({"name": label, "passed": bool(condition)})
        if not condition:
            raise RuntimeError(label)

    def api(path, body=None, timeout=20):
        request = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)

    def ready():
        until = time.monotonic() + 30
        while time.monotonic() < until:
            value = api("/api/state")
            if value["online"] and value["pendingCount"] == 0:
                return value
            time.sleep(.2)
        raise RuntimeError("Isolated player did not connect")

    def confirm(response):
        ids = {item["requestId"] for item in response["commands"]}
        until = time.monotonic() + 30
        while time.monotonic() < until:
            value = api("/api/state")
            receipts = {item["requestId"]: item for item in value["results"]}
            if ids <= receipts.keys():
                failures = [receipts[key].get("error", "unknown error") for key in ids if not receipts[key]["ok"]]
                check(not failures, "Player acknowledged command batch" + (": " + "; ".join(failures) if failures else ""))
                return value
            time.sleep(.2)
        raise RuntimeError("Player receipt timed out")

    def command(item):
        return confirm(api("/api/command", item))

    def pose(x, z):
        return {"position": {"x": x, "y": 0, "z": z}, "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 1, "y": 1, "z": 1}}

    def spawn(asset, x, z):
        value = command({"op": "spawn", "assetId": asset, "anchorId": "white-floor", "transform": pose(x, z)})
        return next(obj for obj in value["snapshot"]["scene"]["objects"] if obj["assetId"] == asset)["objectId"]

    def object_state(identifier, state=None):
        state = state or ready()
        return next(item for item in state["snapshot"]["scene"]["objects"] if item["objectId"] == identifier)

    try:
        env = desktop.child_environment(argparse.Namespace(codex_exe=None, model=None))
        service = subprocess.Popen([sys.executable, "-u", str(ROOT / "ControlService/server.py"), "--port", "0",
                                    "--scenes", str(workspace / "scenes")], cwd=ROOT, env=env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, **desktop.hidden_options())
        url = desktop.wait_for_service(service, workspace / "service.log")
        player = subprocess.Popen([str(ROOT / "Builds/WhiteRoomDesktop/MatrixOperator.exe"), "-batchmode", "-nographics",
                                   "-serviceUrl", url, "-logFile", str(workspace / "player.log")], cwd=ROOT, env=env,
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  **desktop.hidden_options())
        initial = ready()
        assets = {asset["assetId"]: asset for asset in initial["snapshot"]["assets"]}
        check(len(assets) == 23 and all(name in assets for name in ("grass_tile", "cottage", "rock", "street_lamp", "chest")),
              "Player advertises 23 bundled assets including miniature pack")
        check(initial["snapshot"]["behaviorKinds"] == ["rotate", "bob", "path", "select_toggle"],
              "Player advertises the four finite behavior kinds")
        check(assets["street_lamp"]["interactionMode"] == "light" and assets["chest"]["interactionMode"] == "hinge",
              "Operator sees the two compatible interaction modes")
        check(initial["snapshot"]["scene"]["objects"] == [], "Isolated scene starts empty")

        if args.ai:
            proposal = api("/api/plan", {"text": "Place one small cottage at my selected placement point using the installed cottage prefab.",
                                         "mode": "codex-cli", "codex": {"model": args.model,
                                         "reasoningEffort": args.reasoning}}, timeout=150)
            check(proposal.get("status") == "ready" and proposal.get("requiresApply") and
                  any(item["op"] == "spawn" and item["assetId"] == "cottage" for item in proposal["commands"]),
                  "Real AI proposed a reviewed cottage spawn")
            check(ready()["snapshot"]["scene"]["objects"] == [], "AI proposal did not bypass Apply")
            report["inference"] = proposal.get("inference")
            state = confirm(api("/api/apply_plan", {"planId": proposal["planId"]}))
            check(any(obj["assetId"] == "cottage" for obj in state["snapshot"]["scene"]["objects"]),
                  "Reviewed AI proposal executed and was acknowledged")
        else:
            spawn("cottage", 0, 2)

        spawn("grass_tile", -.15, 2.15)
        rock_id = spawn("rock", .18, 2)
        lamp_id = spawn("street_lamp", -.15, 1.85)
        chest_id = spawn("chest", .12, 2.2)
        state = command({"op": "set_behavior", "objectId": rock_id, "behavior": {"kind": "path",
            "waypointA": {"x": 0, "y": 0, "z": 0}, "waypointB": {"x": .2, "y": 0, "z": 0}, "speedMetersPerSecond": .1}})
        check(object_state(rock_id, state)["behaviors"][0]["kind"] == "path", "Path config reached actual player")
        for identifier in (lamp_id, chest_id):
            command({"op": "set_behavior", "objectId": identifier, "behavior": {"kind": "select_toggle"}})
            state = command({"op": "select", "objectId": identifier})
            check(object_state(identifier, state)["behaviors"][0]["toggled"], "Selection toggled saved state")
        saved = ready()["snapshot"]["scene"]
        check(api("/api/save", {"name": "MiniVillage4616"})["saved"], "PC saved the miniature scene")
        state = command({"op": "undo"})
        check(not object_state(chest_id, state)["behaviors"][0]["toggled"], "Undo reverted chest selection")
        command({"op": "clear"})
        check(ready()["snapshot"]["scene"]["objects"] == [], "Clear removed the miniature scene")
        state = confirm(api("/api/load", {"name": "MiniVillage4616"}))
        check(state["snapshot"]["scene"] == saved, "Restore preserved IDs, placement, path and interaction state")
        report["status"] = "passed"
    except Exception as error:
        report["error"] = str(error)
    finally:
        report["ownedProcessesStopped"] = all([desktop.stop_owned_process(player), desktop.stop_owned_process(service)])
        log.close()
        report["passed"] = sum(item["passed"] for item in report["checks"])
        report["failed"] = sum(not item["passed"] for item in report["checks"])
        report["completedUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({key: report[key] for key in ("status", "passed", "failed", "ownedProcessesStopped")}), flush=True)
    return 0 if report["status"] == "passed" and report["ownedProcessesStopped"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--ai", action="store_true", help="Include one real Codex proposal and reviewed Apply")
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--reasoning", default="medium")
    parser.add_argument("--report", type=Path, default=ROOT / "Validation/miniature-desktop-results.json")
    options = parser.parse_args()
    if not options.run:
        parser.error("Supply --run to launch isolated service/player processes")
    sys.exit(run(options))
