"""Provider-neutral Matrix agent-session contract and local Codex adapter.

The gateway filters internal native conversation IDs and maps them to opaque
Matrix session IDs before responding to a browser. Raw app-server events,
command arguments, tool outputs, and credentials stay on PC.
"""
from __future__ import annotations

from pathlib import Path
import json
import re
import sys
from typing import Protocol

from codex_app_server import AppServerTransport
from codex_provider import CodexConfig


class AgentSessionBackend(Protocol):
    """The gateway-facing surface; future hosted backends can implement it."""

    def start(self) -> None: ...
    def start_conversation(self) -> str: ...
    def resume_conversation(self, conversation_id: str) -> str: ...
    def send_text(self, conversation_id: str, text: str) -> str: ...
    def poll(self, cursor: int) -> tuple[int, list[dict]]: ...
    def events_since(self, cursor: int) -> list[dict]: ...
    def pending_approvals(self) -> list[dict]: ...
    def decide(self, approval_id: int | str, conversation_id: str, turn_id: str, approve: bool) -> None: ...
    def cancel(self, conversation_id: str, turn_id: str) -> None: ...
    def close(self) -> None: ...


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


def _mcp_approval_description(params: dict) -> tuple[str, bool]:
    """Only the exact read-only Matrix summary tool is reviewable in XR."""
    meta = params.get("_meta")
    if (params.get("serverName") == "matrix_webxr" and isinstance(meta, dict) and
            meta.get("codex_approval_kind") == "mcp_tool_call" and
            meta.get("tool_params") == {} and
            params.get("message") ==
            'Allow the matrix_webxr MCP server to run tool "matrix_scene_summary"?'):
        return "Read the current Matrix room summary. This does not change the world.", True
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
        environment = {}
        if matrix_bridge is not None:
            script = Path(__file__).with_name("matrix_mcp.py")
            settings = {"command": sys.executable, "args": [str(script)],
                        "env_vars": ["MATRIX_CONTROL_URL", "MATRIX_CONTROL_TOKEN"],
                        "enabled_tools": ["matrix_scene_summary"],
                        "default_tools_approval_mode": "auto",
                        "startup_timeout_sec": 10}
            for key, value in settings.items():
                command += ["-c", f"mcp_servers.matrix_webxr.{key}={json.dumps(value)}"]
            environment = {"MATRIX_CONTROL_URL": matrix_bridge.url,
                           "MATRIX_CONTROL_TOKEN": matrix_bridge.token}
        command += ["app-server", "--stdio"]
        self.transport = AppServerTransport(command, cwd, environment=environment)

    def start(self) -> None:
        self.transport.start()

    def start_conversation(self) -> str:
        return self.transport.thread_start(model=self.config.model)

    def resume_conversation(self, conversation_id: str) -> str:
        return self.transport.thread_resume(conversation_id)

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

    def decide(self, approval_id: int | str, conversation_id: str, turn_id: str, approve: bool) -> None:
        if type(approve) is not bool:
            raise ValueError("Approval decision must be a boolean")
        self.transport.respond_approval(approval_id, conversation_id, turn_id,
                                        "accept" if approve else "decline")

    def cancel(self, conversation_id: str, turn_id: str) -> None:
        self.transport.turn_interrupt(conversation_id, turn_id)

    def close(self) -> None:
        self.transport.close()
