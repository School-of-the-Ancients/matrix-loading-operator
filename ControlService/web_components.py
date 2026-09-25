"""Validated WebXR component schema 1. Components contain data, never code."""
from __future__ import annotations

import json
import math
import re


CHANNELS = {f"{group}.{axis}" for group in ("position", "rotation", "scale")
            for axis in ("x", "y", "z")}
COMPONENT_ID = re.compile(r"webcomp:[a-z0-9][a-z0-9-]{0,39}:[0-9a-f]{12}\Z")


class ComponentError(ValueError):
    pass


def _exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def _expression(value, depth, budget):
    budget[0] += 1
    if budget[0] > 64 or depth > 8 or type(value) is not dict:
        raise ComponentError("Component expression budget exceeded")
    op = value.get("op")
    if op == "const" and _exact(value, ("op", "value")):
        number = value["value"]
        if type(number) in (int, float) and math.isfinite(number) and -1000 <= number <= 1000:
            return
    if op == "time" and _exact(value, ("op",)):
        return
    if op in ("self", "target") and _exact(value, ("op", "path")) and \
            type(value["path"]) is str and value["path"] in CHANNELS:
        return
    if op in ("sin", "cos") and _exact(value, ("op", "arg")):
        _expression(value["arg"], depth + 1, budget)
        return
    if op in ("add", "mul") and _exact(value, ("op", "args")) and \
            type(value["args"]) is list and 2 <= len(value["args"]) <= 4:
        for arg in value["args"]:
            _expression(arg, depth + 1, budget)
        return
    raise ComponentError("Invalid component expression")


def validate_package(value):
    if not _exact(value, ("schemaVersion", "name", "outputs")) or \
            type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or \
            type(value["name"]) is not str or not 1 <= len(value["name"]) <= 64 or \
            any(not (char.isalnum() or char in " ._'-") for char in value["name"]) or \
            type(value["outputs"]) is not dict or not 1 <= len(value["outputs"]) <= 9:
        raise ComponentError("Invalid component package")
    budget = [0]
    for channel, expression in value["outputs"].items():
        if channel not in CHANNELS:
            raise ComponentError("Invalid component output channel")
        _expression(expression, 1, budget)
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")) > 4096:
        raise ComponentError("Component package exceeds 4 KiB")
    return value


def validate_attachment(value):
    required = {"componentId", "package", "targetObjectId", "startedAtMs", "status"}
    if type(value) is not dict or not required <= set(value) or set(value) - required - {"error"} or \
            type(value["componentId"]) is not str or not COMPONENT_ID.fullmatch(value["componentId"]) or \
            type(value["targetObjectId"]) is not str or len(value["targetObjectId"]) > 128 or \
            type(value["startedAtMs"]) is not int or not 0 <= value["startedAtMs"] <= 9007199254740991 or \
            value["status"] not in ("running", "stopped", "failed") or \
            ("error" in value and (value["status"] != "failed" or type(value["error"]) is not str or
                                   len(value["error"]) > 120)):
        raise ComponentError("Invalid component attachment")
    validate_package(value["package"])
    return value
