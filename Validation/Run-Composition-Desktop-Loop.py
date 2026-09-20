"""Validate an owned Windows player with isolated PC storage.

Default: launch a hidden headless player and temporary loopback service for
read-only preflight; no model inference or scene edits. --run explicitly enables
two live Codex compositions and their save/clear/restore checks. No headset or
existing service is used. Failed-run evidence stays in a unique OS-temp folder.
"""
import argparse
import contextlib
import datetime
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("desktop_composition_base", Path(__file__).with_name("Run-Composition-Headset-Loop.py"))
composition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(composition)
from codex_provider import CodexConfig, CodexProviderError

TEMP_PREFIX = "matrix-composition-desktop-"


def hidden_options():
    if os.name != "nt":
        return {}
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    return {"creationflags": subprocess.CREATE_NO_WINDOW, "startupinfo": startup}


def child_environment(args):
    executable = args.codex_exe or os.environ.get("SANDBOX_CODEX_EXE") or shutil.which("codex.exe")
    if not executable:
        raise composition.base.CheckFailed("Codex is unavailable; supply --codex-exe or put codex.exe on PATH")
    model = args.model if args.model is not None else os.environ.get("SANDBOX_CODEX_MODEL", "").strip() or None
    config = CodexConfig(str(Path(executable).resolve()), model)
    config.validate()  # File/model metadata only: no login-store reads or inference.
    excluded = {"OPENAI_API_KEY", "CODEX_API_KEY", "OPENROUTER_API_KEY", "SANDBOX_AI_KEY", "SANDBOX_TOKEN"}
    env = {key: value for key, value in os.environ.items() if key.upper() not in excluded}
    env.update(SANDBOX_AI_MODE="codex-cli", SANDBOX_CODEX_EXE=config.executable)
    if model is not None:
        env["SANDBOX_CODEX_MODEL"] = model
    else:
        env.pop("SANDBOX_CODEX_MODEL", None)
    return env


def wait_for_service(process, log_path, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise composition.base.CheckFailed("The isolated control service exited during startup")
        with log_path.open("rb") as stream:
            beginning = stream.read(8192).decode("utf-8", errors="replace")
        match = re.search(r"^AR Sandbox service listening on (127\.0\.0\.1):(\d+);", beginning, re.MULTILINE)
        if match and 1 <= int(match[2]) <= 65535:
            return "http://" + match[1] + ":" + match[2]
        time.sleep(.1)
    raise composition.base.CheckFailed("The isolated control service did not publish its loopback port in time")


def stop_owned_process(process):
    """Stop only a process created by this runner, including an active CLI child."""
    if process is None or process.poll() is not None:
        return True
    try:
        if os.name == "nt":
            taskkill = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "taskkill.exe"
            stopped = subprocess.run([str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     timeout=10, shell=False, **hidden_options())
            if stopped.returncode != 0:
                raise OSError("Owned process tree could not be stopped")
        else:
            process.terminate()
        process.wait(timeout=10)
        return True
    except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
        # Do not claim descendant cleanup when the bounded tree-stop failed.
        try:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            pass
        return False


def remove_success_workspace(directory):
    # The only recursive removal target is this runner's unique OS-temp directory.
    resolved = directory.resolve()
    if (resolved.parent != Path(tempfile.gettempdir()).resolve() or not resolved.name.startswith(TEMP_PREFIX)
            or directory.is_symlink() or getattr(directory, "is_junction", lambda: False)()):
        raise OSError("Temporary directory boundary check failed")
    shutil.rmtree(resolved)


class DesktopHarness(composition.CompositionHarness):
    def __init__(self, args, player, service):
        super().__init__(args)
        self.player, self.service = player, service
        self.token = ""  # The isolated service intentionally does not inherit SANDBOX_TOKEN.
        self.report.update(
            mode="composition-desktop-controlled-run" if args.run else "composition-desktop-read-only-preflight",
            scope="Owned Windows Unity player, isolated PC persistence" + (" and two live Codex compositions" if args.run else "; no model inference"),
            platform="Windows desktop player, not Quest", package=None, operatorConfirmedPairing=False,
            runtimeAttribution="Owned player launched with a unique isolated loopback service URL",
            plannedInferenceCalls=2 if args.run else 0, deviceProcessObserved=False,
            desktopProcessObserved=False, isolatedStorage=True,
            wearerVisualCheck="Not performed; the desktop player runs headless", trackingAndControllerInputTested=False)

    def choose_device(self):
        self.pid = self.player.pid
        self.check(self.player.poll() is None, "The actual owned Windows player is running")
        self.report.update(desktopProcessObserved=True, appPid=self.pid)

    def read_pid(self):
        return self.player.pid if self.player.poll() is None else None

    def ensure_same_process(self):
        if self.service.poll() is not None:
            raise composition.base.CheckFailed("The owned isolated control service stopped")
        super().ensure_same_process()

    def check(self, condition, description):
        super().check(condition, description.replace("Quest runtime", "Desktop runtime")
                      .replace("Quest acknowledged", "Desktop player acknowledged")
                      .replace("headset viewpoint", "desktop camera viewpoint"))


def run(args):
    workspace = None
    service = player = log_stream = None
    report = {"status": "blocked", "scope": "Isolated Windows composition validation",
              "mode": "composition-desktop-controlled-run" if args.run else "composition-desktop-read-only-preflight",
              "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "plannedInferenceCalls": 2 if args.run else 0, "languageModelUsed": False,
              "runtimeExecutionObserved": False, "deviceProcessObserved": False, "desktopProcessObserved": False,
              "pretestSceneRestored": None, "checks": [], "passed": 0, "failed": 1}
    try:
        if os.name != "nt":
            raise composition.base.CheckFailed("This runner requires the Windows desktop build")
        player_path = args.player.resolve()
        if not player_path.is_file() or player_path.suffix.lower() != ".exe":
            raise composition.base.CheckFailed("Desktop build is missing; build WhiteRoom Desktop or supply --player")
        env = child_environment(args)
        workspace = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX))
        log_path = workspace / "service.log"
        log_stream = log_path.open("wb")
        service = subprocess.Popen([sys.executable, "-u", str(PROJECT / "ControlService" / "server.py"),
                                    "--host", "127.0.0.1", "--port", "0", "--scenes", str(workspace / "scenes")],
                                   cwd=PROJECT, env=env, stdin=subprocess.DEVNULL, stdout=log_stream,
                                   stderr=subprocess.STDOUT, shell=False, **hidden_options())
        service_url = wait_for_service(service, log_path)
        player = subprocess.Popen([str(player_path), "-batchmode", "-nographics", "-serviceUrl", service_url,
                                   "-logFile", str(workspace / "player.log")], cwd=player_path.parent, env=env,
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  shell=False, **hidden_options())
        harness_args = argparse.Namespace(run=args.run, serial=None, adb=None, service_url=service_url,
                                          package=composition.base.DEFAULT_PACKAGE, room_id="white-room-v1",
                                          anchor_id="white-floor", timeout=args.timeout, report=args.report)
        harness = DesktopHarness(harness_args, player, service)
        report = harness.report
        # Publish once, after owned-process cleanup and evidence-retention decisions.
        with contextlib.redirect_stdout(io.StringIO()):
            harness.execute()
    except KeyboardInterrupt:
        report.update(status="interrupted", error="Operator interrupted desktop validation")
    except (composition.base.CheckFailed, CodexProviderError) as error:
        report.update(status="failed" if report.get("languageModelUsed") else "blocked", error=str(error))
    except (OSError, ValueError, TypeError):
        report.update(status="failed", error="Desktop validation could not start or access its isolated files")
    finally:
        clean = True
        for owned in (player, service):
            clean = stop_owned_process(owned) and clean
        if log_stream is not None:
            log_stream.close()
        report["ownedProcessesStopped"] = clean
        if not clean:
            report.update(status="failed", cleanupError="Could not confirm that every owned process stopped")
        retain = workspace is not None
        if workspace is not None and clean and report["status"] in ("passed", "ready"):
            try:
                remove_success_workspace(workspace)
                retain = False
            except OSError:
                report.update(status="failed", cleanupError="Could not safely remove the isolated temporary files")
        report["isolatedFilesRetained"] = retain
        if retain:
            report["manualRecoveryDirectory"] = str(workspace)
            report["manualRecovery"] = ("Local diagnostic files and any PC backups were retained in manualRecoveryDirectory. "
                                        "Its scenes subfolder can be opened with a separate control service for manual recovery. "
                                        "Check pretestSceneRestored and ownedProcessesStopped before resuming.")
        report.update(completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      failed=0 if report["status"] in ("passed", "ready") else 1)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] in ("passed", "ready") else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="Authorize two real Codex turns and isolated scene edits")
    parser.add_argument("--player", type=Path, default=PROJECT / "Builds" / "WhiteRoomDesktop" / "MatrixOperator.exe")
    parser.add_argument("--codex-exe", help="Native Codex executable; otherwise SANDBOX_CODEX_EXE or PATH")
    parser.add_argument("--model", help="Exact optional Codex model; otherwise the environment or CLI default")
    parser.add_argument("--timeout", type=float, default=30, help="Executor acknowledgement timeout, 1-60 seconds")
    parser.add_argument("--report", type=Path, help="Optional report path; preflight and live-run defaults are separate")
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    if args.report is None:
        args.report = PROJECT / "Validation" / ("composition-desktop-results.json" if args.run else "composition-desktop-preflight-results.json")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
