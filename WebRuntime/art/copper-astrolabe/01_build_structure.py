"""Copper Astrolabe first draft, phase 1: original toothed ring and materials.

Run only in the dedicated empty Blender MCP scratch scene.
"""

import math

import bpy


SCENE = bpy.context.scene
if len(SCENE.objects) != 0:
    raise RuntimeError("Scratch scene is not empty; refusing to alter it")

MODEL = bpy.data.collections.new("Copper Astrolabe | Model")
SCENE.collection.children.link(MODEL)
STAGE = bpy.data.collections.new("Copper Astrolabe | Preview Stage")
SCENE.collection.children.link(STAGE)


def material(name, color, metallic, roughness, emission_color=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1.0)
    shader = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission_color is not None:
        if shader.inputs.get("Emission Color") is not None:
            shader.inputs["Emission Color"].default_value = (*emission_color, 1.0)
        if shader.inputs.get("Emission Strength") is not None:
            shader.inputs["Emission Strength"].default_value = emission_strength
    return mat


brass = material("CA | Aged brass", (0.55, 0.31, 0.095), 0.88, 0.28)
copper = material("CA | Burnished copper", (0.42, 0.16, 0.075), 0.83, 0.31)
dark_copper = material("CA | Engraved recess", (0.095, 0.043, 0.025), 0.63, 0.40)
bright_brass = material("CA | Polished edges", (0.85, 0.58, 0.20), 0.91, 0.20)
blue = material("CA | Faceted sapphire", (0.025, 0.11, 0.65), 0.46, 0.16,
                emission_color=(0.012, 0.06, 0.30), emission_strength=0.26)
blue_light = material("CA | Azure facets", (0.045, 0.31, 0.85), 0.35, 0.14,
                      emission_color=(0.018, 0.14, 0.48), emission_strength=0.36)
blue_dark = material("CA | Midnight facets", (0.018, 0.048, 0.26), 0.55, 0.20)


def link_mesh(name, vertices, faces, mat):
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    MODEL.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def polyline(name, points, radius, mat, cyclic=False):
    curve = bpy.data.curves.new(name + " curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 24
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, xyz in zip(spline.points, points):
        point.co = (*xyz, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    MODEL.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


CENTER_Z = 1.70
TEETH = 48
SAMPLES_PER_TOOTH = 6
N = TEETH * SAMPLES_PER_TOOTH
INNER_R = 1.18
HALF_DEPTH = 0.065
vertices = []
for i in range(N):
    theta = 2.0 * math.pi * i / N
    # The high plateau is part of the annular mesh, not a separate tooth prop.
    outer_r = 1.455 if i % SAMPLES_PER_TOOTH in (2, 3) else 1.355
    co, si = math.cos(theta), math.sin(theta)
    vertices.extend([
        (outer_r * co, -HALF_DEPTH, CENTER_Z + outer_r * si),
        (INNER_R * co, -HALF_DEPTH, CENTER_Z + INNER_R * si),
        (outer_r * co, HALF_DEPTH, CENTER_Z + outer_r * si),
        (INNER_R * co, HALF_DEPTH, CENTER_Z + INNER_R * si),
    ])

faces = []
for i in range(N):
    j = (i + 1) % N
    a, b = 4 * i, 4 * j
    faces.extend([
        (a, b, b + 1, a + 1),          # front annulus
        (a + 2, a + 3, b + 3, b + 2),  # back annulus
        (a, a + 2, b + 2, b),          # tooth perimeter
        (a + 1, b + 1, b + 3, a + 3),  # inner perimeter
    ])

ring = link_mesh("CA | 48-tooth brass outer ring", vertices, faces, brass)
bevel = ring.modifiers.new("Machined edge bevel", "BEVEL")
bevel.width = 0.012
bevel.segments = 2
bevel.limit_method = "ANGLE"

for radius, depth, tube, mat, label in [
    (1.205, -0.082, 0.011, bright_brass, "front inner fillet"),
    (1.285, -0.081, 0.006, dark_copper, "engraved chapter line"),
    (1.205, 0.082, 0.011, bright_brass, "rear inner fillet"),
]:
    points = [(radius * math.cos(2 * math.pi * i / 192), depth,
               CENTER_Z + radius * math.sin(2 * math.pi * i / 192))
              for i in range(192)]
    polyline("CA | " + label, points, tube, mat, cyclic=True)

for tick_kind, count, r0, r1, width in [
    ("minor", 48, 1.218, 1.255, 0.0034),
    ("major", 12, 1.214, 1.277, 0.0055),
]:
    curve = bpy.data.curves.new("CA | " + tick_kind + " ticks curve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = width
    curve.bevel_resolution = 2
    for i in range(count):
        theta = 2 * math.pi * i / count
        co, si = math.cos(theta), math.sin(theta)
        spline = curve.splines.new("POLY")
        spline.points.add(1)
        spline.points[0].co = (r0 * co, -0.091, CENTER_Z + r0 * si, 1)
        spline.points[1].co = (r1 * co, -0.091, CENTER_Z + r1 * si, 1)
    obj = bpy.data.objects.new("CA | " + tick_kind + " chapter ticks", curve)
    MODEL.objects.link(obj)
    obj.data.materials.append(bright_brass if tick_kind == "major" else dark_copper)

for i in range(12):
    theta = 2 * math.pi * (i + 0.5) / 12
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.025,
        location=(1.315 * math.cos(theta), -0.092,
                  CENTER_Z + 1.315 * math.sin(theta)))
    rivet = bpy.context.object
    rivet.name = "CA | face rivet %02d" % (i + 1)
    for collection in tuple(rivet.users_collection):
        collection.objects.unlink(rivet)
    MODEL.objects.link(rivet)
    rivet.data.materials.append(bright_brass)

print("Copper Astrolabe phase 1: integrated 48-tooth ring, trim, ticks, rivets")
