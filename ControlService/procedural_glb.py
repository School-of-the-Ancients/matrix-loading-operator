"""Small, deterministic GLB recipes for live Matrix asset prototypes.

This authoring step emits static geometry only. It never evaluates request text
or sends executable behavior to a browser or headset.
"""
import json
import struct


PALETTES = {
    "slate": ((0.32, 0.43, 0.49), (0.45, 0.58, 0.62)),
    "sandstone": ((0.65, 0.52, 0.37), (0.78, 0.65, 0.46)),
    "copper": ((0.47, 0.28, 0.20), (0.72, 0.44, 0.27)),
    "midnight": ((0.10, 0.16, 0.28), (0.19, 0.54, 0.66)),
}
SHAPES = ("arch", "monolith", "pedestal")


def boxes_for(spec):
    width, height, depth = (spec[key] for key in ("width", "height", "depth"))
    if spec["shape"] == "arch":
        post = min(width * .22, max(.14, depth * .65))
        lintel = max(.14, height * .16)
        if width - 2 * post < .25 or height - lintel < .3:
            raise ValueError("Arch needs a wider opening and taller posts")
        return [(-width / 2, 0, -depth / 2, -width / 2 + post, height - lintel, depth / 2, 0),
                (width / 2 - post, 0, -depth / 2, width / 2, height - lintel, depth / 2, 0),
                (-width / 2, height - lintel, -depth / 2, width / 2, height, depth / 2, 1),
                (-width / 2, 0, -depth / 2, -width / 2 + post, .08, depth / 2, 1),
                (width / 2 - post, 0, -depth / 2, width / 2, .08, depth / 2, 1)]
    if spec["shape"] == "monolith":
        lip = min(.08, width * .08, depth * .08)
        return [(-width * .42, 0, -depth * .42, width * .42, height * .92, depth * .42, 0),
                (-width / 2, 0, -depth / 2, width / 2, min(.12, height * .12), depth / 2, 1),
                (-width * .42 - lip, height * .92, -depth * .42 - lip,
                 width * .42 + lip, height, depth * .42 + lip, 1)]
    shaft = width * .45
    return [(-width / 2, 0, -depth / 2, width / 2, height * .12, depth / 2, 1),
            (-shaft / 2, height * .12, -depth * .29, shaft / 2, height * .82, depth * .29, 0),
            (-width / 2, height * .82, -depth / 2, width / 2, height, depth / 2, 1)]


def build_glb(spec):
    positions, normals, colors, indices = [], [], [], []
    palette = PALETTES[spec["palette"]]
    for x0, y0, z0, x1, y1, z1, shade in boxes_for(spec):
        face_data = [
            ((0, 0, 1), ((x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1))),
            ((0, 0,-1), ((x1,y0,z0),(x0,y0,z0),(x0,y1,z0),(x1,y1,z0))),
            ((1, 0, 0), ((x1,y0,z1),(x1,y0,z0),(x1,y1,z0),(x1,y1,z1))),
            ((-1,0, 0), ((x0,y0,z0),(x0,y0,z1),(x0,y1,z1),(x0,y1,z0))),
            ((0, 1, 0), ((x0,y1,z1),(x1,y1,z1),(x1,y1,z0),(x0,y1,z0))),
            ((0,-1, 0), ((x0,y0,z0),(x1,y0,z0),(x1,y0,z1),(x0,y0,z1))),
        ]
        for normal, vertices in face_data:
            start = len(positions) // 3
            for point in vertices:
                positions.extend(point)
                normals.extend(normal)
                colors.extend((*palette[shade], 1.0))
            indices.extend((start, start + 1, start + 2, start, start + 2, start + 3))

    sections = [struct.pack(f"<{len(positions)}f", *positions),
                struct.pack(f"<{len(normals)}f", *normals),
                struct.pack(f"<{len(colors)}f", *colors),
                struct.pack(f"<{len(indices)}H", *indices)]
    views, offset = [], 0
    for section in sections:
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(section)})
        offset += len(section)
    binary = b"".join(sections)
    document = {
        "asset": {"version": "2.0", "generator": "Matrix bounded procedural authoring v1"},
        "buffers": [{"byteLength": len(binary)}], "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(positions)//3, "type": "VEC3",
             "min": [min(positions[i::3]) for i in range(3)], "max": [max(positions[i::3]) for i in range(3)]},
            {"bufferView": 1, "componentType": 5126, "count": len(normals)//3, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(colors)//4, "type": "VEC4"},
            {"bufferView": 3, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1,1,1,1],
                         "metallicFactor": .28 if spec["palette"] == "copper" else .05,
                         "roughnessFactor": .78}, "doubleSided": False}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
                                      "indices": 3, "material": 0}]}],
        "nodes": [{"mesh": 0}], "scenes": [{"nodes": [0]}], "scene": 0,
    }
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    return (struct.pack("<4sII", b"glTF", 2, total)
            + struct.pack("<I4s", len(encoded), b"JSON") + encoded
            + struct.pack("<I4s", len(binary), b"BIN\x00") + binary)
