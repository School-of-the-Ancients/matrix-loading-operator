"""Provider-neutral Matrix agent-session contract and local Codex adapter.

The gateway filters internal native conversation IDs and maps them to opaque
Matrix session IDs before responding to a browser. Raw app-server events,
command arguments, tool outputs, and credentials stay on PC.
"""
from __future__ import annotations

from pathlib import Path
import hashlib
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


class AgentSessionBackend(Protocol):
    """The gateway-facing surface; future hosted backends can implement it."""

    def start(self) -> None: ...
    def start_conversation(self) -> str: ...
    def resume_conversation(self, conversation_id: str) -> str: ...
    def send_text(self, conversation_id: str, text: str) -> str: ...
    def poll(self, cursor: int) -> tuple[int, list[dict]]: ...
    def events_since(self, cursor: int) -> list[dict]: ...
    def pending_approvals(self) -> list[dict]: ...
    def pending_pc_commands(self) -> list[dict]: ...
    def decide(self, approval_id: int | str, conversation_id: str, turn_id: str, approve: bool) -> None: ...
    def cancel(self, conversation_id: str, turn_id: str) -> None: ...
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


def _mcp_approval_description(params: dict) -> tuple[str, bool]:
    """Only typed, bounded Matrix tools have XR-reviewable descriptions."""
    meta = params.get("_meta")
    if (params.get("serverName") != "matrix_webxr" or not isinstance(meta, dict) or
            meta.get("codex_approval_kind") != "mcp_tool_call"):
        return "Codex requests an MCP tool. Review it on PC before approval.", False
    arguments = meta.get("tool_params")
    if (arguments == {} and params.get("message") ==
            'Allow the matrix_webxr MCP server to run tool "matrix_scene_summary"?'):
        return "Read the current Matrix room summary. This does not change the world.", True
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
            {"room_id", "scene_revision", "object_id", "expected_asset_id", "position", "rotation"} and
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
                 -36000 <= arguments["rotation"][axis] <= 36000 for axis in ("x", "y", "z")))):
        point = arguments["position"]
        rotation = arguments.get("rotation")
        angle = (f" with rotation ({rotation['x']}, {rotation['y']}, {rotation['z']}) degrees"
                 if rotation is not None else "")
        summary = (f"Move {arguments['expected_asset_id']} ({arguments['object_id']}) in "
                   f"{arguments['room_id']} to ({point['x']}, {point['y']}, {point['z']}){angle} "
                   f"at scene revision {arguments['scene_revision']}.")
        if len(summary) <= 240:
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

    def __init__(self, config: CodexConfig, cwd: str | Path, matrix_bridge=None):
        config.validate()
        self.config = config
        command = [config.executable]
        if config.windows_sandbox:
            command += ["-c", f'windows.sandbox="{config.windows_sandbox}"']
        environment = {}
        if matrix_bridge is not None:
            script = Path(__file__).with_name("matrix_mcp.py")
            settings = {"command": sys.executable, "args": [str(script)],
                        "env_vars": ["MATRIX_CONTROL_URL", "MATRIX_CONTROL_TOKEN"],
                        "enabled_tools": ["matrix_scene_summary", "matrix_move_object", "matrix_move_status",
                                          "matrix_scale_block", "matrix_reset_block_scale", "matrix_scale_status",
                                          "matrix_list_assets", "matrix_register_glb",
                                          "matrix_spawn_asset", "matrix_spawn_status",
                                          "matrix_bind_animation", "matrix_animation_status",
                                          "matrix_set_physics", "matrix_remove_physics", "matrix_physics_status",
                                          "matrix_publish_component", "matrix_list_components",
                                          "matrix_attach_component", "matrix_stop_component",
                                          "matrix_remove_component", "matrix_component_status"],
                        "default_tools_approval_mode": "auto",
                        "startup_timeout_sec": 10}
            for key, value in settings.items():
                command += ["-c", f"mcp_servers.matrix_webxr.{key}={json.dumps(value)}"]
            if config.agent_approval_policy == "on-request":
                for name in ("matrix_move_object", "matrix_scale_block", "matrix_reset_block_scale",
                             "matrix_register_glb", "matrix_spawn_asset",
                             "matrix_bind_animation", "matrix_publish_component", "matrix_attach_component",
                             "matrix_stop_component", "matrix_remove_component",
                             "matrix_set_physics", "matrix_remove_physics"):
                    command += ["-c", f'mcp_servers.matrix_webxr.tools.{name}.approval_mode="prompt"']
            environment = {"MATRIX_CONTROL_URL": matrix_bridge.url,
                           "MATRIX_CONTROL_TOKEN": matrix_bridge.token}
        command += ["app-server", "--stdio"]
        self.transport = AppServerTransport(command, cwd, environment=environment)

    def start(self) -> None:
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

    def send_text(self, conversation_id: str, text: str) -> str:
        return self.transport.turn_start(conversation_id, text, effort=self.config.reasoning_effort)

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
