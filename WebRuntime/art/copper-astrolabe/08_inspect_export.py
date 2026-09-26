"""Read-only validation and measured bounds for the exact Astrolabe GLB."""

import hashlib
import json
import math
from pathlib import Path
import struct
import sys


FILE = Path(r"C:\Users\theto\Documents\Codex\2026-09-25\g\work\m1-portal-astrolabe\copper-astrolabe-final.glb")
SERVICE = Path(r"C:\Users\theto\Documents\Codex\2026-09-25\g\work\matrix-loading-operator\ControlService")
sys.path.insert(0, str(SERVICE))
from web_assets import inspect_glb


inspection = inspect_glb(FILE)
raw = FILE.read_bytes()
magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
if magic != b"glTF" or version != 2 or declared_length != len(raw):
    raise RuntimeError("GLB header is inconsistent")

chunks = {}
offset = 12
while offset < len(raw):
    length, kind = struct.unpack_from("<I4s", raw, offset)
    offset += 8
    chunks[kind] = raw[offset:offset + length]
    offset += length
if offset != len(raw) or b"JSON" not in chunks or b"BIN\x00" not in chunks:
    raise RuntimeError("GLB chunks are incomplete")

document = json.loads(chunks[b"JSON"].decode("utf-8"))
binary = chunks[b"BIN\x00"]


def uri_count(value):
    if isinstance(value, dict):
        return (int("uri" in value)
                + sum(uri_count(item) for item in value.values()))
    if isinstance(value, list):
        return sum(uri_count(item) for item in value)
    return 0


if uri_count(document) != 0:
    raise RuntimeError("GLB contains a URI reference")

IDENTITY = (1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0)


def multiply(a, b):
    return tuple(sum(a[k * 4 + row] * b[column * 4 + k]
                     for k in range(4))
                 for column in range(4) for row in range(4))


def local_matrix(node):
    if "matrix" in node:
        return tuple(float(value) for value in node["matrix"])
    tx, ty, tz = node.get("translation", (0, 0, 0))
    sx, sy, sz = node.get("scale", (1, 1, 1))
    x, y, z, w = node.get("rotation", (0, 0, 0, 1))
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    xw, yw, zw = x * w, y * w, z * w
    return (
        (1 - 2 * (yy + zz)) * sx, 2 * (xy + zw) * sx, 2 * (xz - yw) * sx, 0,
        2 * (xy - zw) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + xw) * sy, 0,
        2 * (xz + yw) * sz, 2 * (yz - xw) * sz, (1 - 2 * (xx + yy)) * sz, 0,
        tx, ty, tz, 1,
    )


def position_vertices(accessor_number):
    accessor = document["accessors"][accessor_number]
    if accessor.get("componentType") != 5126 or accessor.get("type") != "VEC3":
        raise RuntimeError("Unsupported POSITION accessor encoding")
    if "sparse" in accessor:
        raise RuntimeError("Sparse POSITION accessor was not expected")
    view = document["bufferViews"][accessor["bufferView"]]
    if view.get("buffer", 0) != 0:
        raise RuntimeError("POSITION accessor is outside the embedded buffer")
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", 12)
    count = accessor["count"]
    if start + (count - 1) * stride + 12 > len(binary):
        raise RuntimeError("POSITION accessor exceeds embedded buffer")
    for index in range(count):
        yield struct.unpack_from("<fff", binary, start + index * stride)


mins = [math.inf, math.inf, math.inf]
maxs = [-math.inf, -math.inf, -math.inf]
mesh_nodes = 0
node_names = []


def visit(node_number, parent_matrix):
    global mesh_nodes
    node = document["nodes"][node_number]
    world = multiply(parent_matrix, local_matrix(node))
    if "mesh" in node:
        mesh_nodes += 1
        node_names.append(node.get("name", ""))
        mesh = document["meshes"][node["mesh"]]
        for primitive in mesh["primitives"]:
            accessor_number = primitive["attributes"]["POSITION"]
            for x, y, z in position_vertices(accessor_number):
                transformed = (
                    world[0] * x + world[4] * y + world[8] * z + world[12],
                    world[1] * x + world[5] * y + world[9] * z + world[13],
                    world[2] * x + world[6] * y + world[10] * z + world[14],
                )
                for axis, value in enumerate(transformed):
                    mins[axis] = min(mins[axis], value)
                    maxs[axis] = max(maxs[axis], value)
    for child in node.get("children", ()):
        visit(child, world)


scene_number = document.get("scene", 0)
for root in document["scenes"][scene_number]["nodes"]:
    visit(root, IDENTITY)
if mesh_nodes != 51 or inspection["meshes"] != 51:
    raise RuntimeError("Expected exactly 51 model mesh nodes")
if any("preview floor" in name.lower() for name in node_names):
    raise RuntimeError("Preview floor was exported")
for expected in ("48-tooth brass outer ring", "curved orbit strut 1",
                 "hand-faceted blue core", "turquoise gem finial 1",
                 "engraved 5-degree ticks", "cardinal label N"):
    if not any(expected in name for name in node_names):
        raise RuntimeError("Required geometry is missing from GLB: " + expected)
if document.get("cameras"):
    raise RuntimeError("A camera was exported")
if document.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights"):
    raise RuntimeError("A preview light was exported")

center = [(lo + hi) / 2 for lo, hi in zip(mins, maxs)]
size = [hi - lo for lo, hi in zip(mins, maxs)]
if not all(math.isfinite(value) and value > 0 for value in size):
    raise RuntimeError("Measured GLB bounds are invalid")


def xyz(values):
    return dict(zip(("x", "y", "z"), (round(value, 6) for value in values)))


print(json.dumps({
    "file": str(FILE),
    "sha256": hashlib.sha256(raw).hexdigest(),
    "inspection": inspection,
    "externalUriCount": uri_count(document),
    "meshNodes": mesh_nodes,
    "cameraCount": len(document.get("cameras", ())),
    "lightCount": len(document.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", ())),
    "bounds": {"min": xyz(mins), "max": xyz(maxs),
               "center": xyz(center), "size": xyz(size)},
}, indent=2))
