"""Provider-neutral Matrix agent-session contract and local Codex adapter.

The gateway filters internal native conversation IDs and maps them to opaque
Matrix session IDs before responding to a browser. Raw app-server events,
command arguments, tool outputs, and credentials stay on PC.
"""
from __future__ import annotations

from pathlib import Path
import hashlib
import importlib
import json
import math
import re
import sys
from typing import Protocol

from codex_app_server import AppServerTransport
from codex_provider import CodexConfig
from ai_adapter import PlannerError
import scale_experiment
from web_component_catalog import _identity
from web_components import ComponentError, validate_package


MAX_XR_APPROVAL_SUMMARY = 240


class MatrixMCPUnavailableError(RuntimeError):
    """The service Python cannot launch its optional Matrix MCP tool server."""


class AgentSessionBackend(Protocol):
    """The gateway-facing surface; future hosted backends can implement it."""

    def start(self) -> None: ...
    def start_conversation(self) -> str: ...
    def resume_conversation(self, conversation_id: str) -> str: ...
    def send_text(self, conversation_id: str, text: str, *, image_path: str | Path | None = None) -> str: ...
    def steer(self, conversation_id: str, turn_id: str, text: str) -> None: ...
    def start_native_image(self, conversation_id: str, text: str) -> str: ...
    def poll(self, cursor: int) -> tuple[int, list[dict]]: ...
    def events_since(self, cursor: int) -> list[dict]: ...
    def pending_approvals(self) -> list[dict]: ...
    def pending_pc_commands(self) -> list[dict]: ...
    def decide(self, approval_id: int | str, conversation_id: str, turn_id: str, approve: bool) -> None: ...
    def cancel(self, conversation_id: str, turn_id: str) -> None: ...
    def native_image_capability(self) -> tuple[bool, str | None]: ...
    def image_generation_result(self, conversation_id: str, turn_id: str) -> dict | None: ...
    def close(self) -> None: ...
    @property
    def access_mode(self) -> str: ...
    @property
    def approval_mode(self) -> str: ...


def _identifier(value):
    return value if isinstance(value, str) and 1 <= len(value) <= 128 and not any(ord(c) < 32 for c in value) else None


def _kind(item):
    if not isinstance(item, dict):
        return None
    kind = item.get("type")
    if kind == "commandExecution":
        return "running_command"
    if kind == "fileChange":
        return "editing_files"
    if kind == "mcpToolCall":
        server = item.get("server")
        return "using_blender" if isinstance(server, str) and "blender" in server.lower() else "using_tool"
    return None


_LITERAL_CREATE = re.compile(
    r"\[System\.IO\.File\]::WriteAllText\('([^'\r\n]+)',\s*'([A-Za-z0-9 .,_-]{0,100})'\)\Z"
)
_BUNDLED_PWSH = re.compile(r'"([^"\r\n]+)" -Command "([^"\r\n]+)"\Z', re.IGNORECASE)


def _approval_description(method: str, params: dict, cwd: Path) -> tuple[str, bool]:
    """Only one easily reviewed file-creation form may be approved in XR."""
    if method == "item/fileChange/requestApproval":
        return "Codex requests file changes. This change needs PC review before approval.", False
    command = params.get("command")
    if not isinstance(command, str):
        return "Codex requests a command. Its effect cannot be reviewed in XR.", False
    wrapper = _BUNDLED_PWSH.fullmatch(command)
    if wrapper:
        shell_parts = tuple(part.lower() for part in Path(wrapper[1]).parts)
        if ("codex-runtimes" not in shell_parts or
                shell_parts[-4:] != ("dependencies", "native", "powershell", "pwsh.exe")):
            return "Codex requests a command. Its effect cannot be reviewed in XR.", False
        command = wrapper[2]
    match = _LITERAL_CREATE.fullmatch(command)
    if match:
        try:
            root = cwd.resolve()
            target = (root / match[1]).resolve()
            relative = target.relative_to(root)
            if (not target.exists() and relative.parts and
                    all(re.fullmatch(r"[A-Za-z0-9._-]+", part) for part in relative.parts)):
                return (f"Create one new file in the Matrix repository: {relative.as_posix()} "
                        f"({len(match[2])} literal characters).", True)
        except (OSError, ValueError):
            pass
    return "Codex requests a command. Its effect cannot be reviewed in XR.", False


MAX_PC_COMMAND_REVIEW = 64 * 1024

_XR_ENTITY_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}\Z")
_XR_RECEIPT_ID = re.compile(r"[0-9a-f]{32}\Z")


def _xr_entity_id(value):
    return type(value) is str and _XR_ENTITY_ID.fullmatch(value) is not None


def _xr_context(arguments, fields, *, revision=True):
    required = set(fields) | {"room_id"} | ({"scene_revision"} if revision else set())
    return (type(arguments) is dict and set(arguments) == required and
            _xr_entity_id(arguments["room_id"]) and
            (not revision or type(arguments["scene_revision"]) is int and
             0 <= arguments["scene_revision"] <= 9007199254740991))


def _xr_pose(value):
    from server import transform, APIError
    try:
        return type(value) is dict and transform(value) == value
    except (APIError, TypeError, ValueError):
        return False


def _xr_pose_summary(value):
    return ", ".join(f"{name[0]}=({value[name]['x']},{value[name]['y']},{value[name]['z']})"
                     for name in ("position", "rotation", "scale"))


def _xr_bounded_vector(value, lower, upper):
    return (type(value) is dict and set(value) == {"x", "y", "z"} and
            all(type(value[axis]) in (int, float) and math.isfinite(value[axis]) and
                lower <= value[axis] <= upper for axis in ("x", "y", "z")))


def _xr_parameters(value, *, patch=False):
    from procedural_contract import PARAMETER_NAME
    return (type(value) is dict and (0 < len(value) <= 24 if patch else len(value) <= 24) and
            all(type(name) is str and PARAMETER_NAME.fullmatch(name) and
                (type(item) is bool or type(item) in (int, float) and
                 math.isfinite(item)) for name, item in value.items()))


def _xr_game_summary(tool, arguments):
    """Describe every rule in a compact, fully validated v2 challenge."""
    from web_game import validate_game_plan
    spec, bindings = arguments["spec"], arguments["bindings"]
    if (type(spec) is not dict or type(spec.get("schemaVersion")) is not int or
            spec["schemaVersion"] != 2 or spec.get("kind") != "game" or
            type(spec.get("roles")) is not list):
        return None
    try:
        assets = [{"assetId": role["assetId"]} for role in spec["roles"]]
        validate_game_plan(spec, {"assets": assets})
        roles = spec["roles"]
        if (len(roles) > 4 or len(spec["rules"]) > 2 or
                len(spec["objectives"]) > 2 or len(spec["consequences"]) > 1 or
                type(bindings) is not dict or
                set(bindings) != {role["roleId"] for role in roles}):
            return None
        if not all(_xr_entity_id(role["assetId"]) for role in roles):
            return None
        bound = []
        for role in roles:
            ids = bindings[role["roleId"]]
            if type(ids) is not list or len(ids) != role["count"] or not all(
                    _xr_entity_id(item) for item in ids):
                return None
            bound.extend(ids)
        if len(bound) > 8 or len(set(bound)) != len(bound):
            return None
        prefix_length = next((length for length in range(8, 17)
                              if len({identifier[:length] for identifier in bound}) == len(bound)), None)
        if prefix_length is None:
            return None
        digest = hashlib.sha256(json.dumps({"spec": spec, "bindings": bindings},
            sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:12]
        common_goal = (len(spec["objectives"]) == 2 and
                       all(item["kind"] == "delivered-count" for item in spec["objectives"]))
        goals = ",".join(f"{'' if common_goal else 'deliver '}{item['roleId']}>={item['targetCount']}" if
                         item["kind"] == "delivered-count" else
                         f"score>={item['targetPoints']}" for item in spec["objectives"])
        if common_goal:
            goals = "deliver " + goals
        unlock = (f", unlock {spec['consequences'][0]['roleId']}" if
                  spec["consequences"] else "")
        verb = "Bind" if tool == "matrix_bind_game" else "Revise"
        common_rule = (len(spec["rules"]) == 2 and all(
            spec["rules"][0][key] == spec["rules"][1][key]
            for key in ("event", "targetRoleId", "distanceMeters", "scorePoints")))
        if common_rule:
            first, second = spec["rules"]
            rules = (f"{first['event']} {first['actorRoleId']}|{second['actorRoleId']}"
                     f"->{first['targetRoleId']}<={first['distanceMeters']}m+{first['scorePoints']}")
        else:
            common_event = (spec["rules"][0]["event"] if len(spec["rules"]) == 2 and
                            spec["rules"][0]["event"] == spec["rules"][1]["event"] else None)
            rules = ";".join(f"{rule['actorRoleId']}->{rule['targetRoleId']}"
                              f"{' ' + rule['event'] if common_event is None else ''}"
                              f"<={rule['distanceMeters']}m+{rule['scorePoints']}"
                              for rule in spec["rules"])
            if common_event is not None:
                rules = f"{common_event}: {rules}"
        role_targets = ",".join(
            f"{role['roleId']}/{role['assetId']}@" +
            "+".join(identifier[:prefix_length] for identifier in bindings[role["roleId"]])
            for role in roles)
        return (f"{verb} {json.dumps(spec['title'], ensure_ascii=True)} "
                f"{arguments['room_id']} r{arguments['scene_revision']}: "
                f"{rules}; {goals}{unlock}; {role_targets}; "
                f"{len(bound)} IDs SHA {digest}")
    except (KeyError, TypeError, ValueError, OverflowError):
        return None


def _new_matrix_approval_summary(tool, arguments):
    """Return an exact bounded intent, or decline XR review of unfamiliar input."""
    from procedural_contract import GENERATOR_ID
    from server import (APIError, control_descriptor, display_descriptor,
                        grab_pose, rigid_body_config,
                        rigid_gravity)
    try:
        if tool == 'matrix_set_manipulation':
            required = {'room_id', 'scene_revision', 'object_id', 'expected_asset_id', 'manipulation'}
            if (type(arguments) is dict and set(arguments) == required and
                    all(_xr_entity_id(arguments[k]) for k in ('room_id', 'object_id', 'expected_asset_id')) and
                    type(arguments['scene_revision']) is int and
                    0 <= arguments['scene_revision'] <= 9007199254740991 and
                    type(arguments['manipulation']) is str and
                    arguments['manipulation'] in ('grabbable', 'locked', 'environment')):
                summary = (f"Set {arguments['expected_asset_id']} ({arguments['object_id']}) manipulation "
                           f"to {arguments['manipulation']} in {arguments['room_id']} rev {arguments['scene_revision']}.")
                if len(summary) <= MAX_XR_APPROVAL_SUMMARY:
                    return summary
        if tool == "matrix_move_with_room_constraint":
            required = {"room_id", "scene_revision", "spatial_token", "anchor_id",
                        "object_id", "expected_asset_id", "position"}
            if (type(arguments) is dict and
                    required <= set(arguments) <= required | {"rotation", "scale"} and
                    _xr_entity_id(arguments["room_id"]) and
                    arguments["room_id"].startswith("webxr-session-") and
                    type(arguments["scene_revision"]) is int and
                    0 <= arguments["scene_revision"] <= 9007199254740991 and
                    type(arguments["spatial_token"]) is str and
                    re.fullmatch(r"[0-9a-f]{64}", arguments["spatial_token"]) and
                    _xr_entity_id(arguments["anchor_id"]) and
                    arguments["anchor_id"].startswith("webxr-plane-") and
                    _xr_entity_id(arguments["object_id"]) and
                    _xr_entity_id(arguments["expected_asset_id"]) and
                    _xr_bounded_vector(arguments["position"], -100, 100) and
                    ("rotation" not in arguments or
                     _xr_bounded_vector(arguments["rotation"], -36000, 36000)) and
                    ("scale" not in arguments or
                     _xr_bounded_vector(arguments["scale"], .01, 20))):
                point = arguments["position"]
                optional = ""
                if "rotation" in arguments:
                    turn = arguments["rotation"]
                    optional += f", rotation ({turn['x']},{turn['y']},{turn['z']}) degrees"
                if "scale" in arguments:
                    size = arguments["scale"]
                    optional += f", scale ({size['x']},{size['y']},{size['z']})"
                summary = (f"Move {arguments['expected_asset_id']} ({arguments['object_id']}) to "
                           f"web-floor ({point['x']},{point['y']},{point['z']}){optional} "
                           f"constrained by measured AR surface {arguments['anchor_id']} "
                           f"in {arguments['room_id']} rev {arguments['scene_revision']}.")
                if len(summary) <= MAX_XR_APPROVAL_SUMMARY:
                    return summary
                # Real measured coordinates can carry full float precision. Keep
                # every reviewed value exact while shortening only the prose.
                compact = (f"Move {arguments['expected_asset_id']} "
                           f"({arguments['object_id']}) web-floor "
                           f"({point['x']},{point['y']},{point['z']})")
                if "rotation" in arguments:
                    turn = arguments["rotation"]
                    compact += f" rot({turn['x']},{turn['y']},{turn['z']})"
                if "scale" in arguments:
                    size = arguments["scale"]
                    compact += f" scale({size['x']},{size['y']},{size['z']})"
                compact += (f" AR support {arguments['anchor_id']} "
                            f"room {arguments['room_id']} rev {arguments['scene_revision']}.")
                return compact if len(compact) <= MAX_XR_APPROVAL_SUMMARY else None
        elif tool == "matrix_spawn_on_surface":
            if (_xr_context(arguments, {"spatial_token", "asset_id", "anchor_id", "transform"}) and
                    arguments["room_id"].startswith("webxr-session-") and
                    type(arguments["spatial_token"]) is str and
                    re.fullmatch(r"[0-9a-f]{64}", arguments["spatial_token"]) and
                    _xr_entity_id(arguments["asset_id"]) and
                    _xr_entity_id(arguments["anchor_id"]) and
                    arguments["anchor_id"].startswith("webxr-plane-") and
                    _xr_pose(arguments["transform"])):
                return (f"Place {arguments['asset_id']} on measured AR surface "
                        f"{arguments['anchor_id']} in {arguments['room_id']} "
                        f"rev {arguments['scene_revision']}: "
                        f"{_xr_pose_summary(arguments['transform'])}. "
                        "Store as a persistent web-floor world object.")
        elif tool == "matrix_spawn_builtin":
            if (_xr_context(arguments, {"asset_id", "transform"}) and
                    type(arguments["asset_id"]) is str and
                    re.fullmatch(r"[A-Za-z][A-Za-z0-9._-]{0,127}", arguments["asset_id"]) and
                    _xr_pose(arguments["transform"])):
                return (f"Spawn built-in {arguments['asset_id']} in {arguments['room_id']} "
                        f"rev {arguments['scene_revision']}: {_xr_pose_summary(arguments['transform'])}.")
        elif tool == "matrix_create_procedural":
            if (_xr_context(arguments, {"generator_id", "parameters", "transform"}) and
                    type(arguments["generator_id"]) is str and
                    GENERATOR_ID.fullmatch(arguments["generator_id"]) and
                    _xr_parameters(arguments["parameters"]) and
                    _xr_pose(arguments["transform"])):
                params = json.dumps(arguments["parameters"], sort_keys=True, separators=(",", ":"))
                return (f"Create procedural {arguments['generator_id']} in {arguments['room_id']} "
                        f"rev {arguments['scene_revision']}, params {params}, "
                        f"{_xr_pose_summary(arguments['transform'])}.")
        elif tool == "matrix_update_procedural":
            if (_xr_context(arguments, {"object_id", "expected_source_revision", "parameters_patch"}) and
                    _xr_entity_id(arguments["object_id"]) and
                    type(arguments["expected_source_revision"]) is str and
                    GENERATOR_ID.fullmatch(arguments["expected_source_revision"]) and
                    _xr_parameters(arguments["parameters_patch"], patch=True)):
                patch = json.dumps(arguments["parameters_patch"], sort_keys=True, separators=(",", ":"))
                return (f"Regenerate {arguments['object_id']} in {arguments['room_id']} "
                        f"rev {arguments['scene_revision']} from {arguments['expected_source_revision']}: "
                        f"params {patch}.")
        elif tool in ("matrix_bind_game", "matrix_update_game"):
            if _xr_context(arguments, {"spec", "bindings"}):
                return _xr_game_summary(tool, arguments)
        elif tool == "matrix_set_display":
            if _xr_context(arguments, {"object_id", "display"}) and _xr_entity_id(arguments["object_id"]):
                display = display_descriptor(arguments["display"])
                binding = display["binding"]
                label = "none" if binding is None else binding["kind"] + (
                    ":" + binding["objectId"] if "objectId" in binding else "")
                return (f"Set display on {arguments['object_id']} in {arguments['room_id']} "
                        f"rev {arguments['scene_revision']}: title "
                        f"{json.dumps(display['title'], ensure_ascii=True)}, body "
                        f"{json.dumps(display['body'], ensure_ascii=True)}, binding {label}.")
        elif tool == "matrix_remove_display":
            if _xr_context(arguments, {"object_id"}) and _xr_entity_id(arguments["object_id"]):
                return (f"Remove display from {arguments['object_id']} in "
                        f"{arguments['room_id']} rev {arguments['scene_revision']}.")
        elif tool == "matrix_set_control":
            if (_xr_context(arguments, {"object_id", "control"}) and
                    _xr_entity_id(arguments["object_id"])):
                control = control_descriptor(arguments["control"])
                action = control["action"]
                return (f"Set control {json.dumps(control['label'], ensure_ascii=True)} "
                        f"on {arguments['object_id']} in {arguments['room_id']} "
                        f"rev {arguments['scene_revision']}: cycle "
                        f"{action['targetObjectId']} scale through "
                        f"{json.dumps(action['values'], separators=(',', ':'))}.")
        elif tool == "matrix_remove_control":
            if _xr_context(arguments, {"object_id"}) and _xr_entity_id(arguments["object_id"]):
                return (f"Remove control from {arguments['object_id']} in "
                        f"{arguments['room_id']} rev {arguments['scene_revision']}.")
        elif tool == "matrix_set_rigid_body":
            if _xr_context(arguments, {"object_id", "rigid_body"}) and _xr_entity_id(arguments["object_id"]):
                body = rigid_body_config(arguments["rigid_body"])
                return (f"Set {body['type']} {body['collider']} rigid body on "
                        f"{arguments['object_id']} in {arguments['room_id']} "
                        f"rev {arguments['scene_revision']}: restitution {body['restitution']}, "
                        f"friction {body['friction']}, sensor {body['sensor']}.")
        elif tool == "matrix_remove_rigid_body":
            if _xr_context(arguments, {"object_id"}) and _xr_entity_id(arguments["object_id"]):
                return (f"Remove rigid body from {arguments['object_id']} in "
                        f"{arguments['room_id']} rev {arguments['scene_revision']}.")
        elif tool == "matrix_set_gravity":
            if _xr_context(arguments, {"gravity"}):
                g = rigid_gravity(arguments["gravity"])
                return (f"Set virtual gravity ({g['x']},{g['y']},{g['z']}) m/s2 in "
                        f"{arguments['room_id']} rev {arguments['scene_revision']}.")
        elif tool in ("matrix_begin_grab", "matrix_move_grab", "matrix_release_grab",
                      "matrix_activate_control"):
            fields = {"object_id", "inspection_request_id"} | (
                {"target_pose"} if tool == "matrix_move_grab" else set())
            if (_xr_context(arguments, fields, revision=False) and
                    _xr_entity_id(arguments["object_id"]) and
                    type(arguments["inspection_request_id"]) is str and
                    _XR_RECEIPT_ID.fullmatch(arguments["inspection_request_id"])):
                pose = ""
                if tool == "matrix_move_grab":
                    target = grab_pose(arguments["target_pose"])
                    pose = (f" to ({target['position']['x']},{target['position']['y']},"
                            f"{target['position']['z']}) m, rotation "
                            f"({target['rotation']['x']},{target['rotation']['y']},"
                            f"{target['rotation']['z']}) degrees")
                verb = {"matrix_begin_grab": "Begin grab of", "matrix_move_grab": "Move held",
                        "matrix_release_grab": "Release",
                        "matrix_activate_control": "Activate control"}[tool]
                return (f"{verb} {arguments['object_id']}{pose} in {arguments['room_id']} "
                        f"using live inspection {arguments['inspection_request_id']}.")
        elif tool in ("matrix_start_new_world", "matrix_restore_world_archive"):
            fields = {"archive_name"} | ({"archive_id"} if tool == "matrix_restore_world_archive" else set())
            if _xr_context(arguments, fields):
                name = arguments["archive_name"]
                if (type(name) is str and name == name.strip() and
                        1 <= sum(2 if ord(char) > 0xffff else 1 for char in name) <= 80 and
                        name.isprintable() and
                        (tool != "matrix_restore_world_archive" or
                         type(arguments["archive_id"]) is str and
                         re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                                      arguments["archive_id"]))):
                    if tool == "matrix_start_new_world":
                        return (f"Archive the complete current world as {json.dumps(name, ensure_ascii=False)} "
                                f"and start a blank world in {arguments['room_id']} "
                                f"at revision {arguments['scene_revision']}.")
                    return (f"Archive the complete current world as {json.dumps(name, ensure_ascii=False)} "
                            f"and restore browser archive {arguments['archive_id']} "
                            f"in {arguments['room_id']} at revision {arguments['scene_revision']}.")
        elif tool == "matrix_set_environment":
            if (type(arguments) is dict and
                    {"room_id", "scene_revision", "asset_id"} <= set(arguments) <=
                    {"room_id", "scene_revision", "asset_id", "yaw_degrees"} and
                    _xr_entity_id(arguments["room_id"]) and
                    arguments["room_id"] == "web-virtual-room-v1" and
                    type(arguments["scene_revision"]) is int and
                    0 <= arguments["scene_revision"] <= 9007199254740991 and
                    type(arguments["asset_id"]) is str and
                    re.fullmatch(r"panorama:[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{12}",
                                 arguments["asset_id"]) and
                    type(arguments.get("yaw_degrees", 0)) in (int, float) and
                    math.isfinite(arguments.get("yaw_degrees", 0)) and
                    0 <= arguments.get("yaw_degrees", 0) < 360):
                return (f"Set world panorama {arguments['asset_id']} at "
                        f"{arguments.get('yaw_degrees', 0)} degrees in "
                        f"{arguments['room_id']} revision {arguments['scene_revision']}. "
                        "Scene objects stay in place; passthrough AR stays visible.")
        elif tool == "matrix_remove_environment":
            if (_xr_context(arguments, set()) and
                    arguments["room_id"] == "web-virtual-room-v1"):
                return (f"Remove the world panorama in {arguments['room_id']} "
                        f"revision {arguments['scene_revision']}; scene objects stay in place.")
    except (APIError, KeyError, TypeError, ValueError, OverflowError):
        return None
    return None


def _mcp_approval_description(params: dict) -> tuple[str, bool]:
    """Only typed, bounded Matrix tools have XR-reviewable descriptions."""
    meta = params.get("_meta")
    if (params.get("serverName") != "matrix_webxr" or not isinstance(meta, dict) or
            meta.get("codex_approval_kind") != "mcp_tool_call"):
        return "Codex requests an MCP tool. Review it on PC before approval.", False
    arguments = meta.get("tool_params")
    if arguments == {}:
        if params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_scene_summary"?':
            return "Read the current Matrix room summary. This does not change the world.", True
        if params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_room_spatial_context"?':
            return "Read current bounded WebXR room geometry. This does not change the world.", True
    scale_tool = params.get("message")
    if scale_tool in (
            'Allow the matrix_webxr MCP server to run tool "matrix_scale_block"?',
            'Allow the matrix_webxr MCP server to run tool "matrix_reset_block_scale"?') and isinstance(arguments, dict):
        configure = '"matrix_scale_block"' in scale_tool
        required = {"room_id", "scene_revision", "object_id", "factors"} if configure else \
                   {"room_id", "scene_revision", "object_id", "baseline_request_id"}
        allowed = required | ({"baseline_request_id"} if configure else set())
        if (required <= set(arguments) <= allowed and
                isinstance(arguments["room_id"], str) and
                re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments["room_id"]) and
                type(arguments["scene_revision"]) is int and arguments["scene_revision"] >= 0):
            intent = {"kind": "block-scale", "version": 1,
                      "action": "configure" if configure else "reset",
                      "objectId": arguments["object_id"]}
            if configure:
                intent["factors"] = arguments["factors"]
            if "baseline_request_id" in arguments:
                intent["baselineRequestId"] = arguments["baseline_request_id"]
            try:
                scale_experiment.validate_intent(intent)
                detail = (", ".join(f"{axis.upper()}={intent['factors'][axis]}" for axis in ("x", "y", "z"))
                          if configure else "the confirmed baseline")
                summary = (f"Propose {detail} for block {intent['objectId']} in "
                           f"{arguments['room_id']} at revision {arguments['scene_revision']}. "
                           "The owner must still review and Apply on /clients.")
                if len(summary) <= 230:
                    return summary, True
            except PlannerError:
                pass
    if (params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_move_object"?' and
            isinstance(arguments, dict) and
            {"room_id", "scene_revision", "object_id", "expected_asset_id", "position"} <=
            set(arguments) <=
            {"room_id", "scene_revision", "object_id", "expected_asset_id", "position", "rotation", "scale"} and
            type(arguments["scene_revision"]) is int and arguments["scene_revision"] >= 0 and
            all(isinstance(arguments[key], str) and
                re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments[key])
                for key in ("room_id", "object_id", "expected_asset_id")) and
            isinstance(arguments["position"], dict) and set(arguments["position"]) == {"x", "y", "z"} and
            all(type(arguments["position"][axis]) in (int, float) and
                math.isfinite(arguments["position"][axis]) and
                -100 <= arguments["position"][axis] <= 100 for axis in ("x", "y", "z")) and
            ("rotation" not in arguments or
             isinstance(arguments["rotation"], dict) and set(arguments["rotation"]) == {"x", "y", "z"} and
             all(type(arguments["rotation"][axis]) in (int, float) and
                 math.isfinite(arguments["rotation"][axis]) and
                 -36000 <= arguments["rotation"][axis] <= 36000 for axis in ("x", "y", "z"))) and
            ("scale" not in arguments or
             isinstance(arguments["scale"], dict) and set(arguments["scale"]) == {"x", "y", "z"} and
             all(type(arguments["scale"][axis]) in (int, float) and
                 math.isfinite(arguments["scale"][axis]) and
                 .01 <= arguments["scale"][axis] <= 20 for axis in ("x", "y", "z")))):
        point = arguments["position"]
        rotation = arguments.get("rotation")
        scale = arguments.get("scale")
        angle = (f" with rotation ({rotation['x']}, {rotation['y']}, {rotation['z']}) degrees"
                 if rotation is not None else "")
        size = (f" with unitless scale ({scale['x']}, {scale['y']}, {scale['z']})"
                if scale is not None else "")
        summary = (f"Transform {arguments['expected_asset_id']} ({arguments['object_id']}) in "
                   f"{arguments['room_id']} to position ({point['x']}, {point['y']}, {point['z']})"
                   f"{angle}{size} "
                   f"at scene revision {arguments['scene_revision']}.")
        if len(summary) <= MAX_XR_APPROVAL_SUMMARY:
            return summary, True
    if (params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_register_glb"?' and
            isinstance(arguments, dict) and
            {"source_path", "expected_sha256", "name"} <= set(arguments) <=
            {"source_path", "expected_sha256", "name", "description", "spawn_scale", "local_bounds"}):
        source, name, digest = (arguments[key] for key in ("source_path", "name", "expected_sha256"))
        scale = arguments.get("spawn_scale", 1)
        if (isinstance(source, str) and 1 <= len(source) <= 1024 and
                source.isprintable() and Path(source).is_absolute() and
                not str(Path(source).drive).startswith("\\\\") and Path(source).suffix.lower() == ".glb" and
                isinstance(name, str) and 1 <= len(name) <= 80 and
                name.isprintable() and
                isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) and
                arguments.get("description", "") == "" and arguments.get("local_bounds") is None and
                type(scale) in (int, float) and scale == 1):
            summary = f"Register {Path(source).name} as {name} (GLB SHA-256 {digest[:12]}…) in the Matrix asset catalog."
            if len(summary) <= 200:
                return summary, True
    if (params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_register_panorama"?' and
            type(arguments) is dict and set(arguments) ==
            {"source_path", "expected_sha256", "name"}):
        source, name, digest = (arguments[key] for key in
                                ("source_path", "name", "expected_sha256"))
        if (type(source) is str and 1 <= len(source) <= 1024 and
                source.isprintable() and Path(source).is_absolute() and
                not str(Path(source).drive).startswith("\\\\") and
                Path(source).suffix.lower() == ".png" and
                type(name) is str and 1 <= len(name) <= 80 and name.isprintable() and
                type(digest) is str and re.fullmatch(r"[0-9a-f]{64}", digest)):
            summary = (f"Register {Path(source).name} as {name} "
                       f"(2:1 PNG SHA-256 {digest[:12]}…) in the Matrix panorama catalog. "
                       "This does not change the world.")
            if len(summary) <= 230:
                return summary, True
    if (params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_publish_component"?' and
            isinstance(arguments, dict) and set(arguments) == {"package"}):
        try:
            package = validate_package(arguments["package"])
            digest = hashlib.sha256(json.dumps(package, ensure_ascii=False, sort_keys=True,
                allow_nan=False, separators=(",", ":")).encode("utf-8")).hexdigest()
            component_id = _identity(package, digest)
            summary = (f"Publish bounded numeric Matrix component {component_id} with "
                       f"{len(package['outputs'])} transform channels. Catalog only; no world change.")
            if len(summary) <= 200:
                return summary, True
        except (ComponentError, TypeError, ValueError, RecursionError):
            pass
    if (params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_spawn_asset"?' and
            isinstance(arguments, dict) and set(arguments) ==
            {"room_id", "scene_revision", "asset_id", "transform"} and
            isinstance(arguments["room_id"], str) and
            re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments["room_id"]) and
            type(arguments["scene_revision"]) is int and arguments["scene_revision"] >= 0 and
            isinstance(arguments["asset_id"], str) and
            re.fullmatch(r"web:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}", arguments["asset_id"])):
        pose = arguments["transform"]
        ranges = {"position": (-100, 100), "rotation": (-36000, 36000), "scale": (.01, 20)}
        if (isinstance(pose, dict) and set(pose) == set(ranges) and all(
                isinstance(pose[key], dict) and set(pose[key]) == {"x", "y", "z"} and
                all(type(pose[key][axis]) in (int, float) and
                    math.isfinite(pose[key][axis]) and ranges[key][0] <= pose[key][axis] <= ranges[key][1]
                    for axis in ("x", "y", "z")) for key in ranges)):
            p, r, s = (pose[key] for key in ("position", "rotation", "scale"))
            summary = (f"Spawn {arguments['asset_id']} in {arguments['room_id']} at "
                       f"({p['x']}, {p['y']}, {p['z']}) m, rotation "
                       f"({r['x']}, {r['y']}, {r['z']})°, scale "
                       f"({s['x']}, {s['y']}, {s['z']}) at revision {arguments['scene_revision']}.")
            if len(summary) <= 200:
                return summary, True
    if (params.get("message") == 'Allow the matrix_webxr MCP server to run tool "matrix_bind_animation"?' and
            isinstance(arguments, dict) and set(arguments) ==
            {"room_id", "scene_revision", "object_id", "expected_asset_id", "loop_clip", "select_clip"} and
            type(arguments["scene_revision"]) is int and arguments["scene_revision"] >= 0 and
            all(isinstance(arguments[key], str) and
                re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments[key])
                for key in ("room_id", "object_id")) and
            isinstance(arguments["expected_asset_id"], str) and
            re.fullmatch(r"web:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}", arguments["expected_asset_id"]) and
            all(arguments[key] is None or isinstance(arguments[key], str) and
                1 <= len(arguments[key]) <= 64 and arguments[key].isprintable()
                for key in ("loop_clip", "select_clip")) and
            (not arguments["loop_clip"] or arguments["loop_clip"] != arguments["select_clip"])):
        summary = (f"Bind GLB animation on {arguments['object_id']} ({arguments['expected_asset_id']}) "
                   f"in {arguments['room_id']} at revision {arguments['scene_revision']}: "
                   f"loop={arguments['loop_clip']!r}, select={arguments['select_clip']!r}.")
        if len(summary) <= 200:
            return summary, True
    physics_tool = params.get("message")
    if physics_tool in (
            'Allow the matrix_webxr MCP server to run tool "matrix_set_physics"?',
            'Allow the matrix_webxr MCP server to run tool "matrix_remove_physics"?') and isinstance(arguments, dict):
        setting = '"matrix_set_physics"' in physics_tool
        required = {"room_id", "scene_revision", "object_id", "expected_asset_id"}
        allowed = required | ({"restitution"} if setting else set())
        restitution = arguments.get("restitution", .4)
        if (required <= set(arguments) <= allowed and
                type(arguments["scene_revision"]) is int and arguments["scene_revision"] >= 0 and
                all(isinstance(arguments[key], str) and
                    re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments[key])
                    for key in ("room_id", "object_id")) and
                arguments["room_id"] == "web-virtual-room-v1" and
                isinstance(arguments["expected_asset_id"], str) and
                re.fullmatch(r"web:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}",
                             arguments["expected_asset_id"]) and
                (not setting or type(restitution) in (int, float) and
                 math.isfinite(restitution) and 0 <= restitution <= .75)):
            verb = (f"Start a virtual-floor gravity drop with restitution {restitution} on"
                    if setting else "Stop floor physics and remove its saved setting from")
            summary = (f"{verb} {arguments['expected_asset_id']} ({arguments['object_id']}) "
                       f"in {arguments['room_id']} at revision {arguments['scene_revision']}.")
            if len(summary) <= 230:
                return summary, True
    interaction_tool = params.get("message")
    if interaction_tool in (
            'Allow the matrix_webxr MCP server to run tool "matrix_set_interaction"?',
            'Allow the matrix_webxr MCP server to run tool "matrix_remove_interaction"?') and isinstance(arguments, dict):
        setting = '"matrix_set_interaction"' in interaction_tool
        required = {"room_id", "scene_revision", "object_id", "expected_asset_id"}
        if setting:
            required.add("interaction")
        if (set(arguments) == required and
                type(arguments["scene_revision"]) is int and arguments["scene_revision"] >= 0 and
                isinstance(arguments["room_id"], str) and
                re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments["room_id"]) and
                (arguments["room_id"] == "web-virtual-room-v1" or
                 not setting and arguments["room_id"].startswith("webxr-session-")) and
                all(isinstance(arguments[key], str) and
                    re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments[key])
                    for key in ("object_id", "expected_asset_id")) and
                (arguments["expected_asset_id"] == "matrix:procedural" or
                 re.fullmatch(r"web:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}",
                              arguments["expected_asset_id"]))):
            if setting:
                # The module is already loaded by the time native approval is
                # requested; reuse its exact descriptor contract here.
                from server import APIError, interaction_descriptor
                try:
                    descriptor = interaction_descriptor(arguments["interaction"])
                except (APIError, TypeError, KeyError):
                    descriptor = None
                if descriptor is not None and (
                        descriptor["schemaVersion"] == 1 and
                        arguments["expected_asset_id"].startswith("web:") or
                        descriptor["schemaVersion"] == 2 and
                        arguments["expected_asset_id"] == "matrix:procedural"):
                    approach, use = descriptor["approachPose"], descriptor["usePose"]
                    source = (f"asset SHA {descriptor['assetSha256'][:12]}…" if
                              descriptor["schemaVersion"] == 1 else
                              "generator " + ":".join((
                                  descriptor["proceduralSource"]["generatorId"] + "@" +
                                  descriptor["proceduralSource"]["generatorVersion"],
                                  descriptor["proceduralSource"]["sourceRevision"])))
                    summary = (f"Set {descriptor['kind']} {descriptor['interactionId']} on "
                               f"{arguments['object_id']} ({arguments['expected_asset_id']}) "
                               f"at revision {arguments['scene_revision']}: "
                               f"{descriptor['effect']['need']} +{descriptor['effect']['delta']} "
                               f"in {descriptor['durationTicks']} ticks; approach "
                               f"({approach['x']},{approach['z']}), use ({use['x']},{use['z']}), "
                               f"range {descriptor['rangeMeters']} m; "
                               f"{source}")
                    if descriptor["schemaVersion"] == 2:
                        summary = (f"Set {descriptor['kind']} {descriptor['interactionId']} on "
                                   f"{arguments['object_id']} ({arguments['expected_asset_id']}) "
                                   f"at revision {arguments['scene_revision']}: "
                                   f"{descriptor['effect']['need']} +{descriptor['effect']['delta']}"
                                   f"/{descriptor['durationTicks']} ticks; approach "
                                   f"({approach['x']},{approach['z']}), use "
                                   f"({use['x']},{use['z']}), range "
                                   f"{descriptor['rangeMeters']} m; {source}")
                    if len(summary) <= MAX_XR_APPROVAL_SUMMARY:
                        return summary, True
            else:
                summary = (f"Remove the saved interaction from {arguments['object_id']} "
                           f"({arguments['expected_asset_id']}) in {arguments['room_id']} "
                           f"at revision {arguments['scene_revision']}.")
                if len(summary) <= MAX_XR_APPROVAL_SUMMARY:
                    return summary, True
    for action in ("attach", "stop", "remove"):
        if params.get("message") != f'Allow the matrix_webxr MCP server to run tool "matrix_{action}_component"?':
            continue
        required = {"room_id", "scene_revision", "object_id", "expected_asset_id", "component_id"}
        if action == "attach":
            required.add("target_object_id")
        if (not isinstance(arguments, dict) or set(arguments) != required or
                type(arguments["scene_revision"]) is not int or arguments["scene_revision"] < 0 or
                any(not isinstance(arguments[key], str) or
                    not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments[key])
                    for key in ("room_id", "object_id", "expected_asset_id") if key in arguments) or
                not isinstance(arguments["component_id"], str) or
                not re.fullmatch(r"webcomp:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}", arguments["component_id"]) or
                (action == "attach" and (not isinstance(arguments["target_object_id"], str) or
                                         not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", arguments["target_object_id"])))):
            continue
        summary = (f"{action.capitalize()} {arguments['component_id']} on {arguments['expected_asset_id']} "
                   f"({arguments['object_id']}) in {arguments['room_id']}")
        if action == "attach":
            summary += f" targeting {arguments['target_object_id']}"
        summary += f" at scene revision {arguments['scene_revision']}."
        if len(summary) <= 200:
            return summary, True
    new_tool = params.get("message")
    if type(new_tool) is str:
        match = re.fullmatch(r'Allow the matrix_webxr MCP server to run tool "(matrix_[a-z_]+)"\?',
                             new_tool)
        if match:
            summary = _new_matrix_approval_summary(match[1], arguments)
            if summary is not None and len(summary) <= MAX_XR_APPROVAL_SUMMARY:
                return summary, True
    return "Codex requests an MCP tool. Review it on PC before approval.", False


def normalize_event(event: dict) -> dict | None:
    """Whitelist safe event fields; never copy opaque app-server params."""
    method = event.get("method")
    params = event.get("params")
    sequence = event.get("sequence")
    if not isinstance(params, dict) or type(sequence) is not int or sequence < 1:
        return None
    result = {"sequence": sequence}
    thread_id = _identifier(params.get("threadId"))
    if thread_id is None:
        return None
    turn = params.get("turn")
    turn_id = _identifier(params.get("turnId"))
    if turn_id is None and isinstance(turn, dict):
        turn_id = _identifier(turn.get("id"))
    if turn_id:
        result["turnId"] = turn_id
    result["conversationId"] = thread_id  # Internal routing only; strip at Matrix API boundary.
    if method == "item/agentMessage/delta":
        delta = params.get("delta")
        if not isinstance(delta, str) or not delta:
            return None
        result.update(type="text", text=delta)
    elif method in ("turn/started", "thread/status/changed"):
        if method == "thread/status/changed":
            return None  # Native status is not a stable browser contract.
        result.update(type="activity", activity="working")
    elif method == "turn/completed":
        status = turn.get("status") if isinstance(turn, dict) else None
        activity = "completed" if status == "completed" else "cancelled" if status == "interrupted" else "failed"
        result.update(type="activity", activity=activity)
    elif method in ("item/started", "item/completed"):
        activity = _kind(params.get("item"))
        if activity is None:
            return None
        result.update(type="activity", activity=activity if method == "item/started" else "working")
    elif method in ("item/commandExecution/requestApproval", "item/fileChange/requestApproval",
                    "mcpServer/elicitation/request"):
        approval_id = event.get("requestId")
        if not isinstance(approval_id, (int, str)) or not thread_id or not turn_id:
            return None
        result.update(type="approval", approvalId=approval_id,
                      activity="waiting_for_approval",
                      action="using_tool" if method == "mcpServer/elicitation/request" else
                             "running_command" if "commandExecution" in method else "editing_files")
    else:
        return None
    return result


class LocalCodexAgentBackend:
    """Codex app-server implementation of the Matrix session contract."""

    def __init__(self, config: CodexConfig, cwd: str | Path, matrix_bridge=None,
                 *, artifact_directory: str | Path | None = None):
        config.validate()
        self.config = config
        self.enabled_matrix_tools: tuple[str, ...] = ()
        command = [config.executable]
        if config.windows_sandbox:
            command += ["-c", f'windows.sandbox="{config.windows_sandbox}"']
        environment = {}
        if matrix_bridge is not None:
            script = Path(__file__).with_name("matrix_mcp.py")
            settings = {"command": sys.executable, "args": [str(script)],
                        "env_vars": ["MATRIX_CONTROL_URL", "MATRIX_CONTROL_TOKEN"],
                        "enabled_tools": ["matrix_scene_summary", "matrix_room_spatial_context",
                                          "matrix_set_manipulation", "matrix_manipulation_status",
                                          "matrix_move_object", "matrix_move_with_room_constraint",
                                          "matrix_move_status",
                                          "matrix_scale_block", "matrix_reset_block_scale", "matrix_scale_status",
                                          "matrix_list_assets", "matrix_register_glb",
                                          "matrix_list_environments", "matrix_register_panorama",
                                          "matrix_get_environment", "matrix_set_environment",
                                          "matrix_remove_environment", "matrix_environment_status",
                                          "matrix_spawn_asset", "matrix_spawn_builtin",
                                          "matrix_spawn_on_surface", "matrix_spawn_status",
                                          "matrix_list_procedural_generators",
                                          "matrix_create_procedural", "matrix_update_procedural",
                                          "matrix_procedural_status", "matrix_record_concept_build",
                                          "matrix_bind_game", "matrix_update_game", "matrix_game_status",
                                          "matrix_set_display", "matrix_remove_display",
                                          "matrix_display_status",
                                          "matrix_set_control", "matrix_remove_control",
                                          "matrix_control_status", "matrix_activate_control",
                                          "matrix_set_rigid_body", "matrix_remove_rigid_body",
                                          "matrix_set_gravity", "matrix_rigid_status",
                                          "matrix_list_entities", "matrix_inspect_entity",
                                          "matrix_begin_grab", "matrix_move_grab",
                                          "matrix_release_grab", "matrix_entity_status",
                                          "matrix_list_world_archives", "matrix_start_new_world",
                                          "matrix_restore_world_archive", "matrix_world_archive_status",
                                          "matrix_bind_animation", "matrix_animation_status",
                                          "matrix_set_physics", "matrix_remove_physics", "matrix_physics_status",
                                          "matrix_set_interaction", "matrix_remove_interaction",
                                          "matrix_interaction_status",
                                          "matrix_publish_component", "matrix_list_components",
                                          "matrix_attach_component", "matrix_stop_component",
                                          "matrix_remove_component", "matrix_component_status"],
                        "default_tools_approval_mode": "auto",
                        "startup_timeout_sec": 10}
            self.enabled_matrix_tools = tuple(settings["enabled_tools"])
            for key, value in settings.items():
                command += ["-c", f"mcp_servers.matrix_webxr.{key}={json.dumps(value)}"]
            if config.agent_approval_policy == "on-request":
                for name in ("matrix_set_manipulation", "matrix_move_object", "matrix_move_with_room_constraint",
                             "matrix_scale_block", "matrix_reset_block_scale",
                             "matrix_register_glb", "matrix_spawn_asset", "matrix_spawn_builtin",
                             "matrix_register_panorama", "matrix_set_environment",
                             "matrix_remove_environment",
                             "matrix_spawn_on_surface",
                             "matrix_create_procedural", "matrix_update_procedural",
                             "matrix_bind_game", "matrix_update_game",
                             "matrix_set_display", "matrix_remove_display",
                             "matrix_set_control", "matrix_remove_control",
                             "matrix_activate_control",
                             "matrix_set_rigid_body", "matrix_remove_rigid_body",
                             "matrix_set_gravity",
                             "matrix_begin_grab", "matrix_move_grab", "matrix_release_grab",
                             "matrix_start_new_world", "matrix_restore_world_archive",
                             "matrix_bind_animation", "matrix_publish_component", "matrix_attach_component",
                             "matrix_stop_component", "matrix_remove_component",
                             "matrix_set_physics", "matrix_remove_physics",
                             "matrix_set_interaction", "matrix_remove_interaction"):
                    command += ["-c", f'mcp_servers.matrix_webxr.tools.{name}.approval_mode="prompt"']
            environment = {"MATRIX_CONTROL_URL": matrix_bridge.url,
                           "MATRIX_CONTROL_TOKEN": matrix_bridge.token}
        command += ["app-server", "--stdio"]
        self.transport = AppServerTransport(command, cwd, environment=environment,
                                            artifact_directory=artifact_directory)

    def start(self) -> None:
        if self.enabled_matrix_tools:
            try:
                importlib.import_module("mcp.server.fastmcp")
                importlib.import_module("mcp.types")
            except (ImportError, OSError) as error:
                raise MatrixMCPUnavailableError(
                    "Matrix MCP tools are unavailable in the service Python environment. "
                    "Install ControlService/requirements-agent-mcp.txt and restart the service."
                ) from error
        self.transport.start()

    @property
    def access_mode(self) -> str:
        return self.config.agent_sandbox

    @property
    def approval_mode(self) -> str:
        return "automatic" if self.config.agent_approval_policy == "never" else "reviewed"

    def start_conversation(self) -> str:
        return self.transport.thread_start(model=self.config.model, sandbox=self.config.agent_sandbox,
                                           approval_policy=self.config.agent_approval_policy)

    def resume_conversation(self, conversation_id: str) -> str:
        return self.transport.thread_resume(conversation_id, sandbox=self.config.agent_sandbox,
                                            approval_policy=self.config.agent_approval_policy)

    def send_text(self, conversation_id: str, text: str, *, image_path: str | Path | None = None) -> str:
        return self.transport.turn_start(conversation_id, text,
                                         sandbox=self.config.agent_sandbox,
                                         approval_policy=self.config.agent_approval_policy,
                                         effort=self.config.reasoning_effort,
                                         **({"image_path": image_path} if image_path is not None else {}))

    def steer(self, conversation_id: str, turn_id: str, text: str) -> None:
        self.transport.turn_steer(conversation_id, turn_id, text)

    def native_image_capability(self) -> tuple[bool, str | None]:
        return self.transport.native_image_capability()

    def image_generation_result(self, conversation_id: str, turn_id: str) -> dict | None:
        return self.transport.image_generation_result(conversation_id, turn_id)

    def start_native_image(self, conversation_id: str, text: str) -> str:
        skill = self.transport._generated_root.parent / "skills" / ".system" / "imagegen" / "SKILL.md"
        return self.transport.turn_start(conversation_id, text,
                                         sandbox="read-only", approval_policy="on-request",
                                         effort=self.config.reasoning_effort,
                                         **({"skill_path": skill} if skill.is_file() else {}))

    def events_since(self, cursor: int) -> list[dict]:
        return self.poll(cursor)[1]

    def poll(self, cursor: int) -> tuple[int, list[dict]]:
        raw = self.transport.events_since(cursor)
        safe = [safe for event in raw
                if (safe := normalize_event(event)) is not None]
        return (raw[-1]["sequence"] if raw else cursor, safe)

    def pending_approvals(self) -> list[dict]:
        safe = []
        for approval in self.transport.pending_approvals():
            params = approval.get("params")
            method = approval.get("method")
            if not isinstance(params, dict) or method not in (
                "item/commandExecution/requestApproval", "item/fileChange/requestApproval",
                "mcpServer/elicitation/request"
            ):
                continue
            thread_id = _identifier(params.get("threadId"))
            turn_id = _identifier(params.get("turnId"))
            if thread_id and turn_id:
                summary, reviewable = (_mcp_approval_description(params) if method == "mcpServer/elicitation/request"
                                       else _approval_description(method, params, self.transport.cwd))
                safe.append({"approvalId": approval["requestId"], "conversationId": thread_id,
                             "turnId": turn_id,
                             "action": "using_tool" if method == "mcpServer/elicitation/request" else
                                       "running_command" if "commandExecution" in method else "editing_files",
                             "summary": summary, "reviewable": reviewable})
        return safe

    def pending_pc_commands(self) -> list[dict]:
        """Complete native generic commands for an attached PC console only.

        This return value must never be included in an HTTP response or browser
        event. Incomplete and oversized requests cannot receive PC approval.
        """
        commands = []
        for approval in self.transport.pending_approvals():
            if approval.get("method") != "item/commandExecution/requestApproval":
                continue
            params = approval.get("params")
            request_id = approval.get("requestId")
            if (not isinstance(params, dict) or params.get("truncated") is True or
                    type(request_id) not in (int, str) or
                    type(request_id) is str and not _identifier(request_id)):
                continue
            thread_id = _identifier(params.get("threadId"))
            turn_id = _identifier(params.get("turnId"))
            item_id = _identifier(params.get("itemId"))
            command = params.get("command")
            cwd = params.get("cwd")
            if (not all((thread_id, turn_id, item_id)) or
                    not isinstance(command, str) or not command or
                    not isinstance(cwd, str) or not cwd or
                    _approval_description("item/commandExecution/requestApproval", params,
                                          self.transport.cwd)[1]):
                continue
            try:
                native = json.dumps(params, ensure_ascii=True, sort_keys=True,
                                    allow_nan=False, separators=(",", ":"))
                if len(native.encode("utf-8")) > MAX_PC_COMMAND_REVIEW:
                    continue
            except (TypeError, ValueError, RecursionError):
                continue
            commands.append({"approvalId": request_id, "conversationId": thread_id,
                             "turnId": turn_id, "itemId": item_id,
                             "nativeParams": native})
        return commands

    def decide(self, approval_id: int | str, conversation_id: str, turn_id: str, approve: bool) -> None:
        if type(approve) is not bool:
            raise ValueError("Approval decision must be a boolean")
        self.transport.respond_approval(approval_id, conversation_id, turn_id,
                                        "accept" if approve else "decline")

    def cancel(self, conversation_id: str, turn_id: str) -> None:
        self.transport.turn_interrupt(conversation_id, turn_id)

    def close(self) -> None:
        self.transport.close()
