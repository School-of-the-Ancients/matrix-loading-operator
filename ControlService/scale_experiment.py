"""Bounded static block-scale recipe; existing Matrix commands remain the executor."""
from __future__ import annotations

import copy
import math
import re

from ai_adapter import PlannerError, validate_commands
import block_scale_math

CAPABILITY = "experiment.block-scale.v1"
AXES = ("x", "y", "z")
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,95}\Z")


def require(condition, message, status=422):
    if not condition:
        raise PlannerError(message, status)


def descriptor():
    return {"version": 1, "kind": "block-scale", "assetId": "block",
            "supportedRoomModes": ["white-room"], "factorBounds": {"minimum": .25, "maximum": 4},
            "resultScaleBounds": {"minimum": .01, "maximum": 20},
            "units": "dimensionless factors relative to a captured baseline",
            "result": "mathematical volume ratio from acknowledged transform scale; not physical volume or physics",
            "actions": ["configure", "reset"], "requiresOperatorApply": True,
            "stop": "cancel-before-apply only; static changes have no running simulation to stop",
            "identityGuarantee": "runtime builtin asset ID only; no immutable build digest is available"}


def validate_intent(value):
    require(isinstance(value, dict), "Expected a block-scale intent")
    common = {"kind", "version", "action", "objectId"}
    action = value.get("action")
    allowed = common | ({"factors", "baselineRequestId"} if action == "configure" else {"baselineRequestId"})
    required = common | ({"factors"} if action == "configure" else {"baselineRequestId"})
    require(required <= set(value) <= allowed and value.get("kind") == "block-scale" and type(value.get("version")) is int and value["version"] == 1
            and isinstance(action, str) and action in {"configure", "reset"}, "Unsupported block-scale intent fields or version")
    require(isinstance(value.get("objectId"), str) and ID.fullmatch(value["objectId"]), "Use an existing objectId")
    if "baselineRequestId" in value:
        require(isinstance(value["baselineRequestId"], str) and ID.fullmatch(value["baselineRequestId"]), "Invalid baselineRequestId")
    if action == "configure":
        factors = value.get("factors")
        require(isinstance(factors, dict) and set(factors) == set(AXES) and all(type(factors[a]) in (int, float) and .25 <= factors[a] <= 4 and math.isfinite(factors[a]) for a in AXES),
                "Each X/Y/Z factor must be finite and between 0.25 and 4")
    return copy.deepcopy(value)


def same_transform(left, right):
    try:
        return all(type(left[part][axis]) in (int, float) and math.isfinite(left[part][axis])
                   and abs(left[part][axis] - right[part][axis]) <= 1e-5
                   for part in ("position", "rotation", "scale") for axis in AXES)
    except (KeyError, TypeError):
        return False


def object_in(snapshot, object_id):
    values = [item for item in snapshot.get("scene", {}).get("objects", []) if item.get("objectId") == object_id]
    require(len(values) == 1, "The experiment object is absent or ambiguous; select a current block", 409)
    return values[0]


def plan(intent, snapshot, previous=None):
    intent = validate_intent(intent)
    require(snapshot.get("roomContext", {}).get("mode", "white-room") == "white-room", "Block-scale version 1 supports virtual rooms only", 409)
    require(not snapshot.get("readOnly"), "The current room is read-only", 409)
    item = object_in(snapshot, intent["objectId"])
    require(item.get("assetId") == "block", "This experiment requires the installed built-in block", 409)
    assets = [a for a in snapshot.get("assets", []) if a.get("assetId") == "block"]
    require(len(assets) == 1 and not assets[0].get("source"), "The built-in block identity is unavailable or replaced by imported content", 409)
    anchors = [a for a in snapshot.get("anchors", []) if a.get("anchorId") == item.get("anchorId")]
    require(len(anchors) == 1 and anchors[0].get("source") != "mruk", "Block-scale version 1 requires a virtual anchor", 409)
    require(not any(b.get("enabled", True) for b in item.get("behaviors", [])), "Stop the block's behaviors before configuring this static experiment", 409)
    # Validation remains shared with ordinary reviewed transform edits.
    validate_commands([{"op": "set_transform", "objectId": item["objectId"], "transform": item["transform"]}], snapshot)
    if "baselineRequestId" in intent:
        require(previous is not None and previous.get("capability") == CAPABILITY, "The referenced confirmed baseline is unavailable", 409)
        baseline = copy.deepcopy(previous["baseline"])
        expected = previous["expectedTransform"]
        require(baseline["roomId"] == snapshot["scene"]["roomId"] and baseline["objectId"] == item["objectId"] and baseline["anchorId"] == item["anchorId"]
                and same_transform(item["transform"], expected), "The block changed after the referenced result; capture a new baseline or reconcile it first", 409)
    else:
        baseline = {"roomId": snapshot["scene"]["roomId"], "objectId": item["objectId"], "assetId": "block", "anchorId": item["anchorId"], "transform": copy.deepcopy(item["transform"])}
    factors = intent.get("factors", {axis: 1 for axis in AXES})
    transform = copy.deepcopy(baseline["transform"])
    for axis in AXES:
        transform["scale"][axis] *= factors[axis]
    command = {"op": "set_transform", "objectId": item["objectId"], "transform": transform}
    checked = validate_commands([command], snapshot)
    experiment = {"capability": CAPABILITY, "version": 1, "action": intent["action"], "baseline": baseline,
                  "factors": copy.deepcopy(factors), "expectedTransform": transform,
                  "interpretation": "Static mathematical illustration; transform ratios are not measured physical volume or validated physics."}
    return {"commands": checked, "summary": ("Reset the block to its captured baseline." if intent["action"] == "reset" else "Set block scale factors from the captured baseline: " + ", ".join(f"{a.upper()}={factors[a]}" for a in AXES) + "."),
            "assumptions": ["Virtual-room static illustration. Human Apply is required. No physical-volume or physics claim."],
            "mode": "bounded-experiment", "provider": "Built-in deterministic block-scale recipe", "requiresApply": True, "status": "ready", "experiment": experiment}


def observation(request):
    """Only correlate this request's successful receipt with its acknowledging snapshot."""
    if request.get("status") != "succeeded":
        return None
    experiment = request.get("experiment")
    if not experiment:
        return None
    receipts, commands = request.get("receipts", []), request.get("commandIds", [])
    baseline = experiment["baseline"]
    if len(commands) != 1 or len(receipts) != 1 or receipts[0].get("requestId") != commands[0] or receipts[0].get("ok") is not True or receipts[0].get("objectId") != baseline["objectId"]:
        return None
    snapshot = (request.get("observed") or {}).get("snapshot")
    if not isinstance(snapshot, dict) or snapshot.get("scene", {}).get("roomId") != baseline["roomId"]:
        return None
    try:
        item = object_in(snapshot, baseline["objectId"])
    except PlannerError:
        return None
    if item.get("assetId") != "block" or item.get("anchorId") != baseline["anchorId"] or not same_transform(item.get("transform"), experiment["expectedTransform"]):
        return None
    try:
        measured = block_scale_math.geometry(baseline["transform"]["scale"],
                                             item["transform"]["scale"])
    except ValueError:
        return None
    return {"source": "acknowledged-runtime-transform", "revision": request["observed"]["revision"],
            "relativeFactors": measured["relativeFactors"],
            "mathematicalVolumeRatio": measured["mathematicalVolumeRatio"],
            "units": "dimensionless ratio", "physicalMeasurement": False}


def observed_event(request, observed=None, session_id=""):
    """A stable, renderer-neutral event only after exact runtime evidence.

    This is additive to the strict v1 ``experiment.observation`` consumed by
    existing clients. It is historical request evidence, not current scene
    state, lesson progress, or a physical measurement.
    """
    if observed is None:
        observed = observation(request)
    if observed is None:
        return None
    snapshot = request["observed"]["snapshot"]
    experiment = request["experiment"]
    baseline = experiment["baseline"]
    item = object_in(snapshot, baseline["objectId"])
    assets = [asset for asset in snapshot.get("assets", [])
              if asset.get("assetId") == "block" and not asset.get("source")]
    bounds = assets[0].get("localBounds") if len(assets) == 1 else None
    measured = block_scale_math.geometry(baseline["transform"]["scale"],
                                         item["transform"]["scale"], bounds)
    return {"schemaVersion": 1, "type": "experiment.block-scale.observed",
            "eventId": session_id + ":" + request["requestId"] + ":observed",
            "requestId": request["requestId"],
            "roomId": baseline["roomId"], "objectId": baseline["objectId"],
            "assetId": "block", "anchorId": baseline["anchorId"],
            "action": experiment["action"],
            "revision": observed["revision"], "source": observed["source"],
            "relativeFactors": measured["relativeFactors"],
            "mathematicalVolumeRatio": measured["mathematicalVolumeRatio"],
            "baselineLocalDimensionsMeters": measured["baselineLocalDimensionsMeters"],
            "localDimensionsMeters": measured["localDimensionsMeters"],
            "baselineBoundingVolumeCubicMeters": measured["baselineBoundingVolumeCubicMeters"],
            "boundingVolumeCubicMeters": measured["boundingVolumeCubicMeters"],
            "dimensionSource": "catalog-local-bounds" if measured["localDimensionsMeters"] else "unavailable",
            "physicalMeasurement": False}
