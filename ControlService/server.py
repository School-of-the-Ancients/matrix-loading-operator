"""AR Sandbox control service. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import collections
import copy
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

from ai_adapter import Planner, PlannerError, validate_local_bounds, validate_viewer
from learning import LearningBridge, LearningError, identifier

MAX_BODY = 1024 * 1024
MAX_OBJECTS = 100
MAX_PENDING = 64
MAX_BATCH = 20
LEASE_SECONDS = 15
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\Z")
OPS = {"spawn", "set_transform", "select", "duplicate", "delete", "undo", "redo", "clear", "load",
       "get_scene", "list_assets", "list_targets"}


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def require(condition, message, status=400):
    if not condition:
        raise APIError(status, message)


def text(value, field, empty=False, limit=128):
    require(isinstance(value, str) and (empty or bool(value)) and len(value) <= limit,
            f"Invalid {field}")
    require(not any(ord(c) < 32 for c in value), f"Invalid {field}")
    return value


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
        if key == "assetId" and item.get("description"):
            entry["description"] = text(item["description"], "asset description", limit=500)
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
        viewer = validate_viewer(value.get("viewer"), {a["anchorId"] for a in result["anchors"]})
    except PlannerError as error:
        raise APIError(400, str(error)) from None
    if viewer is not None:
        result["viewer"] = viewer
    return result


def scene_revision_data(value):
    # Plans use the viewpoint at request time. Normal head motion is not a scene edit.
    return None if value is None else {key: item for key, item in value.items() if key != "viewer"}


def command(value):
    require(isinstance(value, dict), "Invalid command")
    op = value.get("op")
    require(isinstance(op, str) and op in OPS, "Unknown command op")
    allowed = {"op", "requestId"}
    required = {"spawn": {"assetId", "anchorId", "transform"}, "set_transform": {"objectId", "transform"},
                "select": {"objectId"}, "duplicate": {"objectId"}, "delete": {"objectId"},
                "load": {"scene"}}.get(op, set())
    allowed |= required
    if op == "spawn":
        allowed |= {"anchorId", "transform"}
    if op == "set_transform":
        allowed |= {"anchorId"}
    require(not (set(value) - allowed), "Unexpected command fields")
    require(required <= set(value), "Missing command fields")
    result = {"op": op}
    for key in ("assetId", "objectId", "anchorId"):
        if key in value:
            result[key] = text(value[key], key, empty=key == "anchorId")
    if "transform" in value:
        result["transform"] = transform(value["transform"])
    if "scene" in value:
        result["scene"] = scene(value["scene"])
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


class State:
    def __init__(self, directory, clock=time.monotonic, learning=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.lock = threading.RLock()
        self.client_id = None
        self.last_seen = -float("inf")
        self.latest = None
        self.pending = collections.OrderedDict()
        self.results = collections.deque(maxlen=100)
        self.revision = 0
        self.proposals = collections.OrderedDict()
        self.learning = learning

    def online(self):
        return self.client_id is not None and self.clock() - self.last_seen < LEASE_SECONDS

    def expire(self):
        if self.client_id is not None and not self.online():
            for request_id in self.pending:
                self.results.append({"requestId": request_id, "ok": False,
                                     "error": "Client lease expired; command outcome unknown", "objectId": ""})
            self.pending.clear()
            self.proposals.clear()
            self.revision += 1
            self.client_id = None

    def exchange(self, body):
        require(isinstance(body, dict), "Expected exchange object")
        client_id = text(body.get("clientId"), "clientId")
        current = snapshot(body.get("snapshot"))
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
            self.client_id, self.last_seen = client_id, self.clock()
            for result in checked:
                if result["requestId"] in self.pending:
                    del self.pending[result["requestId"]]
                    self.results.append(result)
            if scene_revision_data(self.latest) != scene_revision_data(current):
                self.revision += 1
            self.latest = current
            response = {"commands": copy.deepcopy(list(self.pending.values()))}
            if self.learning:
                self.learning.restore_after_ack(self)
                guide = self.learning.guide(self)
                if guide is not None:
                    response["lesson"] = guide
            return response

    def queue(self, raw_commands):
        require(isinstance(raw_commands, list) and 0 < len(raw_commands) <= MAX_BATCH,
                f"Expected 1-{MAX_BATCH} commands")
        checked = [command(item) for item in raw_commands]
        with self.lock:
            self.expire()
            require(not self.learning or not self.learning.restore, "Finish the pending lesson restore before editing", 409)
            require(self.online(), "Headset client is offline", 409)
            require(len(self.pending) + len(checked) <= MAX_PENDING, "Command queue full", 409)
            for item in checked:
                item["requestId"] = uuid.uuid4().hex
                self.pending[item["requestId"]] = item
            self.revision += 1
            return {"commands": copy.deepcopy(checked)}

    def status(self):
        with self.lock:
            self.expire()
            return {"online": self.online(), "snapshot": copy.deepcopy(self.latest),
                    "pendingCount": len(self.pending), "results": copy.deepcopy(list(self.results))}

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
            require(self.online() and self.latest is not None, "Headset client is offline", 409)
            require(not self.pending, "Wait for all queued commands to finish before saving", 409)
            saved = copy.deepcopy(self.latest)
            saved.pop("viewer", None)
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


def plan(state, body):
    require(isinstance(body, dict), "Expected plan object")
    prompt = text(body.get("text"), "text", limit=4000)
    mode = body.get("mode")
    require(mode in (None, "offline-rules", "openai-compatible", "codex-cli"), "Invalid planner mode")
    with state.lock:
        state.expire()
        require(state.online() and state.latest is not None, "Runtime is offline", 409)
        require(not state.pending, "Wait for queued commands before creating a proposal", 409)
        current = copy.deepcopy(state.latest)
        client_id, revision = state.client_id, state.revision
        saved_names = state.scenes()["scenes"]
    try:
        proposed = Planner().plan(prompt, current, saved_scenes=saved_names, mode=mode)
    except PlannerError as error:
        raise APIError(error.status, str(error)) from None
    values = proposed.get("commands")
    require(isinstance(values, list) and len(values) <= MAX_BATCH, "Invalid proposal", 502)
    if not values:
        require(proposed.get("requiresApply") is False and proposed.get("status") == "needs_clarification",
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
        require(all(item["op"] != "load" for item in checked), "Planner cannot invent a scene document", 502)
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
    return result


class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, state, token=""):
        self.is_loopback = loopback(address[0])
        require(self.is_loopback or len(token) >= 24, "Non-loopback binding requires SANDBOX_TOKEN of at least 24 characters")
        self.state, self.token = state, token
        super().__init__(address, Handler)


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
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
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

    def do_GET(self):
        try:
            self.validate_host()
            path = urllib.parse.urlsplit(self.path).path
            if path in ("/", "/learning") and loopback(self.client_address[0]):
                page = "index.html" if path == "/" else "learning.html"
                self.send_data(200, Path(__file__).with_name(page).read_bytes(), "text/html; charset=utf-8")
                return
            if path == "/learning-ui.js" and loopback(self.client_address[0]):
                self.send_data(200, Path(__file__).with_name("learning-ui.js").read_bytes(), "text/javascript; charset=utf-8")
                return
            self.authenticate()
            if path == "/api/state":
                data = self.server.state.status()
            elif path == "/api/scenes":
                data = self.server.state.scenes()
            elif path == "/api/planner":
                data = Planner().public_status()
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
        except (APIError, LearningError) as error:
            self.send_data(error.status, {"error": str(error)})
        except PlannerError as error:
            self.send_data(error.status, {"error": str(error)})
        except (OSError, ValueError):
            self.send_data(500, {"error": "Service I/O error"})

    def do_POST(self):
        try:
            host = self.validate_host()
            self.authenticate()
            origin = self.headers.get("Origin")
            require(origin is None or origin.lower() == "http://" + host, "Cross-origin mutation rejected", 403)
            require(self.headers.get_content_type() == "application/json", "Content-Type must be application/json", 415)
            require(not self.headers.get("Transfer-Encoding"), "Transfer encoding is unsupported", 400)
            try:
                size = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                raise APIError(400, "Invalid Content-Length") from None
            require(0 < size <= MAX_BODY, "Body must be 1 byte to 1 MiB", 413)
            raw = self.rfile.read(size)
            require(len(raw) == size, "Incomplete request body")
            body = parse_json(raw)
            require(isinstance(body, dict), "Expected JSON object")
            path = urllib.parse.urlsplit(self.path).path
            state = self.server.state
            if path == "/api/exchange":
                data = state.exchange(body)
            elif path == "/api/command":
                data = state.queue(body["commands"] if set(body) == {"commands"} else [body])
            elif path == "/api/save":
                data = state.save(body.get("name"))
            elif path == "/api/load":
                data = state.load(body.get("name"), body.get("requestId"))
            elif path == "/api/plan":
                data = plan(state, body)
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
        except (APIError, LearningError) as error:
            self.send_data(error.status, {"error": str(error)})
        except (OSError, ValueError, RecursionError):
            self.send_data(500, {"error": "Service I/O error"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--scenes", type=Path, default=Path(__file__).with_name("scenes"))
    args = parser.parse_args()
    try:
        server = Server((args.host, args.port), State(args.scenes, learning=LearningBridge()), os.environ.get("SANDBOX_TOKEN", ""))
    except (APIError, LearningError, OSError) as error:
        parser.error(str(error))
    print(f"AR Sandbox service listening on {args.host}:{server.server_port}; Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
