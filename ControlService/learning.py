"""Thin scene adapter for sota-v2's local Operator API; no lesson state machine."""
from __future__ import annotations

import copy
import ipaddress
import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid


class LearningError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def check(condition, message, status=409):
    if not condition:
        raise LearningError(status, message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class CoreClient:
    def __init__(self, url=None):
        self.url = (url or os.environ.get("SOTA_CORE_URL", "http://127.0.0.1:8787")).rstrip("/")
        parsed = urllib.parse.urlsplit(self.url)
        try:
            local = parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname or "").is_loopback
            port = parsed.port
        except ValueError:
            local, port = False, None
        check(parsed.scheme == "http" and local and not parsed.username and not parsed.password
              and parsed.path in ("", "/") and not parsed.query and not parsed.fragment
              and port is not None, "SOTA_CORE_URL must be a local HTTP URL with an explicit port", 400)
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None):
        raw = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        request = urllib.request.Request(self.url + "/api/operator/v1" + path, data=raw,
                                         headers={"Content-Type": "application/json"})
        try:
            response = self.http.open(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        except (OSError, TimeoutError):
            raise LearningError(503, "Learning core unavailable. Start sota-v2 with npm run dev:operator; retry the same action.") from None
        try:
            with response:
                raw = response.read(2 * 1024 * 1024 + 1)
                check(len(raw) <= 2 * 1024 * 1024, "Learning core response too large", 502)
                result = json.loads(raw)
                check(isinstance(result, dict), "Invalid learning core response", 502)
                if response.status != 200 and response.status != 201:
                    message = result.get("error", "Learning core rejected the request")
                    if isinstance(message, dict):
                        message = message.get("message", "Learning core rejected the request")
                    raise LearningError(response.status if 400 <= response.status < 500 else 503, str(message)[:500])
                check(result.get("apiVersion") == 1, "Unsupported learning core API version", 502)
                return result
        except (OSError, ValueError):
            raise LearningError(502, "Invalid or incomplete learning core response; retry the same action") from None


def identifier(value, field):
    check(isinstance(value, str) and 1 <= len(value) <= 128
          and all(c.isalnum() or c in "_-" for c in value), "Invalid " + field, 400)
    return value


def scene_matches(expected, actual):
    if expected["roomId"] != actual["roomId"] or len(expected["objects"]) != len(actual["objects"]):
        return False
    by_id = {o["objectId"]: o for o in actual["objects"]}
    for item in expected["objects"]:
        other = by_id.get(item["objectId"])
        if not other or any(item[key] != other[key] for key in ("assetId", "anchorId")):
            return False
        for part in ("position", "rotation", "scale"):
            if any(not math.isclose(item["transform"][part][axis], other["transform"][part][axis], rel_tol=1e-5, abs_tol=1e-5)
                   for axis in ("x", "y", "z")):
                return False
    return True


class LearningBridge:
    """Core owns progress. This holds only a presentation cache and pending scene ACK."""

    def __init__(self, client=None):
        self.client = client or CoreClient()
        self.session = None
        self.restore = None
        self.restore_receipts = {}
        self.requests = {}
        self.binding_epoch = 0

    def catalog(self):
        result = self.client.call("/lessons")
        if self.session is not None:
            self.accept(self.client.call("/sessions/" + self.session["id"]))
        return result

    def settled(self, state):
        state.expire()
        check(state.online() and state.latest, "Connect the room runtime first")
        check(not state.pending, "Wait for room commands to finish")
        check(self.restore is None, "Finish or retry the pending lesson restore first")

    def object(self, snap, context):
        check(snap and snap["scene"]["roomId"] == context["roomId"], "Lesson belongs to another room; restore its saved scene")
        item = next((o for o in snap["scene"]["objects"] if o["objectId"] == context["objectId"]), None)
        check(item is not None and item["anchorId"] == context["anchorId"] and item["assetId"] == "block",
              "Lesson block is missing or moved to another target; restore its saved scene")
        return item

    def accept(self, response):
        session = response.get("session")
        check(isinstance(session, dict) and isinstance(session.get("context"), dict)
              and isinstance(session.get("content"), dict) and isinstance(session.get("id"), str),
              "Invalid session from learning core", 502)
        if not self.session or self.session["id"] != session["id"] or self.session["revision"] <= session["revision"]:
            self.session = copy.deepcopy(session)
        return response

    def retry(self, body, operation):
        key = identifier(body.get("requestId"), "requestId")
        prior = self.requests.get(key)
        if prior is None:
            return None
        check(prior["body"] == body and prior["operation"] == operation, "requestId already used for another request", 409)
        response = self.client.call(prior["path"], prior["payload"])
        return self.accept(response) if prior["epoch"] == self.binding_epoch else response

    def request(self, body, operation, path, payload):
        # Freeze the original runtime evidence across a timeout and retry.
        check(len(self.requests) < 2000, "Local request capacity reached; save before restarting the PC service")
        if operation == "start":
            self.binding_epoch += 1
        self.requests[body["requestId"]] = copy.deepcopy({"body": body, "operation": operation, "path": path, "payload": payload, "epoch": self.binding_epoch})
        return self.accept(self.client.call(path, payload))

    def start(self, state, body):
        with state.lock:
            prior = self.retry(body, "start")
            if prior is not None:
                return prior
            self.settled(state)
            request_id = identifier(body.get("requestId"), "requestId")
            lesson_id = identifier(body.get("lessonId"), "lessonId")
            object_id = body.get("objectId") or (state.latest.get("selection") or {}).get("objectId")
            item = next((o for o in state.latest["scene"]["objects"] if o["objectId"] == object_id), None)
            check(item is not None and item["assetId"] == "block", "Place and select a bundled block before starting this lesson")
            check(all(v <= 10 for v in item["transform"]["scale"].values()), "Start with a smaller block so it can double in size")
            context = {"roomId": state.latest["scene"]["roomId"], "anchorId": item["anchorId"],
                       "objectId": item["objectId"], "baselineScale": item["transform"]["scale"]}
            return self.request(body, "start", "/sessions", {"requestId": request_id, "lessonId": lesson_id, "context": context})

    def act(self, state, body):
        with state.lock:
            prior = self.retry(body, "action")
            if prior is not None:
                return prior
            self.settled(state)
            check(self.session is not None, "Start or restore a lesson first")
            check(body.get("sessionId") == self.session["id"], "Lesson changed; refresh before responding")
            item = self.object(state.latest, self.session["context"])
            # Evidence comes only from the runtime snapshot, never a browser-provided transform.
            payload = {k: body[k] for k in ("requestId", "expectedRevision", "action", "message") if k in body}
            identifier(payload.get("requestId"), "requestId")
            if payload.get("action") == "submit_practice":
                payload["evidence"] = {"roomId": state.latest["scene"]["roomId"], "anchorId": item["anchorId"],
                                       "objectId": item["objectId"], "scale": item["transform"]["scale"]}
            return self.request(body, "action", "/sessions/" + self.session["id"] + "/actions", payload)

    def checkpoint(self, state):
        if self.session is None:
            return None
        self.settled(state)
        self.object(state.latest, self.session["context"])
        result = self.client.call("/sessions/" + self.session["id"] + "/checkpoints",
                                  {"requestId": uuid.uuid4().hex, "expectedRevision": self.session["revision"]})
        return {"apiVersion": 1, "checkpoint": result["checkpoint"]}

    def prepare_restore(self, saved):
        reference = saved.get("learningCheckpoint")
        if reference is None:
            return None
        check(isinstance(reference, dict) and reference.get("apiVersion") == 1
              and isinstance(reference.get("checkpoint"), dict), "Invalid saved learning checkpoint", 400)
        checkpoint = reference["checkpoint"]
        checkpoint_id = identifier(checkpoint.get("id"), "checkpointId")
        result = self.client.call("/checkpoints/" + checkpoint_id)
        check(result["checkpoint"] == checkpoint, "Saved checkpoint metadata does not match the learning core", 409)
        self.object(saved, result["session"]["context"])
        return checkpoint_id

    def restore_after_ack(self, state):
        pending = self.restore
        if not pending:
            return
        result = next((r for r in state.results if r["requestId"] == pending["commandId"]), None)
        if not result:
            return
        if not result["ok"]:
            pending["error"] = "Room restore was not confirmed: " + result["error"]
            pending["failed"] = True
            return
        if not scene_matches(pending["scene"], state.latest["scene"]):
            pending["error"] = "Runtime acknowledged load but its scene differs. Inspect the room, dismiss this restore, and load the saved scene again."
            pending["failed"] = True
            return
        # A successful Unity load ACK is the only trigger for canonical checkpoint restore.
        if pending["checkpointId"] is None:
            self.binding_epoch += 1
            self.session, self.restore = None, None
            return
        if pending.get("error"):
            return  # Retry explicitly with the same request ID; never fork twice after timeout.
        try:
            response = self.client.call("/checkpoints/" + pending["checkpointId"] + "/restore",
                                        {"requestId": pending["requestId"]})
            self.accept(response)
            self.binding_epoch += 1
            self.restore = None
        except LearningError as error:
            pending["error"] = str(error)

    def retry_restore(self, state):
        with state.lock:
            check(self.restore is not None, "No pending restore")
            check(not self.restore.get("failed"), "Room outcome is unconfirmed. Dismiss this restore and load the saved scene again")
            self.restore.pop("error", None)
            self.restore_after_ack(state)
            return self.status(state)

    def status(self, state):
        issue = ""
        if self.restore:
            issue = self.restore.get("error", "Restoring room; waiting for runtime acknowledgement")
        elif self.session:
            try:
                check(state.online(), "Runtime offline; lesson paused")
                self.object(state.latest, self.session["context"])
                if state.pending:
                    issue = "Waiting for room commands"
            except LearningError as error:
                issue = str(error)
        return {"apiVersion": 1, "session": copy.deepcopy(self.session), "issue": issue,
                "restorePending": self.restore is not None, "restoreFailed": bool(self.restore and self.restore.get("failed"))}

    def guide(self, state):
        if self.session is None:
            return None
        s = self.session
        return {"sessionId": s["id"], "revision": s["revision"], "title": s["content"]["title"],
                "stageLabel": s["stageLabel"], "body": s["content"]["body"], "prompt": s["content"]["prompt"],
                "hint": s["content"]["hint"], "status": self.status(state)["issue"] or "Respond on the PC learning panel",
                "progressIndex": s["progress"]["index"], "progressTotal": s["progress"]["total"]}
