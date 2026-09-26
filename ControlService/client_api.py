"""Version 1 local companion adapter over Matrix's existing scene authority.

Pairings and request ledgers are bounded and process-local. A client token can
read its bound runtime and propose work; only the local Operator can Apply.
"""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import re
import secrets
import threading
import scale_experiment
from ai_adapter import PlannerError


PROTOCOL = "1"
PAIR_SECONDS = 120
SESSION_SECONDS = 3600
MAX_SESSIONS = 16
MAX_REQUESTS = 64
ACTIVE_LIMIT = 4
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,95}\Z")
PRE_APPLY = {"planning", "ready"}
IN_FLIGHT = {"queued", "running", "unconfirmed"}


class ClientError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code = status, code
        super().__init__(message)


def require(condition, code, message, status=400):
    if not condition:
        raise ClientError(status, code, message)


def identifier(value, field):
    require(isinstance(value, str) and IDENTIFIER.fullmatch(value), "invalid_request", f"Invalid {field}")
    return value


def digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def envelope(**fields):
    return {"protocolVersion": PROTOCOL, **fields}


class ClientAPI:
    def __init__(self, state, planner, planner_modes=None):
        self.state, self.planner = state, planner
        self.planner_modes = planner_modes or (lambda: ["offline-rules"])
        self.ai_worker = threading.Lock()
        self.instance = secrets.token_hex(12)
        self.pairings = {}
        self.sessions = {}

    def runtime_id(self):
        return f"{self.instance}.{self.state.runtime_generation}" if self.state.online() else None

    def discovery(self, configured):
        return envelope(service="matrix-loading-operator", transport="local-companion",
                        supportedProtocolVersions=[PROTOCOL], pairingAvailable=configured,
                        pairingReason=None if configured else "Configure SANDBOX_TOKEN before pairing clients.",
                        capabilities={"scene.read": True, "scene.propose_text": {"modes": self.planner_modes(), "requiresOperatorApply": True},
                                      "request.read": True, "request.cancel_before_apply": True,
                                      "capture": False, "content.prepare": False, "events.stream": False,
                                      "hostedBrowserConnection": False, "physicalMeasurements": False,
                                      scale_experiment.CAPABILITY: scale_experiment.descriptor()},
                        limits={"pairingSeconds": PAIR_SECONDS, "sessionSeconds": SESSION_SECONDS,
                                "sessionsPerServiceStart": MAX_SESSIONS, "requestsPerSession": MAX_REQUESTS,
                                "activeRequestsPerSession": ACTIVE_LIMIT},
                        retention="Memory only until service restart; do not replay an uncertain request after re-pairing.")

    def _change(self, request, status, **fields):
        changed = request["status"] != status or any(request.get(key) != value for key, value in fields.items())
        request.update(status=status, **fields)
        if changed:
            request["sequence"] += 1

    def _drop_proposal(self, request):
        self.state.proposals.pop((request.get("proposal") or {}).get("planId"), None)

    def _end_session(self, session, status):
        if session["status"] == "active" or (session["status"] == "stale" and status == "expired"):
            session["status"] = status
            for request in session["requests"].values():
                if request["status"] in PRE_APPLY:
                    self._drop_proposal(request)
                    self._change(request, "cancelled" if status == "revoked" else "stale",
                                 error="Pairing was revoked." if status == "revoked" else "The paired session is no longer current.")

    def refresh(self):
        """Caller holds state.lock. Never blocks on providers or network I/O."""
        now = self.state.clock()
        for key in list(self.pairings):
            if self.pairings[key]["expires"] <= now:
                del self.pairings[key]
        for session in self.sessions.values():
            if now >= session["expires"]:
                self._end_session(session, "expired")
            elif session["runtimeSessionId"] != self.runtime_id():
                self._end_session(session, "stale")
            for request in session["requests"].values():
                if request["status"] == "ready":
                    plan = self.state.proposals.get(request["proposal"]["planId"])
                    if (plan is None or plan["revision"] != self.state.revision or now > plan["expires"]):
                        self._drop_proposal(request)
                        self._change(request, "stale", error="Scene, selection, or proposal changed; create a new request after reviewing the current scene.")

    def pair(self, body):
        require(set(body) == {"clientName"}, "invalid_request", "Expected clientName only")
        name = body["clientName"]
        require(isinstance(name, str) and 1 <= len(name.strip()) <= 64 and not any(ord(c) < 32 for c in name),
                "invalid_request", "clientName must be 1-64 printable characters")
        with self.state.lock:
            self.state.expire()
            self.refresh()
            require(self.state.online(), "runtime_offline", "Connect a runtime before pairing.", 409)
            require(len(self.sessions) + len(self.pairings) < MAX_SESSIONS,
                    "session_limit", "Service pairing ledger is full. Existing requests remain queryable; restart only after reconciling them.", 429)
            code = secrets.token_urlsafe(24)
            self.pairings[digest(code)] = {"clientName": name.strip(), "runtimeSessionId": self.runtime_id(),
                                          "expires": self.state.clock() + PAIR_SECONDS}
            return envelope(pairingCode=code, expiresInSeconds=PAIR_SECONDS, runtimeSessionId=self.runtime_id())

    def claim(self, body):
        require(set(body) == {"pairingCode"}, "invalid_request", "Expected pairingCode only")
        code = body["pairingCode"]
        require(isinstance(code, str) and len(code) <= 128, "invalid_pairing", "Pairing code is invalid or expired.", 401)
        with self.state.lock:
            self.state.expire()
            self.refresh()
            pairing = self.pairings.pop(digest(code), None)
            require(pairing is not None, "invalid_pairing", "Pairing code is invalid, expired, or already used.", 401)
            require(pairing["runtimeSessionId"] == self.runtime_id(), "runtime_changed", "The runtime changed. Ask the Operator for a new pairing code.", 409)
            session_id, token = secrets.token_hex(16), secrets.token_urlsafe(32)
            self.sessions[session_id] = {"sessionId": session_id, "clientName": pairing["clientName"], "tokenDigest": digest(token),
                                         "runtimeSessionId": pairing["runtimeSessionId"], "expires": self.state.clock() + SESSION_SECONDS,
                                         "status": "active", "requests": {}}
            return envelope(sessionId=session_id, clientToken=token, runtimeSessionId=pairing["runtimeSessionId"], expiresInSeconds=SESSION_SECONDS)

    def authenticate(self, authorization):
        require(authorization.startswith("Bearer ") and len(authorization) <= 160,
                "authentication_required", "A paired client bearer token is required.", 401)
        token_digest = digest(authorization[7:])
        with self.state.lock:
            self.state.expire()
            self.refresh()
            session = next((value for value in self.sessions.values() if hmac.compare_digest(value["tokenDigest"], token_digest)), None)
            require(session is not None and session["status"] not in {"revoked", "expired"},
                    "authentication_required", "Client token is invalid, expired, or revoked.", 401)
            return session

    def _current(self, session):
        self.refresh()
        require(session["status"] == "active" and self.runtime_id() == session["runtimeSessionId"],
                "runtime_changed", "The paired runtime is no longer current. Reconcile prior requests and pair again.", 409)

    def scene(self, session):
        with self.state.lock:
            self.state.expire()
            self._current(session)
            require(self.state.latest is not None, "room_unavailable", self.state.room_unavailable_message(), 409)
            return envelope(sessionId=session["sessionId"], runtimeSessionId=self.runtime_id(), revision=self.state.revision,
                            snapshot=copy.deepcopy(self.state.latest), runtime=copy.deepcopy(self.state.runtime))

    def public_request(self, session, request):
        fields = {key: copy.deepcopy(request.get(key)) for key in
                  ("requestId", "correlationId", "runtimeSessionId", "sequence", "status", "proposal", "commandIds", "receipts", "observed", "error")}
        if request.get("experiment"):
            fields["experiment"] = copy.deepcopy(request["experiment"])
            observed = scale_experiment.observation(request)
            fields["experiment"]["observation"] = observed
            fields["experiment"]["observationState"] = "confirmed" if observed is not None else "unconfirmed" if request["status"] == "succeeded" else "not-confirmed"
            if observed is not None:
                fields["experimentEvent"] = scale_experiment.observed_event(request, observed, session["sessionId"])
        return envelope(sessionId=session["sessionId"], requiresApply=request["status"] == "ready", **fields)

    def get_request(self, session, request_id):
        identifier(request_id, "requestId")
        with self.state.lock:
            self.state.expire()
            self.refresh()
            request = session["requests"].get(request_id)
            require(request is not None, "request_not_found", "Request not found in this paired session.", 404)
            return self.public_request(session, request)

    def propose(self, session, body):
        require(set(body) in ({"requestId", "expected", "intent"}, {"requestId", "correlationId", "expected", "intent"}),
                "invalid_request", "Expected requestId, expected, intent, and optional correlationId")
        request_id = identifier(body["requestId"], "requestId")
        correlation = identifier(body["correlationId"], "correlationId") if "correlationId" in body else None
        expected, intent = body["expected"], body["intent"]
        require(isinstance(expected, dict) and set(expected) == {"runtimeSessionId", "revision"}
                and isinstance(expected["runtimeSessionId"], str) and type(expected["revision"]) is int,
                "invalid_request", "expected must contain runtimeSessionId and integer revision")
        experiment = isinstance(intent, dict) and intent.get("kind") == "block-scale"
        if experiment:
            try:
                scale_experiment.validate_intent(intent)
            except PlannerError as error:
                raise ClientError(error.status, "invalid_experiment", str(error)) from None
        else:
            require(isinstance(intent, dict) and set(intent) == {"text", "mode"} and intent["mode"] in ("offline-rules", "codex-cli")
                    and isinstance(intent["text"], str) and 0 < len(intent["text"]) <= 4000 and bool(intent["text"].strip()),
                    "invalid_request", "intent must contain only text and mode: offline-rules or codex-cli")
        ai_request = not experiment and intent["mode"] == "codex-cli"
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with self.state.lock:
            self.state.expire()
            self.refresh()
            prior = session["requests"].get(request_id)
            if prior is not None:
                require(prior["fingerprint"] == fingerprint, "idempotency_conflict", "requestId already describes different work.", 409)
                return self.public_request(session, prior)
            self._current(session)
            require(expected == {"runtimeSessionId": self.runtime_id(), "revision": self.state.revision},
                    "stale_scene", "Read the current scene and review the request again.", 409)
            require(len(session["requests"]) < MAX_REQUESTS, "request_limit", "Session request ledger is full; reconcile and pair a new session.", 429)
            require(sum(item["status"] in PRE_APPLY | {"queued", "running"} for item in session["requests"].values()) < ACTIVE_LIMIT,
                    "request_limit", "Finish active requests before proposing more work.", 429)
            baseline = None
            if experiment and "baselineRequestId" in intent:
                previous = session["requests"].get(intent["baselineRequestId"])
                require(previous is not None and previous.get("experiment") is not None and scale_experiment.observation(previous) is not None,
                        "baseline_unconfirmed", "Reference a confirmed experiment request from this pairing.", 409)
                baseline = copy.deepcopy(previous["experiment"])
            if ai_request:
                # This callback only validates trusted local configuration; it
                # never invokes a provider. Lookup idempotency before these gates.
                require("codex-cli" in self.planner_modes(), "planner_unavailable",
                        "The Operator must configure a supported Codex planner before requesting AI scene changes.", 503)
                require(self.ai_worker.acquire(blocking=False), "planner_busy",
                        "A client AI request is still planning. Poll its outcome or wait before creating another request.", 409)
            request = {"requestId": request_id, "fingerprint": fingerprint, "correlationId": correlation,
                       "runtimeSessionId": session["runtimeSessionId"], "sequence": 1, "status": "planning",
                       "proposal": None, "commandIds": [], "receipts": [], "observed": None, "error": None}
            session["requests"][request_id] = request
            # Capture this exact revision for the existing planner's before/after
            # checks. Provider work must never hold the state exchange lock.
            context = (self.state.client_id, self.state.revision, copy.deepcopy(self.state.latest))
            if experiment:
                context += (baseline,)
            if ai_request:
                initial = self.public_request(session, request)
                try:
                    threading.Thread(target=self._plan_ai, args=(session, request, copy.deepcopy(intent), context),
                                     name="matrix-client-planner", daemon=True).start()
                except RuntimeError:
                    self.ai_worker.release()
                    self._change(request, "error", error="AI planning worker could not start. Nothing was applied.")
                    return self.public_request(session, request)
                return initial
        return self._complete_plan(session, request, intent, context, experiment)

    def _plan_ai(self, session, request, intent, context):
        try:
            self._complete_plan(session, request, intent, context, False)
        finally:
            self.ai_worker.release()

    def _complete_plan(self, session, request, intent, context, experiment):
        # Cancellation may win before the worker begins. All provider work
        # remains outside the exchange lock, and only this request may publish it.
        with self.state.lock:
            self.state.expire()
            self.refresh()
            if request["status"] != "planning":
                return self.public_request(session, request)
        try:
            proposed = self.planner(self.state, intent, request_context=context)
        except Exception as error:
            with self.state.lock:
                self.state.expire()
                self.refresh()
                if request["status"] == "planning":
                    self._change(request, "stale" if getattr(error, "status", None) == 409 else "error",
                                 error=str(error) if hasattr(error, "status") else "Planning failed. Nothing was applied.")
                return self.public_request(session, request)
        with self.state.lock:
            self.state.expire()
            self.refresh()
            if request["status"] == "planning" and (self.state.client_id, self.state.revision) != context[:2]:
                self._change(request, "stale", error="Scene or selection changed during planning; review the current scene before requesting again.")
            if request["status"] != "planning":
                self.state.proposals.pop(proposed.get("planId"), None)
            else:
                extra = {"experiment": copy.deepcopy(proposed["experiment"])} if experiment and "experiment" in proposed else {}
                self._change(request, "ready" if proposed.get("requiresApply") else proposed.get("status", "needs_clarification"), proposal=proposed, **extra)
            return self.public_request(session, request)

    def cancel(self, session, request_id):
        with self.state.lock:
            self.get_request(session, request_id)
            request = session["requests"][request_id]
            if request["status"] == "cancelled":
                return self.public_request(session, request)
            require(request["status"] in PRE_APPLY, "already_dispatched", "Cancellation is only available before Apply; reconcile the outcome of dispatched work.", 409)
            self._drop_proposal(request)
            self._change(request, "cancelled")
            return self.public_request(session, request)

    def operator_status(self):
        with self.state.lock:
            self.state.expire()
            self.refresh()
            return envelope(sessions=[{"sessionId": session["sessionId"], "clientName": session["clientName"],
                                       "runtimeSessionId": session["runtimeSessionId"], "status": session["status"],
                                       "requests": [self.public_request(session, value) for value in session["requests"].values()]}
                                      for session in self.sessions.values()])

    def operator_session(self, session_id):
        identifier(session_id, "sessionId")
        session = self.sessions.get(session_id)
        require(session is not None, "session_not_found", "Paired session not found.", 404)
        return session

    def revoke(self, session_id):
        with self.state.lock:
            session = self.operator_session(session_id)
            self._end_session(session, "revoked")
            # A stale session can still read its prior outcomes until revoked.
            session["status"] = "revoked"
            return envelope(sessionId=session_id, status="revoked")

    def apply(self, session_id, request_id):
        with self.state.lock:
            session = self.operator_session(session_id)
            self.get_request(session, request_id)
            request = session["requests"][request_id]
            if request["commandIds"] or request["status"] == "succeeded":
                return self.public_request(session, request)
            self._current(session)
            require(request["status"] == "ready", "not_reviewable", "Request is not awaiting Apply.", 409)
            try:
                applied = self.state.apply_plan(request["proposal"]["planId"])
            except Exception as error:
                known_rejection = hasattr(error, "status")
                self._change(request, "stale" if known_rejection else "unconfirmed",
                             error=str(error) if known_rejection else "Apply was not confirmed. Inspect the Operator before retrying.")
                raise
            ids = [item["requestId"] for item in applied.get("commands", [])]
            if ids:
                self._change(request, "queued", commandIds=ids)
            else:
                # Existing save_scene is a synchronous PC operation, explicitly
                # distinguished from a Unity execution receipt.
                self._change(request, "succeeded", observed={"revision": self.state.revision, "savedScene": applied.get("name")})
            return self.public_request(session, request)

    def runtime_expired(self):
        """Called by the existing lease expiry path, before a replacement runtime."""
        for session in self.sessions.values():
            self._end_session(session, "stale")
            for request in session["requests"].values():
                if request["status"] in {"queued", "running"}:
                    self._change(request, "unconfirmed", error="Runtime lease expired after dispatch; the effect is unknown. Do not automatically retry.")

    def commands_unconfirmed(self, command_ids, reason):
        """Existing runtime recovery may retire pending work without a receipt."""
        retired = set(command_ids)
        for session in self.sessions.values():
            for request in session["requests"].values():
                if request["status"] in {"queued", "running"} and retired.intersection(request["commandIds"]):
                    self._change(request, "unconfirmed", error=reason)

    def observe(self, results):
        """Correlate existing acknowledgements; never dispatch a second queue."""
        for session in self.sessions.values():
            if session["runtimeSessionId"] != self.runtime_id():
                continue
            for request in session["requests"].values():
                if request["status"] not in IN_FLIGHT:
                    continue
                prior = {receipt["requestId"]: receipt for receipt in request["receipts"]}
                for receipt in results:
                    if receipt["requestId"] in request["commandIds"] and receipt["requestId"] not in prior:
                        prior[receipt["requestId"]] = copy.deepcopy(receipt)
                        if self.state.latest is None:
                            request["observationUnavailable"] = True
                receipts = [prior[key] for key in request["commandIds"] if key in prior]
                if len(receipts) == len(request["commandIds"]):
                    if self.state.latest is None or request.get("observationUnavailable"):
                        # Do not attach a later room snapshot to an earlier
                        # acknowledgement and imply they were observed together.
                        request["observationUnavailable"] = True
                        self._change(request, "unconfirmed", receipts=receipts, observed=None,
                                     error="Acknowledgements received; the room observation was unavailable. Inspect the current scene before making a new request.")
                        continue
                    successes = sum(receipt["ok"] for receipt in receipts)
                    status = "succeeded" if successes == len(receipts) else "partial" if successes else "failed"
                    self._change(request, status, receipts=receipts,
                                 observed={"revision": self.state.revision, "snapshot": copy.deepcopy(self.state.latest)})
                elif any(key in self.state.pending for key in request["commandIds"]):
                    self._change(request, "running", receipts=receipts)
                elif receipts != request["receipts"]:
                    # Room recovery can retire the remainder of a batch in the
                    # very exchange that acknowledges its first commands.
                    self._change(request, request["status"], receipts=receipts)
