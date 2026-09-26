"""Build a small self-contained glTF 2.0 food table for isolated Matrix demos.

The table is Y-up and faces negative Z. Its four legs touch Y=0. The blue
bowl and orange food make its eating purpose visible without external assets.
The exact bounds are X [-0.6, 0.6], Y [0, 0.855], Z [-0.4, 0.4] metres.
"""

import json
from pathlib import Path
import struct
from math import cos, pi, sin


OUTPUT = Path(__file__).with_name("citizens-demo-food-table.glb")


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
    return positions, normals, indices


def cylinder(sides=24):
    positions, normals, indices = [], [], []
    for side in range(sides):
        first = 2 * pi * side / sides
        second = 2 * pi * (side + 1) / sides
        base = len(positions) // 3
        for angle, y in ((first, -.5), (second, -.5), (second, .5), (first, .5)):
            x, z = .5 * cos(angle), .5 * sin(angle)
            positions.extend((x, y, z))
            normals.extend((cos(angle), 0, sin(angle)))
        indices.extend((base, base + 2, base + 1, base, base + 3, base + 2))
    for y, normal_y in ((.5, 1), (-.5, -1)):
        center = len(positions) // 3
        positions.extend((0, y, 0))
        normals.extend((0, normal_y, 0))
        for side in range(sides):
            angle = 2 * pi * side / sides
            positions.extend((.5 * cos(angle), y, .5 * sin(angle)))
            normals.extend((0, normal_y, 0))
        for side in range(sides):
            a, b = center + 1 + side, center + 1 + ((side + 1) % sides)
            indices.extend((center, b, a) if normal_y > 0 else (center, a, b))
    return positions, normals, indices


def bowl_rim(sides=24):
    positions, normals, indices = [], [], []
    for side in range(sides):
        angle = 2 * pi * side / sides
        x, z = cos(angle), sin(angle)
        for radius in (.5, .38):
            positions.extend((radius * x, 0, radius * z))
            normals.extend((0, 1, 0))
    for side in range(sides):
        current, following = 2 * side, 2 * ((side + 1) % sides)
        indices.extend((current, current + 1, following,
                        current + 1, following + 1, following))
    return positions, normals, indices


def main():
    binary = bytearray()
    views, accessors, meshes = [], [], []
    materials = [
        {"name": "Warm walnut", "pbrMetallicRoughness": {
            "baseColorFactor": [.40, .23, .11, 1], "metallicFactor": 0,
            "roughnessFactor": .83}},
        {"name": "Blue ceramic", "pbrMetallicRoughness": {
            "baseColorFactor": [.09, .35, .67, 1], "metallicFactor": 0,
            "roughnessFactor": .33}},
        {"name": "Golden food", "pbrMetallicRoughness": {
            "baseColorFactor": [.95, .53, .12, 1], "metallicFactor": 0,
            "roughnessFactor": .78}},
    ]

    def add_mesh(name, geometry, material):
        positions, normals, indices = geometry
        count = len(positions) // 3
        mesh_accessors = []
        for values, fmt, component, target, accessor_type, item_count in (
            (positions, "f", 5126, 34962, "VEC3", count),
            (normals, "f", 5126, 34962, "VEC3", count),
            (indices, "H", 5123, 34963, "SCALAR", len(indices)),
        ):
            while len(binary) % 4:
                binary.append(0)
            blob = struct.pack(f"<{len(values)}{fmt}", *values)
            views.append({"buffer": 0, "byteOffset": len(binary),
                          "byteLength": len(blob), "target": target})
            binary.extend(blob)
            accessor = {"bufferView": len(views) - 1,
                        "componentType": component, "count": item_count,
                        "type": accessor_type}
            if accessor_type == "VEC3" and values is positions:
                accessor["min"] = [min(positions[axis::3]) for axis in range(3)]
                accessor["max"] = [max(positions[axis::3]) for axis in range(3)]
            accessors.append(accessor)
            mesh_accessors.append(len(accessors) - 1)
        meshes.append({"name": name, "primitives": [{"attributes": {
            "POSITION": mesh_accessors[0], "NORMAL": mesh_accessors[1]},
            "indices": mesh_accessors[2], "material": material}]})
        return len(meshes) - 1

    wood = add_mesh("Table wood", cube(), 0)
    ceramic = add_mesh("Ceramic bowl", cylinder(), 1)
    food = add_mesh("Food", cylinder(), 2)
    rim = add_mesh("Bowl rim", bowl_rim(), 1)
    parts = [("Table top", wood, (0, .72, 0), (1.2, .06, .8))]
    for x in (-.54, .54):
        for z in (-.34, .34):
            parts.append(("Table leg", wood, (x, .345, z), (.09, .69, .09)))
    for z in (-.34, .34):
        parts.append(("Long apron", wood, (0, .655, z), (1.08, .07, .06)))
    for x in (-.54, .54):
        parts.append(("Short apron", wood, (x, .655, 0), (.06, .07, .60)))
    parts.extend((
        ("Blue bowl", ceramic, (0, .795, 0), (.34, .09, .34)),
        ("Golden meal", food, (0, .842, 0), (.26, .026, .26)),
        ("Bowl lip", rim, (0, .843, 0), (.36, 1, .36)),
    ))

    while len(binary) % 4:
        binary.append(0)
    document = {
        "asset": {"version": "2.0", "generator": "Matrix demo food table (standard-library glTF builder)"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(parts)))}],
        "nodes": [{"name": name, "mesh": mesh, "translation": position,
                   "scale": scale} for name, mesh, position, scale in parts],
        "meshes": meshes, "materials": materials,
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views, "accessors": accessors,
    }
    json_bytes = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    OUTPUT.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
        + struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
