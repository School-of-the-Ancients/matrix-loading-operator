"""PC-local Codex app-server JSONL transport for the Matrix Agent Portal.

This module is deliberately not an HTTP API. The caller owns Matrix authentication,
durable portal-to-thread mapping, event normalization, and browser-safe redaction.
Only the PC process sees Codex's stdio protocol and credentials.
"""
from __future__ import annotations

from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import subprocess
import threading
from typing import Any


MAX_LINE = 2 * 1024 * 1024
MAX_SEND = 1024 * 1024
MAX_EVENT = 64 * 1024
MAX_EVENTS = 256
MAX_APPROVALS = 16
APPROVAL_METHODS = {"item/commandExecution/requestApproval", "item/fileChange/requestApproval"}


def _truncated_event_params(params: dict) -> dict:
    """Keep bounded routing/lifecycle metadata when a tool payload is oversized."""
    safe = {"truncated": True}
    for key in ("threadId", "turnId", "itemId", "requestId"):
        value = params.get(key)
        if isinstance(value, (int, str)) and len(str(value)) <= 128:
            safe[key] = value
    for key, fields in (("turn", ("id", "status")),
                        ("item", ("id", "type", "server"))):
        value = params.get(key)
        if isinstance(value, dict):
            nested = {field: value[field] for field in fields
                      if isinstance(value.get(field), str) and len(value[field]) <= 128}
            if nested:
                safe[key] = nested
    return safe


class AppServerError(Exception):
    """A local app-server protocol or lifecycle failure."""


@dataclass
class _Waiter:
    ready: threading.Event = field(default_factory=threading.Event)
    result: Any = None
    error: str | None = None


class AppServerTransport:
    """One app-server stdio connection, with request correlation and native approvals.

    ``command`` is PC-owned configuration, never browser input. Production callers
    should pass a validated native ``codex.exe`` followed by ``app-server --stdio``.
    A fake process command can be injected in tests without invoking Codex.
    """

    def __init__(self, command: list[str], cwd: str | Path, *, timeout: float = 10.0,
                 environment: dict[str, str] | None = None):
        path = Path(cwd).resolve(strict=True)
        if not path.is_dir() or not command or not all(isinstance(part, str) and part for part in command):
            raise ValueError("Invalid app-server command or working directory")
        self.command = list(command)
        self.cwd = path
        self.timeout = timeout
        self.environment = dict(environment or {})
        self._proc: subprocess.Popen | None = None
        self._reader: threading.Thread | None = None
        self._lock = threading.RLock()
        self._next_id = 0
        self._waiters: dict[int, _Waiter] = {}
        self._approvals: dict[int | str, dict] = {}
        self._events: deque[dict] = deque(maxlen=MAX_EVENTS)
        self._sequence = 0
        self._failure: str | None = None

    def start(self) -> None:
        with self._lock:
            if self._proc is not None:
                raise AppServerError("Codex app-server is already started")
            self._proc = subprocess.Popen(self.command, cwd=self.cwd, stdin=subprocess.PIPE,
                                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                          env={**os.environ, **self.environment})
            self._reader = threading.Thread(target=self._read_loop, name="matrix-app-server", daemon=True)
            self._reader.start()
        try:
            self.request("initialize", {"clientInfo": {"name": "matrix_webxr",
                                                      "title": "Matrix Agent Portal", "version": "0.1.0"}})
            self.notify("initialized", {})
        except Exception:
            self.close()
            raise

    def _write(self, message: dict) -> None:
        wire = (json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        if len(wire) > MAX_SEND:
            raise AppServerError("Codex app-server request is too large")
        with self._lock:
            if self._proc is None or self._failure or self._proc.stdin is None:
                raise AppServerError(self._failure or "Codex app-server is unavailable")
            try:
                self._proc.stdin.write(wire)
                self._proc.stdin.flush()
            except (OSError, ValueError) as error:
                raise AppServerError("Codex app-server write failed") from error

    def request(self, method: str, params: dict | None = None, *, timeout: float | None = None) -> Any:
        if not isinstance(method, str) or not method or (params is not None and not isinstance(params, dict)):
            raise ValueError("Invalid app-server request")
        with self._lock:
            self._next_id += 1
            request_id = self._next_id
            waiter = _Waiter()
            self._waiters[request_id] = waiter
            try:
                self._write({"method": method, "id": request_id, "params": params or {}})
            except Exception:
                self._waiters.pop(request_id, None)
                raise
        if not waiter.ready.wait(self.timeout if timeout is None else timeout):
            with self._lock:
                self._waiters.pop(request_id, None)
            raise AppServerError(f"Codex app-server did not answer {method}")
        if waiter.error:
            raise AppServerError(waiter.error)
        return waiter.result

    def notify(self, method: str, params: dict | None = None) -> None:
        if not isinstance(method, str) or not method or (params is not None and not isinstance(params, dict)):
            raise ValueError("Invalid app-server notification")
        self._write({"method": method, "params": params or {}})

    def _read_loop(self) -> None:
        try:
            process = self._proc
            assert process is not None and process.stdout is not None
            while True:
                line = process.stdout.readline(MAX_LINE + 1)
                if not line:
                    raise AppServerError("Codex app-server connection closed")
                if len(line) > MAX_LINE or not line.endswith(b"\n"):
                    raise AppServerError("Codex app-server sent an oversized message")
                try:
                    message = json.loads(line)
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise AppServerError("Codex app-server sent invalid JSON") from error
                if not isinstance(message, dict) or message.get("jsonrpc", "2.0") != "2.0":
                    raise AppServerError("Codex app-server sent an invalid message")
                self._receive(message)
        except (AppServerError, OSError) as error:
            self._fail(str(error))
        except Exception:
            self._fail("Codex app-server sent an invalid message")

    def _fail(self, reason: str) -> None:
        with self._lock:
            self._failure = reason
            for waiter in self._waiters.values():
                waiter.error = reason
                waiter.ready.set()
            self._waiters.clear()
            self._approvals.clear()

    def _receive(self, message: dict) -> None:
        with self._lock:
            if "id" in message and "method" not in message:
                if not isinstance(message["id"], int):
                    raise AppServerError("Codex app-server sent an invalid response ID")
                waiter = self._waiters.pop(message["id"], None)
                if waiter is None:
                    return  # A timed-out request can still complete later.
                if "error" in message:
                    error = message["error"]
                    waiter.error = str(error.get("message", "Codex app-server error")) if isinstance(error, dict) else "Codex app-server error"
                else:
                    waiter.result = message.get("result")
                waiter.ready.set()
                return
            method = message.get("method")
            if not isinstance(method, str):
                raise AppServerError("Codex app-server sent an invalid method")
            params = message.get("params", {})
            if "id" in message:
                if not isinstance(message["id"], (int, str)):
                    raise AppServerError("Codex app-server sent an invalid request ID")
                if method not in APPROVAL_METHODS or len(self._approvals) >= MAX_APPROVALS or not isinstance(params, dict):
                    self._write({"id": message["id"], "error": {"code": -32601,
                                                                  "message": "Matrix cannot handle this server request"}})
                else:
                    self._approvals[message["id"]] = {"method": method, "params": params}
            elif method == "serverRequest/resolved" and isinstance(params, dict):
                request_id = params.get("requestId")
                if isinstance(request_id, (int, str)):
                    self._approvals.pop(request_id, None)
            self._sequence += 1
            raw = json.dumps(params, ensure_ascii=False, separators=(",", ":"))
            safe_params = params if len(raw.encode("utf-8")) <= MAX_EVENT else _truncated_event_params(params)
            self._events.append({"sequence": self._sequence, "method": method,
                                 "params": safe_params, **({"requestId": message["id"]} if "id" in message else {})})

    def events_since(self, sequence: int = 0) -> list[dict]:
        """PC-internal raw events. Never forward this return value to the browser."""
        with self._lock:
            if self._failure:
                raise AppServerError(self._failure)
            return [deepcopy(event) for event in self._events if event["sequence"] > sequence]

    def pending_approvals(self) -> list[dict]:
        """PC-internal approval data; the HTTP layer must redact and scope it."""
        with self._lock:
            return [deepcopy({"requestId": request_id, **value}) for request_id, value in self._approvals.items()]

    def respond_approval(self, request_id: int | str, thread_id: str, turn_id: str, decision: str) -> None:
        if decision not in ("accept", "decline"):
            raise ValueError("Only one-time approve or deny is supported")
        with self._lock:
            pending = self._approvals.get(request_id)
            if pending is None or pending["params"].get("threadId") != thread_id or pending["params"].get("turnId") != turn_id:
                raise AppServerError("Approval is no longer pending for this turn")
            self._write({"id": request_id, "result": {"decision": decision}})
            self._approvals.pop(request_id, None)

    def thread_start(self, *, model: str | None = None) -> str:
        params = {"cwd": str(self.cwd), "approvalPolicy": "on-request", "approvalsReviewer": "user",
                  "sandbox": "read-only",
                  "serviceName": "matrix_agent_portal"}
        if model:
            params["model"] = model
        result = self.request("thread/start", params)
        return self._id_from(result, "thread")

    def thread_resume(self, thread_id: str) -> str:
        result = self.request("thread/resume", {"threadId": thread_id, "cwd": str(self.cwd),
                                                 "approvalPolicy": "on-request", "approvalsReviewer": "user",
                                                 "sandbox": "read-only"})
        return self._id_from(result, "thread")

    def thread_read(self, thread_id: str) -> dict:
        # Codex CLI 0.153.4 rejects includeTurns=true (list_turns unsupported).
        result = self.request("thread/read", {"threadId": thread_id, "includeTurns": False})
        if not isinstance(result, dict) or not isinstance(result.get("thread"), dict):
            raise AppServerError("Codex app-server returned an invalid thread")
        return result["thread"]

    def turn_start(self, thread_id: str, text: str, *, effort: str | None = None) -> str:
        if not isinstance(text, str) or not text.strip() or len(text) > 16000:
            raise ValueError("Turn text must be 1–16000 characters")
        params = {"threadId": thread_id, "input": [{"type": "text", "text": text}]}
        if effort:
            params["effort"] = effort
        result = self.request("turn/start", params)
        return self._id_from(result, "turn")

    def turn_interrupt(self, thread_id: str, turn_id: str) -> None:
        self.request("turn/interrupt", {"threadId": thread_id, "turnId": turn_id})

    @staticmethod
    def _id_from(result: Any, key: str) -> str:
        value = result.get(key) if isinstance(result, dict) else None
        identifier = value.get("id") if isinstance(value, dict) else None
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 128 or any(ord(char) < 32 for char in identifier):
            raise AppServerError(f"Codex app-server returned an invalid {key} ID")
        return identifier

    def close(self) -> None:
        with self._lock:
            process = self._proc
            if process is None:
                return
            self._proc = None
            self._fail("Codex app-server connection closed")
            if process.stdin is not None:
                try:
                    process.stdin.close()
                except OSError:
                    pass
            if process.poll() is None:
                process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        if process.stdout is not None:
            process.stdout.close()
