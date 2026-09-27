"""One reviewed Blender blueprint for the first Citizen generated-asset use."""
import copy
import hashlib
import json
from pathlib import Path

from blender_blueprint import validate_blueprint


PROFILE_ID = "rest-seat-v1"
PROFILE_BLUEPRINT = {
    "name": "Citizen Rest Seat",
    "parts": [
        {"kind": "cube", "name": "Walnut seat", "location": [0, 0, .46],
         "rotation": [0, 0, 0], "dimensions": [.70, .65, .12],
         "color": "#795035", "metallic": 0, "roughness": .8, "emission": 0},
        {"kind": "cube", "name": "Teal cushion", "location": [0, -.015, .535],
         "rotation": [0, 0, 0], "dimensions": [.62, .57, .05],
         "color": "#247f87", "metallic": 0, "roughness": .9, "emission": 0},
        *({"kind": "cube", "name": f"Leg {side} {end}",
           "location": [x, y, .205], "rotation": [0, 0, 0],
           "dimensions": [.075, .075, .41], "color": "#795035",
           "metallic": 0, "roughness": .8, "emission": 0}
          for side, x in (("left", -.275), ("right", .275))
          for end, y in (("front", -.245), ("back", .245))),
        {"kind": "cube", "name": "Upright back", "location": [0, .285, .76],
         "rotation": [0, 0, 0], "dimensions": [.70, .08, .48],
         "color": "#795035", "metallic": 0, "roughness": .8, "emission": 0},
        {"kind": "cube", "name": "Back cushion", "location": [0, .23, .76],
         "rotation": [0, 0, 0], "dimensions": [.61, .04, .35],
         "color": "#247f87", "metallic": 0, "roughness": .9, "emission": 0},
    ],
}
_validated_bytes = json.dumps(validate_blueprint(copy.deepcopy(PROFILE_BLUEPRINT)),
                              sort_keys=True, separators=(",", ":")).encode("utf-8")
PROFILE_BLUEPRINT_SHA256 = hashlib.sha256(_validated_bytes).hexdigest()
_runner_sha256 = hashlib.sha256(Path(__file__).with_name("build_blueprint.py").read_bytes()).hexdigest()
PROFILE_REVISION = hashlib.sha256((PROFILE_BLUEPRINT_SHA256 + ":" +
                                   _runner_sha256).encode("ascii")).hexdigest()


def reviewed_blueprint(profile_id):
    if profile_id != PROFILE_ID:
        raise ValueError("Unknown Citizen Blender generation profile")
    return validate_blueprint(copy.deepcopy(PROFILE_BLUEPRINT))
