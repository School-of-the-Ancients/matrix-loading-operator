"""Build a tiny, self-contained glTF 2.0 chair for isolated Matrix demos.

The chair is Y-up. Its front faces negative Z. Geometry spans
X [-.31, .31], Y [0, .95], and Z [-.31, .31] metres.
"""

import json
from pathlib import Path
import struct


OUTPUT = Path(__file__).with_name("citizens-demo-chair.glb")


def cube():
    faces = [
        ((0, 0, 1), [(-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)]),
        ((0, 0, -1), [(.5, -.5, -.5), (-.5, -.5, -.5), (-.5, .5, -.5), (.5, .5, -.5)]),
        ((1, 0, 0), [(.5, -.5, .5), (.5, -.5, -.5), (.5, .5, -.5), (.5, .5, .5)]),
        ((-1, 0, 0), [(-.5, -.5, -.5), (-.5, -.5, .5), (-.5, .5, .5), (-.5, .5, -.5)]),
        ((0, 1, 0), [(-.5, .5, .5), (.5, .5, .5), (.5, .5, -.5), (-.5, .5, -.5)]),
        ((0, -1, 0), [(-.5, -.5, -.5), (.5, -.5, -.5), (.5, -.5, .5), (-.5, -.5, .5)]),
    ]
    positions, normals, indices = [], [], []
    for normal, corners in faces:
        base = len(positions) // 3
        for corner in corners:
            positions.extend(corner)
            normals.extend(normal)
        indices.extend((base, base + 1, base + 2, base, base + 2, base + 3))
    return (
        struct.pack(f"<{len(positions)}f", *positions),
        struct.pack(f"<{len(normals)}f", *normals),
        struct.pack(f"<{len(indices)}H", *indices),
    )


def main():
    positions, normals, indices = cube()
    binary = positions + normals + indices
    views = []
    offset = 0
    for blob, target in ((positions, 34962), (normals, 34962), (indices, 34963)):
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(blob), "target": target})
        offset += len(blob)

    parts = [
        ("Seat frame", 0, (0, .43, 0), (.62, .08, .62)),
        ("Seat cushion", 1, (0, .495, -.015), (.55, .07, .53)),
        ("Back frame", 0, (0, .70, .27), (.62, .50, .08)),
        ("Back cushion", 1, (0, .72, .214), (.54, .38, .04)),
    ]
    for x in (-.255, .255):
        for z in (-.255, .255):
            parts.append(("Chair leg", 0, (x, .21, z), (.075, .42, .075)))

    document = {
        "asset": {"version": "2.0", "generator": "Matrix demo chair (standard-library glTF builder)"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(parts)))}],
        "nodes": [
            {"name": name, "mesh": mesh, "translation": position, "scale": scale}
            for name, mesh, position, scale in parts
        ],
        "meshes": [
            {"name": "Wood", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]},
            {"name": "Teal upholstery", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 1}]},
        ],
        "materials": [
            {"name": "Walnut", "pbrMetallicRoughness": {"baseColorFactor": [.43, .24, .12, 1], "metallicFactor": 0, "roughnessFactor": .84}},
            {"name": "Teal fabric", "pbrMetallicRoughness": {"baseColorFactor": [.07, .45, .48, 1], "metallicFactor": 0, "roughnessFactor": .94}},
        ],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 24, "type": "VEC3", "min": [-.5, -.5, -.5], "max": [.5, .5, .5]},
            {"bufferView": 1, "componentType": 5126, "count": 24, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": 36, "type": "SCALAR"},
        ],
    }
    json_bytes = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    OUTPUT.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
        + struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
