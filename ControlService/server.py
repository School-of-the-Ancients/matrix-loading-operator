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
import unicodedata

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
from web_component_catalog import WebComponentCatalog
from web_authoring import WebAuthoringJobs, WebAuthoringError
from blender_authoring import BlenderAuthoringJobs, BlenderAuthoringError
from web_game import GamePlanError, design_game, wants_game, validate_saved_game
from content_service import ContentBridge, runtime_capabilities
from content_catalog import ContentError
from quest_connection import QuestConnection
from client_api import ClientAPI, ClientError
import scale_experiment

MAX_BODY = 1024 * 1024
MAX_EXCHANGE_BODY = 3 * 1024 * 1024  # two bounded snapshots plus a base64 JPEG
MAX_OBJECTS = 100
MAX_PHYSICS_BODIES = 16
MAX_PENDING = 64
MAX_BATCH = 20
LEASE_SECONDS = 15
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\Z")
OPS = {"spawn", "set_transform", "select", "duplicate", "delete", "undo", "redo", "clear", "load",
       "get_scene", "list_assets", "list_targets", "confirm_room", "set_behavior", "remove_behavior",
       "attach_component", "stop_component", "remove_component", "bind_animation",
       "set_physics", "remove_physics", "set_interaction", "remove_interaction"}
INTERACTION_ID = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\Z")
GLB_SHA = re.compile(r"[0-9a-f]{64}\Z")


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


def animation_binding(value, *, allow_empty=False):
    require(isinstance(value, dict) and set(value) == {"loopClip", "selectClip"},
            "Invalid animation binding")
    result = {}
    for key in ("loopClip", "selectClip"):
        name = value[key]
        require(name is None or isinstance(name, str) and 1 <= len(name) <= 64 and
                not any(unicodedata.category(char).startswith("C") for char in name),
                f"Invalid {key}")
        result[key] = name
    require(allow_empty or any(result.values()), "Animation binding needs a clip")
    require(not result["loopClip"] or result["loopClip"] != result["selectClip"],
            "Loop and selection clips must differ")
    return result


def physics_config(value):
    require(type(value) is dict and set(value) ==
            {"schemaVersion", "kind", "collider", "restitution"}, "Invalid physics configuration")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and
            value["kind"] == "gravity-floor" and
            value["collider"] in ("rendered-bounds-box", "catalog-bounds-box"),
            "Unsupported physics configuration")
    restitution = value["restitution"]
    require(type(restitution) in (int, float) and math.isfinite(restitution) and
            0 <= restitution <= .75, "Physics restitution must be 0-0.75")
    # Existing schema-1 saves used the catalog name for the same renderer-aligned
    # floor proxy. Canonicalize it as scenes and snapshots pass through here.
    return {"schemaVersion": 1, "kind": "gravity-floor", "collider": "rendered-bounds-box",
            "restitution": restitution}


def interaction_descriptor(value):
    """Validate one finite, object-authored Web GLB interaction."""
    fields = {"schemaVersion", "interactionId", "kind", "assetSha256",
              "requiredCapabilities", "availability", "approachPose", "usePose",
              "rangeMeters", "durationTicks", "capacity", "effect"}
    require(type(value) is dict and set(value) == fields, "Invalid interaction descriptor")
    kind = value["kind"]
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and
            type(value["interactionId"]) is str and
            INTERACTION_ID.fullmatch(value["interactionId"]) is not None and
            kind in ("rest", "eat") and
            type(value["assetSha256"]) is str and
            GLB_SHA.fullmatch(value["assetSha256"]) is not None and
            value["requiredCapabilities"] ==
            ["static-virtual-floor", "verified-rendered-bounds"] and
            value["availability"] ==
            ["target-static", "floor-aligned", "rendered-verified"],
            "Unsupported interaction descriptor")
    for key in ("approachPose", "usePose"):
        pose = value[key]
        require(type(pose) is dict and set(pose) == {"x", "z"} and
                all(type(pose[axis]) in (int, float) and math.isfinite(pose[axis]) and
                    abs(pose[axis]) <= 20 for axis in ("x", "z")),
                f"Invalid interaction {key}")
    require(type(value["rangeMeters"]) in (int, float) and
            math.isfinite(value["rangeMeters"]) and .1 <= value["rangeMeters"] <= 2 and
            type(value["durationTicks"]) is int and 1 <= value["durationTicks"] <= 12 and
            type(value["capacity"]) is int and value["capacity"] == 1,
            "Invalid interaction range, duration or capacity")
    effect = value["effect"]
    require(type(effect) is dict and set(effect) == {"need", "delta"} and
            effect["need"] == ("energy" if kind == "rest" else "hunger") and
            type(effect["delta"]) is int and 1 <= effect["delta"] <= 50,
            "Invalid interaction effect")
    return copy.deepcopy(value)


def interaction_world_point(obj, asset, pose):
    """Apply the same local X/Z pose transform used by Matrix Web."""
    transform = obj["transform"]
    factor = asset.get("spawnScale", 1)
    x = pose["x"] * transform["scale"]["x"] * factor
    z = pose["z"] * transform["scale"]["z"] * factor
    yaw = math.radians(transform["rotation"]["y"])
    return (transform["position"]["x"] + x * math.cos(yaw) + z * math.sin(yaw),
            transform["position"]["z"] - x * math.sin(yaw) + z * math.cos(yaw))


def require_interaction_eligible(obj, asset, descriptor):
    """Check catalog identity and bounded static-footprint pose semantics."""
    require(obj is not None and asset is not None and
            obj["assetId"].startswith("web:") and obj["anchorId"] == "web-floor" and
            asset["assetId"] == obj["assetId"] and
            asset.get("sha256") == descriptor["assetSha256"] and
            asset.get("localBounds") is not None and
            not asset.get("animationClips") and
            "animation" not in obj and
            "physics" not in obj and
            obj.get("component", {}).get("status") != "running" and
            not any(behavior["enabled"] and not behavior["paused"]
                    for behavior in obj.get("behaviors", [])),
            "Interaction needs a matching static registered Web GLB", 409)
    transform = obj["transform"]
    require(abs(transform["position"]["y"]) <= .05 and
            abs(transform["rotation"]["x"]) <= .01 and
            abs(transform["rotation"]["z"]) <= .01,
            "Interaction target needs an upright floor-aligned pose", 409)
    size = asset["localBounds"]["size"]
    factor = asset.get("spawnScale", 1)
    half_x = size["x"] * transform["scale"]["x"] * factor / 2
    half_z = size["z"] * transform["scale"]["z"] * factor / 2
    require(math.isfinite(half_x) and math.isfinite(half_z) and
            0 < half_x <= 20 and 0 < half_z <= 20,
            "Interaction target footprint exceeds supported bounds", 409)
    approach = descriptor["approachPose"]
    use = descriptor["usePose"]
    ax = approach["x"] * transform["scale"]["x"] * factor
    az = approach["z"] * transform["scale"]["z"] * factor
    ux = use["x"] * transform["scale"]["x"] * factor
    uz = use["z"] * transform["scale"]["z"] * factor
    require(abs(ax) > half_x + .24 or abs(az) > half_z + .24,
            "Interaction approach pose lacks actor clearance", 409)
    require(abs(ux) <= half_x + 1e-9 and abs(uz) <= half_z + 1e-9,
            "Interaction use pose lies outside target footprint", 409)
    start = interaction_world_point(obj, asset, approach)
    target = interaction_world_point(obj, asset, use)
    require(all(abs(axis) <= 99.8 for point in (start, target) for axis in point) and
            math.dist(start, target) <= descriptor["rangeMeters"] - .1 + 1e-9,
            "Interaction points exceed floor or use range", 409)


def require_registered_interaction(obj, browser_assets, web_assets):
    """Bind an authored interaction to exact installed GLB bytes and metadata."""
    asset_id = obj["assetId"]
    browser_asset = next((item for item in browser_assets if item["assetId"] == asset_id), None)
    try:
        registered = next((item for item in web_assets.list() if item["assetId"] == asset_id), None)
    except WebAssetError as error:
        raise APIError(409, f"Interaction GLB catalog is unavailable: {error}") from None
    require(browser_asset is not None and registered is not None,
            "Interaction GLB is missing from the connected browser or PC catalog", 409)
    try:
        web_assets.file(registered["sha256"])
    except WebAssetError as error:
        raise APIError(409, f"Interaction GLB is missing or corrupt: {error}") from None
    clips = [clip["name"] for clip in registered["geometry"].get("animationClips", [])]
    require(browser_asset.get("sha256") == registered["sha256"] and
            browser_asset.get("localBounds") == registered.get("localBounds") and
            browser_asset.get("spawnScale", 1) == registered.get("spawnScale", 1) and
            browser_asset.get("animationClips", []) == clips,
            "Interaction GLB metadata is stale; refresh assets and retry", 409)
    require_interaction_eligible(obj, {**registered, "animationClips": clips},
                                 obj["interaction"])


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
        if "animation" in item:
            normalized[-1]["animation"] = animation_binding(item["animation"])
        if "physics" in item:
            normalized[-1]["physics"] = physics_config(item["physics"])
            authored = normalized[-1]
            pose = authored["transform"]
            require(authored["anchorId"] == "web-floor" and
                    abs(pose["rotation"]["x"]) <= .01 and
                    abs(pose["rotation"]["z"]) <= .01 and
                    0 <= pose["position"]["y"] <= 5 and
                    "component" not in authored and
                    not any(behavior["enabled"] for behavior in authored.get("behaviors", [])),
                    "Physics requires an upright virtual-floor object without another motion writer")
        if "interaction" in item:
            authored = normalized[-1]
            pose = authored["transform"]
            require(authored["assetId"].startswith("web:") and
                    authored["anchorId"] == "web-floor" and
                    abs(pose["position"]["y"]) <= .05 and
                    abs(pose["rotation"]["x"]) <= .01 and
                    abs(pose["rotation"]["z"]) <= .01 and
                    "animation" not in authored and
                    "physics" not in authored and
                    authored.get("component", {}).get("status") != "running" and
                    not any(behavior["enabled"] and not behavior["paused"]
                            for behavior in authored.get("behaviors", [])),
                    "Interaction requires a static virtual-floor Web GLB")
            authored["interaction"] = interaction_descriptor(item["interaction"])
    require(sum("physics" in item for item in normalized) <= MAX_PHYSICS_BODIES,
            "Scene physics body limit reached")
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


def physics_states(value, authored_scene):
    require(type(value) is list and len(value) <= MAX_PHYSICS_BODIES,
            "Invalid physics states")
    configured = {item["objectId"] for item in authored_scene["objects"] if "physics" in item}
    result, seen = [], set()
    for item in value:
        require(type(item) is dict and set(item) ==
                {"objectId", "executionId", "status", "position", "verticalVelocityMps",
                 "contactCount", "lastContact"}, "Invalid physics state")
        object_id = text(item["objectId"], "physics objectId")
        execution_id = text(item["executionId"], "physics executionId")
        require(object_id in configured and object_id not in seen, "Unknown or duplicate physics objectId")
        seen.add(object_id)
        require(item["status"] in ("falling", "settled", "paused"), "Invalid physics status")
        position = item["position"]
        require(type(position) is dict and set(position) == {"x", "y", "z"},
                "Invalid physics position")
        position = vector(position, "position")
        velocity = item["verticalVelocityMps"]
        require(type(velocity) in (int, float) and math.isfinite(velocity) and -50 <= velocity <= 50,
                "Invalid physics velocity")
        count = item["contactCount"]
        require(type(count) is int and 0 <= count <= 1000, "Invalid physics contact count")
        contact = item["lastContact"]
        if contact is None:
            require(count == 0, "Missing physics contact")
        else:
            require(type(contact) is dict and set(contact) ==
                    {"index", "surface", "impactSpeedMps", "approximate"},
                    "Invalid physics contact")
            speed = contact["impactSpeedMps"]
            require(type(contact["index"]) is int and contact["index"] == count and count > 0 and
                    contact["surface"] == "web-floor" and contact["approximate"] is True and
                    type(speed) in (int, float) and math.isfinite(speed) and 0 <= speed <= 50,
                    "Invalid physics contact")
        result.append({"objectId": object_id, "executionId": execution_id,
                       "status": item["status"], "position": position,
                       "verticalVelocityMps": velocity, "contactCount": count,
                       "lastContact": copy.deepcopy(contact)})
    return result


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
        if key == "assetId" and "sha256" in item:
            digest = item["sha256"]
            require(identifier.startswith("web:") and type(digest) is str and
                    GLB_SHA.fullmatch(digest) is not None,
                    "Invalid Web asset SHA-256")
            entry["sha256"] = digest
        if key == "assetId" and "animationClips" in item:
            clips = item["animationClips"]
            require(isinstance(clips, list) and len(clips) <= 8 and
                    all(isinstance(name, str) and 1 <= len(name) <= 64 and
                        not any(unicodedata.category(char).startswith("C") for char in name)
                        for name in clips) and len(set(clips)) == len(clips),
                    "Invalid animation clip catalog")
            entry["animationClips"] = clips
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
        if value.get("animationSchemaVersion") is not None:
            require(type(value["animationSchemaVersion"]) is int and value["animationSchemaVersion"] == 1,
                    "Unsupported animation schema")
            result["animationSchemaVersion"] = 1
        if value.get("physicsSchemaVersion") is not None:
            require(type(value["physicsSchemaVersion"]) is int and value["physicsSchemaVersion"] == 1,
                    "Unsupported physics schema")
            result["physicsSchemaVersion"] = 1
        if value.get("interactionSchemaVersion") is not None:
            require(type(value["interactionSchemaVersion"]) is int and
                    value["interactionSchemaVersion"] == 1,
                    "Unsupported interaction schema")
            result["interactionSchemaVersion"] = 1
        require(result.get("componentSchemaVersion") == 1 or
                not any("component" in item for item in result["scene"]["objects"]),
                "Scene components require the WebXR component runtime")
        require(result.get("animationSchemaVersion") == 1 or
                not any("animation" in item for item in result["scene"]["objects"]),
                "Scene animation bindings require the WebXR runtime")
        require(result.get("physicsSchemaVersion") == 1 or
                not any("physics" in item for item in result["scene"]["objects"]),
                "Scene physics requires the WebXR physics runtime")
        require(result.get("interactionSchemaVersion") == 1 or
                not any("interaction" in item for item in result["scene"]["objects"]),
                "Scene interactions require the Matrix Web runtime")
        for item in result["scene"]["objects"]:
            if "animation" not in item:
                continue
            asset = next((asset for asset in result["assets"] if asset["assetId"] == item["assetId"]), None)
            require(item["anchorId"] == "web-floor" and asset is not None and
                    all(not clip or clip in asset.get("animationClips", [])
                        for clip in item["animation"].values()),
                    "Scene animation clip is unavailable")
        for item in result["scene"]["objects"]:
            if "physics" not in item:
                continue
            asset = next((asset for asset in result["assets"] if asset["assetId"] == item["assetId"]), None)
            require(item["assetId"].startswith("web:") and asset is not None,
                    "Physics requires a registered Web GLB")
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
    # Keep a structurally valid authored descriptor available for cleanup when
    # a registered GLB later becomes unavailable, or the wearer enters AR.
    # Set/use and checkpoint restore validate current catalog dependencies.
    if "physicsStates" in value:
        require(result.get("physicsSchemaVersion") == 1,
                "Physics observations require the WebXR physics runtime")
        states = physics_states(value["physicsStates"], result["scene"])
        require(not states or room is not None and room["mode"] == "white-room" and
                room["state"] == "ready", "Physics observations require the ready White Room")
        result["physicsStates"] = states
    read_only = value.get("readOnly", False)
    require(type(read_only) is bool, "Invalid readOnly marker")
    if read_only:
        require(room and room["mode"] == "ar" and room["state"] != "ready",
                "Read-only recovery requires an unavailable AR room")
        result["readOnly"] = True
    observation = value.get("citizensObservation")
    if observation is not None:
        require(type(observation) is dict and set(observation) ==
                {"residentObjectIds", "authoredGeneration"}, "Invalid Citizens observation")
        ids = observation["residentObjectIds"]
        generation = observation["authoredGeneration"]
        require(result["scene"]["roomId"] == "web-virtual-room-v1" and
                room is not None and room["mode"] == "white-room" and room["state"] == "ready" and
                not read_only, "Citizens observations require the ready desktop virtual room")
        require(type(ids) is list and len(ids) <= 4 and
                all(type(object_id) is str and object_id for object_id in ids) and
                ids == sorted(set(ids)), "Invalid Citizens resident IDs")
        require(type(generation) is int and 0 <= generation <= 9007199254740991,
                "Invalid Citizens authored generation")
        objects = {item["objectId"]: item for item in result["scene"]["objects"]}
        require(all(objects.get(object_id, {}).get("assetId") == "orb" and
                    objects[object_id]["anchorId"] == "web-floor" and
                    "component" not in objects[object_id] and
                    "physics" not in objects[object_id] and
                    not any(behavior["enabled"] and not behavior["paused"]
                            for behavior in objects[object_id].get("behaviors", []))
                    for object_id in ids), "Citizens observation references an incompatible resident")
        result["citizensObservation"] = {"residentObjectIds": ids[:],
                                         "authoredGeneration": generation}
    return result


def scene_revision_data(value, *, include_observed_motion=False):
    # Voice captures head/controller pose at recording start. Movement isn't a scene edit.
    if value is None:
        return None
    result = {key: item for key, item in value.items() if key not in ("viewer", "pointing", "physicsStates")}
    observation = result.get("citizensObservation")
    if observation is not None and not include_observed_motion:
        residents = set(observation["residentObjectIds"])
        # Local Citizens receipts update X/Z only. Keep the full pose in latest,
        # captures, and planner context; only the broad authored revision omits
        # these two observed coordinates. The authored generation still changes
        # whenever a user or Operator explicitly edits a resident.
        scene_data = result["scene"]
        result["scene"] = {**scene_data, "objects": [
            {**item, "transform": {**item["transform"], "position": {
                **item["transform"]["position"], "x": 0, "z": 0}}}
            if item["objectId"] in residents else item
            for item in scene_data["objects"]]}
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


def resident_motion_dependencies(value, commands=None, *, strict=False):
    """Capture only the observed actor poses a proposal actually depends on."""
    observation = value.get("citizensObservation") or {}
    residents = set(observation.get("residentObjectIds", []))
    if not strict:
        references = {value.get("selection", {}).get("objectId")}
        for item in commands or []:
            references.update((item.get("objectId"), item.get("targetObjectId")))
        residents &= references
    objects = {item["objectId"]: item for item in value["scene"]["objects"]}
    return {object_id: copy.deepcopy(objects[object_id]["transform"])
            for object_id in sorted(residents)}


def resident_motion_current(value, dependencies):
    if value is None:
        return False
    objects = {item["objectId"]: item for item in value["scene"]["objects"]}
    return all(objects.get(object_id, {}).get("transform") == transform
               for object_id, transform in dependencies.items())


RESIDENT_PRECONDITION_OPS = {"set_transform", "set_behavior", "remove_behavior",
                             "delete", "duplicate", "select", "attach_component",
                             "stop_component", "remove_component", "bind_animation",
                             "set_physics", "remove_physics", "set_interaction",
                             "remove_interaction"}


def command(value, *, allow_precondition=False):
    require(isinstance(value, dict), "Invalid command")
    op = value.get("op")
    require(isinstance(op, str) and op in OPS, "Unknown command op")
    allowed = {"op", "requestId"}
    required = {"spawn": {"assetId", "anchorId", "transform"}, "set_transform": {"objectId", "transform"},
                "set_behavior": {"objectId", "behavior"}, "remove_behavior": {"objectId", "behaviorKind"},
                "attach_component": {"objectId", "componentId", "package", "targetObjectId"},
                "stop_component": {"objectId"}, "remove_component": {"objectId"},
                "bind_animation": {"objectId", "loopClip", "selectClip"},
                "set_physics": {"objectId", "physics"}, "remove_physics": {"objectId"},
                 "set_interaction": {"objectId", "interaction"},
                 "remove_interaction": {"objectId"},
                "select": {"objectId"}, "duplicate": {"objectId"}, "delete": {"objectId"},
                "load": {"scene"}}.get(op, set())
    allowed |= required
    if op == "spawn":
        allowed |= {"anchorId", "transform", "placement"}
    if op == "set_transform":
        allowed |= {"anchorId", "placement"}
    if allow_precondition and op in RESIDENT_PRECONDITION_OPS:
        allowed.add("expectedTransform")
    if allow_precondition and op == "attach_component":
        allowed.add("expectedTargetTransform")
    require(not (set(value) - allowed), "Unexpected command fields")
    require(required <= set(value), "Missing command fields")
    result = {"op": op}
    for key in ("assetId", "objectId", "anchorId", "componentId", "targetObjectId"):
        if key in value:
            result[key] = text(value[key], key, empty=key == "anchorId")
    if "transform" in value:
        result["transform"] = transform(value["transform"])
    if "expectedTransform" in value:
        result["expectedTransform"] = transform(value["expectedTransform"])
    if "expectedTargetTransform" in value:
        result["expectedTargetTransform"] = transform(value["expectedTargetTransform"])
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
    if "physics" in value:
        result["physics"] = physics_config(value["physics"])
    if "interaction" in value:
        result["interaction"] = interaction_descriptor(value["interaction"])
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
    if op == "bind_animation":
        result.update(animation_binding({key: value[key] for key in ("loopClip", "selectClip")},
                                        allow_empty=True))
    return result


def parse_json(raw):
    def invalid_constant(_):
        raise ValueError("Non-finite JSON number")
    try:
        return json.loads(raw, parse_constant=invalid_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise APIError(400, "Invalid JSON") from None


def world_checkpoint_digest(world, dependencies):
    payload = json.dumps({"world": world, "dependencies": dependencies}, ensure_ascii=False,
                         sort_keys=True, allow_nan=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def validate_citizens_checkpoint(value, checked_scene):
    """Validate the bounded browser Citizens state against its saved world."""
    def shape(item, fields, label):
        require(type(item) is dict and set(item) == set(fields), f"Invalid Citizens {label}")

    def citizens_text(item, field, empty=False, limit=128):
        # JavaScript String.length counts UTF-16 code units, not Python code
        # points. Reject unpaired surrogates here, before the UTF-8 digest/write.
        require(isinstance(item, str) and (empty or bool(item)), f"Invalid {field}")
        units = 0
        for char in item:
            code = ord(char)
            require(code >= 32 and not 0xd800 <= code <= 0xdfff, f"Invalid {field}")
            units += 2 if code > 0xffff else 1
            require(units <= limit, f"Invalid {field}")
        return item

    def integer(item, minimum, maximum):
        return type(item) is int and minimum <= item <= maximum

    def number(item, minimum, maximum):
        return type(item) in (int, float) and minimum <= item <= maximum and math.isfinite(item)

    require(type(value) is dict and type(value.get("schemaVersion")) is int and
            value["schemaVersion"] in (1, 2, 3, 4, 5, 6, 7, 8, 9), "Unsupported Citizens schemaVersion")
    version = value["schemaVersion"]
    if version == 9:
        # V9 adds one need, one preference and a social choice trace. Project
        # those fields away only after validating them, so every other shape
        # still has to satisfy the exact V8 checkpoint contract below.
        require(type(value.get("residents")) is list and
                len(value["residents"]) <= 4 and
                integer(value.get("clockTick"), 0, 1000000000),
                "Invalid Citizens social choice state")
        projected = copy.deepcopy(value)
        projected["schemaVersion"] = 8
        for resident, old_resident in zip(value["residents"], projected["residents"]):
            require(type(resident) is dict, "Invalid Citizens social choice resident")
            shape(resident.get("needs"), ("hunger", "energy", "fun", "social"),
                  "resident needs")
            shape(resident.get("preferences"),
                  ("rest", "eat", "explore", "converse"), "resident preferences")
            require(number(resident["needs"]["social"], 0, 100) and
                    number(resident["preferences"]["converse"], .2, 2),
                    "Invalid Citizens social need or preference")
            del old_resident["needs"]["social"]
            del old_resident["preferences"]["converse"]
            decision = resident.get("lastDecision")
            if type(decision) is not dict or decision.get("mode") != "social":
                continue
            shape(decision, ("tick", "mode", "roll", "selectedKind",
                             "selectedRoutineId", "candidates"), "social decision")
            require(integer(decision["tick"], 0, value["clockTick"]) and
                    decision["roll"] is None and
                    decision["selectedKind"] == "converse" and
                    decision["selectedRoutineId"] is None and
                    type(decision["candidates"]) is list and
                    len(decision["candidates"]) == 1,
                    "Invalid Citizens social decision")
            candidate = decision["candidates"][0]
            shape(candidate, ("kind", "routineId", "priority", "deficit",
                              "preference", "travelMeters", "baseWeight",
                              "availabilityFactor", "score"), "social candidate")
            require(candidate["kind"] == "converse" and
                    candidate["routineId"] is None and
                    candidate["priority"] == "none" and
                    number(candidate["deficit"], 0, 100) and
                    number(candidate["preference"], .2, 2) and
                    number(candidate["travelMeters"], 0, 1000) and
                    number(candidate["baseWeight"], 0, 100) and
                    candidate["baseWeight"] == 0 and
                    number(candidate["availabilityFactor"], 0, 1) and
                    candidate["availabilityFactor"] == 1 and
                    number(candidate["score"], 0, 300) and
                    candidate["score"] >= 35,
                    "Invalid Citizens social candidate")
            old_resident["lastDecision"] = None
        validate_citizens_checkpoint(projected, checked_scene)
        return
    state_fields = ("schemaVersion", "world", "seed", "rngState", "requestSequence",
                    "clockTick", "paused", "residents", "stations", "log")
    shape(value, state_fields + (("actionSequence", "retiredResidentIds") if version >= 2 else ()) +
          (("socialSession", "socialEvents", "relationships", "nextSocialTick") if version >= 3 else ()) +
          (("clockSpeed",) if version >= 7 else ()),
          "state")
    shape(value["world"], ("schemaVersion", "roomId"), "world binding")
    require(type(value["world"]["schemaVersion"]) is int and
            value["world"]["schemaVersion"] == checked_scene["schemaVersion"] and
            value["world"]["roomId"] == checked_scene["roomId"],
            "Citizens world binding does not match the saved scene")
    require(integer(value["seed"], 1, 0xffffffff) and
            integer(value["rngState"], 0, 0xffffffff) and
            integer(value["requestSequence"], 0, 1000000000) and
            integer(value["clockTick"], 0, 1000000000) and
            type(value["paused"]) is bool, "Invalid Citizens clock or random state")
    if version >= 7:
        require(type(value["clockSpeed"]) is int and value["clockSpeed"] in (1, 4, 16),
                "Invalid Citizens clock speed")
    action_sequence = value["actionSequence"] if version >= 2 else 0
    retired_ids = set()
    if version >= 2:
        require(integer(action_sequence, 0, 1000000000) and
                type(value["retiredResidentIds"]) is list and
                len(value["retiredResidentIds"]) <= 4,
                "Invalid Citizens action sequence or retired residents")
        for retired_id in value["retiredResidentIds"]:
            citizens_text(retired_id, "Citizens retired resident ID", limit=32)
            require(retired_id not in retired_ids, "Duplicate Citizens retired resident ID")
            retired_ids.add(retired_id)
    residents, stations, events = value["residents"], value["stations"], value["log"]
    require(type(residents) is list and (1 <= len(residents) <= 4 if version == 1 else
                                        0 <= len(residents) <= 4) and
            type(stations) is list and (len(stations) == 2 if version == 1 else
                                        len(stations) <= 2) and
            type(events) is list and len(events) <= 80, "Invalid Citizens list bounds")
    if version >= 2:
        require(len(residents) + len(retired_ids) <= 4,
                "Invalid Citizens live and retired resident count")
    if version >= 2 and not residents:
        require(value["paused"], "Citizens with no residents must be paused")

    scene_objects = {item["objectId"]: item for item in checked_scene["objects"]}
    residents_by_id, stations_by_id, station_kinds, bound_objects = {}, {}, set(), set()
    active_execution_ids = set()
    for resident in residents:
        shape(resident, ("id", "name", "objectId", "needs", "preferences", "activity",
                         "cooldowns", "lastOutcome") +
              (("socialSessionId",) if version >= 3 else ()) +
              (("routines", "lastDecision") if version >= 7 else ()), "resident")
        resident_id = citizens_text(resident["id"], "Citizens resident ID", limit=32)
        citizens_text(resident["name"], "Citizens resident name", limit=40)
        object_id = citizens_text(resident["objectId"], "Citizens resident object ID")
        citizens_text(resident["lastOutcome"], "Citizens last outcome", empty=True, limit=160)
        if version >= 3:
            session_id = resident["socialSessionId"]
            if session_id is not None:
                citizens_text(session_id, "Citizens resident social session ID", limit=32)
        require(resident_id not in residents_by_id and object_id not in bound_objects,
                "Duplicate Citizens resident binding")
        obj = scene_objects.get(object_id)
        require(obj is not None and obj["assetId"] == "orb" and obj["anchorId"] == "web-floor" and
                "physics" not in obj and "component" not in obj and
                not any(behavior["enabled"] and not behavior["paused"]
                        for behavior in obj.get("behaviors", [])),
                "Citizens resident object is missing or incompatible")
        if version >= 4:
            transform = obj["transform"]
            require(abs(transform["position"]["y"]) <= .05 and
                    all(transform["scale"][axis] == .7 for axis in ("x", "y", "z")),
                    "Citizens resident object has unsupported size or height")
        for field, minimum, maximum in (("needs", 0, 100), ("preferences", .2, 2)):
            expected = ("hunger", "energy", "fun") if field == "needs" else ("rest", "eat", "explore")
            shape(resident[field], expected, f"resident {field}")
            require(all(number(resident[field][key], minimum, maximum) for key in expected),
                    f"Invalid Citizens resident {field}")
        shape(resident["cooldowns"], ("rest", "eat", "explore"), "resident cooldowns")
        require(all(integer(resident["cooldowns"][key], 0, 1000000012)
                    for key in ("rest", "eat", "explore")), "Invalid Citizens resident cooldowns")
        activity = resident["activity"]
        if activity is not None:
            activity_fields = ("kind", "stationId", "phase", "remainingTicks", "travelTicks", "target")
            shape(activity, activity_fields + (("executionId",) if version >= 2 else ()) +
                  (("routeRetries", "routeGeometryId") if version >= 5 else ()), "activity")
            require(activity["kind"] in ("rest", "eat", "explore") and
                    activity["phase"] in (("travel", "use", "egress") if version >= 8 else
                                          ("travel", "use")) and
                    integer(activity["remainingTicks"], 0, 12) and
                    integer(activity["travelTicks"], 0, 60), "Invalid Citizens activity")
            if activity["phase"] == "egress":
                require(activity["kind"] in ("rest", "eat") and
                        activity["remainingTicks"] == 0 and
                        type(activity["target"]) is dict and
                        set(activity["target"]) == {"x", "z"} and
                        all(number(activity["target"][axis], -99.8, 99.8)
                            for axis in ("x", "z")) and
                        resident["lastOutcome"].startswith(
                            f"Completed {activity['kind']} "),
                        "Invalid Citizens egress activity")
            if version >= 5:
                require(integer(activity["routeRetries"], 0, 3),
                        "Invalid Citizens route retry count")
                if activity["routeGeometryId"] is not None:
                    citizens_text(activity["routeGeometryId"], "Citizens route geometry ID")
            if version >= 2:
                execution_id = activity["executionId"]
                require(integer(execution_id, 1, action_sequence) and
                        execution_id not in active_execution_ids,
                        "Invalid Citizens activity execution ID")
                active_execution_ids.add(execution_id)
            if activity["phase"] == "egress":
                citizens_text(activity["stationId"], "Citizens activity station ID", limit=32)
            elif activity["kind"] == "explore":
                shape(activity["target"], ("x", "z"), "exploration target")
                explore_limit = 100 if version >= 4 else 5
                require(activity["stationId"] is None and
                        all(number(activity["target"][axis], -explore_limit, explore_limit)
                            for axis in ("x", "z")),
                        "Invalid Citizens exploration target")
            else:
                citizens_text(activity["stationId"], "Citizens activity station ID", limit=32)
                require(activity["target"] is None, "Invalid Citizens activity target")
        residents_by_id[resident_id] = resident
        bound_objects.add(object_id)
    require(not retired_ids.intersection(residents_by_id),
            "Citizens retired resident ID is still active")

    waiting_residents, waiting_execution_ids = set(), set()
    for station in stations:
        station_fields = ("id", "kind", "objectId", "capacity")
        selected_approach = version >= 6 and "approachMode" in station
        shape(station, station_fields + (("holder",) if version == 1 else
                                         ("claim", "waiters")) +
              (("interaction",) if version >= 6 else ()) +
              (("approachMode",) if selected_approach else ()), "station")
        if selected_approach:
            require(station["approachMode"] == "selected",
                    "Invalid Citizens station approach mode")
        station_id = citizens_text(station["id"], "Citizens station ID", limit=32)
        object_id = citizens_text(station["objectId"], "Citizens station object ID")
        kind = station["kind"]
        require(kind in ("rest", "eat") and kind not in station_kinds and
                station_id not in stations_by_id and object_id not in bound_objects and
                type(station["capacity"]) is int and station["capacity"] == 1,
                "Invalid Citizens station or duplicate binding")
        obj = scene_objects.get(object_id)
        if version >= 6 and station["interaction"] is not None:
            descriptor = interaction_descriptor(station["interaction"])
            require(obj is not None and obj.get("interaction") == descriptor and
                    obj["assetId"].startswith("web:") and descriptor["kind"] == kind,
                    "Citizens interaction binding is missing or changed")
        else:
            require(obj is not None and
                    obj["assetId"] == ("chair" if kind == "rest" else "table") and
                    (version < 6 or station["interaction"] is None),
                    "Citizens station object is missing or incompatible")
        require(obj["anchorId"] == "web-floor" and "physics" not in obj and
                obj.get("component", {}).get("status") != "running" and
                not any(behavior["enabled"] and not behavior["paused"]
                        for behavior in obj.get("behaviors", [])),
                "Citizens station object is missing or incompatible")
        if version == 1:
            holder = station["holder"]
            require(holder is None or type(holder) is str and holder in residents_by_id,
                    "Invalid Citizens reservation holder")
        else:
            claim = station["claim"]
            if claim is not None:
                shape(claim, ("residentId", "executionId", "expiresTick"), "claim")
                claim_id = citizens_text(claim["residentId"], "Citizens claim resident ID", limit=32)
                require(claim_id in residents_by_id and
                        integer(claim["executionId"], 1, action_sequence) and
                        integer(claim["expiresTick"], value["clockTick"] + 1,
                                value["clockTick"] + 72),
                        "Invalid Citizens claim")
            waiters = station["waiters"]
            require(type(waiters) is list and len(waiters) <= 4,
                    "Invalid Citizens wait queue")
            previous_order = None
            for waiter in waiters:
                shape(waiter, ("residentId", "executionId", "enqueuedTick"), "waiter")
                waiter_id = citizens_text(waiter["residentId"], "Citizens waiter ID", limit=32)
                execution_id, enqueued_tick = waiter["executionId"], waiter["enqueuedTick"]
                order = (enqueued_tick, execution_id)
                require(waiter_id in residents_by_id and
                        residents_by_id[waiter_id]["activity"] is None and
                        waiter_id not in waiting_residents and
                        integer(execution_id, 1, action_sequence) and
                        execution_id not in active_execution_ids and
                        execution_id not in waiting_execution_ids and
                        integer(enqueued_tick, 0, value["clockTick"]) and
                        value["clockTick"] - enqueued_tick < 96 and
                        (previous_order is None or previous_order < order),
                        "Invalid Citizens wait queue")
                waiting_residents.add(waiter_id)
                waiting_execution_ids.add(execution_id)
                previous_order = order
        stations_by_id[station_id] = station
        station_kinds.add(kind)
        bound_objects.add(object_id)

    for resident_id, resident in residents_by_id.items():
        activity = resident["activity"]
        if activity is not None and activity["stationId"] is not None:
            station = stations_by_id.get(activity["stationId"])
            if version == 1:
                require(station is not None and station["kind"] == activity["kind"] and
                        station["holder"] == resident_id, "Invalid Citizens reservation")
            else:
                claim = station["claim"] if station is not None else None
                require(station is not None and station["kind"] == activity["kind"] and
                        claim is not None and claim["residentId"] == resident_id and
                        claim["executionId"] == activity["executionId"],
                        "Invalid Citizens reservation")
    for station_id, station in stations_by_id.items():
        if version == 1 and station["holder"] is not None:
            activity = residents_by_id[station["holder"]]["activity"]
            require(activity is not None and activity["stationId"] == station_id,
                    "Invalid Citizens reservation")
        if version >= 2 and station["claim"] is not None:
            claim = station["claim"]
            activity = residents_by_id[claim["residentId"]]["activity"]
            require(activity is not None and activity["stationId"] == station_id and
                    activity["kind"] == station["kind"] and
                    activity["executionId"] == claim["executionId"],
                    "Invalid Citizens reservation")

    if version >= 7:
        for resident in residents:
            routines = resident["routines"]
            require(type(routines) is list and len(routines) <= 6,
                    "Invalid Citizens routines")
            routine_ids = set()
            routines_by_id = {}
            for routine in routines:
                shape(routine, ("id", "kind", "priority", "startMinute", "endMinute",
                                "baseWeight", "stationId"), "routine")
                routine_id = citizens_text(routine["id"], "Citizens routine ID", limit=32)
                kind = routine["kind"]
                require(routine_id not in routine_ids and
                        type(kind) is str and kind in ("rest", "eat", "explore") and
                        type(routine["priority"]) is str and
                        routine["priority"] in ("high", "default", "low") and
                        integer(routine["startMinute"], 0, 1439) and
                        integer(routine["endMinute"], 0, 1440) and
                        routine["startMinute"] != routine["endMinute"] and
                        number(routine["baseWeight"], 0, 100),
                        "Invalid Citizens routine")
                station_id = routine["stationId"]
                if station_id is not None:
                    citizens_text(station_id, "Citizens routine station ID", limit=32)
                require((station_id is None if kind == "explore" else
                         station_id is None or
                         station_id in stations_by_id and stations_by_id[station_id]["kind"] == kind),
                        "Invalid Citizens routine station binding")
                routine_ids.add(routine_id)
                routines_by_id[routine_id] = routine

            decision = resident["lastDecision"]
            if decision is None:
                continue
            shape(decision, ("tick", "mode", "roll", "selectedKind",
                             "selectedRoutineId", "candidates"), "decision")
            require(integer(decision["tick"], 0, value["clockTick"]) and
                    type(decision["mode"]) is str and
                    decision["mode"] in ("routine", "needs", "idle") and
                    (decision["roll"] is None or number(decision["roll"], 0, 1) and
                     decision["roll"] < 1) and
                    (decision["selectedKind"] is None or
                     type(decision["selectedKind"]) is str and
                     decision["selectedKind"] in ("rest", "eat", "explore")),
                    "Invalid Citizens decision")
            selected_routine = decision["selectedRoutineId"]
            if selected_routine is not None:
                citizens_text(selected_routine, "Citizens selected routine ID", limit=32)
            require(selected_routine is None or selected_routine in routine_ids,
                    "Invalid Citizens selected routine")
            mode = decision["mode"]
            selected_kind = decision["selectedKind"]
            require((mode == "routine" and selected_routine is not None and
                     selected_kind is not None or
                     mode == "needs" and selected_routine is None and
                     selected_kind is not None and decision["roll"] is None or
                     mode == "idle" and selected_routine is None and
                     selected_kind is None and decision["roll"] is None),
                    "Invalid Citizens selected decision")
            candidates = decision["candidates"]
            require(type(candidates) is list and len(candidates) <= 6,
                    "Invalid Citizens decision candidates")
            selected_candidate = False
            for candidate in candidates:
                shape(candidate, ("kind", "routineId", "priority", "deficit",
                                  "preference", "travelMeters", "baseWeight",
                                  "availabilityFactor", "score"), "decision candidate")
                require(type(candidate["kind"]) is str and
                        candidate["kind"] in ("rest", "eat", "explore") and
                        type(candidate["priority"]) is str and
                        candidate["priority"] in ("high", "default", "low", "none") and
                        number(candidate["deficit"], 0, 100) and
                        number(candidate["preference"], .2, 2) and
                        number(candidate["travelMeters"], 0, 1000) and
                        number(candidate["baseWeight"], 0, 100) and
                        number(candidate["availabilityFactor"], 0, 1) and
                        number(candidate["score"], 0, 300),
                        "Invalid Citizens decision candidate")
                candidate_routine = candidate["routineId"]
                if candidate_routine is not None:
                    citizens_text(candidate_routine, "Citizens candidate routine ID", limit=32)
                require((mode == "routine" and candidate_routine in routine_ids and
                         candidate["kind"] == routines_by_id[candidate_routine]["kind"] and
                         candidate["priority"] == routines_by_id[candidate_routine]["priority"] or
                         mode != "routine" and candidate_routine is None and
                         candidate["priority"] == "none"),
                        "Invalid Citizens candidate routine")
                if (candidate["kind"] == selected_kind and
                    candidate_routine == selected_routine and candidate["score"] > 0):
                    selected_candidate = True
            if mode != "idle":
                require(selected_candidate,
                        "Citizens selection has no positive candidate")

    if version >= 3:
        require(integer(value["nextSocialTick"], 0, 1000000100),
                "Invalid Citizens next social tick")
        session = value["socialSession"]
        if session is not None:
            shape(session, ("id", "executionId", "initiatorId", "inviteeId", "phase",
                            "startedTick", "expiresTick", "acceptedTick", "travelTicks",
                            "remainingTicks"), "social session")
            execution_id = session["executionId"]
            session_id = f"social-{value['seed']}-{execution_id}"
            require(integer(execution_id, 1, action_sequence) and
                    session["id"] == session_id and len(session_id) <= 32 and
                    execution_id not in active_execution_ids and
                    execution_id not in waiting_execution_ids,
                    "Invalid Citizens social session ID or execution")
            initiator_id = citizens_text(session["initiatorId"],
                                         "Citizens social initiator ID", limit=32)
            invitee_id = citizens_text(session["inviteeId"],
                                       "Citizens social invitee ID", limit=32)
            participants = (initiator_id, invitee_id)
            require(initiator_id != invitee_id and
                    all(resident_id in residents_by_id and
                        residents_by_id[resident_id]["activity"] is None and
                        residents_by_id[resident_id]["socialSessionId"] == session_id and
                        resident_id not in waiting_residents
                        for resident_id in participants),
                    "Invalid Citizens social participants")
            started_tick = session["startedTick"]
            accepted_tick = session["acceptedTick"]
            require(integer(started_tick, 0, value["clockTick"]) and
                    integer(session["expiresTick"], value["clockTick"] + 1, 1000000100) and
                    integer(session["travelTicks"], 0, 60) and
                    integer(session["remainingTicks"], 0, 3) and
                    type(session["phase"]) is str and
                    session["phase"] in ("offered", "active"),
                    "Invalid Citizens social phase or clock")
            if session["phase"] == "offered":
                require(accepted_tick is None and session["travelTicks"] == 0 and
                        session["remainingTicks"] == 3 and
                        session["expiresTick"] == started_tick + 4 and
                        value["clockTick"] < session["expiresTick"],
                        "Invalid Citizens social offer")
            else:
                require(integer(accepted_tick, started_tick + 1, started_tick + 3) and
                        accepted_tick <= value["clockTick"] and
                        session["expiresTick"] == accepted_tick + 72 and
                        session["travelTicks"] <= value["clockTick"] - accepted_tick and
                        value["clockTick"] < session["expiresTick"],
                        "Invalid Citizens active social session")
        for resident in residents:
            expected_id = session["id"] if session is not None and resident["id"] in (
                session["initiatorId"], session["inviteeId"]) else None
            require(resident["socialSessionId"] == expected_id,
                    "Invalid Citizens resident social session binding")

        social_events = value["socialEvents"]
        require(type(social_events) is list and len(social_events) <= 24,
                "Invalid Citizens social events")
        social_event_names = {"initiated", "accepted", "declined", "timed_out",
                              "ended", "interrupted"}
        known_ids = set(residents_by_id).union(retired_ids)
        event_ids = set()
        ended_events = []
        last_event_tick = -1
        for social_event in social_events:
            shape(social_event, ("id", "event", "tick", "initiatorId", "inviteeId",
                                 "requestId"), "social event")
            event_name = social_event["event"]
            require(type(event_name) is str and event_name in social_event_names and
                    integer(social_event["tick"], last_event_tick, value["clockTick"]),
                    "Invalid Citizens social event clock")
            event_tick = social_event["tick"]
            event_id = citizens_text(social_event["id"], "Citizens social event ID", limit=96)
            suffix = f"-{event_name}-{event_tick}"
            require(event_id.endswith(suffix) and event_id not in event_ids,
                    "Invalid Citizens social event ID")
            source_id = event_id[:-len(suffix)]
            source_prefix = f"social-{value['seed']}-"
            source_execution = source_id[len(source_prefix):] if source_id.startswith(source_prefix) else ""
            require(source_execution.isascii() and source_execution.isdigit() and
                    source_execution == str(int(source_execution)) and
                    integer(int(source_execution), 1, action_sequence),
                    "Invalid Citizens social event execution ID")
            initiator_id = citizens_text(social_event["initiatorId"],
                                         "Citizens social event initiator ID", limit=32)
            invitee_id = citizens_text(social_event["inviteeId"],
                                       "Citizens social event invitee ID", limit=32)
            require(initiator_id != invitee_id and
                    initiator_id in known_ids and invitee_id in known_ids,
                    "Invalid Citizens social event participants")
            request_id = citizens_text(social_event["requestId"],
                                       "Citizens social event receipt", empty=True, limit=128)
            if event_name == "ended":
                receipt_prefix = f"citizens-{value['seed']}-social-{source_execution}-"
                receipt_sequence = (request_id[len(receipt_prefix):]
                                    if request_id.startswith(receipt_prefix) else "")
                require(receipt_sequence.isascii() and receipt_sequence.isdigit() and
                        receipt_sequence == str(int(receipt_sequence)) and
                        integer(int(receipt_sequence), 1, value["requestSequence"]),
                        "Invalid Citizens social completion receipt")
                ended_events.append((source_id, request_id, event_tick,
                                     frozenset((initiator_id, invitee_id))))
            else:
                require(request_id == "", "Invalid Citizens social event receipt")
            event_ids.add(event_id)
            last_event_tick = event_tick

        relationships = value["relationships"]
        require(type(relationships) is list and len(relationships) <= 6,
                "Invalid Citizens relationships")
        previous_pair = None
        completed_by_key = {}
        completed_session_ids = set()
        completed_request_ids = set()
        for relationship in relationships:
            shape(relationship, ("a", "b", "score") +
                  (("completed",) if version >= 4 else ()), "relationship")
            a = citizens_text(relationship["a"], "Citizens relationship resident ID", limit=32)
            b = citizens_text(relationship["b"], "Citizens relationship resident ID", limit=32)
            # JavaScript compares identifiers by UTF-16 code units.
            pair = (a.encode("utf-16-be"), b.encode("utf-16-be"))
            require(a in known_ids and b in known_ids and pair[0] < pair[1] and
                    (previous_pair is None or previous_pair < pair) and
                    number(relationship["score"], 0, 100),
                    "Invalid Citizens relationship")
            # V3 has no durable receipt ledger. Accept it only while its
            # bounded event ring still proves the entire relationship score;
            # the browser migrates those ended events to v4 records.
            completed = (relationship["completed"] if version >= 4 else [
                {"sessionId": session_id, "requestId": request_id, "tick": tick}
                for session_id, request_id, tick, participants in ended_events
                if participants == frozenset((a, b))])
            require(type(completed) is list and len(completed) <= 10 and
                    relationship["score"] == 50 + 5 * len(completed),
                    "Citizens relationship history is incomplete or inconsistent")
            last_tick, last_execution, last_request = -1, 0, 0
            for record in completed:
                shape(record, ("sessionId", "requestId", "tick"),
                      "relationship completion")
                session_id = citizens_text(record["sessionId"],
                                           "Citizens completion session ID", limit=32)
                request_id = citizens_text(record["requestId"],
                                           "Citizens completion request ID", limit=128)
                social_prefix = f"social-{value['seed']}-"
                execution_text = (session_id[len(social_prefix):]
                                  if session_id.startswith(social_prefix) else "")
                require(execution_text.isascii() and execution_text.isdigit() and
                        execution_text == str(int(execution_text)) and
                        integer(int(execution_text), 1, action_sequence),
                        "Invalid Citizens completion session ID")
                execution_id = int(execution_text)
                receipt_prefix = f"citizens-{value['seed']}-social-{execution_id}-"
                request_text = (request_id[len(receipt_prefix):]
                                if request_id.startswith(receipt_prefix) else "")
                require(request_text.isascii() and request_text.isdigit() and
                        request_text == str(int(request_text)) and
                        integer(int(request_text), 1, value["requestSequence"]),
                        "Invalid Citizens completion request ID")
                request_sequence = int(request_text)
                tick = record["tick"]
                require(integer(tick, max(1, last_tick + 1), value["clockTick"]) and
                        execution_id > last_execution and
                        request_sequence > last_request and
                        session_id not in completed_session_ids and
                        request_id not in completed_request_ids and
                        (session is None or session_id != session["id"]),
                        "Invalid Citizens completion order or duplicate")
                key = (session_id, request_id, tick)
                completed_by_key[key] = frozenset((a, b))
                completed_session_ids.add(session_id)
                completed_request_ids.add(request_id)
                last_tick, last_execution, last_request = tick, execution_id, request_sequence
            previous_pair = pair
        require(all(completed_by_key.get((session_id, request_id, tick)) == participants
                    for session_id, request_id, tick, participants in ended_events),
                "Citizens social completion has no matching relationship record")

    log_events = {"selected", "blocked", "arrived", "completed", "failed", "paused", "resumed"}
    if version >= 2:
        log_events.update(("waiting", "released", "retired", "expired"))
    if version >= 5:
        log_events.add("rerouted")
    for event in events:
        shape(event, ("tick", "residentId", "event", "message"), "log entry")
        resident_id = citizens_text(event["residentId"], "Citizens log resident ID", empty=True, limit=32)
        citizens_text(event["message"], "Citizens log message", empty=True, limit=160)
        require(integer(event["tick"], 0, value["clockTick"]) and
                (not resident_id or resident_id in residents_by_id or resident_id in retired_ids) and
                type(event["event"]) is str and event["event"] in log_events,
                "Invalid Citizens log entry")


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


def web_virtual_floor_ready(snapshot):
    """A tracked WebXR AR room can edit unanchored virtual-floor previews."""
    room = snapshot.get("roomContext") or {}
    if room.get("mode") == "white-room":
        return True
    return (room.get("mode") == "ar" and room.get("state") == "ready" and
            snapshot["scene"]["roomId"].startswith("webxr-session-") and
            any(anchor["anchorId"] == "web-floor" for anchor in snapshot["anchors"]))


def virtual_floor_command(snapshot, item):
    """Allow only commands proven to stay on the virtual floor before AR alignment."""
    if not web_virtual_floor_ready(snapshot):
        return False
    if item["op"] == "spawn":
        return item["anchorId"] == "web-floor" and "placement" not in item
    objects = {obj["objectId"]: obj for obj in snapshot["scene"]["objects"]}
    target = objects.get(item.get("objectId"))
    if target is None or target["anchorId"] != "web-floor":
        return False
    if item["op"] == "set_transform":
        return item.get("anchorId", "web-floor") == "web-floor" and "placement" not in item
    if item["op"] == "attach_component":
        other = objects.get(item["targetObjectId"])
        return (other is not None and other["anchorId"] == "web-floor" and
                other["objectId"] != target["objectId"])
    return item["op"] in {"duplicate", "set_behavior", "remove_behavior",
                          "stop_component", "remove_component", "bind_animation",
                           "remove_physics", "remove_interaction", "delete"}


def require_physics_eligible(obj, assets, registered_assets, pose=None):
    """Check the current Web GLB and authored pose before a floor-solver command."""
    require(obj is not None and obj["anchorId"] == "web-floor" and
            obj["assetId"].startswith("web:") and "component" not in obj and
            not any(behavior["enabled"] for behavior in obj.get("behaviors", [])),
            "Physics requires a virtual-floor Web GLB without a competing transform writer", 409)
    asset = next((asset for asset in assets if asset["assetId"] == obj["assetId"]), None)
    registered = next((asset for asset in registered_assets
                       if asset["assetId"] == obj["assetId"]), None)
    digest = registered.get("sha256") if registered else None
    require(asset is not None and registered is not None and
            isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) and
            re.fullmatch(r"web:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}", obj["assetId"]) and
            obj["assetId"].endswith(":" + digest[:12]) and
            registered.get("url") == f"/api/web/assets/{digest}.glb" and
            asset.get("spawnScale", 1) == registered.get("spawnScale", 1),
            "Physics requires the current registered GLB identity and scale", 409)
    transform_value = obj["transform"] if pose is None else pose
    require(abs(transform_value["rotation"]["x"]) <= .01 and
            abs(transform_value["rotation"]["z"]) <= .01 and
            0 <= transform_value["position"]["y"] <= 5,
            "Physics needs an upright start 0-5 metres above the virtual floor", 409)
    # GLB loading subtracts its rendered bounds.min.y, so root-local Y=0 is
    # the model bottom even when the raw export pivot starts elsewhere.


class State:
    def __init__(self, directory, clock=time.monotonic, learning=None, web_assets_directory=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.web_assets = WebAssetCatalog(web_assets_directory or Path(__file__).with_name("web_assets"))
        self.web_components = WebComponentCatalog(self.directory / "web_components")
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
        self.agent_spawn_ids = collections.OrderedDict()
        self.agent_animation_ids = collections.OrderedDict()
        self.agent_component_ids = collections.OrderedDict()
        self.agent_physics_ids = collections.OrderedDict()
        self.agent_interaction_ids = collections.OrderedDict()
        self.agent_scale_session_id = None
        self.client_pairing_enabled = False
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

    @staticmethod
    def _agent_scale_public(value):
        """Keep the MCP result small; /clients retains the full review/evidence."""
        result = {key: copy.deepcopy(value.get(key)) for key in
                  ("requestId", "sessionId", "status", "requiresApply", "error", "experimentEvent")
                  if key in value}
        result["reviewUrl"] = "/clients"
        result["observationState"] = (value.get("experiment") or {}).get("observationState")
        if value.get("proposal"):
            result["proposal"] = {key: copy.deepcopy(value["proposal"].get(key)) for key in
                                  ("summary", "commands", "assumptions")}
        return result

    def agent_scale(self, value):
        """Agent tool adapter to the same reviewed v1 experiment request."""
        require(self.client_pairing_enabled,
                "Configure SANDBOX_TOKEN before using the reviewed Matrix scale tool", 503)
        require(isinstance(value, dict) and set(value) in (
            {"room_id", "scene_revision", "object_id", "factors"},
            {"room_id", "scene_revision", "object_id", "factors", "baseline_request_id"},
            {"room_id", "scene_revision", "object_id", "action", "baseline_request_id"}),
            "Invalid Matrix scale tool request")
        action = value.get("action", "configure")
        require(action in ("configure", "reset"), "Invalid Matrix scale action")
        room_id = text(value["room_id"], "room_id")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid Matrix scene revision")
        intent = {"kind": "block-scale", "version": 1, "action": action,
                  "objectId": value["object_id"]}
        if action == "configure":
            intent["factors"] = value["factors"]
        if "baseline_request_id" in value:
            intent["baselineRequestId"] = value["baseline_request_id"]
        try:
            scale_experiment.validate_intent(intent)
        except PlannerError as error:
            raise APIError(error.status, str(error)) from None
        with self.lock:
            self.expire()
            self.clients.refresh()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            require(self.latest["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require(self.latest["scene"]["roomId"] == "web-virtual-room-v1" and
                    web_virtual_floor_ready(self.latest) and
                    self.latest.get("roomContext", {}).get("mode") == "white-room",
                    "This scale tool requires a ready Matrix Web virtual room", 409)
            session = self.clients.sessions.get(self.agent_scale_session_id)
            if session is None or session["status"] != "active" or session["runtimeSessionId"] != self.clients.runtime_id():
                paired = self.clients.pair({"clientName": "Matrix Agent scale tool"})
                claimed = self.clients.claim({"pairingCode": paired["pairingCode"]})
                self.agent_scale_session_id = claimed["sessionId"]
                session = self.clients.sessions[self.agent_scale_session_id]
            request_id = uuid.uuid4().hex
            result = self.clients.propose(session, {"requestId": request_id,
                "expected": {"runtimeSessionId": self.clients.runtime_id(), "revision": revision},
                "intent": intent})
            return self._agent_scale_public(result)

    def agent_scale_status(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[0-9a-f]{32}", request_id),
                "Invalid Matrix scale receipt ID")
        with self.lock:
            self.expire()
            for session in self.clients.sessions.values():
                if session["clientName"] == "Matrix Agent scale tool" and request_id in session["requests"]:
                    return self._agent_scale_public(self.clients.get_request(session, request_id))
            raise APIError(404, "Matrix scale request is unavailable")

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
        restoring_world = "worldRestoreExpectedRevision" in body
        expected_revision = body.get("worldRestoreExpectedRevision")
        if restoring_world:
            require(type(expected_revision) is int and expected_revision >= 0,
                    "Invalid world restore revision")
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
            if restoring_world:
                require(self.client_id == client_id and self.revision == expected_revision and
                        not self.pending and self.latest is not None and current is not None and
                        self.latest["scene"]["roomId"] == "web-virtual-room-v1" and
                        current["scene"]["roomId"] == "web-virtual-room-v1" and
                        (self.latest.get("roomContext") or {}).get("mode") == "white-room" and
                        (self.latest.get("roomContext") or {}).get("state") == "ready" and
                        (current.get("roomContext") or {}).get("mode") == "white-room" and
                        (current.get("roomContext") or {}).get("state") == "ready" and
                        not self.latest.get("readOnly") and not current.get("readOnly"),
                        "World changed or a command was queued; retry the PC world restore", 409)
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
                        or self.latest is None or self.latest.get("readOnly") or self.pending or
                        not resident_motion_current(self.latest, capture.get("motionDependencies", {}))):
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
                            "revision": self.revision, "requested": self.clock(), "status": "pending", "mode": mode,
                            "motionDependencies": resident_motion_dependencies(self.latest, strict=True)}
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
            require(scene_revision_data(captured, include_observed_motion=True) ==
                    scene_revision_data(self.latest, include_observed_motion=True),
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

    def queue(self, raw_commands, *, ordered=False):
        require(isinstance(raw_commands, list) and 0 < len(raw_commands) <= MAX_BATCH,
                f"Expected 1-{MAX_BATCH} commands")
        checked = [command(item, allow_precondition=True) for item in raw_commands]
        if any(item["op"] in {"set_interaction", "remove_interaction"} for item in checked):
            require(len(checked) == 1,
                    "Review one interaction change at a time", 409)
        physics_targets = [item["objectId"] for item in checked
                           if item["op"] in {"set_physics", "remove_physics"}]
        if physics_targets:
            require(len(set(physics_targets)) == len(physics_targets) and
                    not any(item["op"] in {"load", "clear", "undo", "redo"} or
                            item.get("objectId") in physics_targets and
                            item["op"] not in {"set_physics", "remove_physics"}
                            for item in checked),
                    "Review conflicting physics and scene commands separately", 409)
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
                    behavior_target = next((obj for obj in self.latest["scene"]["objects"]
                                            if obj["objectId"] == item["objectId"]), None)
                    require(behavior_target is not None, "Behavior target object is unavailable", 409)
                    require(item["op"] != "set_behavior" or "physics" not in behavior_target,
                            "Remove physics before adding a visual behavior", 409)
                    require(item["op"] != "set_behavior" or
                            "interaction" not in behavior_target or
                            not item["behavior"]["enabled"] or item["behavior"]["paused"],
                            "Remove the interaction before enabling a transform behavior", 409)
                    if item["op"] == "set_behavior" and kind == "select_toggle":
                        target = next(obj for obj in self.latest["scene"]["objects"] if obj["objectId"] == item["objectId"])
                        asset = next((asset for asset in self.latest["assets"] if asset["assetId"] == target["assetId"]), None)
                        require(asset is not None and asset.get("interactionMode") in ("light", "hinge"),
                                "This prefab has no selectable interaction", 409)
                elif item["op"] in {"attach_component", "stop_component", "remove_component"}:
                    require(self.latest.get("componentSchemaVersion") == 1,
                            "Connected runtime does not support components", 409)
                    require(web_virtual_floor_ready(self.latest),
                            "Components currently require a ready WebXR virtual floor", 409)
                    if item["op"] == "attach_component":
                        component_target = next((obj for obj in self.latest["scene"]["objects"]
                                                 if obj["objectId"] == item["objectId"]), None)
                        require(component_target is not None and "physics" not in component_target,
                                "Remove physics before attaching a component", 409)
                        require("interaction" not in component_target,
                                "Remove the interaction before attaching a component", 409)
                        try:
                            registered = self.web_components.get(item["componentId"])
                        except ComponentError as error:
                            raise APIError(409, str(error)) from None
                        require(registered["package"] == item["package"],
                                "Component package does not match its published version", 409)
                elif item["op"] == "bind_animation":
                    require(self.latest.get("animationSchemaVersion") == 1 and
                            web_virtual_floor_ready(self.latest),
                            "Connected WebXR virtual floor does not support animation bindings", 409)
                    obj = next((obj for obj in self.latest["scene"]["objects"]
                                if obj["objectId"] == item["objectId"]), None)
                    require(obj is not None and obj["anchorId"] == "web-floor",
                            "Animation target is unavailable on the virtual floor", 409)
                    registered = next((asset for asset in self.web_assets.list()
                                       if asset.get("assetId") == obj["assetId"]), None)
                    names = {clip["name"] for clip in (registered or {}).get("geometry", {}).get("animationClips", [])}
                    require(registered is not None and
                            all(not item[key] or item[key] in names for key in ("loopClip", "selectClip")),
                            "Requested GLB animation clip is unavailable", 409)
                    require("interaction" not in obj or
                            not any(item[key] for key in ("loopClip", "selectClip")),
                            "Remove the interaction before binding an animation", 409)
                elif item["op"] in {"set_interaction", "remove_interaction"}:
                    require(self.latest.get("interactionSchemaVersion") == 1 and
                            web_virtual_floor_ready(self.latest),
                            "Connected Matrix Web virtual floor does not support interactions", 409)
                    obj = next((obj for obj in self.latest["scene"]["objects"]
                                if obj["objectId"] == item["objectId"]), None)
                    require(obj is not None and obj["anchorId"] == "web-floor",
                            "Interaction target is unavailable on the virtual floor", 409)
                    item["expectedTransform"] = copy.deepcopy(obj["transform"])
                    item["expectedInteraction"] = copy.deepcopy(obj.get("interaction"))
                    if item["op"] == "set_interaction":
                        require(room and room["mode"] == "white-room" and
                                room["state"] == "ready" and
                                self.latest["scene"]["roomId"] == "web-virtual-room-v1",
                                "Author interactions in the ready desktop virtual room", 409)
                        require_registered_interaction(
                            {**obj, "interaction": item["interaction"]},
                            self.latest["assets"], self.web_assets)
                    else:
                        require("interaction" in obj,
                                "Object has no interaction descriptor", 409)
                elif item["op"] in {"set_physics", "remove_physics"}:
                    require(self.latest.get("physicsSchemaVersion") == 1,
                            "Connected WebXR runtime does not support physics", 409)
                    obj = next((obj for obj in self.latest["scene"]["objects"]
                                if obj["objectId"] == item["objectId"]), None)
                    require(obj is not None and obj["anchorId"] == "web-floor",
                            "Physics target is unavailable on the virtual floor", 409)
                    if item["op"] == "set_physics":
                        require("interaction" not in obj,
                                "Remove the interaction before enabling physics", 409)
                        require(room and room["mode"] == "white-room" and room["state"] == "ready",
                                "Gravity-floor physics runs only in the ready White Room", 409)
                        configured = sum("physics" in other for other in self.latest["scene"]["objects"])
                        require("physics" in obj or configured < MAX_PHYSICS_BODIES,
                                "Scene physics body limit reached", 409)
                        require_physics_eligible(obj, self.latest["assets"], self.web_assets.list())
                    else:
                        require("physics" in obj, "Object has no physics configuration", 409)
                elif item["op"] == "set_transform":
                    obj = next((obj for obj in self.latest["scene"]["objects"]
                                if obj["objectId"] == item["objectId"]), None)
                    if obj is not None and "physics" in obj:
                        require_physics_eligible(obj, self.latest["assets"], self.web_assets.list(),
                                                 item["transform"])
                    if obj is not None and "interaction" in obj:
                        require_registered_interaction(
                            {**obj, "transform": item["transform"]},
                            self.latest["assets"], self.web_assets)
                elif item["op"] == "duplicate":
                    obj = next((obj for obj in self.latest["scene"]["objects"]
                                if obj["objectId"] == item["objectId"]), None)
                    if obj is not None and "physics" in obj:
                        require(sum("physics" in other for other in self.latest["scene"]["objects"]) <
                                MAX_PHYSICS_BODIES, "Scene physics body limit reached", 409)
                    if obj is not None and "interaction" in obj:
                        duplicated = copy.deepcopy(obj)
                        duplicated["transform"]["position"]["x"] = min(
                            100, duplicated["transform"]["position"]["x"] + .3)
                        require_registered_interaction(duplicated, self.latest["assets"],
                                                       self.web_assets)
                elif item["op"] == "load":
                    require(all(behavior["kind"] in supported for obj in item["scene"]["objects"]
                                for behavior in obj.get("behaviors", [])),
                            "Saved behaviors need an updated Quest app; scene has not been loaded", 409)
                    require(self.latest.get("componentSchemaVersion") == 1 or
                            not any("component" in obj for obj in item["scene"]["objects"]),
                            "Saved components need the WebXR runtime; scene has not been loaded", 409)
                    require(self.latest.get("animationSchemaVersion") == 1 or
                            not any("animation" in obj for obj in item["scene"]["objects"]),
                            "Saved animation bindings need the WebXR runtime; scene has not been loaded", 409)
                    interaction_objects = [obj for obj in item["scene"]["objects"]
                                           if "interaction" in obj]
                    require(self.latest.get("interactionSchemaVersion") == 1 or
                            not interaction_objects,
                            "Saved interactions need the Matrix Web runtime; scene has not been loaded", 409)
                    for obj in interaction_objects:
                        require_registered_interaction(obj, self.latest["assets"],
                                                       self.web_assets)
                    physics_objects = [obj for obj in item["scene"]["objects"] if "physics" in obj]
                    require(self.latest.get("physicsSchemaVersion") == 1 or not physics_objects,
                            "Saved physics needs the WebXR runtime; scene has not been loaded", 409)
                    if physics_objects:
                        registered = self.web_assets.list()
                        for obj in physics_objects:
                            require_physics_eligible(obj, self.latest["assets"], registered)
                if self.latest.get("readOnly"):
                    require(item["op"] in {"clear", "get_scene", "list_assets", "list_targets"},
                            "Room changed. Save the retained poses, clear objects, then reload room data and verify outlines", 409)
                if item["op"] == "confirm_room":
                    require(room and room["mode"] == "ar" and room["state"] == "ready",
                            "Load a real room and inspect its outlines before confirming alignment", 409)
                elif room and room["mode"] == "ar" and not room.get("alignmentVerified"):
                    require(item["op"] in {"clear", "select", "get_scene", "list_assets", "list_targets"}
                            or virtual_floor_command(self.latest, item),
                            "Check the labeled outlines in the headset, then confirm room alignment on this panel", 409)
            configured_ids = {obj["objectId"] for obj in self.latest["scene"]["objects"]
                              if "physics" in obj}
            projected_count = len(configured_ids)
            for item in checked:
                op, object_id = item["op"], item.get("objectId")
                if op == "set_physics" and object_id not in configured_ids:
                    configured_ids.add(object_id)
                    projected_count += 1
                elif op in {"remove_physics", "delete"} and object_id in configured_ids:
                    configured_ids.remove(object_id)
                    projected_count -= 1
                elif op == "duplicate" and object_id in configured_ids:
                    projected_count += 1
                elif op == "load":
                    configured_ids = {obj["objectId"] for obj in item["scene"]["objects"]
                                      if "physics" in obj}
                    projected_count = len(configured_ids)
                require(projected_count <= MAX_PHYSICS_BODIES,
                        "Scene physics body limit reached", 409)
            require(len(self.pending) + len(checked) <= MAX_PENDING, "Command queue full", 409)
            previous_request_id = None
            for item in checked:
                item["requestId"] = uuid.uuid4().hex
                if ordered and previous_request_id is not None:
                    # Only the reviewed Apply path supplies ordered=True. The
                    # planner and raw command endpoint cannot choose or forge
                    # predecessor receipts. A later command must not run if an
                    # earlier effect in the same proposal failed in the browser.
                    item["requiresSuccessOf"] = previous_request_id
                self.pending[item["requestId"]] = item
                previous_request_id = item["requestId"]
            self.revision += 1
            return {"commands": copy.deepcopy(checked)}

    def agent_move(self, value):
        """Queue one virtual-floor position or rotation edit through the normal command path."""
        required = {"room_id", "scene_revision", "object_id", "expected_asset_id", "position"}
        require(isinstance(value, dict) and required <= set(value) <= required | {"rotation"},
                "Invalid Matrix move request")
        room_id = text(value["room_id"], "room_id")
        object_id = text(value["object_id"], "object_id")
        asset_id = text(value["expected_asset_id"], "expected_asset_id")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid scene revision")
        require(isinstance(value["position"], dict) and set(value["position"]) == {"x", "y", "z"},
                "Invalid Matrix move position")
        position = vector(value["position"], "position")
        rotation = None
        if "rotation" in value:
            require(isinstance(value["rotation"], dict) and set(value["rotation"]) == {"x", "y", "z"},
                    "Invalid Matrix move rotation")
            rotation = vector(value["rotation"], "rotation")
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            current = self.latest
            require(current["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require(web_virtual_floor_ready(current),
                    "This Matrix tool requires a ready WebXR virtual floor", 409)
            require(not current.get("readOnly") and not self.pending,
                    "Matrix world is not ready for a new move", 409)
            item = next((item for item in current["scene"]["objects"] if item["objectId"] == object_id), None)
            require(item is not None and item["assetId"] == asset_id and item["anchorId"] == "web-floor",
                    "The requested virtual-floor object is no longer available", 409)
            transform = copy.deepcopy(item["transform"])
            transform["position"] = position
            if rotation is not None:
                transform["rotation"] = rotation
            queued = self.queue([{"op": "set_transform", "objectId": object_id,
                                  "transform": transform}])["commands"][0]
            request_id = queued["requestId"]
            self.agent_move_ids[request_id] = {"roomId": room_id, "objectId": object_id,
                                               "assetId": asset_id, "transform": transform}
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
                     item["assetId"] == issued["assetId"] and item["anchorId"] == "web-floor" and
                     item["transform"] == issued["transform"]), None)
                result["status"] = "succeeded" if observed else "unconfirmed"
            elif "outcome unknown" in receipt["error"]:
                result["status"] = "unconfirmed"
            else:
                result["status"] = "failed"
                result["error"] = receipt["error"][:200]
            return result

    def agent_spawn(self, value):
        """Queue a registered GLB on the virtual floor through the normal runtime."""
        require(isinstance(value, dict) and set(value) ==
                {"room_id", "scene_revision", "asset_id", "transform"},
                "Invalid Matrix spawn request")
        room_id = text(value["room_id"], "room_id")
        asset_id = text(value["asset_id"], "asset_id")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid scene revision")
        pose = transform(value["transform"])
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            current = self.latest
            require(current["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require(web_virtual_floor_ready(current),
                    "This Matrix tool requires a ready WebXR virtual floor", 409)
            require(not current.get("readOnly") and not self.pending,
                    "Matrix world is not ready for a new spawn", 409)
            asset = next((item for item in self.web_assets.list() if item.get("assetId") == asset_id), None)
            require(asset is not None, "GLB is not registered in the Matrix asset catalog", 409)
            require(any(item["assetId"] == asset_id for item in current["assets"]),
                    "Connected browser has not loaded this asset yet; refresh its catalog", 409)
            try:
                self.web_assets.file(asset["sha256"])
            except WebAssetError as error:
                raise APIError(409, str(error)) from None
            queued = self.queue([{"op": "spawn", "assetId": asset_id,
                                  "anchorId": "web-floor", "transform": pose}])["commands"][0]
            request_id = queued["requestId"]
            self.agent_spawn_ids[request_id] = {"roomId": room_id, "assetId": asset_id,
                                                "transform": pose}
            while len(self.agent_spawn_ids) > 64:
                self.agent_spawn_ids.popitem(last=False)
            return self.agent_spawn_status(request_id)

    def agent_spawn_status(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[0-9a-f]{32}", request_id),
                "Invalid Matrix spawn receipt ID")
        with self.lock:
            self.expire()
            issued = self.agent_spawn_ids.get(request_id)
            require(issued is not None, "Matrix spawn receipt is unavailable", 404)
            receipt = next((item for item in reversed(self.results) if item["requestId"] == request_id), None)
            result = {"requestId": request_id, "roomId": issued["roomId"],
                      "assetId": issued["assetId"], "sceneRevision": self.revision}
            if receipt is None:
                result["status"] = "queued" if request_id in self.pending else "unconfirmed"
            elif not receipt["ok"]:
                result["status"] = "unconfirmed" if "outcome unknown" in receipt["error"] else "failed"
                if result["status"] == "failed":
                    result["error"] = receipt["error"][:200]
            else:
                object_id = receipt.get("objectId")
                observed = (self.latest and self.latest["scene"]["roomId"] == issued["roomId"] and
                            isinstance(object_id, str) and next((item for item in self.latest["scene"]["objects"]
                            if item["objectId"] == object_id and item["assetId"] == issued["assetId"] and
                            item["anchorId"] == "web-floor" and item["transform"] == issued["transform"]), None))
                result["status"] = "succeeded" if observed else "unconfirmed"
                if observed:
                    result["objectId"] = object_id
            return result

    def agent_bind_animation(self, value):
        """Persist named GLB clips on one virtual-floor object through the runtime."""
        require(isinstance(value, dict) and set(value) ==
                {"room_id", "scene_revision", "object_id", "expected_asset_id", "loop_clip", "select_clip"},
                "Invalid Matrix animation request")
        room_id = text(value["room_id"], "room_id")
        object_id = text(value["object_id"], "object_id")
        asset_id = text(value["expected_asset_id"], "expected_asset_id")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid scene revision")
        binding = animation_binding({"loopClip": value["loop_clip"], "selectClip": value["select_clip"]},
                                    allow_empty=True)
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            current = self.latest
            require(current["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require(current.get("animationSchemaVersion") == 1 and
                    web_virtual_floor_ready(current),
                    "Connected WebXR virtual floor does not support animation bindings", 409)
            require(not current.get("readOnly") and not self.pending,
                    "Matrix world is not ready for an animation change", 409)
            item = next((item for item in current["scene"]["objects"] if item["objectId"] == object_id), None)
            require(item is not None and item["assetId"] == asset_id and item["anchorId"] == "web-floor",
                    "Animation object is no longer available on the virtual floor", 409)
            registered = next((asset for asset in self.web_assets.list() if asset["assetId"] == asset_id), None)
            require(registered is not None, "Animation asset is no longer registered", 409)
            names = {clip["name"] for clip in registered["geometry"].get("animationClips", [])}
            require(all(not clip or clip in names for clip in binding.values()),
                    "Requested GLB animation clip is unavailable", 409)
            require(any(asset["assetId"] == asset_id and set(asset.get("animationClips", [])) == names
                        for asset in current["assets"]),
                    "Connected browser has not loaded the current GLB animation catalog", 409)
            queued = self.queue([{"op": "bind_animation", "objectId": object_id, **binding}])["commands"][0]
            request_id = queued["requestId"]
            self.agent_animation_ids[request_id] = {"roomId": room_id, "objectId": object_id,
                                                    "assetId": asset_id, "binding": binding}
            while len(self.agent_animation_ids) > 64:
                self.agent_animation_ids.popitem(last=False)
            return self.agent_animation_status(request_id)

    def agent_animation_status(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[0-9a-f]{32}", request_id),
                "Invalid Matrix animation receipt ID")
        with self.lock:
            self.expire()
            issued = self.agent_animation_ids.get(request_id)
            require(issued is not None, "Matrix animation receipt is unavailable", 404)
            receipt = next((item for item in reversed(self.results) if item["requestId"] == request_id), None)
            result = {"requestId": request_id, "roomId": issued["roomId"],
                      "objectId": issued["objectId"], "assetId": issued["assetId"],
                      "binding": issued["binding"], "sceneRevision": self.revision}
            if receipt is None:
                result["status"] = "queued" if request_id in self.pending else "unconfirmed"
            elif not receipt["ok"]:
                result["status"] = "unconfirmed" if "outcome unknown" in receipt["error"] else "failed"
                if result["status"] == "failed":
                    result["error"] = receipt["error"][:200]
            else:
                observed = self.latest and self.latest["scene"]["roomId"] == issued["roomId"] and next(
                    (item for item in self.latest["scene"]["objects"] if item["objectId"] == issued["objectId"]
                     and item["assetId"] == issued["assetId"]), None)
                expected = issued["binding"] if any(issued["binding"].values()) else None
                result["status"] = "succeeded" if observed and observed.get("animation") == expected else "unconfirmed"
            return result

    def agent_physics_action(self, value):
        """Queue a bounded Web floor drop through the existing runtime receipt path."""
        require(type(value) is dict and value.get("action") in ("set", "remove"),
                "Invalid Matrix physics action")
        action = value["action"]
        required = {"action", "room_id", "scene_revision", "object_id", "expected_asset_id"}
        if action == "set":
            required.add("restitution")
        require(set(value) == required, "Invalid Matrix physics action fields")
        room_id = text(value["room_id"], "room_id")
        object_id = text(value["object_id"], "object_id")
        asset_id = text(value["expected_asset_id"], "expected_asset_id")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid scene revision")
        if action == "set":
            restitution = value["restitution"]
            require(type(restitution) in (int, float) and math.isfinite(restitution) and
                    0 <= restitution <= .75, "Restitution must be 0–0.75")
            configuration = {"schemaVersion": 1, "kind": "gravity-floor",
                             "collider": "rendered-bounds-box", "restitution": restitution}
        else:
            configuration = None
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            current = self.latest
            require(current["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require(room_id == "web-virtual-room-v1" and
                    (current.get("roomContext") or {}).get("mode") == "white-room" and
                    current.get("physicsSchemaVersion") == 1,
                    "This physics tool requires the ready Matrix Web White Room", 409)
            require(not current.get("readOnly") and not self.pending and not self.content.busy(),
                    "Matrix world is not ready for a physics change", 409)
            obj = next((item for item in current["scene"]["objects"]
                        if item["objectId"] == object_id), None)
            require(obj is not None and obj["assetId"] == asset_id and
                    obj["anchorId"] == "web-floor" and asset_id.startswith("web:"),
                    "Physics object is no longer available on the virtual floor", 409)
            if action == "set":
                registry = self.web_assets.list()
                require_physics_eligible(obj, current["assets"], registry)
                registered = next(asset for asset in registry if asset["assetId"] == asset_id)
                try:
                    self.web_assets.file(registered["sha256"])
                except WebAssetError as error:
                    raise APIError(409, str(error)) from None
                require(sum("physics" in item for item in current["scene"]["objects"]
                            if item["objectId"] != object_id) < 16,
                        "Floor physics body limit reached", 409)
                command_value = {"op": "set_physics", "objectId": object_id,
                                 "physics": configuration}
            else:
                require("physics" in obj, "Object has no physics to remove", 409)
                command_value = {"op": "remove_physics", "objectId": object_id}
            queued = self.queue([command_value])["commands"][0]
            request_id = queued["requestId"]
            self.agent_physics_ids[request_id] = {"action": action, "roomId": room_id,
                                                  "objectId": object_id, "assetId": asset_id,
                                                  "physics": configuration}
            while len(self.agent_physics_ids) > 64:
                self.agent_physics_ids.popitem(last=False)
            return self.agent_physics_status(request_id)

    def agent_physics_status(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[0-9a-f]{32}", request_id),
                "Invalid Matrix physics receipt ID")
        with self.lock:
            self.expire()
            issued = self.agent_physics_ids.get(request_id)
            require(issued is not None, "Matrix physics receipt is unavailable", 404)
            receipt = next((item for item in reversed(self.results)
                            if item["requestId"] == request_id), None)
            result = {"requestId": request_id, "roomId": issued["roomId"],
                      "objectId": issued["objectId"], "assetId": issued["assetId"],
                      "action": issued["action"], "sceneRevision": self.revision}
            if receipt is None:
                result["status"] = "queued" if request_id in self.pending else "unconfirmed"
            elif not receipt["ok"]:
                result["status"] = "unconfirmed" if "outcome unknown" in receipt["error"] else "failed"
                if result["status"] == "failed":
                    result["error"] = receipt["error"][:200]
            else:
                current = self.latest
                obj = (next((item for item in current["scene"]["objects"]
                             if item["objectId"] == issued["objectId"] and
                             item["assetId"] == issued["assetId"]), None)
                       if current and current["scene"]["roomId"] == issued["roomId"] else None)
                observed = (next((item for item in current.get("physicsStates", [])
                                  if item["objectId"] == issued["objectId"] and
                                  item["executionId"] == request_id), None)
                            if current else None)
                if issued["action"] == "set":
                    result["status"] = ("succeeded" if obj and
                                        obj.get("physics") == issued["physics"] and observed else "unconfirmed")
                    if result["status"] == "succeeded":
                        result["physicsState"] = copy.deepcopy(observed)
                        result["contactObserved"] = bool(observed["contactCount"])
                else:
                    result["status"] = ("succeeded" if obj and "physics" not in obj and
                                        not any(item["objectId"] == issued["objectId"]
                                                for item in current.get("physicsStates", [])) else "unconfirmed")
            return result

    def agent_interaction_action(self, value):
        """Author or remove one reviewed, object-level Web GLB affordance."""
        require(type(value) is dict and value.get("action") in ("set", "remove"),
                "Invalid Matrix interaction action")
        action = value["action"]
        required = {"action", "room_id", "scene_revision", "object_id", "expected_asset_id"}
        if action == "set":
            required.add("interaction")
        require(set(value) == required, "Invalid Matrix interaction action fields")
        room_id = text(value["room_id"], "room_id")
        object_id = text(value["object_id"], "object_id")
        asset_id = text(value["expected_asset_id"], "expected_asset_id")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid scene revision")
        descriptor = interaction_descriptor(value["interaction"]) if action == "set" else None
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None,
                    self.room_unavailable_message(), 409)
            current = self.latest
            require(current["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require(current.get("interactionSchemaVersion") == 1,
                    "Connected Matrix Web runtime does not support interactions", 409)
            require(not current.get("readOnly") and not self.pending and not self.content.busy(),
                    "Matrix world is not ready for an interaction change", 409)
            obj = next((item for item in current["scene"]["objects"]
                        if item["objectId"] == object_id), None)
            require(obj is not None and obj["assetId"] == asset_id and
                    obj["anchorId"] == "web-floor" and asset_id.startswith("web:"),
                    "Interaction object is no longer available on the virtual floor", 409)
            if action == "set":
                command_value = {"op": "set_interaction", "objectId": object_id,
                                 "interaction": descriptor}
            else:
                require("interaction" in obj, "Object has no interaction descriptor", 409)
                command_value = {"op": "remove_interaction", "objectId": object_id}
            queued = self.queue([command_value])["commands"][0]
            request_id = queued["requestId"]
            self.agent_interaction_ids[request_id] = {
                "action": action, "roomId": room_id, "objectId": object_id,
                "assetId": asset_id, "interaction": descriptor}
            while len(self.agent_interaction_ids) > 64:
                self.agent_interaction_ids.popitem(last=False)
            return self.agent_interaction_status(request_id)

    def agent_interaction_status(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[0-9a-f]{32}", request_id),
                "Invalid Matrix interaction receipt ID")
        with self.lock:
            self.expire()
            issued = self.agent_interaction_ids.get(request_id)
            require(issued is not None, "Matrix interaction receipt is unavailable", 404)
            receipt = next((item for item in reversed(self.results)
                            if item["requestId"] == request_id), None)
            result = {"requestId": request_id, "roomId": issued["roomId"],
                      "objectId": issued["objectId"], "assetId": issued["assetId"],
                      "action": issued["action"], "sceneRevision": self.revision}
            if receipt is None:
                result["status"] = "queued" if request_id in self.pending else "unconfirmed"
            elif not receipt["ok"]:
                result["status"] = ("unconfirmed" if "outcome unknown" in receipt["error"]
                                    else "failed")
                if result["status"] == "failed":
                    result["error"] = receipt["error"][:200]
            else:
                current = self.latest
                obj = (next((item for item in current["scene"]["objects"]
                             if item["objectId"] == issued["objectId"] and
                             item["assetId"] == issued["assetId"]), None)
                       if current and current["scene"]["roomId"] == issued["roomId"] else None)
                expected = issued["interaction"]
                result["status"] = ("succeeded" if obj and
                                    obj.get("interaction") == expected else "unconfirmed")
                if result["status"] == "succeeded" and expected is not None:
                    result["interaction"] = copy.deepcopy(expected)
            return result

    def agent_publish_component(self, value):
        require(isinstance(value, dict) and set(value) == {"package"},
                "Invalid component publication")
        entry = self.web_components.publish(value["package"])
        return {"status": "published", "componentId": entry["componentId"],
                "sha256": entry["sha256"], "name": entry["package"]["name"],
                "outputs": sorted(entry["package"]["outputs"])}

    def agent_list_components(self, offset=0, limit=24):
        require(type(offset) is int and 0 <= offset <= 63 and type(limit) is int and 1 <= limit <= 24,
                "Invalid Matrix component page")
        items = self.web_components.list()
        return {"total": len(items), "offset": offset, "components": [
            {"componentId": item["componentId"], "sha256": item["sha256"],
             "name": item["package"]["name"], "outputs": sorted(item["package"]["outputs"])}
            for item in items[offset:offset + limit]]}

    def agent_component_action(self, value):
        require(type(value) is dict and value.get("action") in ("attach", "stop", "remove"),
                "Invalid Matrix component action")
        action = value["action"]
        required = {"action", "room_id", "scene_revision", "object_id", "expected_asset_id", "component_id"}
        if action == "attach":
            required.add("target_object_id")
        require(set(value) == required, "Invalid Matrix component action fields")
        room_id = text(value["room_id"], "room_id")
        object_id = text(value["object_id"], "object_id")
        asset_id = text(value["expected_asset_id"], "expected_asset_id")
        component_id = text(value["component_id"], "component_id")
        require(COMPONENT_ID.fullmatch(component_id) is not None, "Invalid component ID")
        revision = value["scene_revision"]
        require(type(revision) is int and revision >= 0, "Invalid scene revision")
        target_id = text(value["target_object_id"], "target_object_id") if action == "attach" else None
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            current = self.latest
            require(current["scene"]["roomId"] == room_id and self.revision == revision,
                    "Matrix scene changed; inspect the current room and retry", 409)
            require(current.get("componentSchemaVersion") == 1 and
                    web_virtual_floor_ready(current),
                    "Connected WebXR virtual floor does not support components", 409)
            require(not current.get("readOnly") and not self.pending,
                    "Matrix world is not ready for a component action", 409)
            objects = current["scene"]["objects"]
            item = next((item for item in objects if item["objectId"] == object_id), None)
            require(item is not None and item["assetId"] == asset_id and item["anchorId"] == "web-floor",
                    "Component object is no longer available on the virtual floor", 409)
            if action == "attach":
                require("component" not in item, "Remove existing component first", 409)
                target = next((other for other in objects if other["objectId"] == target_id), None)
                require(target is not None and target["anchorId"] == "web-floor" and target_id != object_id,
                        "Component target is unavailable on the virtual floor", 409)
                package = self.web_components.get(component_id)["package"]
                command_value = {"op": "attach_component", "objectId": object_id,
                                 "targetObjectId": target_id, "componentId": component_id,
                                 "package": package}
            else:
                component = item.get("component")
                require(component is not None and component["componentId"] == component_id,
                        "Expected component is no longer attached", 409)
                require(action != "stop" or component["status"] == "running",
                        "Component is not running; remove it instead", 409)
                command_value = {"op": f"{action}_component", "objectId": object_id}
            queued = self.queue([command_value])["commands"][0]
            request_id = queued["requestId"]
            self.agent_component_ids[request_id] = {"action": action, "roomId": room_id,
                                                    "objectId": object_id, "componentId": component_id,
                                                    "targetObjectId": target_id}
            while len(self.agent_component_ids) > 64:
                self.agent_component_ids.popitem(last=False)
            return self.agent_component_status(request_id)

    def agent_component_status(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[0-9a-f]{32}", request_id),
                "Invalid Matrix component receipt ID")
        with self.lock:
            self.expire()
            issued = self.agent_component_ids.get(request_id)
            require(issued is not None, "Matrix component receipt is unavailable", 404)
            receipt = next((item for item in reversed(self.results) if item["requestId"] == request_id), None)
            result = {"requestId": request_id, "roomId": issued["roomId"],
                      "objectId": issued["objectId"], "componentId": issued["componentId"],
                      "action": issued["action"], "sceneRevision": self.revision}
            if receipt is None:
                result["status"] = "queued" if request_id in self.pending else "unconfirmed"
            elif not receipt["ok"]:
                result["status"] = "unconfirmed" if "outcome unknown" in receipt["error"] else "failed"
                if result["status"] == "failed":
                    result["error"] = receipt["error"][:200]
            else:
                observed = self.latest and self.latest["scene"]["roomId"] == issued["roomId"] and next(
                    (item for item in self.latest["scene"]["objects"] if item["objectId"] == issued["objectId"]), None)
                component = observed.get("component") if observed else None
                if issued["action"] == "remove":
                    result["status"] = "succeeded" if observed and component is None else "unconfirmed"
                elif component and component["componentId"] == issued["componentId"]:
                    result["runtimeStatus"] = component["status"]
                    if component["status"] == "failed":
                        result["status"] = "failed"
                        result["error"] = component.get("error", "Component failed")
                    elif issued["action"] == "stop":
                        result["status"] = "succeeded" if component["status"] == "stopped" else "unconfirmed"
                    else:
                        result["status"] = "succeeded" if component["targetObjectId"] == issued["targetObjectId"] else "unconfirmed"
                else:
                    result["status"] = "unconfirmed"
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

    def world_checkpoint_path(self, name):
        self.path(name)  # Reuse the legacy name and reserved-device checks.
        directory = self.directory / "world_checkpoints"
        require(not directory.is_symlink(), "World checkpoint links are not supported")
        target = directory / (name + ".json")
        require(not target.is_symlink(), "World checkpoint links are not supported")
        return target

    def _world_checkpoint_ready(self):
        self.expire()
        require(self.online() and self.latest is not None, "Web runtime is offline; reconnect before using a world checkpoint", 409)
        require(not self.pending and not self.content.busy(), "Wait for pending world commands before using a checkpoint", 409)
        current = self.latest
        require(current["scene"]["roomId"] == "web-virtual-room-v1" and
                (current.get("roomContext") or {}).get("mode") == "white-room" and
                (current.get("roomContext") or {}).get("state") == "ready" and
                not current.get("readOnly"),
                "Whole-world PC checkpoints require the desktop virtual room; leave AR or recover its origin first", 409)
        return current

    def _checked_world_checkpoint(self, value, current):
        require(type(value) is dict and type(value.get("version")) is int and
                (value["version"] == 2 and set(value) == {"version", "scene", "game"} or
                 value["version"] == 3 and set(value) == {"version", "scene", "game", "citizens"} and
                 value["citizens"] is not None),
                "Unsupported world checkpoint envelope")
        checked_scene = scene(value["scene"])
        require(checked_scene == value["scene"] and checked_scene["roomId"] == "web-virtual-room-v1" and
                all(item["anchorId"] == "web-floor" for item in checked_scene["objects"]),
                "World checkpoint contains unsupported scene data or session-local anchors")
        capabilities = {key: current[key] for key in ("componentSchemaVersion", "animationSchemaVersion",
                                                     "physicsSchemaVersion", "interactionSchemaVersion",
                                                     "behaviorKinds")
                        if key in current}
        snapshot({"scene": checked_scene, "assets": current["assets"], "anchors": current["anchors"],
                  **capabilities})
        if value["version"] == 3:
            validate_citizens_checkpoint(value["citizens"], checked_scene)
        supported = set(current.get("behaviorKinds", []))
        require(all(behavior["kind"] in supported for item in checked_scene["objects"]
                    for behavior in item.get("behaviors", [])),
                "Saved behaviors are unavailable in the connected browser", 409)
        referenced = {item["assetId"] for item in checked_scene["objects"]}
        try:
            validate_saved_game(value["game"], checked_scene, current)
        except (ValueError, TypeError, KeyError) as error:
            raise APIError(400, str(error) or "Invalid saved game") from None
        if value["game"] is not None:
            referenced.update(role["assetId"] for role in value["game"]["spec"]["roles"])
        available = {item["assetId"] for item in current["assets"]}
        require(referenced <= available, "World checkpoint asset is unavailable in the connected browser", 409)
        browser_assets = {item["assetId"]: item for item in current["assets"]}
        for obj in checked_scene["objects"]:
            if "interaction" in obj:
                require_registered_interaction(obj, current["assets"], self.web_assets)
        try:
            catalog = ({item["assetId"]: item for item in self.web_assets.list()}
                       if any(asset_id.startswith("web:") for asset_id in referenced) else {})
            dependencies = []
            for asset_id in sorted(referenced):
                if not asset_id.startswith("web:"):
                    continue
                entry = catalog.get(asset_id)
                require(entry is not None, f"World asset {asset_id} is missing from the PC catalog", 409)
                self.web_assets.file(entry["sha256"])
                browser_entry = browser_assets[asset_id]
                clips = [clip["name"] for clip in entry["geometry"].get("animationClips", [])]
                require(browser_entry.get("spawnScale", 1) == entry.get("spawnScale", 1) and
                        browser_entry.get("localBounds") == entry.get("localBounds") and
                        browser_entry.get("animationClips", []) == clips,
                        "Browser asset metadata is stale; refresh assets and retry", 409)
                dependencies.append({"assetId": asset_id, "sha256": entry["sha256"],
                                     "spawnScale": entry.get("spawnScale", 1),
                                     "animationClips": clips,
                                     **({"localBounds": entry["localBounds"]} if "localBounds" in entry else {})})
        except WebAssetError as error:
            raise APIError(409, f"World GLB is missing or corrupt: {error}. Restore the matching asset catalog and retry") from None
        return dependencies

    def save_world_checkpoint(self, name, world):
        target = self.world_checkpoint_path(name)
        with self.lock:
            current = self._world_checkpoint_ready()
            dependencies = self._checked_world_checkpoint(world, current)
            require(world["scene"] == current["scene"],
                    "Browser world changed since the last exchange; sync it and retry saving", 409)
            saved_world = copy.deepcopy(world)
            for item in saved_world["scene"]["objects"]:
                if "component" in item:
                    # Preserve the attachment configuration and status, not its elapsed-time phase.
                    item["component"]["startedAtMs"] = 0
            document = {"schemaVersion": 1, "world": saved_world,
                        "dependencies": dependencies,
                        "payloadSha256": world_checkpoint_digest(saved_world, dependencies)}
            data = json.dumps(document, ensure_ascii=False, allow_nan=False, indent=2).encode("utf-8")
            require(len(data) <= MAX_BODY, "World checkpoint exceeds save size limit", 413)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".saving-world-", delete=False) as handle:
                    temporary = handle.name
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, target)
                temporary = None
            finally:
                if temporary is not None:
                    os.unlink(temporary)
            return {"name": name, "saved": True, "schemaVersion": 1, "dependencies": dependencies}

    def load_world_checkpoint(self, name):
        target = self.world_checkpoint_path(name)
        require(target.is_file(), "World checkpoint not found", 404)
        with target.open("rb") as handle:
            data = handle.read(MAX_BODY + 1)
        require(len(data) <= MAX_BODY, "World checkpoint exceeds size limit", 413)
        document = parse_json(data)
        require(type(document) is dict and set(document) ==
                {"schemaVersion", "world", "dependencies", "payloadSha256"} and
                type(document["schemaVersion"]) is int and document["schemaVersion"] == 1 and
                type(document["payloadSha256"]) is str and
                re.fullmatch(r"[0-9a-f]{64}", document["payloadSha256"]) is not None and
                type(document["dependencies"]) is list,
                "Unsupported or corrupt world checkpoint")
        try:
            digest = world_checkpoint_digest(document["world"], document["dependencies"])
        except (TypeError, ValueError, RecursionError):
            raise APIError(400, "Corrupt world checkpoint payload") from None
        require(digest == document["payloadSha256"], "World checkpoint payload is corrupt")
        with self.lock:
            current = self._world_checkpoint_ready()
            dependencies = self._checked_world_checkpoint(document["world"], current)
            require(document["dependencies"] == dependencies,
                    "World checkpoint asset version changed; restore the matching PC asset catalog", 409)
            restored_world = copy.deepcopy(document["world"])
            started_at_ms = int(time.time() * 1000)
            for item in restored_world["scene"]["objects"]:
                if item.get("component", {}).get("status") == "running":
                    item["component"]["startedAtMs"] = started_at_ms
            return {"name": name, "schemaVersion": 1, "world": restored_world,
                    "dependencies": dependencies, "expectedRevision": self.revision}

    def world_checkpoints(self):
        directory = self.directory / "world_checkpoints"
        require(not directory.is_symlink(), "World checkpoint links are not supported")
        return {"worlds": sorted(path.stem for path in directory.glob("*.json")
                                 if NAME.fullmatch(path.stem) and path.is_file() and not path.is_symlink())}

    def save(self, name):
        target = self.path(name)
        with self.lock:
            self.expire()
            require(self.online() and self.latest is not None, self.room_unavailable_message(), 409)
            require(not self.pending, "Wait for all queued commands to finish before saving", 409)
            saved = copy.deepcopy(self.latest)
            saved.pop("viewer", None)
            saved.pop("pointing", None)
            saved.pop("physicsStates", None)  # Solver pose, velocity and contacts are transient.
            saved.pop("citizensObservation", None)  # Runtime motion/authoring marker is not a scene document.
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

    def proposal_is_current(self, proposal):
        """Caller holds lock; broad edits and plan-specific observed poses must match."""
        return (self.online() and self.latest is not None and
                proposal["clientId"] == self.client_id and
                proposal["revision"] == self.revision and
                self.clock() <= proposal["expires"] and
                resident_motion_current(self.latest, proposal.get("motionDependencies", {})))

    def apply_plan(self, plan_id):
        text(plan_id, "planId")
        with self.lock:
            self.expire()
            proposal = self.proposals.pop(plan_id, None)
            require(proposal is not None, "Proposal expired or already applied; create a new proposal", 409)
            require(self.online() and not self.pending, "Runtime must be connected with no pending commands", 409)
            require(self.proposal_is_current(proposal),
                    "Scene or selection changed; create a new proposal", 409)
            commands = proposal["commands"]
            if commands[0]["op"] == "save_scene":
                return self.save(commands[0]["name"])
            if commands[0]["op"] == "load_scene":
                return self.load(commands[0]["name"])
            return self.queue(commands, ordered=True)


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
        game_scene_at_request = scene_revision_data(current, include_observed_motion=True)
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
                    and not state.pending and
                    game_scene_at_request ==
                    scene_revision_data(state.latest, include_observed_motion=True),
                    "Scene changed during game planning; try again", 409)
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
    # The finite offline grammar can name a selected object or an explicit
    # command target. An AI/visual/voice proposal can depend on any actor pose,
    # including references not visible in its final command shape. Keep those
    # strict until the planner has a trusted dependency contract.
    independent_offline = (proposed.get("mode") == "offline-rules" and
                           screenshot is None and not experiment and
                           all(item["op"] in {"spawn", "select", "duplicate", "delete",
                                               "set_transform", "set_behavior", "remove_behavior"}
                               for item in checked))
    motion_dependencies = resident_motion_dependencies(current, checked,
                                                       strict=not independent_offline)
    # A resident may move after Apply but before the browser receives the
    # queued command. Carry the captured pose into the runtime command so the
    # executor can return a failed receipt instead of editing a later pose.
    # Planner output cannot provide or override this server-derived condition.
    expected_poses = copy.deepcopy(motion_dependencies)
    for item in checked:
        object_id = item.get("objectId")
        if item["op"] in RESIDENT_PRECONDITION_OPS and object_id in expected_poses:
            item["expectedTransform"] = copy.deepcopy(expected_poses[object_id])
            if item["op"] == "set_transform":
                # Commands are delivered in order. The desktop virtual floor
                # preserves this validated transform exactly, so a subsequent
                # command must expect the pose produced by this one.
                expected_poses[object_id] = copy.deepcopy(item["transform"])
        if item["op"] == "attach_component" and item["targetObjectId"] in expected_poses:
            # The component may bind a static source to a moving resident.
            # Its target pose is a dependency even when objectId is unrelated.
            item["expectedTargetTransform"] = copy.deepcopy(expected_poses[item["targetObjectId"]])
    with state.lock:
        state.expire()
        require(state.online() and state.client_id == client_id and state.revision == revision
                and not state.pending, "Scene changed during planning; try again", 409)
        candidate = {"clientId": client_id, "revision": revision,
                     "expires": state.clock() + 120,
                     "commands": copy.deepcopy(checked),
                     "motionDependencies": motion_dependencies}
        require(state.proposal_is_current(candidate),
                "Resident pose changed during planning; try again", 409)
        plan_id = uuid.uuid4().hex
        state.proposals[plan_id] = candidate
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
                    or state.clock() > job.get("gameExpires", 0) or
                    not resident_motion_current(state.latest, job.get("motionDependencies", {}))):
                job["public"].update(phase="error", requiresApply=False,
                                     error="World changed or game proposal expired. Speak again.")
        elif job["public"]["phase"] == "ready" and job["public"].get("planId") not in state.proposals:
            job["public"].update(phase="finished", requiresApply=False)
        if job["public"]["phase"] == "ready" and "gamePlan" not in job["public"]:
            proposal = state.proposals[job["public"]["planId"]]
            if not state.proposal_is_current(proposal):
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
        require(scene_revision_data(captured, include_observed_motion=True) ==
                scene_revision_data(state.latest, include_observed_motion=True),
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
        job = {"public": public, "clientId": client_id, "revision": state.revision,
               "motionDependencies": resident_motion_dependencies(captured, strict=True),
               "cancelled": False}
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
        self.state.client_pairing_enabled = len(token) >= 24
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
            if path in ("/web", "/web/", "/web/citizens.html") or path.startswith("/web/assets/"):
                dist = Path(__file__).resolve().parent.parent / "WebRuntime" / "dist"
                if path in ("/web", "/web/", "/web/citizens.html"):
                    asset = dist / ("citizens.html" if path == "/web/citizens.html" else "index.html")
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
            elif path == "/api/web/worlds":
                data = self.server.state.world_checkpoints()
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
            elif path == "/api/web/world/save":
                require(set(body) == {"name", "world"}, "World checkpoint needs name and world")
                data = state.save_world_checkpoint(body["name"], body["world"])
            elif path == "/api/web/world/load":
                require(set(body) == {"name"}, "World checkpoint load needs a name")
                data = state.load_world_checkpoint(body["name"])
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
