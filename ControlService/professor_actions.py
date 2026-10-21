"""Bounded School requests over existing concept/panorama jobs; no authoring language."""
import copy
import hashlib
import json
import re

from concept_store import checked_id, checked_text, SESSION_ID, NATIVE_PROVIDER
from content_catalog import ContentError

UUID = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
FIELDS = {"sessionId", "schoolSessionId", "requestId", "requestVersion", "lessonRevision",
          "kind", "prompt", "objectiveId", "learningIntent", "interaction"}


def require(ok, message, status=400):
    if not ok:
        raise ContentError(status, message)


def checked_request(value):
    require(type(value) is dict and set(value) == FIELDS, "Invalid Professor request fields")
    result = copy.deepcopy(value)
    for field, pattern in (("sessionId", SESSION_ID), ("schoolSessionId", UUID), ("requestId", UUID)):
        checked_id(value[field], field, pattern)
    for field in ("requestVersion", "lessonRevision"):
        require(type(value[field]) is int and 1 <= value[field] <= 9007199254740991, "Invalid " + field)
    require(value["kind"] in ("artifact", "location", "lab"), "Unknown Professor request kind")
    for field, limit in (("prompt", 3600), ("objectiveId", 40), ("learningIntent", 1200)):
        result[field] = checked_text(value[field], field, limit)
    interaction = value["interaction"]
    require(type(interaction) is dict and set(interaction) == {"requirement", "description", "capabilities"}, "Invalid interaction")
    require(interaction["requirement"] in ("none", "required", "unspecified") and
            type(interaction["capabilities"]) is list and len(interaction["capabilities"]) <= 5 and
            all(type(item) is str and item in ("move", "rotate", "select", "measure", "simulate")
                for item in interaction["capabilities"]) and
            len(set(interaction["capabilities"])) == len(interaction["capabilities"]), "Invalid interaction capabilities")
    checked_text(interaction["description"], "interaction description", 1200)
    return result


def action_key(value):
    # A lesson turn may advance without changing this saved exhibit version.
    identity = {key: value[key] for key in ("schoolSessionId", "requestId", "requestVersion")}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def submit(state, value):
    value = checked_request(value)
    if not state.agent_turn_submission_lock.acquire(blocking=False):
        raise ContentError(409, "An Operator request is starting; retry status shortly")
    try:
        with state.concepts.lock:
            for session_id, entry in state.concepts.data['sessions'].items():
                previous = next((job for job in entry['jobs'] if job.get('externalKey') == action_key(value)), None)
                if previous:
                    require(session_id == value['sessionId'], 'This School request belongs to another Operator session; resume it instead of duplicating generation', 409)
                    original = previous.get('externalRequest') or {}
                    require(all(original.get(key) == value[key] for key in FIELDS - {'lessonRevision'}),
                            'The saved School request changed without a new prompt version', 409)
        state.agent_portal_status(value["sessionId"])
        purpose = "concept" if value["kind"] == "artifact" else "panorama"
        state.concepts.create(value["sessionId"], value["prompt"], provider_id=NATIVE_PROVIDER,
                              purpose=purpose, external_key=action_key(value), external_request=value)
        return status(state, value["sessionId"], action_key(value))
    finally:
        state.agent_turn_submission_lock.release()


def status(state, session_id, key):
    checked_id(session_id, "Agent session ID", SESSION_ID)
    checked_id(key, "Professor action ID", SHA)
    state.agent_portal_status(session_id)
    snapshot = state.concepts.status(session_id)
    jobs = snapshot["jobs"] + snapshot.get("panoramaJobs", [])
    job = next((item for item in jobs if item.get("externalKey") == key), None)
    require(job is not None and type(job.get("externalRequest")) is dict, "Professor action not found", 404)
    source = job["externalRequest"]
    result = {"adapterId": "matrix-operator-v1", "actionId": key, "sessionId": session_id,
              "schoolSessionId": source["schoolSessionId"], "requestId": source["requestId"],
              "requestVersion": source["requestVersion"], "lessonRevision": source["lessonRevision"],
              "kind": source["kind"], "prompt": source["prompt"], "status": job["status"],
              "message": job.get("message", "")[:300], "conceptId": job["conceptId"],
              "conceptVersion": job["version"], "purpose": job.get("purpose", "concept"),
              "selected": job["conceptId"] == snapshot.get("selectedConceptId" if source["kind"] == "artifact" else "selectedPanoramaId"),
              "image": None, "build": None, "environment": None}
    if job["status"] != "ready":
        return result
    # Checksums/preview identities come from the existing validated concept store.
    result["status"] = "image_ready"
    result["image"] = {"sha256": job["imageSha256"], "previewUrl": job["previewUrl"]}
    builds = [item for item in snapshot.get("builds", []) if item["conceptId"] == job["conceptId"]]
    if builds:
        build = builds[-1]
        result["build"] = {key: copy.deepcopy(build[key]) for key in
                           ("buildRequestId", "status", "creationMode", "assetIds", "objectIds", "receipts") if key in build}
        with state.lock:
            current = state.latest or {}
            scene = current.get("scene", {})
            observed = {item["objectId"] for item in scene.get("objects", [])}
            if (build["status"] == "completed" and state.online() and
                    build.get("conceptVersion") == job["version"] and
                    build.get("runtimeGeneration") == state.runtime_generation and
                    build.get("roomId") == scene.get("roomId") and
                    build.get("objectIds") and set(build["objectIds"]) <= observed and build.get("receipts")):
                result["status"] = "object_loaded"
                result["build"].update(runtimeId=state.client_id, roomId=scene["roomId"])
    if source["kind"] != "artifact":
        registered = job.get("registeredPanorama")
        if registered:
            with state.lock:
                candidates = [(request_id, issued) for request_id, issued in state.agent_environment_ids.items()
                              if (issued.get("environment") or {}).get("assetId") == registered["assetId"]]
            for request_id, _ in reversed(candidates):
                applied = state.agent_environment_status(request_id)
                if applied["status"] == "succeeded":
                    result["status"] = "setting_applied"
                    result["environment"] = {"requestId": request_id, "roomId": applied["roomId"],
                                             "assetId": registered["assetId"], "sha256": registered["sha256"]}
                    break
    return result
