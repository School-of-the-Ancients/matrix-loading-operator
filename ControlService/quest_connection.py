"""Bounded, local-only USB recovery for an already configured Matrix Quest app.

The HTTP handler owns authentication and loopback authorization. This module only
accepts the server's bound port and a runtime freshness callback, never browser
supplied device names, paths, URLs, or commands.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time


PACKAGES = ("com.matt.arsandbox", "com.matt.matrixoperator.whiteroom")
QUEST_MODELS = {"Quest Pro", "Quest 3"}
DEFAULT_PORT = 8765
COMMAND_TIMEOUT = 3
ATTEMPT_TIMEOUT = 20
MAX_OUTPUT = 65536


class ConnectionFailure(Exception):
    pass


def result(status, message, **extra):
    return {"status": status, "message": message, **extra}


def find_adb():
    """Explicit server configuration wins; never search the current directory."""
    configured = os.environ.get("MATRIX_ADB")
    if configured:
        path = Path(configured)
        return str(path) if path.is_absolute() and path.is_file() else None
    found = shutil.which("adb.exe" if os.name == "nt" else "adb")
    if found and Path(found).is_absolute() and Path(found).resolve().parent != Path.cwd().resolve():
        return found
    root = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    path = root / "Unity/Hub/Editor/6000.6.0f1/Editor/Data/PlaybackEngines/AndroidPlayer/SDK/platform-tools/adb.exe"
    return str(path) if path.is_file() else None


def usb_port(value):
    """Return a port only for an exact, credential-free HTTP loopback base URL."""
    if not isinstance(value, str) or not value or len(value) > 256:
        return None
    match = re.fullmatch(r"http://(?:127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?/?", value)
    if match is None:
        return None
    port = int(match[1]) if match[1] is not None else 80
    return port if 1 <= port <= 65535 else None


class QuestConnection:
    def __init__(self):
        self.lock = threading.Lock()

    def reconnect(self, port, online):
        if online():
            return result("online", "A runtime is already connected to this Operator.")
        if not self.lock.acquire(blocking=False):
            return result("needs_attention", "A Quest reconnect is already in progress. Wait for it to finish.")
        try:
            if online():
                return result("online", "A runtime is already connected to this Operator.")
            return self._reconnect(port, online)
        except ConnectionFailure as error:
            return result("error", str(error))
        finally:
            self.lock.release()

    def _reconnect(self, port, online):
        adb = find_adb()
        if not adb:
            return result("needs_attention", "ADB was not found. Install Unity Android Build Support, or set MATRIX_ADB to the full adb executable path and restart the service.")
        deadline = time.monotonic() + ATTEMPT_TIMEOUT

        def run(*args, allow_missing=False, strip_output=True):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ConnectionFailure("Quest reconnect timed out. Keep the headset awake, check its USB cable, and try again.")
            try:
                completed = subprocess.run(
                    [adb, *args], shell=False, stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    encoding="utf-8", errors="replace", timeout=min(COMMAND_TIMEOUT, remaining),
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except subprocess.TimeoutExpired:
                raise ConnectionFailure("ADB timed out. Keep the headset awake, check its USB cable, and try again.") from None
            except OSError:
                raise ConnectionFailure("ADB could not run. Check the server's ADB installation and USB connection.") from None
            if len(completed.stdout) > MAX_OUTPUT:
                raise ConnectionFailure("ADB returned an unexpected response. Reconnect the USB cable and try again.")
            if completed.returncode and not (allow_missing and completed.returncode == 1):
                raise ConnectionFailure("ADB could not complete the reconnect check. Check USB debugging in the headset and try again.")
            return completed.returncode, completed.stdout.strip() if strip_output else completed.stdout

        _, output = run("devices", "-l")
        devices = []
        for line in output.splitlines():
            fields = line.split()
            if len(fields) >= 2 and fields[1] in {"device", "unauthorized", "offline", "no"}:
                devices.append((fields[0], fields[1]))
        if not devices:
            return result("needs_attention", "Connect one Quest by USB, keep it awake, and allow USB debugging in the headset.")
        if len(devices) != 1:
            return result("needs_attention", "Several Android devices are connected. Leave only the intended Quest connected, then retry.")
        serial, state = devices[0]
        if state == "unauthorized":
            return result("needs_attention", "Put on the Quest and accept Allow USB debugging, then retry.")
        if state != "device":
            return result("needs_attention", "The Quest is offline or inaccessible. Wake it, reconnect its USB cable, and allow USB debugging.")
        # -d is ADB's USB-only selector. Do not turn wireless/emulator discovery
        # into a writable device merely because its model resembles a Quest.
        _, usb_serial = run("-d", "get-serialno", allow_missing=True)
        if (not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", serial)
                or usb_serial != serial or serial.startswith("emulator-")):
            return result("needs_attention", "The detected device is not a single USB Quest. Connect the Quest with a USB data cable and retry.")

        def device(*args, **kwargs):
            return run("-s", serial, *args, **kwargs)

        _, model = device("shell", "getprop", "ro.product.model")
        if model not in QUEST_MODELS:
            return result("needs_attention", "The connected device is not a supported Quest Pro or Quest 3. USB forwarding was not changed.")
        installed, running = [], []
        for package in PACKAGES:
            _, location = device("shell", "pm", "path", package, allow_missing=True)
            if location.startswith("package:"):
                installed.append(package)
                _, pid = device("shell", "pidof", package, allow_missing=True)
                if re.fullmatch(r"[0-9]+(?:\s+[0-9]+)*", pid):
                    running.append(package)
        if len(running) > 1 or (not running and len(installed) > 1):
            return result("needs_attention", "Open only the Matrix app you want to connect in the Quest, then retry. Both Matrix Operator AR and White Room are installed.")
        if not installed:
            return result("needs_attention", "Matrix Operator is not installed on this Quest. Install the Matrix APK, open it, and retry.")
        package = (running or installed)[0]
        app_name = "Matrix Operator AR" if package == PACKAGES[0] else "Matrix Operator White Room"
        config_path = f"/sdcard/Android/data/{package}/files/control.json"
        # Prove we can inspect the directory before treating an absent file as
        # the default URL. Permission errors must not silently select port 8765.
        _, files = device("shell", "ls", "-1a", config_path.rsplit("/", 1)[0])
        configured_port = DEFAULT_PORT
        if "control.json" in files.splitlines():
            _, raw = device("shell", "head", "-c", "8193", config_path, strip_output=False)
            try:
                if len(raw.encode("utf-8")) > 8192:
                    raise ValueError("oversize")
                settings = json.loads(raw)
                if not isinstance(settings, dict):
                    raise ValueError("not an object")
            except (ValueError, RecursionError):
                return result("needs_attention", f"{app_name} has an unreadable control.json. Review its connection configuration before reconnecting.")
            configured_port = usb_port(settings.get("url", "http://127.0.0.1:8765"))
            if configured_port is None:
                return result("needs_attention", f"{app_name} is configured with a non-USB or invalid service URL. Check its network connection or review control.json; USB forwarding was not changed.")
        if configured_port != port:
            return result("other_service", f"{app_name} is configured for PC port {configured_port}. Open that Operator and press Reconnect Quest there. This page uses port {port}.",
                          operatorUrl=f"http://127.0.0.1:{configured_port}/")
        if not running:
            return result("needs_attention", f"Open {app_name} from Unknown Sources in the Quest, keep it awake, then retry.")
        if online():
            return result("online", "A runtime is already connected to this Operator.")
        port_spec = f"tcp:{port}"
        # Replace this one mapping only; never remove or rewrite other ports.
        device("reverse", port_spec, port_spec)
        _, mappings = device("reverse", "--list")
        if not any(len(fields := line.split()) == 3 and fields[1:] == [port_spec, port_spec]
                   for line in mappings.splitlines()):
            raise ConnectionFailure("USB forwarding could not be verified. Reconnect the Quest USB cable and retry.")
        if online():
            return result("online", "The Quest runtime is connected to this Operator.")
        return result("forwarded", "USB forwarding is ready. Waiting for the Matrix app to connect; keep the Quest awake with Matrix open.")
