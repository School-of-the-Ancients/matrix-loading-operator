"""Private loopback bridge from PC-local Codex MCP tools to Matrix state.

The separate listener avoids sharing the headset-facing API or its credentials
with Codex's MCP subprocess, including when that API uses TLS.
"""
from __future__ import annotations

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import secrets
import threading
import time
import urllib.request
import urllib.parse

from web_assets import WebAssetError
from web_components import ComponentError


MAX_SUMMARY_OBJECTS = 24
MOVE_WAIT = 5


def _request_json(url: str, token: str, body: dict | None = None) -> dict:
    """Contact only the private listener, ignoring process proxy settings."""
    headers = {"Authorization": "Bearer " + token}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, headers=headers,
                                     data=json.dumps(body, allow_nan=False).encode("utf-8") if body is not None else None)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=8) as response:
        raw = response.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024:
        raise ValueError("Matrix scene summary exceeded its limit")
    return json.loads(raw)


def read_scene(url: str, token: str) -> dict:
    return _request_json(url, token)


def move_object(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/move", token, value)


def move_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix move receipt request")
    return _request_json(url[:-6] + "/moves/" + request_id, token)


def list_assets(url: str, token: str, offset: int = 0, limit: int = 24) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + f"/assets?offset={offset}&limit={limit}", token)


def register_glb(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/register-glb", token, value)


def publish_component(url: str, token: str, package: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/publish-component", token, {"package": package})


def list_components(url: str, token: str, offset: int = 0, limit: int = 24) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + f"/components?offset={offset}&limit={limit}", token)


def component_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/component-action", token, value)


def component_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix component receipt request")
    return _request_json(url[:-6] + "/component-actions/" + request_id, token)


def scene_summary(state) -> dict:
    with state.lock:
        state.expire()
        online = state.online() and state.latest is not None
        snapshot = state.latest if online else None
        scene = snapshot.get("scene", {}) if isinstance(snapshot, dict) else {}
        objects = scene.get("objects", []) if isinstance(scene, dict) else []
        if not isinstance(objects, list):
            objects = []
        return {"schemaVersion": 1, "online": bool(online),
                "sceneRevision": state.revision,
                "roomId": scene.get("roomId") if online else None,
                "roomMode": (snapshot.get("roomContext") or {}).get("mode") if online else None,
                "objectCount": len(objects) if online else 0,
                "componentSchemaVersion": snapshot.get("componentSchemaVersion") if online else None,
                "objects": [{"objectId": item["objectId"], "assetId": item["assetId"],
                             "anchorId": item["anchorId"], "transform": item["transform"],
                             **({"component": {"componentId": item["component"]["componentId"],
                                                "targetObjectId": item["component"]["targetObjectId"],
                                                "status": item["component"]["status"],
                                                **({"error": item["component"]["error"]}
                                                   if "error" in item["component"] else {})}}
                                if "component" in item else {})}
                            for item in objects[:MAX_SUMMARY_OBJECTS]] if online else [],
                "truncated": len(objects) > MAX_SUMMARY_OBJECTS if online else False}


class _PrivateServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, state):
        self.state = state
        self.token = secrets.token_urlsafe(32)
        super().__init__(("127.0.0.1", 0), _Handler)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _authorized(self):
        expected = "Bearer " + self.server.token
        received = self.headers.get("Authorization", "")
        if not hmac.compare_digest(received, expected):
            self.send_error(404)
            return False
        return True

    def _send_json(self, status, value):
        raw = json.dumps(value, ensure_ascii=False,
                         allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not self._authorized():
            return
        if self.path == "/scene":
            self._send_json(200, scene_summary(self.server.state))
        elif re.fullmatch(r"/moves/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_move_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/component-actions/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_component_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif self.path.startswith("/components?"):
            try:
                query = urllib.parse.parse_qs(self.path[12:], strict_parsing=True)
                if set(query) != {"offset", "limit"} or any(len(values) != 1 for values in query.values()):
                    raise ValueError()
                self._send_json(200, self.server.state.agent_list_components(int(query["offset"][0]),
                                                                              int(query["limit"][0])))
            except Exception as error:
                known = hasattr(error, "status") or isinstance(error, ComponentError)
                self._send_json(getattr(error, "status", 400 if known or isinstance(error, ValueError) else 500),
                                {"error": str(error) if known else "Invalid component page"})
        elif self.path.startswith("/assets?"):
            try:
                query = urllib.parse.parse_qs(self.path[8:], strict_parsing=True)
                if set(query) != {"offset", "limit"} or any(len(values) != 1 for values in query.values()):
                    raise ValueError()
                self._send_json(200, self.server.state.agent_list_assets(int(query["offset"][0]),
                                                                    int(query["limit"][0])))
            except Exception as error:
                self._send_json(getattr(error, "status", 400 if isinstance(error, ValueError) else 500),
                                {"error": str(error) if hasattr(error, "status") else "Invalid asset page"})
        else:
            self.send_error(404)

    def do_POST(self):
        if not self._authorized():
            return
        if self.path not in ("/move", "/register-glb", "/publish-component", "/component-action"):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
            # Escaped Unicode in valid 500-character descriptions can exceed
            # the move endpoint's small request budget.
            limit = 32 * 1024 if self.path == "/register-glb" else 8192 if self.path == "/publish-component" else 4096
            if not 0 < length <= limit:
                raise ValueError("Invalid Matrix tool request size")
            value = json.loads(self.rfile.read(length))
            if self.path == "/register-glb":
                result = self.server.state.agent_register_glb(value)
            elif self.path == "/publish-component":
                result = self.server.state.agent_publish_component(value)
            elif self.path == "/component-action":
                result = self.server.state.agent_component_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_component_status(result["requestId"])
            else:
                result = self.server.state.agent_move(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_move_status(result["requestId"])
            self._send_json(200, result)
        except Exception as error:
            known = hasattr(error, "status") or isinstance(error, (WebAssetError, ComponentError))
            self._send_json(getattr(error, "status", 400 if known or isinstance(error, ValueError) else 500),
                            {"error": str(error) if known else "Invalid Matrix tool request"})


class MatrixToolBridge:
    def __init__(self, state):
        self._server = _PrivateServer(state)
        self._thread = threading.Thread(target=self._server.serve_forever,
                                        name="matrix-tool-bridge", daemon=True)
        self._thread.start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self._server.server_port}/scene"

    @property
    def token(self):
        return self._server.token

    def close(self):
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=2)
