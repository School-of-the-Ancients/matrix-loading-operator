"""Pair a standalone client, propose a static block experiment, and inspect its result.

Start Matrix's desktop white room, place/select a built-in block, then run:
  python Examples/block_scale_client.py --url http://127.0.0.1:8765 --reset
Create a one-use code on the Operator /clients page. Every change requires Apply
there. This client never holds the Operator token or applies changes itself.
"""
import argparse
import getpass
import http.client
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

CAPABILITY = "experiment.block-scale.v1"
ACTIVE = {"planning", "ready", "queued", "running"}
STATUSES = ACTIVE | {"succeeded", "failed", "partial", "cancelled", "unconfirmed", "stale", "error", "needs_clarification", "review_only"}
CORRELATION = "block-scale-sample"
MAX_RESPONSE = 1024 * 1024
SAFE_ERRORS = {
    "authentication_required": "The paired client credential is unavailable or expired. Reconcile prior work before pairing again.",
    "invalid_pairing": "The pairing code is invalid, expired, or already used. Create a fresh code in the Operator.",
    "runtime_changed": "The paired runtime changed. Reconcile prior work before pairing again.",
    "runtime_offline": "The Matrix runtime is offline. Connect the desktop white room first.",
    "room_unavailable": "The runtime room is unavailable. Check the Operator before continuing.",
    "stale_scene": "The scene changed. Inspect this request in the Operator before making a new proposal.",
    "invalid_experiment": "The experiment parameters are invalid. Use X/Y/Z factors from 0.25 through 4 and a current built-in block.",
    "baseline_unconfirmed": "The captured baseline is not confirmed in this pairing. Inspect the original request; do not replay it.",
    "request_limit": "The paired request ledger is full. Reconcile its existing requests before starting another session.",
}


class ClientError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ClientError("Matrix redirected the request. Use its direct local origin.")


def reject_nonfinite(_):
    raise ValueError("Non-finite JSON number")


def local_origin(value):
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 for c in value):
        raise argparse.ArgumentTypeError("Use a local HTTP origin without whitespace or control characters")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise argparse.ArgumentTypeError("Invalid local Matrix URL") from error
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or parsed.path not in {"", "/"}
            or (port is not None and port < 1)):
        raise argparse.ArgumentTypeError("Use a local HTTP origin, such as http://127.0.0.1:8765")
    # Resolve no arbitrary hostname and honor no proxy environment variables.
    return "http://127.0.0.1" + (":" + str(port) if port is not None else "")


def factor(value):
    try:
        number = float(value)
    except (ValueError, TypeError, OverflowError) as error:
        raise argparse.ArgumentTypeError("Scale factors must be numbers between 0.25 and 4") from error
    if not math.isfinite(number) or not .25 <= number <= 4:
        raise argparse.ArgumentTypeError("Scale factors must be finite and between 0.25 and 4")
    return number


class Transport:
    def __init__(self, origin):
        self.origin, self.token = local_origin(origin), None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, path, body=None):
        if not isinstance(path, str) or not re.fullmatch(r"/api/v1/(?:discovery|sessions|scene|requests(?:/[A-Za-z0-9][A-Za-z0-9._:-]{0,95})?)", path):
            raise ClientError("Unexpected client endpoint. No request was sent.")
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.origin + path, headers=headers,
                                         data=None if body is None else json.dumps(body, allow_nan=False).encode())
        try:
            with self.opener.open(request, timeout=15) as response:
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE or response.headers.get_content_type() != "application/json":
                    raise ClientError("Matrix returned an unexpected response.")
                value = json.loads(raw, parse_constant=reject_nonfinite)
        except urllib.error.HTTPError as error:
            # Display only locally authored descriptions, never arbitrary server
            # text which could contain credentials, private URLs or room data.
            message = f"Matrix rejected the request (HTTP {error.code}). Review it in the Operator."
            with error:
                try:
                    raw = error.read(8193)
                    value = json.loads(raw) if len(raw) <= 8192 else None
                    code = value.get("code") if isinstance(value, dict) and value.get("protocolVersion") == "1" else None
                    if isinstance(code, str):
                        message = SAFE_ERRORS.get(code, message)
                except (ValueError, OSError, http.client.HTTPException):
                    pass
            raise ClientError(message) from None
        except (OSError, ValueError, http.client.HTTPException):
            raise ClientError("Matrix did not return a valid response. The request outcome may be unknown; inspect its printed ID. No retry was made.") from None
        if not isinstance(value, dict) or value.get("protocolVersion") != "1":
            raise ClientError("Matrix client protocol version 1 is required.")
        return value


def require_scene(scene, paired):
    if (not isinstance(scene, dict) or scene.get("protocolVersion") != "1"
            or scene.get("sessionId") != paired["sessionId"] or scene.get("runtimeSessionId") != paired["runtimeSessionId"]
            or type(scene.get("revision")) is not int or scene["revision"] < 0):
        raise ClientError("The paired runtime changed. Reconcile prior work before pairing again.")
    return scene


def checked_outcome(value, paired, request_id, sequence=0):
    if (not isinstance(value, dict) or value.get("protocolVersion") != "1" or value.get("sessionId") != paired["sessionId"]
            or value.get("runtimeSessionId") != paired["runtimeSessionId"] or value.get("requestId") != request_id
            or value.get("correlationId") != CORRELATION
            or type(value.get("sequence")) is not int or value["sequence"] < max(1, sequence)
            or not isinstance(value.get("status"), str) or value["status"] not in STATUSES):
        raise ClientError("Request identity or sequence changed. Reconcile the printed request ID; do not replay it.")
    return value


def confirmed_ratio(outcome):
    if not isinstance(outcome, dict) or not isinstance(outcome.get("experiment"), dict):
        return None
    experiment = outcome.get("experiment") or {}
    observed = experiment.get("observation")
    if not isinstance(observed, dict):
        return None
    ratio = observed.get("mathematicalVolumeRatio")
    if (outcome.get("status") != "succeeded" or experiment.get("capability") != CAPABILITY
            or experiment.get("observationState") != "confirmed"
            or observed.get("source") != "acknowledged-runtime-transform"
            or observed.get("physicalMeasurement") is not False
            or type(ratio) not in (int, float) or not 0 < ratio <= 65 or not math.isfinite(ratio)):
        return None
    return ratio


def submit_and_observe(request, paired, scene, intent, *, emit=print, sleep=time.sleep, clock=time.monotonic, wait_seconds=180):
    request_id = uuid.uuid4().hex
    # Printed before POST so a lost response can be reconciled without a retry.
    emit("Request ID: " + request_id)
    value = request("/api/v1/requests", {"requestId": request_id, "correlationId": CORRELATION,
                    "expected": {"runtimeSessionId": scene["runtimeSessionId"], "revision": scene["revision"]}, "intent": intent})
    outcome = checked_outcome(value, paired, request_id)
    emit("Proposed commands: " + json.dumps((outcome.get("proposal") or {}).get("commands", []), indent=2))
    emit("Review and Apply in the Operator /clients page. Ctrl+C stops polling, not dispatched work.")
    deadline = clock() + wait_seconds
    while outcome["status"] in ACTIVE and clock() < deadline:
        sleep(1)
        updated = checked_outcome(request("/api/v1/requests/" + request_id), paired, request_id, outcome["sequence"])
        if updated["sequence"] == outcome["sequence"] and updated != outcome:
            raise ClientError("Matrix changed an outcome without advancing its sequence. Inspect the request ID; do not replay it.")
        outcome = updated
    ratio = confirmed_ratio(outcome)
    if ratio is None:
        emit("No confirmed experiment observation. Status: " + outcome["status"] + ". Inspect this request in the Operator; do not replay it.")
    else:
        emit(f"Confirmed mathematical volume ratio: {ratio:g}x the captured baseline. This is transform math, not measured physical volume.")
    return outcome


def run(request, factors, object_id=None, reset=False, *, pairing_code=None, emit=print, **poll_options):
    discovery = request("/api/v1/discovery")
    capabilities = discovery.get("capabilities")
    descriptor = capabilities.get(CAPABILITY) if isinstance(capabilities, dict) else None
    if (discovery.get("protocolVersion") != "1" or discovery.get("pairingAvailable") is not True
            or not isinstance(descriptor, dict) or type(descriptor.get("version")) is not int or descriptor["version"] != 1):
        raise ClientError("This Matrix service does not offer the block-scale experiment. Use its matching API build.")
    code = pairing_code() if pairing_code else getpass.getpass("One-use pairing code from the Operator: ")
    paired = request("/api/v1/sessions", {"pairingCode": code})
    if (paired.get("protocolVersion") != "1"
            or not all(isinstance(paired.get(key), str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,95}", paired[key]) for key in ("sessionId", "runtimeSessionId"))
            or not isinstance(paired.get("clientToken"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", paired["clientToken"])):
        raise ClientError("Matrix returned an incomplete pairing.")
    request.token = paired["clientToken"]
    scene = require_scene(request("/api/v1/scene"), paired)
    snapshot = scene.get("snapshot") or {}
    object_id = object_id or snapshot.get("selection", {}).get("objectId")
    objects = [item for item in snapshot.get("scene", {}).get("objects", []) if item.get("objectId") == object_id]
    if len(objects) != 1 or objects[0].get("assetId") != "block":
        raise ClientError("Select an existing built-in block in Matrix, or supply its --object-id.")
    if snapshot.get("roomContext", {}).get("mode", "white-room") != "white-room":
        raise ClientError("Version 1 supports the desktop white room. Quest AR support is pending.")
    outcome = submit_and_observe(request, paired, scene, {"kind": "block-scale", "version": 1, "action": "configure",
                                "objectId": object_id, "factors": dict(zip(("x", "y", "z"), factors))}, emit=emit, **poll_options)
    if reset and confirmed_ratio(outcome) is not None:
        scene = require_scene(request("/api/v1/scene"), paired)
        emit("Preparing a separate reset proposal. It also requires Operator Apply.")
        outcome = submit_and_observe(request, paired, scene, {"kind": "block-scale", "version": 1, "action": "reset",
                                    "objectId": object_id, "baselineRequestId": outcome["requestId"]}, emit=emit, **poll_options)
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", type=local_origin, default="http://127.0.0.1:8765")
    parser.add_argument("--factors", nargs=3, type=factor, default=[2, 2, 2], metavar=("X", "Y", "Z"))
    parser.add_argument("--object-id", help="Existing block ID; defaults to the selected object")
    parser.add_argument("--reset", action="store_true", help="After confirmation, propose a separately reviewed reset")
    args = parser.parse_args()
    return 0 if confirmed_ratio(run(Transport(args.url), args.factors, args.object_id, args.reset)) is not None else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ClientError as error:
        print(str(error))
        print("Inspect any printed request ID in the Operator before trying again. No automatic retry was made.")
        raise SystemExit(1)
    except (OSError, ValueError, KeyError, TypeError):
        print("Matrix could not confirm this experiment. Inspect the printed request ID in the Operator. No automatic retry was made.")
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("Polling stopped. This does not cancel a request. Inspect its ID in the Operator before making another change.")
        raise SystemExit(130)
