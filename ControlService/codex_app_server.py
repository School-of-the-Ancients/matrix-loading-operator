"""PC-local Codex app-server JSONL transport for the Matrix Agent Portal.

This module is deliberately not an HTTP API. The caller owns Matrix authentication,
durable portal-to-thread mapping, event normalization, and browser-safe redaction.
Only the PC process sees Codex's stdio protocol and credentials.
"""
from __future__ import annotations

from collections import OrderedDict, deque
from copy import deepcopy
from dataclasses import dataclass, field
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from typing import Any


# A native imageGeneration completion may contain a base64 PNG. The image is
# extracted on the PC and never enters the bounded event stream.
MAX_LINE = 48 * 1024 * 1024
MAX_SEND = 1024 * 1024
MAX_EVENT = 64 * 1024
MAX_EVENTS = 256
MAX_APPROVALS = 16
MAX_GENERATED_IMAGE_BYTES = 32 * 1024 * 1024
MAX_IMAGE_RESULTS = 128
APPROVAL_METHODS = {"item/commandExecution/requestApproval", "item/fileChange/requestApproval",
                    "mcpServer/elicitation/request"}


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
                 environment: dict[str, str] | None = None,
                 artifact_directory: str | Path | None = None):
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
        self._image_results: OrderedDict[tuple[str, str], dict] = OrderedDict()
        codex_home = self.environment.get("CODEX_HOME") or os.environ.get("CODEX_HOME")
        self._generated_root = (Path(codex_home) if codex_home else Path.home() / ".codex") / "generated_images"
        self._image_directory = (Path(artifact_directory) if artifact_directory is not None else
                                 self.cwd / ".agent_portal" / "native_generated")
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
                mcp_approval = (method == "mcpServer/elicitation/request" and
                                isinstance(params, dict) and params.get("mode") == "form" and
                                isinstance(params.get("_meta"), dict) and
                                params["_meta"].get("codex_approval_kind") == "mcp_tool_call" and
                                isinstance(params.get("threadId"), str) and
                                isinstance(params.get("turnId"), str))
                if (method not in APPROVAL_METHODS or len(self._approvals) >= MAX_APPROVALS or
                        not isinstance(params, dict) or
                        method == "mcpServer/elicitation/request" and not mcp_approval):
                    self._write({"id": message["id"], "error": {"code": -32601,
                                                                  "message": "Matrix cannot handle this server request"}})
                else:
                    self._approvals[message["id"]] = {"method": method, "params": params}
            elif method == "serverRequest/resolved" and isinstance(params, dict):
                request_id = params.get("requestId")
                if isinstance(request_id, (int, str)):
                    self._approvals.pop(request_id, None)
            self._sequence += 1
            image_item = (params.get("item") if isinstance(params, dict) and
                          method in ("item/started", "item/completed") else None)
            if isinstance(image_item, dict) and image_item.get("type") == "imageGeneration":
                if method == "item/completed":
                    self._capture_generated_image(params)
                # Even a short image item can contain a private savedPath. Only
                # routing metadata may reach the event normalization layer.
                safe_params = _truncated_event_params(params)
            else:
                raw = json.dumps(params, ensure_ascii=False, separators=(",", ":"))
                safe_params = params if len(raw.encode("utf-8")) <= MAX_EVENT else _truncated_event_params(params)
            self._events.append({"sequence": self._sequence, "method": method,
                                 "params": safe_params, **({"requestId": message["id"]} if "id" in message else {})})

    @staticmethod
    def _image_type(data: bytes) -> tuple[str, str] | None:
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png", ".png"
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg", ".jpg"
        if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return "image/webp", ".webp"
        return None

    def _validated_saved_image(self, value: str) -> dict | None:
        if not isinstance(value, str) or len(value) > 2048:
            return None
        path = Path(value)
        try:
            checked = path.resolve(strict=True)
            checked.relative_to(self._generated_root.resolve(strict=True))
            size = checked.stat().st_size
            if not path.is_absolute() or not checked.is_file() or not 0 < size <= MAX_GENERATED_IMAGE_BYTES:
                return None
            digest = hashlib.sha256()
            with checked.open("rb") as stream:
                header = stream.read(12)
                stream.seek(0)
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            image_type = self._image_type(header)
            if image_type is None or checked.suffix.lower() not in (
                    (".jpg", ".jpeg") if image_type[0] == "image/jpeg" else (image_type[1],)):
                return None
            return {"imagePath": str(checked), "sha256": digest.hexdigest(),
                    "mimeType": image_type[0]}
        except (OSError, ValueError):
            return None

    def _decoded_image(self, result: str) -> tuple[bytes, str, str] | None:
        if not isinstance(result, str) or not 0 < len(result) <= 4 * ((MAX_GENERATED_IMAGE_BYTES + 2) // 3):
            return None
        try:
            raw = base64.b64decode(result, validate=True)
        except (binascii.Error, ValueError):
            return None
        if not 0 < len(raw) <= MAX_GENERATED_IMAGE_BYTES:
            return None
        image_type = self._image_type(raw[:12])
        if image_type is None:
            return None
        return raw, image_type[0], image_type[1]

    def _persist_decoded_image(self, decoded: tuple[bytes, str, str]) -> dict | None:
        raw, mime_type, suffix = decoded
        directory = self._image_directory
        temporary = None
        try:
            directory.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="wb", dir=directory, suffix=suffix,
                                             prefix="codex-", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            return {"imagePath": str(temporary), "sha256": hashlib.sha256(raw).hexdigest(),
                    "mimeType": mime_type, "transientArtifact": True}
        except OSError:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            return None

    def _discard_staged_image(self, result: dict) -> None:
        if result.get("transientArtifact") is not True:
            return
        path = Path(result["imagePath"])
        try:
            if (path.parent.resolve() == self._image_directory.resolve() and
                    path.name.startswith("codex-") and not path.is_symlink()):
                path.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass

    def _capture_generated_image(self, params: dict) -> None:
        thread_id, turn_id, item = params.get("threadId"), params.get("turnId"), params.get("item")
        if not all(isinstance(value, str) and 1 <= len(value) <= 128 for value in (thread_id, turn_id)):
            return
        key = (thread_id, turn_id)
        if key in self._image_results:
            self._discard_staged_image(self._image_results[key])
            self._image_results[key] = {"status": "failed", "error": "Multiple native image results in one turn"}
            return
        result = {"status": "failed", "error": "Native image generation did not return a valid image"}
        if isinstance(item, dict) and item.get("status") == "completed":
            saved = self._validated_saved_image(item.get("savedPath"))
            encoded = item.get("result")
            decoded = self._decoded_image(encoded) if isinstance(encoded, str) and encoded else None
            if isinstance(encoded, str) and encoded:
                # The app-server supplies both values today. A path is trusted
                # only when it names the same bytes as the completed item.
                artifact = (saved if saved is not None and decoded is not None and
                            saved["sha256"] == hashlib.sha256(decoded[0]).hexdigest() else
                            self._persist_decoded_image(decoded) if decoded is not None else None)
            else:
                artifact = saved
            if artifact is not None:
                revised = item.get("revisedPrompt")
                result = {"status": "ready", **artifact,
                          **({"revisedPrompt": revised[:4096]} if isinstance(revised, str) else {})}
        self._image_results[key] = result
        self._image_results.move_to_end(key)
        while len(self._image_results) > MAX_IMAGE_RESULTS:
            _, old = self._image_results.popitem(last=False)
            self._discard_staged_image(old)

    def image_generation_result(self, thread_id: str, turn_id: str) -> dict | None:
        """PC-only verified artifact; no base64 or arbitrary native path escapes."""
        with self._lock:
            result = self._image_results.get((thread_id, turn_id))
            return dict(result) if result is not None else None

    def native_image_capability(self) -> tuple[bool, str | None]:
        """Require authenticated ChatGPT and an image capable model provider."""
        try:
            account = self.request("account/read", {})
            if not isinstance(account, dict) or not isinstance(account.get("account"), dict) or \
                    account["account"].get("type") != "chatgpt":
                return False, "Codex needs a ChatGPT sign-in for native image generation"
            capabilities = self.request("modelProvider/capabilities/read", {})
            if not isinstance(capabilities, dict) or capabilities.get("imageGeneration") is not True:
                return False, "Codex image generation is unavailable in this session"
            return True, None
        except AppServerError:
            return False, "Codex image generation capability could not be verified"

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
            if pending["method"] == "mcpServer/elicitation/request":
                result = {"action": "accept", "content": {}} if decision == "accept" else {"action": "decline"}
            else:
                result = {"decision": decision}
            self._write({"id": request_id, "result": result})
            self._approvals.pop(request_id, None)

    def thread_start(self, *, model: str | None = None, sandbox: str = "workspace-write",
                     approval_policy: str = "on-request") -> str:
        if sandbox not in ("read-only", "workspace-write", "danger-full-access"):
            raise ValueError("Unsupported Agent Portal sandbox")
        if (approval_policy not in ("on-request", "never") or
                (approval_policy == "never" and sandbox != "danger-full-access")):
            raise ValueError("Unsupported Agent Portal approval policy")
        params = {"cwd": str(self.cwd), "approvalPolicy": approval_policy, "approvalsReviewer": "user",
                  "sandbox": sandbox,
                  "serviceName": "matrix_agent_portal"}
        if model:
            params["model"] = model
        result = self.request("thread/start", params)
        return self._id_from(result, "thread")

    def thread_resume(self, thread_id: str, *, sandbox: str = "workspace-write",
                      approval_policy: str = "on-request") -> str:
        if sandbox not in ("read-only", "workspace-write", "danger-full-access"):
            raise ValueError("Unsupported Agent Portal sandbox")
        if (approval_policy not in ("on-request", "never") or
                (approval_policy == "never" and sandbox != "danger-full-access")):
            raise ValueError("Unsupported Agent Portal approval policy")
        result = self.request("thread/resume", {"threadId": thread_id, "cwd": str(self.cwd),
                                                 "approvalPolicy": approval_policy, "approvalsReviewer": "user",
                                                 "sandbox": sandbox})
        return self._id_from(result, "thread")

    def thread_read(self, thread_id: str) -> dict:
        # Codex CLI 0.153.4 rejects includeTurns=true (list_turns unsupported).
        result = self.request("thread/read", {"threadId": thread_id, "includeTurns": False})
        if not isinstance(result, dict) or not isinstance(result.get("thread"), dict):
            raise AppServerError("Codex app-server returned an invalid thread")
        return result["thread"]

    def turn_start(self, thread_id: str, text: str, *, sandbox: str,
                   approval_policy: str, effort: str | None = None,
                   image_path: str | Path | None = None,
                   skill_path: str | Path | None = None) -> str:
        if not isinstance(text, str) or not text.strip() or len(text) > 16000:
            raise ValueError("Turn text must be 1–16000 characters")
        # These app-server overrides persist into later turns. Require an
        # explicit policy for every turn so an image-only read-only turn cannot
        # accidentally change the authority of a subsequent Agent turn (or
        # inherit a prior full-access turn's authority itself).
        policies = {
            "read-only": {"type": "readOnly", "networkAccess": False},
            "workspace-write": {"type": "workspaceWrite"},
            "danger-full-access": {"type": "dangerFullAccess"},
        }
        if sandbox not in policies or approval_policy not in ("on-request", "never") or \
                (approval_policy == "never" and sandbox != "danger-full-access"):
            raise ValueError("Unsupported Agent Portal turn policy")
        inputs = [{"type": "text", "text": text}]
        if image_path is not None:
            path = Path(image_path)
            if (not path.is_absolute() or not path.is_file() or
                    path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp")):
                raise ValueError("Turn image must be an existing local image")
            inputs.append({"type": "localImage", "path": str(path.resolve())})
        if skill_path is not None:
            path = Path(skill_path)
            if not path.is_absolute() or not path.is_file() or path.name != "SKILL.md":
                raise ValueError("Turn skill must be an existing local skill")
            inputs.append({"type": "skill", "name": "imagegen", "path": str(path.resolve())})
        params = {"threadId": thread_id, "input": inputs,
                  "sandboxPolicy": policies[sandbox], "approvalPolicy": approval_policy}
        if effort:
            params["effort"] = effort
        result = self.request("turn/start", params)
        return self._id_from(result, "turn")

    def turn_interrupt(self, thread_id: str, turn_id: str) -> None:
        self.request("turn/interrupt", {"threadId": thread_id, "turnId": turn_id})

    def turn_steer(self, thread_id: str, turn_id: str, text: str) -> None:
        if not isinstance(text, str) or not text.strip() or len(text) > 16000:
            raise ValueError("Steer text must be 1–16000 characters")
        result = self.request("turn/steer", {"threadId": thread_id,
                                             "expectedTurnId": turn_id,
                                             "input": [{"type": "text", "text": text}]})
        if not isinstance(result, dict) or result.get("turnId") != turn_id:
            raise AppServerError("Codex app-server returned a different steered turn")

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
        with self._lock:
            for result in self._image_results.values():
                self._discard_staged_image(result)
            self._image_results.clear()
