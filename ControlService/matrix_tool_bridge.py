"""Private loopback bridge from PC-local Codex MCP tools to Matrix state.

The separate listener avoids sharing the headset-facing API or its credentials
with Codex's MCP subprocess, including when that API uses TLS.
"""
from __future__ import annotations

import copy
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
import urllib.parse

from web_assets import WebAssetError
from web_environments import WebEnvironmentError
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
    try:
        with opener.open(request, timeout=8) as response:
            raw = response.read(64 * 1024 + 1)
    except urllib.error.HTTPError as error:
        # The private listener returns concise validation errors. Keep their
        # reason visible to the Agent so a rejected edit can be corrected
        # without guessing or repeating an uncertain mutation.
        if error.headers.get_content_type() == "application/json":
            raw_error = error.read(8193)
            try:
                payload = json.loads(raw_error) if len(raw_error) <= 8192 else None
                reason = payload.get("error") if type(payload) is dict else None
            except (ValueError, UnicodeDecodeError):
                reason = None
            if (type(reason) is str and 0 < len(reason) <= 240 and
                    all(ord(char) >= 32 for char in reason)):
                raise urllib.error.HTTPError(error.url, error.code, reason,
                                             error.headers, io.BytesIO(raw_error)) from None
            raise urllib.error.HTTPError(error.url, error.code, error.reason,
                                         error.headers, io.BytesIO(raw_error)) from None
        raise
    if len(raw) > 64 * 1024:
        raise ValueError("Matrix scene summary exceeded its limit")
    return json.loads(raw)


def read_scene(url: str, token: str) -> dict:
    return _request_json(url, token)


def room_spatial_context(url: str, token: str) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/room-spatial", token)


def move_object(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/move", token, value)


def move_with_room_constraint(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/move-room", token, value)


def move_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix move receipt request")
    return _request_json(url[:-6] + "/moves/" + request_id, token)


def spawn_asset(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/spawn", token, value)


def spawn_surface(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/spawn-surface", token, value)


def spawn_builtin(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/spawn-builtin", token, value)


def spawn_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix spawn receipt request")
    return _request_json(url[:-6] + "/spawns/" + request_id, token)


def list_procedural_generators(url: str, token: str) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/procedural-generators", token)


def procedural_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/procedural", token, value)


def procedural_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix procedural receipt request")
    return _request_json(url[:-6] + "/procedural/" + request_id, token)


def record_concept_build(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/concept-build", token, value)


def bind_game(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/bind-game", token, value)


def update_game(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/update-game", token, value)


def game_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix game receipt request")
    return _request_json(url[:-6] + "/games/" + request_id, token)


def display_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/display", token, value)


def display_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix display receipt request")
    return _request_json(url[:-6] + "/displays/" + request_id, token)


def control_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/control", token, value)


def control_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix control receipt request")
    return _request_json(url[:-6] + "/controls/" + request_id, token)


def rigid_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/rigid", token, value)


def rigid_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix rigid receipt request")
    return _request_json(url[:-6] + "/rigid/" + request_id, token)


def list_entities(url: str, token: str, offset: int = 0, limit: int = 24) -> dict:
    if not url.endswith("/scene") or type(offset) is not int or type(limit) is not int:
        raise ValueError("Invalid Matrix entity page request")
    return _request_json(url[:-6] + f"/entities?offset={offset}&limit={limit}", token)


def inspect_entity(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/inspect-entity", token, value)


def entity_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/entity-action", token, value)


def entity_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix entity receipt request")
    return _request_json(url[:-6] + "/entities/actions/" + request_id, token)


def world_archive_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/world-archive", token, value)


def world_archive_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix world archive receipt request")
    return _request_json(url[:-6] + "/world-archives/" + request_id, token)


def bind_animation(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/bind-animation", token, value)


def animation_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix animation receipt request")
    return _request_json(url[:-6] + "/animations/" + request_id, token)


def physics_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/physics", token, value)


def physics_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix physics receipt request")
    return _request_json(url[:-6] + "/physics/" + request_id, token)


def interaction_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/interaction", token, value)


def interaction_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix interaction receipt request")
    return _request_json(url[:-6] + "/interactions/" + request_id, token)


def list_assets(url: str, token: str, offset: int = 0, limit: int = 24) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + f"/assets?offset={offset}&limit={limit}", token)


def list_environments(url: str, token: str, offset: int = 0, limit: int = 24) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + f"/environments?offset={offset}&limit={limit}", token)


def register_panorama(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/register-panorama", token, value)


def environment_action(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/environment", token, value)


def environment_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix environment receipt request")
    return _request_json(url[:-6] + "/environments/actions/" + request_id, token)


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


def scale_block(url: str, token: str, value: dict) -> dict:
    if not url.endswith("/scene"):
        raise ValueError("Invalid Matrix tool bridge URL")
    return _request_json(url[:-6] + "/scale", token, value)


def scale_status(url: str, token: str, request_id: str) -> dict:
    if not url.endswith("/scene") or not re.fullmatch(r"[0-9a-f]{32}", request_id):
        raise ValueError("Invalid Matrix scale receipt request")
    return _request_json(url[:-6] + "/scales/" + request_id, token)


def scene_summary(state) -> dict:
    with state.lock:
        state.expire()
        online = state.online() and state.latest is not None
        snapshot = state.latest if online else None
        scene = snapshot.get("scene", {}) if isinstance(snapshot, dict) else {}
        objects = scene.get("objects", []) if isinstance(scene, dict) else []
        if not isinstance(objects, list):
            objects = []
        assets = snapshot.get("assets", []) if online else []
        room_context = (snapshot.get("roomContext") or {}) if online else {}
        return {"schemaVersion": 1, "online": bool(online),
                "sceneRevision": state.revision,
                "roomId": scene.get("roomId") if online else None,
                "roomMode": room_context.get("mode") if online else None,
                "room": ({"mode": room_context.get("mode", "unknown"),
                          "state": room_context.get("state", "unknown"),
                          "alignmentVerified": room_context.get("alignmentVerified", False),
                          "readOnly": snapshot.get("readOnly", False)} if online else None),
                "digitalWorldVisit": snapshot.get("digitalWorldVisit", False) if online else None,
                "runtimeDescriptor": snapshot.get("runtimeDescriptor") if online else None,
                "objectCount": len(objects) if online else 0,
                "assetCount": len(assets),
                "environment": scene.get("environment") if online else None,
                "environmentSchemaVersion": snapshot.get("environmentSchemaVersion") if online else None,
                "environmentAssetCount": len(snapshot.get("environmentAssets", [])) if online else 0,
                "assets": [{key: item[key] for key in
                            ("assetId", "displayName", "description", "spawnScale",
                             "localBounds", "sha256") if key in item}
                           for item in assets[:MAX_SUMMARY_OBJECTS]],
                "assetsTruncated": len(assets) > MAX_SUMMARY_OBJECTS,
                "componentSchemaVersion": snapshot.get("componentSchemaVersion") if online else None,
                "animationSchemaVersion": snapshot.get("animationSchemaVersion") if online else None,
                "physicsSchemaVersion": snapshot.get("physicsSchemaVersion") if online else None,
                "rigidSchemaVersion": snapshot.get("rigidSchemaVersion") if online else None,
                "controlSchemaVersion": snapshot.get("controlSchemaVersion") if online else None,
                "controlStates": snapshot.get("controlStates", {}) if online else {},
                "rigidGravity": snapshot.get("rigidGravity") if online else None,
                "rigidStates": snapshot.get("rigidStates", [])[:32] if online else [],
                "entityActionSchemaVersion": snapshot.get("entityActionSchemaVersion") if online else None,
                "worldSlotSchemaVersion": snapshot.get("worldSlotSchemaVersion") if online else None,
                "agentGrab": snapshot.get("agentGrab") if online else None,
                "creatorMode": snapshot.get("creatorMode") if online else None,
                "gameStatus": snapshot.get("gameStatus") if online else None,
                "game": snapshot.get("game") if online else None,
                "proceduralGenerators": snapshot.get("proceduralGenerators", []) if online else [],
                "interactionSchemaVersion": snapshot.get("interactionSchemaVersion") if online else None,
                "physicsStates": snapshot.get("physicsStates", [])[:16] if online else [],
                "objects": [{"objectId": item["objectId"], "assetId": item["assetId"],
                             "anchorId": item["anchorId"], "transform": item["transform"],
                             **({"animation": item["animation"]} if "animation" in item else {}),
                             **({"physics": item["physics"]} if "physics" in item else {}),
                             **({"rigidBody": item["rigidBody"]} if "rigidBody" in item else {}),
                             **({"display": item["display"]} if "display" in item else {}),
                             **({"control": item["control"]} if "control" in item else {}),
                             **({"procedural": item["procedural"]} if "procedural" in item else {}),
                             **({"interaction": item["interaction"]} if "interaction" in item else {}),
                             **({"component": {"componentId": item["component"]["componentId"],
                                                "targetObjectId": item["component"]["targetObjectId"],
                                                "status": item["component"]["status"],
                                                **({"error": item["component"]["error"]}
                                                   if "error" in item["component"] else {})}}
                                if "component" in item else {})}
                            for item in objects[:MAX_SUMMARY_OBJECTS]] if online else [],
                "truncated": len(objects) > MAX_SUMMARY_OBJECTS if online else False}


CONCEPT_SCENE_MUTATIONS = frozenset({
    "/move", "/move-room", "/spawn", "/spawn-surface", "/spawn-builtin", "/procedural", "/bind-game",
    "/update-game", "/display", "/control", "/rigid", "/entity-action",
    "/world-archive", "/bind-animation", "/component-action", "/physics",
    "/interaction", "/scale", "/environment"})

BRIDGE_POST_PATHS = frozenset({
    "/move", "/move-room", "/spawn", "/spawn-surface", "/spawn-builtin", "/procedural", "/bind-game", "/update-game",
    "/display", "/control", "/rigid", "/inspect-entity", "/entity-action",
    "/world-archive", "/bind-animation", "/register-glb", "/publish-component",
    "/component-action", "/scale", "/physics", "/interaction", "/concept-build",
    "/register-panorama", "/environment"})
NATIVE_IMAGE_BLOCKED_POSTS = BRIDGE_POST_PATHS - {"/inspect-entity"}


def entity_page(state, offset: int, limit: int) -> dict:
    if type(offset) is not int or type(limit) is not int or not 0 <= offset <= 100 or not 1 <= limit <= 24:
        raise ValueError("Invalid Matrix entity page")
    with state.lock:
        state.expire()
        online = state.online() and state.latest is not None
        scene = state.latest["scene"] if online else None
        objects = scene["objects"] if scene else []
        end = min(len(objects), offset + limit)
        return {"online": bool(online), "roomId": scene["roomId"] if scene else None,
                "sceneRevision": state.revision, "total": len(objects),
                "offset": offset, "nextOffset": end if end < len(objects) else None,
                "objects": copy.deepcopy(objects[offset:end])}


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
        elif self.path == "/room-spatial":
            try:
                self._send_json(200, self.server.state.agent_room_spatial())
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/moves/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_move_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/spawns/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_spawn_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif self.path == "/procedural-generators":
            try:
                self._send_json(200, self.server.state.agent_list_procedural_generators())
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/procedural/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_procedural_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/games/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_game_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/displays/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_display_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/controls/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_control_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/rigid/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_rigid_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/entities/actions/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_entity_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/world-archives/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_world_archive_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/environments/actions/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_environment_status(
                    self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif self.path.startswith("/entities?"):
            try:
                query = urllib.parse.parse_qs(self.path[10:], strict_parsing=True)
                if set(query) != {"offset", "limit"} or any(len(values) != 1 for values in query.values()):
                    raise ValueError()
                self._send_json(200, entity_page(self.server.state,
                                                 int(query["offset"][0]), int(query["limit"][0])))
            except Exception as error:
                self._send_json(getattr(error, "status", 400 if isinstance(error, ValueError) else 500),
                                {"error": str(error) if isinstance(error, ValueError) else "Invalid entity page"})
        elif re.fullmatch(r"/animations/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_animation_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/physics/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_physics_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/interactions/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_interaction_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/component-actions/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_component_status(self.path.rsplit("/", 1)[1]))
            except Exception as error:
                self._send_json(getattr(error, "status", 500),
                                {"error": str(error) if hasattr(error, "status") else "Matrix tool failed"})
        elif re.fullmatch(r"/scales/[0-9a-f]{32}", self.path):
            try:
                self._send_json(200, self.server.state.agent_scale_status(self.path.rsplit("/", 1)[1]))
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
        elif self.path.startswith("/environments?"):
            try:
                query = urllib.parse.parse_qs(self.path[14:], strict_parsing=True)
                if set(query) != {"offset", "limit"} or any(len(values) != 1 for values in query.values()):
                    raise ValueError()
                self._send_json(200, self.server.state.agent_list_environments(
                    int(query["offset"][0]), int(query["limit"][0])))
            except Exception as error:
                known = hasattr(error, "status") or isinstance(error, WebEnvironmentError)
                self._send_json(getattr(error, "status", 400 if known or isinstance(error, ValueError) else 500),
                                {"error": str(error) if known else "Invalid environment page"})
        else:
            self.send_error(404)

    def do_POST(self):
        if not self._authorized():
            return
        if self.path not in BRIDGE_POST_PATHS:
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
            if (self.path in NATIVE_IMAGE_BLOCKED_POSTS and
                    self.server.state.agent_portal.native_generation_active()):
                from server import APIError
                raise APIError(409, "Matrix mutation is blocked during native concept image generation")
            if self.path in CONCEPT_SCENE_MUTATIONS:
                self.server.state.concept_build_preflight()
            if self.path == "/concept-build":
                result = self.server.state.agent_record_concept_build(value)
            elif self.path == "/register-glb":
                result = self.server.state.agent_register_glb(value)
            elif self.path == "/register-panorama":
                result = self.server.state.agent_register_panorama(value)
            elif self.path == "/environment":
                result = self.server.state.agent_environment_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_environment_status(result["requestId"])
            elif self.path == "/spawn-builtin":
                result = self.server.state.agent_spawn_builtin(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_spawn_status(result["requestId"])
            elif self.path == "/procedural":
                result = self.server.state.agent_procedural_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_procedural_status(result["requestId"])
            elif self.path == "/bind-game":
                result = self.server.state.agent_bind_game(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_game_status(result["requestId"])
            elif self.path == "/update-game":
                result = self.server.state.agent_update_game(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_game_status(result["requestId"])
            elif self.path == "/display":
                result = self.server.state.agent_display_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_display_status(result["requestId"])
            elif self.path == "/control":
                result = self.server.state.agent_control_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_control_status(result["requestId"])
            elif self.path == "/rigid":
                result = self.server.state.agent_rigid_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_rigid_status(result["requestId"])
            elif self.path == "/inspect-entity":
                result = self.server.state.agent_inspect_entity(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_entity_status(result["requestId"])
            elif self.path == "/entity-action":
                result = self.server.state.agent_entity_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_entity_status(result["requestId"])
            elif self.path == "/world-archive":
                result = self.server.state.agent_world_archive_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_world_archive_status(result["requestId"])
            elif self.path == "/scale":
                result = self.server.state.agent_scale(value)
            elif self.path == "/publish-component":
                result = self.server.state.agent_publish_component(value)
            elif self.path == "/component-action":
                result = self.server.state.agent_component_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_component_status(result["requestId"])
            elif self.path == "/physics":
                result = self.server.state.agent_physics_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_physics_status(result["requestId"])
            elif self.path == "/interaction":
                result = self.server.state.agent_interaction_action(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_interaction_status(result["requestId"])
            elif self.path == "/bind-animation":
                result = self.server.state.agent_bind_animation(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_animation_status(result["requestId"])
            elif self.path == "/spawn":
                result = self.server.state.agent_spawn(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_spawn_status(result["requestId"])
            elif self.path == "/spawn-surface":
                result = self.server.state.agent_spawn_surface(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_spawn_status(result["requestId"])
            elif self.path == "/move-room":
                result = self.server.state.agent_move_room(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_move_status(result["requestId"])
            else:
                result = self.server.state.agent_move(value)
                deadline = time.monotonic() + MOVE_WAIT
                while result["status"] == "queued" and time.monotonic() < deadline:
                    time.sleep(.1)
                    result = self.server.state.agent_move_status(result["requestId"])
            if (self.path in CONCEPT_SCENE_MUTATIONS and type(result) is dict and
                    type(result.get("requestId")) is str and
                    result.get("status") in ("queued", "succeeded", "unconfirmed")):
                self.server.state.concept_build_first_action()
            self._send_json(200, result)
        except Exception as error:
            known = hasattr(error, "status") or isinstance(error, (WebAssetError, WebEnvironmentError, ComponentError))
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
