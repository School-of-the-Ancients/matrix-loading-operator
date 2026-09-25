"""Provider-neutral Matrix agent-session contract and local Codex adapter.

The gateway filters internal native conversation IDs and maps them to opaque
Matrix session IDs before responding to a browser. Raw app-server events,
command arguments, tool outputs, and credentials stay on PC.
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol

from codex_app_server import AppServerTransport
from codex_provider import CodexConfig


class AgentSessionBackend(Protocol):
    """The gateway-facing surface; future hosted backends can implement it."""

    def start(self) -> None: ...
    def start_conversation(self) -> str: ...
    def resume_conversation(self, conversation_id: str) -> str: ...
    def send_text(self, conversation_id: str, text: str) -> str: ...
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
    elif method in ("item/commandExecution/requestApproval", "item/fileChange/requestApproval"):
        approval_id = event.get("requestId")
        if not isinstance(approval_id, (int, str)) or not thread_id or not turn_id:
            return None
        result.update(type="approval", approvalId=approval_id,
                      activity="waiting_for_approval",
                      action="running_command" if "commandExecution" in method else "editing_files")
    else:
        return None
    return result


class LocalCodexAgentBackend:
    """Codex app-server implementation of the Matrix session contract."""

    def __init__(self, config: CodexConfig, cwd: str | Path):
        config.validate()
        self.config = config
        self.transport = AppServerTransport([config.executable, "app-server", "--stdio"], cwd)

    def start(self) -> None:
        self.transport.start()

    def start_conversation(self) -> str:
        return self.transport.thread_start(model=self.config.model)

    def resume_conversation(self, conversation_id: str) -> str:
        return self.transport.thread_resume(conversation_id)

    def send_text(self, conversation_id: str, text: str) -> str:
        return self.transport.turn_start(conversation_id, text, effort=self.config.reasoning_effort)

    def events_since(self, cursor: int) -> list[dict]:
        return [safe for event in self.transport.events_since(cursor)
                if (safe := normalize_event(event)) is not None]

    def pending_approvals(self) -> list[dict]:
        safe = []
        for approval in self.transport.pending_approvals():
            params = approval.get("params")
            method = approval.get("method")
            if not isinstance(params, dict) or method not in (
                "item/commandExecution/requestApproval", "item/fileChange/requestApproval"
            ):
                continue
            thread_id = _identifier(params.get("threadId"))
            turn_id = _identifier(params.get("turnId"))
            if thread_id and turn_id:
                safe.append({"approvalId": approval["requestId"], "conversationId": thread_id,
                             "turnId": turn_id,
                             "action": "running_command" if "commandExecution" in method else "editing_files"})
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
