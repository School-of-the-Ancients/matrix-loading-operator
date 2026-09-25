"""AR Sandbox control service. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import ssl
import collections
import copy
import hashlib
import hmac
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.parse
import urllib.request
import uuid

from ai_adapter import (Planner, PlannerError, validate_local_bounds, validate_viewer,
                        validate_anchor_metadata, validate_room_context, validate_pointing,
                        validate_behavior, validate_behaviors, validate_behavior_kinds, validate_content_source)
from learning import LearningBridge, LearningError, identifier
from codex_provider import CodexConfig, CodexProviderError, codex_options, select_codex_config
from agent_session import LocalCodexAgentBackend
from agent_portal import AgentPortal, AgentPortalError
from matrix_tool_bridge import MatrixToolBridge
import speech
import tts
import scene_capture
from web_assets import WebAssetCatalog, WebAssetError, MAX_BYTES as MAX_GLB_BYTES
from web_components import ComponentError, validate_attachment, validate_package, COMPONENT_ID
from web_authoring import WebAuthoringJobs, WebAuthoringError
from blender_authoring import BlenderAuthoringJobs, BlenderAuthoringError
from web_game import GamePlanError, design_game, wants_game
from content_service import ContentBridge, runtime_capabilities
from content_catalog import ContentError
from quest_connection import QuestConnection
from client_api import ClientAPI, ClientError
import scale_experiment

MAX_BODY = 1024 * 1024
MAX_EXCHANGE_BODY = 3 * 1024 * 1024  # two bounded snapshots plus a base64 JPEG
MAX_OBJECTS = 100
MAX_PENDING = 64
MAX_BATCH = 20
LEASE_SECONDS = 15
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\Z")
OPS = {"spawn", "set_transform", "select", "duplicate", "delete", "undo", "redo", "clear", "load",
       "get_scene", "list_assets", "list_targets", "confirm_room", "set_behavior", "remove_behavior",
       "attach_component", "stop_component", "remove_component"}


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def require(condition, message, status=400):
    if not condition:
        raise APIError(status, message)


def client_api_path(path):
    # /api/voice is an existing unrelated API, not a versioned client route.
    return re.match(r"/api/v[0-9]+(?:/|$)", path) is not None


def text(value, field, empty=False, limit=128):
    require(isinstance(value, str) and (empty or bool(value)) and len(value) <= limit,
            f"Invalid {field}")
    require(not any(ord(c) < 32 for c in value), f"Invalid {field}")
    return value


def conversation(value):
    if value is None:
        return []
    require(isinstance(value, list) and len(value) <= 6, "Invalid conversation history")
    turns = []
    for item in value:
        require(isinstance(item, dict) and set(item) == {"user", "assistant"}, "Invalid conversation turn")
        turns.append({"user": text(item["user"], "conversation user", limit=1000),
                      "assistant": text(item["assistant"], "conversation assistant", limit=1000)})
    return turns


def vector(value, field, scale=False):
    require(isinstance(value, dict), f"Invalid {field}")
    result = {}
    minimum, maximum = (0.01, 20) if scale else (-100, 100) if field == "position" else (-36000, 36000)
    for axis in ("x", "y", "z"):
        n = value.get(axis)
        require(type(n) in (int, float) and minimum <= n <= maximum and math.isfinite(n),
                f"Invalid {field}.{axis}")
        result[axis] = n
    return result


def transform(value):
    require(isinstance(value, dict), "Invalid transform")
    return {"position": vector(value.get("position"), "position"),
            "rotation": vector(value.get("rotation"), "rotation"),
            "scale": vector(value.get("scale"), "scale", True)}


def scene(value):
    require(isinstance(value, dict), "Invalid scene")
    require(type(value.get("schemaVersion")) is int and value["schemaVersion"] == 1,
            "Unsupported schemaVersion")
    room = text(value.get("roomId"), "roomId")
    objects = value.get("objects")
    require(isinstance(objects, list) and len(objects) <= MAX_OBJECTS, "Invalid objects list")
    normalized, ids = [], set()
    for item in objects:
        require(isinstance(item, dict), "Invalid scene object")
        object_id = text(item.get("objectId"), "objectId")
        require(object_id not in ids, "Duplicate objectId")
        ids.add(object_id)
        normalized.append({"objectId": object_id,
                           "assetId": text(item.get("assetId"), "assetId"),
                           "anchorId": text(item.get("anchorId"), "anchorId"),
                           "transform": transform(item.get("transform"))})
        try:
            source = validate_content_source(item.get("source"), normalized[-1]["assetId"])
            if source:
                normalized[-1]["source"] = source
            behaviors = validate_behaviors(item.get("behaviors"))
        except PlannerError as error:
            raise APIError(400, str(error)) from None
        if behaviors:
            normalized[-1]["behaviors"] = behaviors
        if "component" in item:
            try:
                validate_attachment(item["component"])
            except ComponentError as error:
                raise APIError(400, str(error)) from None
            normalized[-1]["component"] = copy.deepcopy(item["component"])
    for item in normalized:
        component = item.get("component")
        if component:
            target = next((other for other in normalized
                           if other["objectId"] == component["targetObjectId"]), None)
            require(item["anchorId"] == "web-floor" and
                    (target is not None and target["anchorId"] == "web-floor" and
                     target["objectId"] != item["objectId"] or
                     target is None and component["status"] == "failed"),
                    "Invalid component target")
    return {"schemaVersion": 1, "roomId": room, "objects": normalized}


def catalog(value, key, limit):
    require(isinstance(value, list) and len(value) <= limit, f"Invalid {key} catalog")
    result, ids = [], set()
    for item in value:
        require(isinstance(item, dict), f"Invalid {key} entry")
        identifier = text(item.get(key), key)
        require(identifier not in ids, f"Duplicate {key}")
        ids.add(identifier)
        entry = {key: identifier, "displayName": text(item.get("displayName"), "displayName")}
        if key == "assetId":
            try:
                source = validate_content_source(item.get("source"), identifier)
            except PlannerError as error:
                raise APIError(400, str(error)) from None
            if source:
                entry["source"] = source
        if key == "assetId" and item.get("description"):
            entry["description"] = text(item["description"], "asset description", limit=500)
        if key == "assetId" and item.get("interactionMode"):
            require(item["interactionMode"] in ("light", "hinge") and "source" not in entry,
                    "Invalid bundled interaction mode")
            entry["interactionMode"] = item["interactionMode"]
        if key == "assetId" and "spawnScale" in item:
            scale = item["spawnScale"]
            require(type(scale) in (int, float) and 0.01 <= scale <= 20 and math.isfinite(scale), "Invalid spawnScale")
            entry["spawnScale"] = scale
        if key == "assetId" and "localBounds" in item:
            try:
                bounds = validate_local_bounds(item["localBounds"])
            except PlannerError as error:
                raise APIError(400, str(error)) from None
            if bounds is not None:
                entry["localBounds"] = bounds
        if key == "anchorId":
            try:
                entry.update(validate_anchor_metadata(item))
            except PlannerError as error:
                raise APIError(400, str(error)) from None
        result.append(entry)
    return result


def snapshot(value):
    require(isinstance(value, dict), "Invalid snapshot")
    result = {"scene": scene(value.get("scene")),
              "assets": catalog(value.get("assets"), "assetId", 512),
              "anchors": catalog(value.get("anchors"), "anchorId", 128)}
    selected = value.get("selection")
    if selected is not None:
        require(isinstance(selected, dict), "Invalid selection")
        anchor_id = text("" if selected.get("anchorId") is None else selected["anchorId"], "selection.anchorId", empty=True)
        object_id = text("" if selected.get("objectId") is None else selected["objectId"], "selection.objectId", empty=True)
        require(not anchor_id or anchor_id in {a["anchorId"] for a in result["anchors"]}, "Unknown selection anchorId")
        require(not object_id or object_id in {o["objectId"] for o in result["scene"]["objects"]}, "Unknown selection objectId")
        result["selection"] = {"anchorId": anchor_id, "objectId": object_id,
                               "position": vector(selected.get("position"), "position")}
    try:
        if value.get("behaviorKinds") is not None:
            result["behaviorKinds"] = validate_behavior_kinds(value["behaviorKinds"])
        if value.get("componentSchemaVersion") is not None:
            require(type(value["componentSchemaVersion"]) is int and value["componentSchemaVersion"] == 1,
                    "Unsupported component schema")
            result["componentSchemaVersion"] = 1
        require(result.get("componentSchemaVersion") == 1 or
                not any("component" in item for item in result["scene"]["objects"]),
                "Scene components require the WebXR component runtime")
        viewer = validate_viewer(value.get("viewer"), {a["anchorId"] for a in result["anchors"]})
        pointing = validate_pointing(value.get("pointing"),
                                     {a["anchorId"]: a for a in result["anchors"]},
                                     {o["objectId"]: o for o in result["scene"]["objects"]})
        room = validate_room_context(value.get("roomContext"))
    except PlannerError as error:
        raise APIError(400, str(error)) from None
    if viewer is not None:
        result["viewer"] = viewer
    if pointing is not None:
        result["pointing"] = pointing
    if room is not None:
        result["roomContext"] = room
    read_only = value.get("readOnly", False)
    require(type(read_only) is bool, "Invalid readOnly marker")
    if read_only:
        require(room and room["mode"] == "ar" and room["state"] != "ready",
                "Read-only recovery requires an unavailable AR room")
        result["readOnly"] = True
    return result


def scene_revision_data(value):
    # Voice captures head/controller pose at recording start. Movement isn't a scene edit.
    if value is None:
        return None
    result = {key: item for key, item in value.items() if key not in ("viewer", "pointing")}
    # Browser planes refine their poses and polygons while the wearer moves. Their
    # session-local IDs identify the same targets; the browser checks current fit
    # again when it executes a command. Do not stale a proposal for pose jitter.
    if result["scene"]["roomId"].startswith("webxr-session-"):
        result["anchors"] = [{"anchorId": anchor["anchorId"], "displayName": anchor["displayName"],
                              "source": anchor.get("source"),
                              "labels": anchor.get("semanticLabels"),
                              "kind": (anchor.get("surface") or {}).get("kind")}
                             for anchor in result["anchors"]]
    return result


def command(value):
    require(isinstance(value, dict), "Invalid command")
    op = value.get("op")
    require(isinstance(op, str) and op in OPS, "Unknown command op")
    allowed = {"op", "requestId"}
    required = {"spawn": {"assetId", "anchorId", "transform"}, "set_transform": {"objectId", "transform"},
                "set_behavior": {"objectId", "behavior"}, "remove_behavior": {"objectId", "behaviorKind"},
                "attach_component": {"objectId", "componentId", "package", "targetObjectId"},
                "stop_component": {"objectId"}, "remove_component": {"objectId"},
                "select": {"objectId"}, "duplicate": {"objectId"}, "delete": {"objectId"},
                "load": {"scene"}}.get(op, set())
    allowed |= required
    if op == "spawn":
        allowed |= {"anchorId", "transform", "placement"}
    if op == "set_transform":
        allowed |= {"anchorId", "placement"}
    require(not (set(value) - allowed), "Unexpected command fields")
    require(required <= set(value), "Missing command fields")
    result = {"op": op}
    for key in ("assetId", "objectId", "anchorId", "componentId", "targetObjectId"):
        if key in value:
            result[key] = text(value[key], key, empty=key == "anchorId")
    if "transform" in value:
        result["transform"] = transform(value["transform"])
    if "placement" in value:
        require(value["placement"] == "surface", "Unknown placement mode")
        result["placement"] = "surface"
    if "scene" in value:
        result["scene"] = scene(value["scene"])
    if "behavior" in value:
        try:
            result["behavior"] = validate_behavior(value["behavior"])
        except PlannerError as error:
            raise APIError(400, str(error)) from None
    if "behaviorKind" in value:
        require(isinstance(value["behaviorKind"], str) and value["behaviorKind"] in ("rotate", "bob", "all"),
                "Unknown behavior kind")
        result["behaviorKind"] = value["behaviorKind"]
    if "package" in value:
        try:
            result["package"] = copy.deepcopy(validate_package(value["package"]))
        except ComponentError as error:
            raise APIError(400, str(error)) from None
        require(COMPONENT_ID.fullmatch(result["componentId"]) is not None, "Invalid componentId")
    return result


def parse_json(raw):
    def invalid_constant(_):
        raise ValueError("Non-finite JSON number")
    try:
        return json.loads(raw, parse_constant=invalid_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise APIError(400, "Invalid JSON") from None


def loopback(host):
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def local_agent_backend(state=None):
    config = CodexConfig.from_environment()
    if config is None:
        raise AgentPortalError(503, "Configure the local Codex provider for Agent Portal")
    config.validate()
    if state is not None and state.matrix_tool_bridge is None:
        state.matrix_tool_bridge = MatrixToolBridge(state)
    return LocalCodexAgentBackend(config, Path(__file__).resolve().parent.parent,
                                  getattr(state, "matrix_tool_bridge", None))


def agent_turn_context(state, value):
    """Reduce one wearer-owned semantic hit to bounded, advisory agent data."""
    require(isinstance(value, dict) and set(value) == {"schemaVersion", "inputSource", "clientId",
            "roomId", "selectedObjectId", "pointingTarget", "viewerFrame"},
            "Invalid Matrix Agent context")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1,
            "Unsupported Matrix Agent context version")
    require(value["inputSource"] in ("text", "voice_transcript"), "Invalid Agent input source")
    client_id = text(value["clientId"], "Agent clientId")
    room_id = text(value["roomId"], "Agent roomId")
    selected_id = value["selectedObjectId"]
    require(selected_id is None or isinstance(selected_id, str), "Invalid selected object")
    if selected_id is not None:
        selected_id = text(selected_id, "selected object")
    with state.lock:
        state.expire()
        require(state.online() and state.client_id == client_id and state.latest,
                "Matrix world is not connected for spatial context", 409)
        current = state.latest
        require(current["scene"]["roomId"] == room_id, "Matrix room changed; point and retry", 409)
        objects = {item["objectId"]: item for item in current["scene"]["objects"]}
        anchors = {item["anchorId"] for item in current["anchors"]}
        require(selected_id is None or selected_id in objects,
                "Selected Matrix object is no longer available", 409)
        target = value["pointingTarget"]
        if target is not None:
            require(isinstance(target, dict) and set(target) == {"anchorId", "objectId", "position"},
                    "Invalid pointing target")
            anchor_id = text(target["anchorId"], "pointing anchorId")
            object_id = target["objectId"]
            require(object_id is None or isinstance(object_id, str), "Invalid pointed object")
            if object_id is not None:
                object_id = text(object_id, "pointed object")
            require(anchor_id in anchors, "Pointed Matrix anchor is no longer available", 409)
            require(object_id is None or object_id in objects and objects[object_id]["anchorId"] == anchor_id,
                    "Pointed Matrix object is no longer available", 409)
            target = {"anchorId": anchor_id, "objectId": object_id,
                      "position": vector(target["position"], "position")}
        frame = value["viewerFrame"]
        if frame is not None:
            try:
                checked = validate_viewer({"frames": [frame]}, anchors)
            except PlannerError as error:
                raise APIError(400, str(error)) from None
            frame = checked["frames"][0]
        def object_summary(item):
            return {"objectId": item["objectId"], "assetId": item["assetId"],
                    "anchorId": item["anchorId"], "transform": item["transform"]}
        scene_objects = current["scene"]["objects"]
        priority_ids = [identifier for identifier in
                        (selected_id, target["objectId"] if target else None) if identifier]
        summary_objects = []
        included = set()
        for identifier in priority_ids:
            if identifier not in included:
                summary_objects.append(objects[identifier])
                included.add(identifier)
        for item in scene_objects:
            if len(summary_objects) >= 8:
                break
            if item["objectId"] not in included:
                summary_objects.append(item)
                included.add(item["objectId"])
        room = current.get("roomContext") or {}
        return {"schemaVersion": 1, "kind": "matrix_spatial_context",
                "inputSource": value["inputSource"], "roomId": room_id,
                "sceneRevision": state.revision,
                "room": {"mode": room.get("mode", "unknown"), "state": room.get("state", "unknown"),
                         "alignmentVerified": room.get("alignmentVerified", False),
                         "readOnly": current.get("readOnly", False)},
                "selectedObject": object_summary(objects[selected_id]) if selected_id else None,
                "pointingTarget": target, "viewerFrame": frame,
                "sceneSummary": {"objectCount": len(scene_objects),
                                 "objects": [object_summary(item) for item in summary_objects],
                                 "omittedObjectCount": max(0, len(scene_objects) - 8)}}


def agent_portal_action(state, path, body):
    portal = state.agent_portal
    if path == "/api/agent/transcribe":
        require(set(body) == {"sessionId", "audioBase64"}, "Invalid Agent transcription request")
        portal.status(body["sessionId"])
        audio = speech.decode_audio(body["audioBase64"])
        speech.configuration()
        require(state.voice_worker.acquire(blocking=False),
                "Speech recognition is still busy; try again shortly", 409)
        try:
            return {"transcript": speech.transcribe(audio)}
        finally:
            state.voice_worker.release()
    if path == "/api/agent/session":
        require(body == {}, "Agent session start expects an empty object")
        return portal.open()
    if path == "/api/agent/status":
        require(set(body) in ({"sessionId"}, {"sessionId", "cursor"}), "Invalid Agent status request")
        return portal.status(body["sessionId"], body.get("cursor", 0))
    if path == "/api/agent/turn":
        require(set(body) in ({"sessionId", "text"}, {"sessionId", "text", "context"}),
                "Invalid Agent turn request")
        context = agent_turn_context(state, body["context"]) if "context" in body else None
        return portal.send_text(body["sessionId"], body["text"], context)
    if path == "/api/agent/approval":
        require(set(body) == {"sessionId", "approvalId", "turnId", "approve"}, "Invalid Agent approval request")
        return portal.decide(body["sessionId"], body["approvalId"], body["turnId"], body["approve"])
    if path == "/api/agent/cancel":
        require(set(body) == {"sessionId", "turnId"}, "Invalid Agent cancel request")
        return portal.cancel(body["sessionId"], body["turnId"])
    raise APIError(404, "Not found")


class State:
    def __init__(self, directory, clock=time.monotonic, learning=None, web_assets_directory=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.web_assets = WebAssetCatalog(web_assets_directory or Path(__file__).with_name("web_assets"))
        self.web_authoring = WebAuthoringJobs(self.web_assets)
        self.blender_authoring = BlenderAuthoringJobs(self.web_assets)
        self.matrix_tool_bridge = None
        self.agent_portal = AgentPortal(self.directory / ".agent_portal", lambda: local_agent_backend(self))
        self.clock = clock
        self.lock = threading.RLock()
        self.client_id = None
        self.runtime_generation = 0
        self.last_seen = -float("inf")
        self.latest = None
        self.runtime = None
        self.pending = collections.OrderedDict()
        self.results = collections.deque(maxlen=100)
        self.agent_move_ids = collections.OrderedDict()
        self.revision = 0
        self.proposals = collections.OrderedDict()
        self.learning = learning
        self.codex_preferences = None
        self.voice_jobs = collections.OrderedDict()
        self.voice_worker = threading.Lock()
        self.capture_supported = False
        self.capture_capabilities = scene_capture.capabilities(None)
        self.capture = None
        self.last_capture_request = -float("inf")
        self.voice_capture_id = None
        self.content = ContentBridge(self)
        self.clients = ClientAPI(self, plan, lambda: client_planner_modes(self))

    def online(self):
        return self.client_id is not None and self.clock() - self.last_seen < LEASE_SECONDS

    def expire(self):
        if self.client_id is not None and not self.online():
            # Retire lease-bound installs before exchange can renew the same
            # client ID. A returning heartbeat must not revive an old request.
            self.content.expire()
            for request_id in self.pending:
                self.results.append({"requestId": request_id, "ok": False,
                                     "error": "Client lease expired; command outcome unknown", "objectId": ""})
            self.pending.clear()
            self.proposals.clear()
            self.clients.runtime_expired()
            self.revision += 1
            self.client_id = None

    def exchange(self, body):
        content_capabilities = runtime_capabilities(body.get("contentCapabilities"))
        require(isinstance(body, dict), "Expected exchange object")
        client_id = text(body.get("clientId"), "clientId")
        require(type(body.get("captureSupported", False)) is bool, "Invalid capture capability")
        try:
            capture_capabilities = scene_capture.capabilities(body.get("captureCapabilities"), body.get("captureSupported", False))
        except scene_capture.CaptureError as error:
            raise APIError(error.status, str(error)) from None
        try:
            runtime = validate_room_context(body.get("runtime"))
        except PlannerError as error:
            raise APIError(400, str(error)) from None
        raw = body.get("snapshot")
        missing = runtime is not None and runtime["mode"] == "ar" and runtime["state"] != "ready"
        # JsonUtility can serialize an absent inline snapshot as zero-filled fields.
        raw_scene = raw.get("scene") if isinstance(raw, dict) else None
        empty = raw is None or (isinstance(raw, dict) and
                               (raw_scene is None or isinstance(raw_scene, dict) and not raw_scene.get("roomId")))
        if empty:
            require(missing, "A snapshot is required for a ready runtime")
            current = None
        else:
            current = snapshot(raw)
            if runtime is not None:
                require(current.get("roomContext") == runtime, "Snapshot and runtime room context disagree")
            else:
                runtime = current.get("roomContext")
            require(not runtime or runtime["mode"] != "ar" or runtime["state"] == "ready" or current.get("readOnly"),
                    "Unavailable room must not publish an editable snapshot")
        results = body.get("results", [])
        require(isinstance(results, list) and len(results) <= MAX_PENDING, "Too many results")
        checked = []
        for item in results:
            require(isinstance(item, dict) and type(item.get("ok")) is bool, "Invalid result")
            checked.append({"requestId": text(item.get("requestId"), "requestId"), "ok": item["ok"],
                            "error": text("" if item.get("error") is None else item["error"], "error", empty=True, limit=2048),
                            "objectId": text("" if item.get("objectId") is None else item["objectId"], "objectId", empty=True)})
        with self.lock:
            self.expire()
            require(self.client_id in (None, client_id), "Another client holds the active lease", 409)
            if self.client_id != client_id:
                self.runtime_generation += 1
            self.client_id, self.last_seen = client_id, self.clock()
            for result in checked:
                if result["requestId"] in self.pending:
                    del self.pending[result["requestId"]]
                    self.results.append(result)
            if current is None or (current.get("readOnly") and not (self.latest or {}).get("readOnly")):
                self.clients.commands_unconfirmed(self.pending, "Room became unavailable after dispatch; the effect is unknown. Reconcile before retrying.")
                for request_id in self.pending:
                    self.results.append({"requestId": request_id, "ok": False, "objectId": "",
                                         "error": "Room became unavailable; command outcome unknown. " + runtime["message"]})
                self.pending.clear()
                self.proposals.clear()
                for job in self.voice_jobs.values():
                    if job["public"]["phase"] in {"transcribing", "planning", "ready"}:
                        job["cancelled"] = True
                        job["public"].update(phase="error", requiresApply=False,
                                             error="Room became unavailable. Reload the room, check alignment, and speak again.")
            if scene_revision_data(self.latest) != scene_revision_data(current):
                self.revision += 1
            self.latest = current
            self.runtime = runtime
            self.clients.observe(checked)
            self.capture_supported = body.get("captureSupported", False)
            self.capture_capabilities = capture_capabilities
            self.receive_capture(body.get("capture"))
            content_request = self.content.exchange(content_capabilities, body.get("contentReceipt"))
            response = {"commands": copy.deepcopy(list(self.pending.values()))}
            if content_request is not None:
                response["contentInstall"] = content_request
            if self.capture_status()["status"] == "pending":
                response["capture"] = {"captureId": self.capture["captureId"], "revision": self.capture["revision"]}
                if self.capture.get("mode") == "mixed":
                    response["capture"]["mode"] = "mixed"
            if self.learning:
                self.learning.restore_after_ack(self)
                guide = self.learning.guide(self)
                if guide is not None:
                    response["lesson"] = guide
            return response

    def capture_status(self, include_image=False):
        with self.lock:
            self.expire()
            result = {"supported": self.capture_supported, "status": "none", "voiceCaptureId": self.voice_capture_id,
                      "capabilities": copy.deepcopy(self.capture_capabilities)}
            capture = self.capture
            if capture is None:
                return result
            age = max(0, self.clock() - capture.get("received", capture["requested"]))
            status, error = capture["status"], capture.get("error", "")
            timeout = scene_capture.MIXED_CAPTURE_TIMEOUT if capture.get("mode") == "mixed" else scene_capture.CAPTURE_TIMEOUT
            if status == "pending" and age > timeout:
                capture.update(status="error", error="Capture timed out. Keep the runtime awake and try again.")
                status, error = capture["status"], capture["error"]
            if status in ("pending", "ready"):
                if (not self.online() or self.client_id != capture["clientId"] or self.revision != capture["revision"]
                        or self.latest is None or self.latest.get("readOnly") or self.pending):
                    status, error = "stale", "Runtime, scene, or selection changed. Capture the current view again."
                elif status == "ready" and age > scene_capture.CAPTURE_MAX_AGE:
                    status, error = "stale", "Image is older than 30 seconds. Capture the current view again."
            result.update(captureId=capture["captureId"], revision=capture["revision"], status=status,
                          ageSeconds=round(age, 3), error=error, mode=capture.get("mode", "virtual"))
            if "image" in capture:
                result.update({key: copy.deepcopy(value) for key, value in capture["image"].items() if key != "dataBase64"})
                if include_image:
                    result["imageDataUrl"] = "data:image/jpeg;base64," + capture["image"]["dataBase64"]
            return result

    def request_capture(self, body):
        require(set(body) <= {"mode"} and body.get("mode", "virtual") in ("virtual", "mixed"), "Expected capture mode virtual or mixed")
        mode = body.get("mode", "virtual")
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            require(self.capture_supported, "Connected player does not support rendered captures; update the app", 409)
            require(mode in self.capture_capabilities["modes"], self.capture_capabilities["reason"] or "Capture mode unavailable", 409)
            if mode == "mixed":
                require((self.latest.get("roomContext") or {}).get("mode") == "ar", "Physical imagery requires the AR runtime", 409)
            require(not self.latest.get("readOnly"), "Reload room data before capturing", 409)
            require(not self.pending, "Wait for queued commands before capturing", 409)
            require(not self.content.busy(), "Wait for content installation before capturing", 409)
            require(self.capture_status()["status"] != "pending", "A capture is already pending", 409)
            require(self.clock() - self.last_capture_request >= scene_capture.CAPTURE_INTERVAL,
                    "Wait two seconds between captures", 429)
            self.last_capture_request = self.clock()
            self.capture = {"captureId": uuid.uuid4().hex, "clientId": self.client_id,
                            "revision": self.revision, "requested": self.clock(), "status": "pending", "mode": mode}
            self.voice_capture_id = None
            return self.capture_status()

    def receive_capture(self, value):
        # JsonUtility represents an absent inline field as a zero-filled object.
        if value is None or isinstance(value, dict) and not value.get("captureId"):
            return
        require(isinstance(value, dict), "Invalid capture result")
        capture = self.capture
        # A superseded upload or retry must never replace the selected capture.
        if not capture or value.get("captureId") != capture["captureId"] or capture["status"] != "pending":
            return
        try:
            require(value.get("clientId") == capture["clientId"] == self.client_id,
                    "Capture belongs to a different runtime session", 409)
            require(type(value.get("revision")) is int and value["revision"] == capture["revision"] == self.revision,
                    "Scene changed during capture; capture again", 409)
            timeout = scene_capture.MIXED_CAPTURE_TIMEOUT if capture.get("mode") == "mixed" else scene_capture.CAPTURE_TIMEOUT
            require(self.clock() - capture["requested"] <= timeout,
                    "Capture arrived after the timeout; capture again", 409)
            require(type(value.get("ok")) is bool, "Invalid capture result status")
            require(value["ok"], text(value.get("error") or "Runtime could not capture this view", "capture error", limit=2048), 409)
            captured = snapshot(value.get("snapshot"))
            require(scene_revision_data(captured) == scene_revision_data(self.latest),
                    "Image and scene snapshot do not match; capture again", 409)
            validated = scene_capture.image(value)
            require((validated["source"] in {"quest_camera_composite", "webxr_camera_pair"}) == (capture.get("mode") == "mixed"),
                    "Capture did not match the requested image source; no fallback is allowed", 409)
            if validated.get("spatialProvenance"):
                provenance = validated["spatialProvenance"]
                require(provenance["roomId"] == captured["scene"]["roomId"]
                        and provenance["anchorCount"] == len(captured["anchors"]), "Spatial provenance does not match the paired room", 409)
                room = captured.get("roomContext") or {}
                measured = any(anchor.get("source") == "mruk" for anchor in captured["anchors"])
                web_pair = validated["source"] == "webxr_camera_pair"
                require(provenance["source"] == ("webxr_room_planes" if web_pair else
                                                 "mruk_scene_model_v1" if measured else "virtual")
                        and (not measured or room.get("mode") == "ar")
                        and provenance["alignmentVerified"] == ((room.get("alignmentVerified") is True) if web_pair
                                                                  else (measured and room.get("alignmentVerified") is True)),
                        "Spatial provenance does not match the paired room source or alignment", 409)
                require(validated["source"] not in {"quest_camera_composite", "webxr_camera_pair"} or room.get("mode") == "ar",
                        "Mixed capture requires an AR room snapshot", 409)
            validated.update(captureId=capture["captureId"], clientId=capture["clientId"], revision=capture["revision"],
                             content=scene_capture.content_description(captured, validated))
            capture.update(status="ready", image=validated, snapshot=captured, received=self.clock())
        except (APIError, scene_capture.CaptureError) as error:
            # A bad image should be acknowledged and surfaced without breaking text heartbeats.
            capture.update(status="error", error=str(error))

    def selected_capture(self, capture_id):
        text(capture_id, "captureId")
        status = self.capture_status()
        require(status.get("captureId") == capture_id, "Requested image is unavailable; capture again", 409)
        require(status["status"] == "ready", status.get("error") or "Image is not ready; capture and preview it first", 409)
        return copy.deepcopy(self.capture["image"]), copy.deepcopy(self.capture["snapshot"])

    def arm_voice_capture(self, body):
        require(set(body) == {"captureId"}, "Expected captureId for the next voice request")
        with self.lock:
            if body["captureId"] is not None:
                self.selected_capture(body["captureId"])
            self.voice_capture_id = body["captureId"]
            return self.capture_status()

    def queue(self, raw_commands):
        require(isinstance(raw_commands, list) and 0 < len(raw_commands) <= MAX_BATCH,
                f"Expected 1-{MAX_BATCH} commands")
        checked = [command(item) for item in raw_commands]
        with self.lock:
            self.expire()
            require(not self.learning or not self.learning.restore, "Finish the pending lesson restore before editing", 409)
            require(self.online(), "Headset client is offline", 409)
            require(self.latest is not None, self.room_unavailable_message(), 409)
            require(not self.content.busy(), "Wait for content installation before editing", 409)
            room = self.runtime
            for item in checked:
                supported = self.latest.get("behaviorKinds", [])
                if item["op"] in {"set_behavior", "remove_behavior"}:
                    require(bool(supported), "Connected player does not support behaviors; update the Quest app", 409)
                    kind = item["behavior"]["kind"] if item["op"] == "set_behavior" else item["behaviorKind"]
                    require(kind == "all" or kind in supported, "Connected player does not support this behavior", 409)
                    require(item["objectId"] in {obj["objectId"] for obj in self.latest["scene"]["objects"]},
                            "Behavior target object is unavailable", 409)
                    if item["op"] == "set_behavior" and kind == "select_toggle":
                        target = next(obj for obj in self.latest["scene"]["objects"] if obj["objectId"] == item["objectId"])
                        asset = next((asset for asset in self.latest["assets"] if asset["assetId"] == target["assetId"]), None)
                        require(asset is not None and asset.get("interactionMode") in ("light", "hinge"),
                                "This prefab has no selectable interaction", 409)
                elif item["op"] in {"attach_component", "stop_component", "remove_component"}:
                    require(self.latest.get("componentSchemaVersion") == 1,
                            "Connected runtime does not support components", 409)
                    require((self.latest.get("roomContext") or {}).get("mode") == "white-room",
                            "Components currently require the virtual room", 409)
                elif item["op"] == "load":
                    require(all(behavior["kind"] in supported for obj in item["scene"]["objects"]
                                for behavior in obj.get("behaviors", [])),
                            "Saved behaviors need an updated Quest app; scene has not been loaded", 409)
                    require(self.latest.get("componentSchemaVersion") == 1 or
                            not any("component" in obj for obj in item["scene"]["objects"]),
                            "Saved components need the WebXR runtime; scene has not been loaded", 409)
                if self.latest.get("readOnly"):
                    require(item["op"] in {"clear", "get_scene", "list_assets", "list_targets"},
                            "Room changed. Save the retained poses, clear objects, then reload room data and verify outlines", 409)
                if item["op"] == "confirm_room":
                    require(room and room["mode"] == "ar" and room["state"] == "ready",
                            "Load a real room and inspect its outlines before confirming alignment", 409)
                elif room and room["mode"] == "ar" and not room.get("alignmentVerified"):
                    require(item["op"] in {"clear", "select", "get_scene", "list_assets", "list_targets"},
                            "Check the labeled outlines in the headset, then confirm room alignment on this panel", 409)
            require(len(self.pending) + len(checked) <= MAX_PENDING, "Command queue full", 409)
            for item in checked:
                item["requestId"] = uuid.uuid4().hex
                self.pending[item["requestId"]] = item
            self.revision += 1
            return {"commands": copy.deepcopy(checked)}

    def agent_move(self, value):
        """Queue one virtual-floor move through the normal Matrix command path."""
        require(isinstance(value, dict) and set(value) ==
                {"room_id", "scene_revision", "object_id", "expected_asset_id", "position"},
                "Invalid Matrix move request")
        room_id = text(value["room_id"], "room_id")
        object_id = text(value["object_id"], "object_id")
        asset_id = text(value["expected_asset_id"], "expected_asset_id")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid scene revision")
        require(isinstance(value["position"], dict) and set(value["position"]) == {"x", "y", "z"},
                "Invalid Matrix move position")
        position = vector(value["position"], "position")
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            current = self.latest
            require(current["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require((current.get("roomContext") or {}).get("mode") == "white-room",
                    "This Matrix tool currently moves virtual-room objects only", 409)
            require(not current.get("readOnly") and not self.pending,
                    "Matrix world is not ready for a new move", 409)
            item = next((item for item in current["scene"]["objects"] if item["objectId"] == object_id), None)
            require(item is not None and item["assetId"] == asset_id and item["anchorId"] == "web-floor",
                    "The requested virtual-floor object is no longer available", 409)
            transform = copy.deepcopy(item["transform"])
            transform["position"] = position
            queued = self.queue([{"op": "set_transform", "objectId": object_id,
                                  "transform": transform}])["commands"][0]
            request_id = queued["requestId"]
            self.agent_move_ids[request_id] = {"roomId": room_id, "objectId": object_id,
                                               "position": position}
            while len(self.agent_move_ids) > 64:
                self.agent_move_ids.popitem(last=False)
            return self.agent_move_status(request_id)

    def agent_move_status(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[0-9a-f]{32}", request_id),
                "Invalid Matrix move receipt ID")
        with self.lock:
            self.expire()
            issued = self.agent_move_ids.get(request_id)
            require(issued is not None, "Matrix move receipt is unavailable", 404)
            receipt = next((item for item in reversed(self.results) if item["requestId"] == request_id), None)
            result = {"requestId": request_id, "roomId": issued["roomId"],
                      "objectId": issued["objectId"], "sceneRevision": self.revision}
            if receipt is None:
                result["status"] = "queued" if request_id in self.pending else "unconfirmed"
            elif receipt["ok"]:
                observed = self.latest and self.latest["scene"]["roomId"] == issued["roomId"] and next(
                    (item for item in self.latest["scene"]["objects"]
                     if item["objectId"] == issued["objectId"] and
                     item["transform"]["position"] == issued["position"]), None)
                result["status"] = "succeeded" if observed else "unconfirmed"
            elif "outcome unknown" in receipt["error"]:
                result["status"] = "unconfirmed"
            else:
                result["status"] = "failed"
                result["error"] = receipt["error"][:200]
            return result

    def agent_list_assets(self, offset=0, limit=24):
        require(type(offset) is int and 0 <= offset <= 255 and type(limit) is int and 1 <= limit <= 24,
                "Invalid Matrix asset page")
        items = self.web_assets.list()
        return {"total": len(items), "offset": offset,
                "assets": [{key: item[key] for key in
                            ("assetId", "displayName", "sha256", "byteLength", "geometry", "spawnScale", "localBounds")
                            if key in item} for item in items[offset:offset + limit]]}

    def agent_register_glb(self, value):
        """Stage exact PC-local bytes and use the existing GLB validator/catalog."""
        require(isinstance(value, dict) and set(value) ==
                {"source_path", "expected_sha256", "name", "description", "spawn_scale", "local_bounds"},
                "Invalid Matrix GLB registration")
        source_name = text(value["source_path"], "source_path", limit=1024)
        digest = value["expected_sha256"]
        require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest),
                "Invalid expected GLB digest")
        source = Path(source_name)
        require(source.is_absolute() and not str(source.drive).startswith("\\\\") and
                source.suffix.lower() == ".glb" and not source.is_symlink() and source.is_file(),
                "Use an existing local PC .glb file", 400)
        staged = None
        try:
            digest_reader = hashlib.sha256()
            size = 0
            with source.open("rb") as original, tempfile.NamedTemporaryFile(
                    dir=self.directory, prefix=".agent-glb-", suffix=".glb", delete=False) as temporary:
                staged = Path(temporary.name)
                while chunk := original.read(128 * 1024):
                    size += len(chunk)
                    require(size <= MAX_GLB_BYTES, "GLB exceeds 16 MiB", 413)
                    digest_reader.update(chunk)
                    temporary.write(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
            require(digest_reader.hexdigest() == digest,
                    "GLB changed since Codex identified it; inspect and retry", 409)
            # The catalog treats a supplied scale as an update on duplicate IDs.
            # A default registration should not reset an existing asset's scale.
            scale = (None if type(value["spawn_scale"]) in (int, float) and
                     value["spawn_scale"] == 1 else value["spawn_scale"])
            entry = self.web_assets.register(staged, value["name"], value["description"],
                                             scale, value["local_bounds"])
            return {"status": "registered", "assetId": entry["assetId"],
                    "sha256": entry["sha256"], "byteLength": entry["byteLength"],
                    "displayName": entry["displayName"], "geometry": entry["geometry"],
                    "spawnScale": entry["spawnScale"],
                    **({"localBounds": entry["localBounds"]} if "localBounds" in entry else {})}
        finally:
            if staged is not None:
                staged.unlink(missing_ok=True)

    def status(self):
        with self.lock:
            self.expire()
            return {"online": self.online(), "clientId": self.client_id, "revision": self.revision,
                    "contentLibrary": True, "snapshot": copy.deepcopy(self.latest),
                    "runtime": copy.deepcopy(self.runtime),
                    "pendingCount": len(self.pending), "results": copy.deepcopy(list(self.results)),
                    "capture": self.capture_status(),
                    "voice": voice_status(self) if self.voice_jobs else None}

    def room_unavailable_message(self):
        if self.online() and self.runtime and self.runtime.get("mode") == "ar":
            return "Room unavailable: " + (self.runtime.get("message") or self.runtime["state"])
        return "Headset client is offline"

    def path(self, name):
        require(isinstance(name, str) and NAME.fullmatch(name) is not None,
                "Scene name must be 1-64 letters, digits, spaces, hyphens or underscores; start with a letter or digit")
        # Reject Windows device names, including when this is run on another platform.
        require(name.upper() not in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(1, 10)],
                                    *[f"LPT{i}" for i in range(1, 10)]}, "Reserved scene name")
        target = self.directory / (name + ".json")
        require(not target.is_symlink(), "Scene links are not supported")
        return target

    def save(self, name):
        target = self.path(name)
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            require(not self.pending, "Wait for all queued commands to finish before saving", 409)
            saved = copy.deepcopy(self.latest)
            saved.pop("viewer", None)
            saved.pop("pointing", None)
            saved.pop("roomContext", None)
            saved.pop("readOnly", None)
            saved.pop("behaviorKinds", None)  # Capability belongs to the connected player, not the save.
            if self.learning:
                require(not self.learning.restore, "Finish the pending lesson restore before saving", 409)
                checkpoint = self.learning.checkpoint(self)
                if checkpoint is not None:
                    saved["learningCheckpoint"] = checkpoint
            data = json.dumps(saved, ensure_ascii=False, allow_nan=False, indent=2).encode("utf-8")
            require(len(data) <= MAX_BODY, "Scene exceeds save size limit", 413)
            tmp = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.directory, prefix=".saving-", delete=False) as handle:
                    tmp = handle.name
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp, target)
                tmp = None
            finally:
                if tmp is not None:
                    os.unlink(tmp)
            return {"name": name, "saved": True}

    def load(self, name, request_id=None):
        target = self.path(name)
        require(target.is_file(), "Scene not found", 404)
        with target.open("rb") as handle:
            data = handle.read(MAX_BODY + 1)
        require(len(data) <= MAX_BODY, "Saved scene exceeds size limit", 413)
        document = parse_json(data)
        saved = snapshot(document)
        with self.lock:
            if self.learning:
                request_id = identifier(request_id or uuid.uuid4().hex, "requestId")
                prior = self.learning.restore_receipts.get(request_id)
                if prior:
                    require(prior["name"] == name, "requestId already used for another load", 409)
                    return copy.deepcopy(prior["response"])
                require(not self.pending, "Wait for room commands before loading", 409)
                require(not self.learning.restore, "Finish or dismiss the pending restore first", 409)
                checkpoint_id = self.learning.prepare_restore(document)
            else:
                require("learningCheckpoint" not in document, "Learning adapter is required to restore this scene", 503)
            response = self.queue([{"op": "load", "scene": saved["scene"]}])
            if self.learning:
                # Scene-only loads with no active lesson need no checkpoint barrier.
                # In particular, a rejected load must not lock ordinary editing behind learning recovery.
                if checkpoint_id is not None or self.learning.session is not None:
                    self.learning.restore = {"commandId": response["commands"][0]["requestId"],
                                             "checkpointId": checkpoint_id, "requestId": request_id,
                                             "scene": copy.deepcopy(saved["scene"])}
                self.learning.restore_receipts[request_id] = {"name": name, "response": copy.deepcopy(response)}
                if len(self.learning.restore_receipts) > 128:
                    del self.learning.restore_receipts[next(iter(self.learning.restore_receipts))]
            return response

    def scenes(self):
        return {"scenes": sorted(p.stem for p in self.directory.glob("*.json")
                                 if NAME.fullmatch(p.stem) and p.is_file() and not p.is_symlink())}

    def apply_plan(self, plan_id):
        text(plan_id, "planId")
        with self.lock:
            self.expire()
            proposal = self.proposals.pop(plan_id, None)
            require(proposal is not None, "Proposal expired or already applied; create a new proposal", 409)
            require(self.online() and not self.pending, "Runtime must be connected with no pending commands", 409)
            require(proposal["clientId"] == self.client_id and proposal["revision"] == self.revision
                    and self.clock() <= proposal["expires"],
                    "Scene or selection changed; create a new proposal", 409)
            commands = proposal["commands"]
            if commands[0]["op"] == "save_scene":
                return self.save(commands[0]["name"])
            if commands[0]["op"] == "load_scene":
                return self.load(commands[0]["name"])
            return self.queue(commands)


def wants_blender_asset(prompt):
    """Route creation requests to asset authoring; scene layout stays with the planner."""
    if not isinstance(prompt, str) or not re.search(r"\b(create|make|build|generate|model|sculpt|design)\b", prompt, re.I):
        return False
    return bool(re.search(r"\b(blender|blend|3d model|3d asset|mesh|new prefab|new model)\b", prompt, re.I))


_BLENDER_SESSION_SELECTION = object()


def blender_codex_config(state, selection=_BLENDER_SESSION_SELECTION):
    try:
        config = CodexConfig.from_environment()
        require(config is not None, "Configure the PC Codex CLI before creating a Blender asset", 503)
        config.validate()
        if selection is _BLENDER_SESSION_SELECTION:
            with state.lock:
                selection = copy.deepcopy(state.codex_preferences)
        return select_codex_config(config, selection)
    except CodexProviderError as error:
        raise APIError(error.status, str(error)) from None


def plan(state, body, request_context=None, content_stage=0, progress=None, cancelled=None):
    def check_cancelled():
        require(cancelled is None or not cancelled(), "Voice request cancelled", 409)

    check_cancelled()
    require(isinstance(body, dict), "Expected plan object")
    experiment = body.get("kind") == "block-scale"
    prompt = None if experiment else text(body.get("text"), "text", limit=4000)
    prior_turns = conversation(body.get("conversation"))
    web_runtime = body.get("webRuntime", False)
    require(type(web_runtime) is bool, "Invalid webRuntime flag")
    mode = body.get("mode")
    require(mode in (None, "offline-rules", "openai-compatible", "codex-cli"), "Invalid planner mode")
    # Asset creation is independent of the current AR plane pose. Start its
    # bounded PC job before scene-revision checks so tracking updates cannot
    # invalidate a spoken authoring request during transcription.
    if (not experiment and "captureId" not in body and mode != "offline-rules" and
            not (web_runtime and wants_game(prompt)) and wants_blender_asset(prompt)):
        check_cancelled()
        try:
            selection = body["codex"] if "codex" in body else _BLENDER_SESSION_SELECTION
            config = blender_codex_config(state, selection)
            job = state.blender_authoring.submit({"prompt": prompt}, config)
        except BlenderAuthoringError as error:
            raise APIError(error.status, str(error)) from None
        return {"status": "authoring", "authoringJobId": job["jobId"], "commands": [],
                "requiresApply": False, "summary": "Creating a new asset in Blender on the PC…"}
    with state.lock:
        state.expire()
        require(state.online() and state.latest is not None, state.room_unavailable_message(), 409)
        require(not state.latest.get("readOnly"), state.room_unavailable_message(), 409)
        require(not state.pending, "Wait for queued commands before creating a proposal", 409)
        require(not state.content.busy(), "Wait for content installation before creating a proposal", 409)
        current = copy.deepcopy(state.latest)
        client_id, revision = state.client_id, state.revision
        saved_names = state.scenes()["scenes"]
        if request_context is not None:
            require((client_id, revision) == request_context[:2], "Scene or selection changed during the request; try again", 409)
            current = copy.deepcopy(request_context[2])
        codex = copy.deepcopy(body.get("codex", state.codex_preferences))
        screenshot = None
        if "captureId" in body:
            screenshot, current = state.selected_capture(body["captureId"])
    if web_runtime and not experiment and wants_game(prompt):
        require(current["scene"]["roomId"].startswith("web"), "Game planning requires the browser runtime", 409)
        require(mode == "codex-cli", "Choose Codex AI on the PC to build a game", 422)
        require(screenshot is None, "Create the game separately from visual review", 422)
        check_cancelled()
        if prior_turns:
            current["conversation"] = prior_turns
        try:
            game = design_game(prompt, current, codex)
        except GamePlanError as error:
            raise APIError(error.status, str(error)) from None
        check_cancelled()
        with state.lock:
            state.expire()
            require(state.online() and state.client_id == client_id and state.revision == revision
                    and not state.pending, "Scene changed during game planning; try again", 409)
        if game["kind"] == "unsupported":
            return {"status": "needs_clarification", "requiresApply": False,
                    "commands": [], "summary": game["summary"]}
        return {"status": "ready", "requiresApply": True, "commands": [],
                "gamePlan": game, "summary": game["summary"]}
    try:
        options = {"codex": codex} if codex is not None else {}
        if prior_turns:
            options["conversation"] = prior_turns
        candidates = state.content.planner_context(prompt if mode in ("codex-cli", "openai-compatible") else "",
                                                   current.get("assets"))
        if candidates:
            options["catalog_context"] = candidates
        if screenshot is not None:
            options["screenshot"] = screenshot
        proposed = (scale_experiment.plan(body, current, request_context[3] if request_context is not None and len(request_context) > 3 else None)
                    if experiment else Planner().plan(prompt, current, saved_scenes=saved_names, mode=mode, **options))
    except PlannerError as error:
        raise APIError(error.status, str(error)) from None
    check_cancelled()
    values = proposed.get("commands")
    content_requests = proposed.get("contentRequests", [])
    if content_requests and content_stage:
        return {**proposed, "commands": [], "contentRequests": [], "requiresApply": False,
                "status": "needs_clarification",
                "summary": "The first content batch is installed. Ask for another scene proposal to add further packs."}
    if content_requests:
        require(not experiment and screenshot is None and mode != "offline-rules" and content_stage == 0,
                "Content installation needs a fresh AI request", 422)
        original_scene = current["scene"]
        original_room = current.get("roomContext")
        deadline = time.monotonic() + 180
        installed = []
        for item in content_requests:
            check_cancelled()
            with state.lock:
                state.expire()
                require(state.online() and state.client_id == client_id and state.latest is not None and
                        state.latest["scene"] == original_scene and state.latest.get("roomContext") == original_room,
                        "Room or scene changed during content installation; request a new proposal", 409)
                existing = any(asset.get("source", {}).get("providerId") == item["providerId"] and
                               asset.get("source", {}).get("packId") == item["assetId"] and
                               asset.get("source", {}).get("version") == item["version"]
                               for asset in state.latest["assets"])
            if existing:
                continue
            if progress:
                progress("planning", "Installing " + item["assetId"] + " into the Quest catalog")
            job = state.content.queue_install(item)
            while True:
                with state.lock:
                    state.content.expire()
                    current_job = state.content.jobs.get(job["requestId"])
                    phase = current_job["phase"] if current_job else "error"
                    error = current_job.get("error", "") if current_job else "Installation job disappeared"
                if cancelled is not None and cancelled():
                    if phase == "preparing":
                        try:
                            state.content.cancel(job["requestId"])
                        except ContentError:
                            pass  # The runtime may have started installation during cancellation.
                    check_cancelled()
                if phase == "ready":
                    installed.append(item)
                    break
                require(phase in ("preparing", "installing"),
                        "Content installation failed: " + error, 409)
                require(time.monotonic() < deadline, "Content installation timed out; check the Quest connection", 504)
                time.sleep(.1)
        require(installed or content_requests, "No compatible content was selected", 422)
        if progress:
            progress("planning", "Arranging installed prefabs")
        instruction = " Use the newly installed prefabs to compose the scene now; do not request more packs."
        next_body = {**body, "text": prompt + instruction if len(prompt) + len(instruction) <= 4000 else prompt}
        result = plan(state, next_body, content_stage=1, progress=progress, cancelled=cancelled)
        result["installedContent"] = installed
        return result
    if screenshot is not None:
        proposed["screenshot"] = {key: value for key, value in screenshot.items() if key != "dataBase64"}
    check_cancelled()
    require(isinstance(values, list) and len(values) <= MAX_BATCH, "Invalid proposal", 502)
    if not values:
        require(proposed.get("requiresApply") is False and proposed.get("status") in ("needs_clarification", "review_only"),
                "Invalid empty proposal", 502)
        with state.lock:
            state.expire()
            require(state.online() and state.client_id == client_id and state.revision == revision
                    and not state.pending, "Scene changed during planning; try again", 409)
        # A clarification is information only. It never receives an executable plan ID.
        return {**proposed, "commands": [], "requiresApply": False}
    persistence = [item for item in values if item.get("op") in ("save_scene", "load_scene")]
    if persistence:
        require(len(values) == 1, "Save/load must be a separate proposal after edits finish", 422)
        item = values[0]
        state.path(item.get("name"))
        require(item["op"] != "load_scene" or item["name"] in saved_names, "Saved scene not found", 404)
        checked = [{"op": item["op"], "name": item["name"]}]
    else:
        checked = [command(item) for item in values]
        require(all(item["op"] not in {"load", "confirm_room"} for item in checked),
                "Planner cannot invent a scene document or confirm physical alignment", 502)
    with state.lock:
        state.expire()
        require(state.online() and state.client_id == client_id and state.revision == revision
                and not state.pending, "Scene changed during planning; try again", 409)
        plan_id = uuid.uuid4().hex
        state.proposals[plan_id] = {"clientId": client_id, "revision": revision,
                                    "expires": state.clock() + 120, "commands": copy.deepcopy(checked)}
        while len(state.proposals) > 16:
            state.proposals.popitem(last=False)
    result = {**proposed, "commands": checked, "planId": plan_id, "requiresApply": True}
    if "viewer" in current:
        result["viewerAtRequest"] = copy.deepcopy(current["viewer"])
    if "pointing" in current:
        result["pointingAtRequest"] = copy.deepcopy(current["pointing"])
    return result


def client_planner_modes(state):
    """Advertise only the owner's validated configuration, without its details.

    Configuration validation does not prove login, quota, or provider health.
    The existing planner performs those checks when a request runs.
    """
    modes = ["offline-rules"]
    try:
        config = CodexConfig.from_environment()
        if config is None:
            return modes
        config.validate()
        with state.lock:
            preferences = copy.deepcopy(state.codex_preferences)
        select_codex_config(config, preferences)
    except CodexProviderError:
        return modes
    return [*modes, "codex-cli"]


def planner_status(state):
    with state.lock:
        preferences = copy.deepcopy(state.codex_preferences)
    return {**Planner().public_status(), "codexOptions": codex_options(),
            "codexPreferences": preferences, "speech": speech.public_status()}


def planner_preferences(state, body):
    require(set(body) == {"codex"}, "Expected Codex preferences")
    try:
        config = CodexConfig.from_environment()
        require(config is not None, "Configure Codex before selecting its model or reasoning effort.", 503)
        config.validate()
        select_codex_config(config, body["codex"])
    except CodexProviderError as error:
        raise APIError(error.status, str(error)) from None
    with state.lock:
        state.codex_preferences = copy.deepcopy(body["codex"])
        return {"codex": copy.deepcopy(state.codex_preferences)}


def voice_status(state, job_id=None):
    with state.lock:
        if job_id is None:
            job_id = next(reversed(state.voice_jobs), None)
        job = state.voice_jobs.get(job_id)
        require(job is not None, "Voice request not found", 404)
        if job["public"]["phase"] == "ready" and "gamePlan" in job["public"]:
            if (not state.online() or state.client_id != job["clientId"] or state.revision != job["revision"]
                    or state.clock() > job.get("gameExpires", 0)):
                job["public"].update(phase="error", requiresApply=False,
                                     error="World changed or game proposal expired. Speak again.")
        elif job["public"]["phase"] == "ready" and job["public"].get("planId") not in state.proposals:
            job["public"].update(phase="finished", requiresApply=False)
        if job["public"]["phase"] == "ready" and "gamePlan" not in job["public"]:
            proposal = state.proposals[job["public"]["planId"]]
            if (not state.online() or state.client_id != job["clientId"] or state.revision != job["revision"]
                    or state.clock() > proposal["expires"]):
                state.proposals.pop(job["public"]["planId"], None)
                job["public"].update(phase="error", requiresApply=False, error="Scene or selection changed, or proposal expired. Speak again.")
        return copy.deepcopy(job["public"])


def cancel_voice(state, body):
    with state.lock:
        job = state.voice_jobs.get(body.get("jobId"))
        require(job is not None, "Voice request not found", 404)
        require(job["clientId"] == body.get("clientId"), "Voice request belongs to another client", 409)
        job["cancelled"] = True
        state.proposals.pop(job["public"].get("planId"), None)
        job["public"].update(phase="error", requiresApply=False, error="Voice request cancelled.")
        return {"cancelled": True}


def start_voice(state, body):
    client_id = text(body.get("clientId"), "clientId")
    prior_turns = conversation(body.get("conversation"))
    captured = snapshot(body.get("snapshot"))
    audio = speech.decode_audio(body.get("audioBase64"))
    speech.configuration()
    # Voice must use a real configured planner. It never falls back to offline rules.
    provider = Planner().public_status()
    require(provider["configured"] and provider["mode"] == "codex-cli", "Configure Codex on the PC before using voice.", 503)
    with state.lock:
        state.expire()
        require(state.online() and state.client_id == client_id, "Voice client is not connected", 409)
        require(not state.pending, "Wait for queued commands before speaking", 409)
        require(scene_revision_data(captured) == scene_revision_data(state.latest),
                "Scene or selection changed while recording; point and speak again", 409)
        voice_capture_id = state.voice_capture_id
        voice_screenshot = None
        if voice_capture_id is not None:
            voice_screenshot, _ = state.selected_capture(voice_capture_id)
        require(state.voice_worker.acquire(blocking=False), "Speech recognition is still busy; try again shortly", 409)
        state.voice_capture_id = None
        job_id = uuid.uuid4().hex
        public = {"jobId": job_id, "phase": "transcribing", "transcript": "", "requiresApply": False}
        if voice_screenshot is not None:
            public["screenshot"] = {key: value for key, value in voice_screenshot.items() if key != "dataBase64"}
        job = {"public": public, "clientId": client_id, "revision": state.revision, "cancelled": False}
        state.voice_jobs[job_id] = job
        while len(state.voice_jobs) > 4:
            _, old = state.voice_jobs.popitem(last=False)
            state.proposals.pop(old["public"].get("planId"), None)
        context = (client_id, state.revision, captured)
        preferences = copy.deepcopy(state.codex_preferences)

    def run():
        try:
            transcript = speech.transcribe(audio)
            with state.lock:
                if job["cancelled"]:
                    return
                public.update(phase="planning", transcript=transcript)
            request = {"text": transcript, "mode": "codex-cli", "codex": preferences,
                       "conversation": prior_turns, "webRuntime": body.get("webRuntime", False)}
            if voice_capture_id is not None:
                request["captureId"] = voice_capture_id
            def progress(phase, detail):
                with state.lock:
                    if not job["cancelled"]:
                        public.update(phase=phase, progress=detail)
            result = plan(state, request, request_context=context, progress=progress,
                          cancelled=lambda: job["cancelled"])
            with state.lock:
                if job["cancelled"]:
                    state.proposals.pop(result.get("planId"), None)
                    return
                job["revision"] = state.revision
                public.update(result)
                public["phase"] = "ready" if result.get("requiresApply") else result.get("status", "needs_clarification")
                if "gamePlan" in result:
                    job["gameExpires"] = state.clock() + 120
        except (APIError, ContentError, speech.SpeechError, PlannerError) as error:
            with state.lock:
                if not job["cancelled"]:
                    public.update(phase="error", error=str(error), errorStatus=error.status, requiresApply=False)
        except Exception:
            with state.lock:
                if not job["cancelled"]:
                    public.update(phase="error", error="Voice processing failed. Try again or use text input.", requiresApply=False)
        finally:
            state.voice_worker.release()

    try:
        threading.Thread(target=run, name="sandbox-voice", daemon=True).start()
    except RuntimeError:
        with state.lock:
            state.voice_jobs.pop(job_id, None)
        state.voice_worker.release()
        raise APIError(503, "Speech worker could not start. Try again shortly.") from None
    return {"jobId": job_id, "phase": "transcribing"}


class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, state, token=""):
        self.is_loopback = loopback(address[0])
        self.scheme = "http"
        require(self.is_loopback or len(token) >= 24, "Non-loopback binding requires SANDBOX_TOKEN of at least 24 characters")
        self.state, self.token = state, token
        self.quest_connection = QuestConnection()
        super().__init__(address, Handler)

    def server_close(self):
        self.state.agent_portal.close()
        if self.state.matrix_tool_bridge is not None:
            self.state.matrix_tool_bridge.close()
            self.state.matrix_tool_bridge = None
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    server_version = "ARSandbox/1"
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_):
        pass  # URLs, headers, prompt text and tokens never enter request logs.

    def send_data(self, status, data, content_type="application/json; charset=utf-8"):
        raw = data if isinstance(data, bytes) else json.dumps(data, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(raw)

    def validate_host(self):
        host = self.headers.get("Host", "")
        require(bool(host) and len(host) <= 255 and "/" not in host and "@" not in host, "Invalid Host", 400)
        try:
            parsed = urllib.parse.urlsplit("http://" + host)
            hostname, port = parsed.hostname, parsed.port
        except ValueError:
            raise APIError(400, "Invalid Host") from None
        require(hostname and port in (None, self.server.server_port), "Invalid Host", 400)
        require(not self.server.is_loopback or loopback(hostname), "Host is not allowed", 403)
        return host.lower()

    def authenticate(self):
        if self.server.token:
            expected = "Bearer " + self.server.token
            require(hmac.compare_digest(self.headers.get("Authorization", "").encode("utf-8"),
                                        expected.encode("utf-8")), "Authentication required", 401)

    def client_api(self, path, method, body=None):
        require(loopback(self.client_address[0]), "Client API requires a companion on this PC", 403)
        origin = self.headers.get("Origin")
        require(origin is None or origin.lower() == self.server.scheme + "://" + self.headers.get("Host", "").lower(),
                "Cross-origin client API access is unsupported", 403)
        require(not urllib.parse.urlsplit(self.path).query, "Client API does not accept query parameters")
        if not path.startswith("/api/v1/"):
            raise ClientError(426, "unsupported_version", "Supported client API version: 1")
        clients = self.server.state.clients
        configured = len(self.server.token) >= 24
        if path == "/api/v1/discovery" and method == "GET":
            return clients.discovery(configured)
        if not configured:
            raise ClientError(503, "pairing_disabled", "Configure SANDBOX_TOKEN with at least 24 characters before pairing clients.")
        if path == "/api/v1/sessions" and method == "POST":
            return clients.claim(body)
        if path == "/api/v1/pairings" or path.startswith("/api/v1/operator"):
            self.authenticate()
            if path == "/api/v1/pairings" and method == "POST":
                return clients.pair(body)
            if path == "/api/v1/operator" and method == "GET":
                return clients.operator_status()
            parts = [urllib.parse.unquote(part) for part in path.split("/")]
            if method == "POST":
                require(body == {}, "Operator client actions expect an empty JSON object")
                if len(parts) == 7 and parts[4] == "sessions" and parts[6] == "revoke":
                    return clients.revoke(parts[5])
                if len(parts) == 8 and parts[4] == "requests" and parts[7] in {"apply", "cancel"}:
                    if parts[7] == "apply":
                        return clients.apply(parts[5], parts[6])
                    return clients.cancel(clients.operator_session(parts[5]), parts[6])
            raise ClientError(404, "not_found", "Client API route not found")
        session = clients.authenticate(self.headers.get("Authorization", ""))
        if path == "/api/v1/scene" and method == "GET":
            return clients.scene(session)
        if path == "/api/v1/requests" and method == "POST":
            return clients.propose(session, body)
        parts = [urllib.parse.unquote(part) for part in path.split("/")]
        if len(parts) == 5 and parts[3] == "requests" and method == "GET":
            return clients.get_request(session, parts[4])
        if len(parts) == 6 and parts[3] == "requests" and parts[5] == "cancel" and method == "POST":
            require(body == {}, "Cancel expects an empty JSON object")
            return clients.cancel(session, parts[4])
        raise ClientError(404, "not_found", "Client API route not found")

    def send_api_error(self, error):
        data = {"error": str(error)}
        if client_api_path(urllib.parse.urlsplit(self.path).path):
            data.update(protocolVersion="1", code=getattr(error, "code", "request_rejected"))
        self.send_data(error.status, data)

    def do_GET(self):
        try:
            self.validate_host()
            path = urllib.parse.urlsplit(self.path).path
            if path in ("/web", "/web/") or path.startswith("/web/assets/"):
                dist = Path(__file__).resolve().parent.parent / "WebRuntime" / "dist"
                if path in ("/web", "/web/"):
                    asset = dist / "index.html"
                    content_type = "text/html; charset=utf-8"
                else:
                    name = path[len("/web/assets/"):]
                    require(bool(re.fullmatch(r"[A-Za-z0-9._-]+", name)), "Invalid web asset", 404)
                    asset = dist / "assets" / name
                    content_type = "text/javascript; charset=utf-8" if name.endswith(".js") else "text/css; charset=utf-8" if name.endswith(".css") else "application/octet-stream"
                require(asset.is_file(), "Build WebRuntime with npm run build first", 404)
                self.send_data(200, asset.read_bytes(), content_type)
                return
            if path in ("/", "/learning", "/content", "/clients") and loopback(self.client_address[0]):
                page = "index.html" if path == "/" else "content.html" if path == "/content" else "clients.html" if path == "/clients" else "learning.html"
                self.send_data(200, Path(__file__).with_name(page).read_bytes(), "text/html; charset=utf-8")
                return
            if path == "/learning-ui.js" and loopback(self.client_address[0]):
                self.send_data(200, Path(__file__).with_name("learning-ui.js").read_bytes(), "text/javascript; charset=utf-8")
                return
            if client_api_path(path):
                self.send_data(200, self.client_api(path, "GET"))
                return
            self.authenticate()
            if path == "/api/state":
                data = self.server.state.status()
            elif path == "/api/web/assets":
                try:
                    data = {"assets": self.server.state.web_assets.list()}
                except WebAssetError as error:
                    raise APIError(500, str(error)) from None
            elif path == "/api/web/authoring":
                data = self.server.state.web_authoring.status()
            elif path.startswith("/api/web/authoring/"):
                data = self.server.state.web_authoring.status(path.rsplit("/", 1)[1])
            elif path == "/api/web/blender":
                data = self.server.state.blender_authoring.status()
            elif path.startswith("/api/web/blender/"):
                data = self.server.state.blender_authoring.status(path.rsplit("/", 1)[1])
            elif path.startswith("/api/web/assets/"):
                name = path[len("/api/web/assets/"):]
                require(bool(re.fullmatch(r"[0-9a-f]{64}\.glb", name)), "Unknown web asset", 404)
                try:
                    asset = self.server.state.web_assets.file(name[:-4])
                except WebAssetError as error:
                    raise APIError(404, str(error)) from None
                self.send_data(200, asset.read_bytes(), "model/gltf-binary")
                return
            elif path == "/api/content":
                data = self.server.state.content.status()
            elif path.startswith("/api/content/files/"):
                asset = self.server.state.content.catalog.cached_file(path.rsplit("/", 1)[1])
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(asset.stat().st_size))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with asset.open("rb") as source:
                    while chunk := source.read(128 * 1024):
                        self.wfile.write(chunk)
                return
            elif path == "/api/capture":
                data = self.server.state.capture_status(include_image=True)
            elif path == "/api/scenes":
                data = self.server.state.scenes()
            elif path == "/api/planner":
                data = planner_status(self.server.state)
            elif path.startswith("/api/voice/"):
                data = voice_status(self.server.state, path.rsplit("/", 1)[1])
            elif path in ("/api/lessons", "/api/learning"):
                require(self.server.state.learning is not None, "Learning adapter unavailable", 503)
                if path == "/api/lessons":
                    with self.server.state.lock:
                        data = self.server.state.learning.catalog()
                else:
                    with self.server.state.lock:
                        self.server.state.expire()
                        data = self.server.state.learning.status(self.server.state)
            elif path == "/api/health":
                data = {"ok": True}
            else:
                raise APIError(404, "Not found")
            self.send_data(200, data)
        except (WebAuthoringError, BlenderAuthoringError) as error:
            self.send_api_error(APIError(error.status, str(error)))
        except (APIError, LearningError, ContentError, ClientError) as error:
            self.send_api_error(error)
        except PlannerError as error:
            self.send_data(error.status, {"error": str(error)})
        except (OSError, ValueError):
            self.send_api_error(APIError(500, "Service I/O error"))

    def do_POST(self):
        try:
            host = self.validate_host()
            path = urllib.parse.urlsplit(self.path).path
            if not client_api_path(path):
                self.authenticate()
            origin = self.headers.get("Origin")
            require(origin is None or origin.lower() == self.server.scheme + "://" + host,
                    "Cross-origin mutation rejected", 403)
            require(self.headers.get_content_type() == "application/json", "Content-Type must be application/json", 415)
            require(not self.headers.get("Transfer-Encoding"), "Transfer encoding is unsupported", 400)
            try:
                size = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                raise APIError(400, "Invalid Content-Length") from None
            path = urllib.parse.urlsplit(self.path).path
            limit = MAX_EXCHANGE_BODY if path == "/api/exchange" else 16384 if client_api_path(path) else MAX_BODY
            require(0 < size <= limit, f"Body must be 1 byte to {limit // 1024} KiB", 413)
            raw = self.rfile.read(size)
            require(len(raw) == size, "Incomplete request body")
            body = parse_json(raw)
            require(isinstance(body, dict), "Expected JSON object")
            path = urllib.parse.urlsplit(self.path).path
            state = self.server.state
            if client_api_path(path):
                data = self.client_api(path, "POST", body)
            elif path == "/api/exchange":
                data = state.exchange(body)
            elif path == "/api/runtime/reconnect":
                require(loopback(self.client_address[0]), "Quest reconnect is available only on this PC", 403)
                require(not body and not urllib.parse.urlsplit(self.path).query, "Reconnect expects an empty JSON object")
                data = self.server.quest_connection.reconnect(self.server.server_port, state.online)
            elif path.startswith("/api/content/"):
                data = state.content.post(path, body)
            elif path == "/api/web/authoring":
                data = state.web_authoring.submit(body)
            elif path == "/api/web/blender":
                data = state.blender_authoring.submit(body, blender_codex_config(state))
            elif path.startswith("/api/agent/"):
                data = agent_portal_action(state, path, body)
            elif path == "/api/command":
                data = state.queue(body["commands"] if set(body) == {"commands"} else [body])
            elif path == "/api/save":
                data = state.save(body.get("name"))
            elif path == "/api/load":
                data = state.load(body.get("name"), body.get("requestId"))
            elif path == "/api/plan":
                data = plan(state, body)
            elif path == "/api/capture":
                data = state.request_capture(body)
            elif path == "/api/capture/voice":
                data = state.arm_voice_capture(body)
            elif path == "/api/planner_preferences":
                data = planner_preferences(state, body)
            elif path == "/api/voice":
                data = start_voice(state, body)
            elif path == "/api/voice/speak":
                self.send_data(200, tts.synthesize(body.get("text")), "audio/wav")
                return
            elif path == "/api/voice/cancel":
                data = cancel_voice(state, body)
            elif path == "/api/apply_plan":
                data = state.apply_plan(body.get("planId"))
            elif path.startswith("/api/learning/"):
                require(state.learning is not None, "Learning adapter unavailable", 503)
                if path == "/api/learning/start":
                    data = state.learning.start(state, body)
                elif path == "/api/learning/action":
                    data = state.learning.act(state, body)
                elif path == "/api/learning/retry_restore":
                    data = state.learning.retry_restore(state)
                elif path == "/api/learning/dismiss_restore":
                    with state.lock:
                        require(state.learning.restore and state.learning.restore.get("failed"), "Only an unconfirmed room restore can be dismissed", 409)
                        state.learning.restore = None
                        data = state.learning.status(state)
                else:
                    raise APIError(404, "Not found")
            else:
                raise APIError(404, "Not found")
            self.send_data(200, data)
        except (WebAuthoringError, BlenderAuthoringError) as error:
            self.send_api_error(APIError(error.status, str(error)))
        except (APIError, AgentPortalError, LearningError, speech.SpeechError, tts.TTSError, CodexProviderError, ContentError, ClientError) as error:
            self.send_api_error(error)
        except (OSError, ValueError, RecursionError):
            self.send_api_error(APIError(500, "Service I/O error"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--scenes", type=Path, default=Path(__file__).with_name("scenes"))
    parser.add_argument("--web-assets", type=Path, default=Path(__file__).with_name("web_assets"))
    parser.add_argument("--tls-cert", type=Path, help="PEM certificate for HTTPS; use a certificate trusted by the headset")
    parser.add_argument("--tls-key", type=Path, help="PEM private key for HTTPS")
    args = parser.parse_args()
    if bool(args.tls_cert) != bool(args.tls_key):
        parser.error("--tls-cert and --tls-key must be supplied together")
    try:
        server = Server((args.host, args.port), State(args.scenes, learning=LearningBridge(),
                                                      web_assets_directory=args.web_assets), os.environ.get("SANDBOX_TOKEN", ""))
        if args.tls_cert:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(args.tls_cert, args.tls_key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            server.scheme = "https"
    except (APIError, LearningError, OSError, ssl.SSLError) as error:
        parser.error(str(error))
    print(f"AR Sandbox service listening on {server.scheme}://{args.host}:{server.server_port}; Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
