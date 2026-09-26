"""Data-only procedural recipe and live generator metadata validation.

The browser owns the reviewed generator implementation. This PC boundary pins
the advertised version and bounded parameter schema without executing scene
data. Interactable procedural sources also need a reviewed PC bounds contract.
"""
from __future__ import annotations

import math
import re


class ProceduralError(ValueError):
    pass


GENERATOR_ID = re.compile(r"[a-z][a-z0-9-]{0,47}\Z")
PARAMETER_NAME = re.compile(r"[a-z][a-zA-Z0-9]{0,47}\Z")
VERSION = re.compile(r"[1-9][0-9]*\.[0-9]+\.[0-9]+\Z")
RECIPE_KEYS = {"schemaVersion", "generatorId", "generatorVersion",
               "sourceRevision", "parameters", "seed", "dependencies"}
METADATA_KEYS = {"generatorId", "generatorVersion", "sourceRevision",
                 "description", "parameterSchema", "dependencies"}

CURVED_BENCH_PARAMETERS = {
    "lengthMeters": {"type": "number", "default": 1.8, "min": .8, "max": 3},
    "depthMeters": {"type": "number", "default": .5, "min": .3, "max": .8},
    "seatHeightMeters": {"type": "number", "default": .46, "min": .35, "max": .7},
    "backHeightMeters": {"type": "number", "default": .45, "min": .25, "max": .8},
    "arcDegrees": {"type": "number", "default": 75, "min": 30, "max": 120},
}


def _fail(message):
    raise ProceduralError(message)


def _identifier(value, pattern):
    return type(value) is str and pattern.fullmatch(value) is not None


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def checked_recipe(value):
    """Check the bounded, exact JSON recipe shape independently of availability."""
    if (type(value) is not dict or set(value) != RECIPE_KEYS or
            type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1):
        _fail("Invalid procedural recipe")
    if not _identifier(value["generatorId"], GENERATOR_ID) or not _identifier(
            value["generatorVersion"], VERSION) or not _identifier(
            value["sourceRevision"], GENERATOR_ID):
        _fail("Invalid procedural generator identity")
    if type(value["seed"]) is not int or not 0 <= value["seed"] <= 0xffffffff:
        _fail("Invalid procedural seed")
    if value["dependencies"] != []:
        _fail("Unsupported procedural dependency references")
    parameters = value["parameters"]
    if type(parameters) is not dict or len(parameters) > 24:
        _fail("Invalid procedural parameters")
    for key, item in parameters.items():
        if not _identifier(key, PARAMETER_NAME) or not (type(item) is bool or _number(item)):
            _fail("Invalid procedural parameter")
    return value


def checked_generators(value):
    """Validate an advertised source-code registry before exposing it to tools."""
    if type(value) is not list or len(value) > 32:
        _fail("Invalid procedural generator catalog")
    identifiers = set()
    for entry in value:
        if type(entry) is not dict or set(entry) != METADATA_KEYS:
            _fail("Invalid procedural generator metadata")
        identifier = entry["generatorId"]
        if not _identifier(identifier, GENERATOR_ID) or identifier in identifiers or not _identifier(
                entry["generatorVersion"], VERSION) or not _identifier(
                entry["sourceRevision"], GENERATOR_ID):
            _fail("Invalid procedural generator identity")
        identifiers.add(identifier)
        if type(entry["description"]) is not str or not 1 <= len(entry["description"]) <= 240:
            _fail("Invalid procedural generator description")
        if entry["dependencies"] != []:
            _fail("Unsupported procedural generator dependencies")
        schema = entry["parameterSchema"]
        if type(schema) is not dict or len(schema) > 24:
            _fail("Invalid procedural parameter schema")
        for name, field in schema.items():
            if not _identifier(name, PARAMETER_NAME) or type(field) is not dict:
                _fail("Invalid procedural parameter field")
            kind = field.get("type")
            if kind == "number":
                if set(field) != {"type", "default", "min", "max"} or not all(
                        _number(field.get(key)) for key in ("default", "min", "max")) or not (
                        field["min"] < field["max"] and
                        field["min"] <= field["default"] <= field["max"]):
                    _fail("Invalid procedural numeric parameter")
            elif kind == "boolean":
                if set(field) != {"type", "default"} or type(field["default"]) is not bool:
                    _fail("Invalid procedural boolean parameter")
            else:
                _fail("Unsupported procedural parameter type")
    return value


def available_recipe(value, catalog):
    """Check a pinned recipe against the connected browser's reviewed code."""
    checked_recipe(value)
    checked_generators(catalog)
    entry = next((item for item in catalog
                  if item["generatorId"] == value["generatorId"]), None)
    if entry is None or entry["generatorVersion"] != value["generatorVersion"] or (
            entry["sourceRevision"] != value["sourceRevision"] or
            entry["dependencies"] != value["dependencies"]):
        _fail("Saved procedural generator version or dependency unavailable")
    schema = entry["parameterSchema"]
    if set(value["parameters"]) != set(schema):
        _fail("Procedural parameters do not match the pinned generator")
    for key, field in schema.items():
        item = value["parameters"][key]
        if field["type"] == "number":
            if not _number(item) or not field["min"] <= item <= field["max"]:
                _fail(f"Invalid procedural parameter: {key}")
        elif type(item) is not bool:
            _fail(f"Invalid procedural parameter: {key}")
    return value


def interaction_bounds(value, catalog):
    """Return the measured curved-bench-v1 box; other sources need review."""
    available_recipe(value, catalog)
    if (value["generatorId"], value["generatorVersion"],
            value["sourceRevision"]) != ("curved-bench", "1.0.0", "curved-bench-v1"):
        _fail("Procedural interaction source has no reviewed PC bounds contract")
    entry = next(item for item in catalog if item["generatorId"] == "curved-bench")
    if entry["parameterSchema"] != CURVED_BENCH_PARAMETERS:
        _fail("Curved bench generator parameters differ from reviewed PC bounds")
    p = value["parameters"]
    half_angle = math.radians(p["arcDegrees"]) / 2
    radius = p["lengthMeters"] / (2 * math.sin(half_angle))
    depth = p["depthMeters"]
    half_x = (radius + depth / 2 + .015) * math.sin(half_angle)
    z_min = -(depth / 2) * math.cos(half_angle)
    z_max = radius * (1 - math.cos(half_angle)) + depth / 2 + .015
    return {"center": {"x": 0, "y": (p["seatHeightMeters"] + p["backHeightMeters"]) / 2,
                       "z": (z_min + z_max) / 2},
            "size": {"x": 2 * half_x, "y": p["seatHeightMeters"] + p["backHeightMeters"],
                     "z": z_max - z_min}}


def new_recipe(catalog, generator_id, parameters=None):
    checked_generators(catalog)
    if not _identifier(generator_id, GENERATOR_ID):
        _fail("Invalid procedural generator ID")
    entry = next((item for item in catalog if item["generatorId"] == generator_id), None)
    if entry is None:
        _fail("Procedural generator unavailable in the connected runtime")
    provided = {} if parameters is None else parameters
    if type(provided) is not dict or not set(provided) <= set(entry["parameterSchema"]):
        _fail("Invalid procedural parameter patch")
    normalized = {key: provided.get(key, field["default"])
                  for key, field in entry["parameterSchema"].items()}
    recipe = {"schemaVersion": 1, "generatorId": generator_id,
              "generatorVersion": entry["generatorVersion"],
              "sourceRevision": entry["sourceRevision"],
              "parameters": normalized, "seed": 0, "dependencies": []}
    return available_recipe(recipe, catalog)


def revised_recipe(catalog, current, patch):
    available_recipe(current, catalog)
    if type(patch) is not dict or not patch:
        _fail("Invalid procedural parameter patch")
    recipe = {**current, "parameters": {**current["parameters"], **patch}}
    return available_recipe(recipe, catalog)
