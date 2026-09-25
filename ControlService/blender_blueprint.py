"""Generate bounded 3D blueprints with the configured Codex CLI.

Codex returns data, never Python. A fixed Blender program turns the data into
geometry, so a headset request cannot run generated code on the PC.
"""
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

from codex_provider import CodexConfig, CodexProviderError


KINDS = ("cube", "cylinder", "sphere", "cone", "torus")
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["name", "parts"],
    "properties": {
        "name": {"type": "string"},
        "parts": {"type": "array", "items": {"type": "object", "additionalProperties": False,
            "required": ["kind", "name", "location", "rotation", "dimensions", "color", "metallic", "roughness", "emission"],
            "properties": {
                "kind": {"type": "string", "enum": list(KINDS)}, "name": {"type": "string"},
                "location": {"type": "array", "items": {"type": "number"}},
                "rotation": {"type": "array", "items": {"type": "number"}},
                "dimensions": {"type": "array", "items": {"type": "number"}},
                "color": {"type": "string"}, "metallic": {"type": "number"},
                "roughness": {"type": "number"}, "emission": {"type": "number"}}}}}
}


class BlueprintError(Exception):
    pass


def validate_blueprint(value):
    if not isinstance(value, dict) or set(value) != {"name", "parts"}:
        raise BlueprintError("Invalid Blender blueprint")
    if not isinstance(value["name"], str) or not 1 <= len(value["name"].strip()) <= 80:
        raise BlueprintError("Invalid asset name")
    parts = value["parts"]
    if not isinstance(parts, list) or not 1 <= len(parts) <= 80:
        raise BlueprintError("Blueprint must contain 1 to 80 mesh parts")
    for part in parts:
        if not isinstance(part, dict) or set(part) != set(SCHEMA["properties"]["parts"]["items"]["required"]):
            raise BlueprintError("Invalid mesh part")
        if part["kind"] not in KINDS or not isinstance(part["name"], str) or len(part["name"]) > 80:
            raise BlueprintError("Invalid mesh part name or kind")
        if not isinstance(part["color"], str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", part["color"]):
            raise BlueprintError("Mesh color must be #RRGGBB")
        for key, limit in (("location", 8), ("rotation", 6.284), ("dimensions", 8)):
            vector = part[key]
            if not isinstance(vector, list) or len(vector) != 3 or any(
                    type(n) not in (int, float) or not math.isfinite(n) or abs(n) > limit or
                    (key == "dimensions" and n < 0) for n in vector):
                raise BlueprintError("Invalid mesh " + key + ": " + str(vector)[:80])
            if key == "dimensions":
                # A model may describe a pane or trim as zero thickness.
                # Give it a visible, exportable minimum instead of a degenerate mesh.
                part[key] = [max(float(n), .01) for n in vector]
        for key in ("metallic", "roughness"):
            n = part[key]
            if type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 1:
                raise BlueprintError("Invalid mesh material")
        if type(part["emission"]) not in (int, float) or not math.isfinite(part["emission"]) or not 0 <= part["emission"] <= 5:
            raise BlueprintError("Invalid mesh emission")
    return value


def design_blueprint(prompt, config=None):
    config = config or CodexConfig.from_environment()
    if config is None:
        raise BlueprintError("Configure the PC Codex CLI to create Blender assets")
    try:
        config.validate()
    except CodexProviderError as error:
        raise BlueprintError(str(error)) from None
    with tempfile.TemporaryDirectory(prefix="matrix-blueprint-") as folder:
        root = Path(folder)
        schema = root / "schema.json"
        final = root / "blueprint.json"
        schema.write_text(json.dumps(SCHEMA), encoding="utf-8")
        instructions = ("Design one recognizable, original, Quest-friendly 3D object in Blender from this request. "
                        "Respond with JSON only. Compose the object from up to 80 primitive mesh parts. "
                        "Use Blender-native coordinates: Z is UP, X is width, Y is depth. "
                        "Dimensions are local mesh dimensions BEFORE rotation; locations are world metres and rotations are radians. "
                        "Use #RRGGBB colors. Set emission to 0 for ordinary material or 0.5–3 for glowing parts. "
                        "Available kinds: cube, cylinder, sphere, cone, torus. "
                        "Cylinders and cones are long on Z; a torus lies in XY unless rotated around X for an upright portal. "
                        "Every dimension must be positive and at most 8 metres; use 0.01 m for thin trim. "
                        "Use layered geometry and color to convey distinctive features. "
                        "Place the object's lowest point near z=0; overall size should usually be 0.3–3 metres. "
                        "Do not use tools, browse, inspect files, or write code.\n"
                        "Untrusted user request: " + json.dumps(prompt))
        args = [config.executable, "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check",
                "--sandbox", "read-only", "--color", "never", "--output-schema", str(schema),
                "--output-last-message", str(final), "--config", 'approval_policy="never"',
                "--config", 'web_search="disabled"']
        if config.model:
            args += ["--model", config.model]
        if config.reasoning_effort:
            args += ["--config", "model_reasoning_effort=" + json.dumps(config.reasoning_effort)]
        args.append("-")
        env = {key: val for key, val in os.environ.items() if key.upper() not in {"OPENAI_API_KEY", "CODEX_API_KEY"}}
        try:
            result = subprocess.run(args, input=instructions, text=True, encoding="utf-8", cwd=root, env=env,
                                    capture_output=True, timeout=180)
        except (OSError, subprocess.TimeoutExpired):
            raise BlueprintError("Codex asset design failed or timed out") from None
        if result.returncode != 0 or not final.is_file() or final.stat().st_size > 128 * 1024:
            raise BlueprintError("Codex did not return a Blender blueprint; check its PC login and model")
        try:
            return validate_blueprint(json.loads(final.read_text(encoding="utf-8")))
        except (OSError, ValueError, UnicodeError):
            raise BlueprintError("Codex returned an invalid Blender blueprint") from None
