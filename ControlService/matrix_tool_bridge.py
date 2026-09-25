"""Private loopback bridge from the Matrix MCP tool to live WebXR state.

Only a bounded read-only scene summary is available in this first tool slice.
The separate listener avoids sharing the headset-facing API or its credentials
with Codex's MCP subprocess, including when that API uses TLS.
"""
from __future__ import annotations

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import threading
import urllib.request


MAX_SUMMARY_OBJECTS = 24


def read_scene(url: str, token: str) -> dict:
    """Read only the private loopback listener, ignoring process proxy settings."""
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=3) as response:
        raw = response.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024:
        raise ValueError("Matrix scene summary exceeded its limit")
    return json.loads(raw)


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
                "objects": [{"objectId": item["objectId"], "assetId": item["assetId"],
                             "anchorId": item["anchorId"], "transform": item["transform"]}
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

    def do_GET(self):
        expected = "Bearer " + self.server.token
        received = self.headers.get("Authorization", "")
        if self.path != "/scene" or not hmac.compare_digest(received, expected):
            self.send_error(404)
            return
        raw = json.dumps(scene_summary(self.server.state), ensure_ascii=False,
                         allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)


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
