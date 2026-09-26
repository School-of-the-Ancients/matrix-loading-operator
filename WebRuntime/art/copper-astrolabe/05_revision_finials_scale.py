"""Copper Astrolabe revision: three turquoise finials and engraved face scale.

Send this source directly through Blender MCP execute_blender_code in the
dedicated GUI scratch instance after the first draft scene is open.
"""

import math

import bpy
from mathutils import Vector


SCENE = bpy.context.scene
BASE = r"C:\Users\theto\Documents\Codex\2026-09-25\g\work\m1-portal-astrolabe"
INITIAL = BASE + r"\copper-astrolabe-initial.blend"
if bpy.data.filepath.lower() != INITIAL.lower():
    raise RuntimeError("The active Blender file is not the Astrolabe initial draft")
MODEL = bpy.data.collections.get("Copper Astrolabe | Model")
if MODEL is None or bpy.data.objects.get("CA | hand-faceted blue core") is None:
    raise RuntimeError("The original Astrolabe model is missing")
if bpy.data.objects.get("CA | turquoise gem finial 1") is not None:
    raise RuntimeError("Revision geometry already exists; refusing to duplicate it")

bright = bpy.data.materials["CA | Polished edges"]
dark = bpy.data.materials["CA | Engraved recess"]
CZ = 1.70


def turquoise_material(name, color, emission):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1.0)
    shader = next(node for node in mat.node_tree.nodes
                  if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = 0.24
    shader.inputs["Roughness"].default_value = 0.16
    if shader.inputs.get("Emission Color") is not None:
        shader.inputs["Emission Color"].default_value = (*emission, 1.0)
    if shader.inputs.get("Emission Strength") is not None:
        shader.inputs["Emission Strength"].default_value = 0.33
    return mat


turquoise = turquoise_material("CA | Turquoise gemstone",
    (0.018, 0.64, 0.57), (0.008, 0.22, 0.19))
turquoise_light = turquoise_material("CA | Turquoise facet highlight",
    (0.10, 0.91, 0.78), (0.035, 0.30, 0.25))
turquoise_deep = turquoise_material("CA | Turquoise facet shade",
    (0.015, 0.31, 0.37), (0.005, 0.09, 0.11))


def model_object(obj):
    for collection in tuple(obj.users_collection):
        collection.objects.unlink(obj)
    MODEL.objects.link(obj)
    return obj


# Each gemstone has a radial double-pyramid silhouette with eight side
# facets. The bright metal socket anchors it to the inner brass perimeter.
for number, angle_degrees in enumerate((45, 165, 285), start=1):
    angle = math.radians(angle_degrees)
    outward = Vector((math.cos(angle), 0, math.sin(angle)))
    tangent = Vector((-math.sin(angle), 0, math.cos(angle)))
    toward_viewer = Vector((0, -1, 0))

    socket_center = Vector((1.165 * math.cos(angle), -0.105,
                            CZ + 1.165 * math.sin(angle)))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8,
                                         radius=0.102, location=socket_center)
    socket = model_object(bpy.context.object)
    socket.name = "CA | finial brass socket %d" % number
    socket.data.materials.append(bright)

    center = Vector((1.070 * math.cos(angle), -0.175,
                     CZ + 1.070 * math.sin(angle)))
    vertices = [tuple(center - outward * 0.155),
                tuple(center + outward * 0.080)]
    for side in range(8):
        turn = 2 * math.pi * side / 8
        point = (center + tangent * (0.105 * math.cos(turn))
                 + toward_viewer * (0.077 * math.sin(turn)))
        vertices.append(tuple(point))
    faces = []
    for side in range(8):
        nxt = (side + 1) % 8
        faces.append((0, 2 + side, 2 + nxt))
        faces.append((1, 2 + nxt, 2 + side))
    mesh = bpy.data.meshes.new("CA | turquoise finial %d mesh" % number)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    gem = bpy.data.objects.new("CA | turquoise gem finial %d" % number, mesh)
    MODEL.objects.link(gem)
    gem.data.materials.append(turquoise)
    gem.data.materials.append(turquoise_light)
    gem.data.materials.append(turquoise_deep)
    for facet in mesh.polygons:
        facet.material_index = (facet.index + number) % 3
        facet.use_smooth = False


def scale_circle(name, radius):
    curve = bpy.data.curves.new(name + " curve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.0025
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(287)
    for i, point in enumerate(spline.points):
        angle = 2 * math.pi * i / 288
        point.co = (radius * math.cos(angle), -0.073,
                    CZ + radius * math.sin(angle), 1)
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    MODEL.objects.link(obj)
    obj.data.materials.append(dark)


scale_circle("CA | engraved degree inner line", 1.296)
scale_circle("CA | engraved degree outer line", 1.342)

ticks = bpy.data.curves.new("CA | 5-degree scale curve", "CURVE")
ticks.dimensions = "3D"
ticks.bevel_depth = 0.0029
ticks.bevel_resolution = 2
for degree in range(0, 360, 5):
    angle = math.radians(degree)
    if degree % 90 == 0:
        start_radius = 1.272
    elif degree % 30 == 0:
        start_radius = 1.292
    elif degree % 15 == 0:
        start_radius = 1.307
    else:
        start_radius = 1.319
    spline = ticks.splines.new("POLY")
    spline.points.add(1)
    for point, radius in zip(spline.points, (start_radius, 1.340)):
        point.co = (radius * math.cos(angle), -0.078,
                    CZ + radius * math.sin(angle), 1)
scale_obj = bpy.data.objects.new("CA | engraved 5-degree ticks", ticks)
MODEL.objects.link(scale_obj)
scale_obj.data.materials.append(dark)


# Polished little badges mask the previous chapter ticks at the four
# compass positions so the new letters read as engraved on the face.
for letter, degree in (("N", 90), ("E", 0), ("S", 270), ("W", 180)):
    angle = math.radians(degree)
    x, z = 1.235 * math.cos(angle), CZ + 1.235 * math.sin(angle)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.078,
        depth=0.008, location=(x, -0.105, z),
        rotation=(math.pi / 2, 0, 0))
    badge = model_object(bpy.context.object)
    badge.name = "CA | cardinal badge " + letter
    badge.data.materials.append(bright)

    font = bpy.data.curves.new("CA | cardinal glyph " + letter, "FONT")
    font.body = letter
    font.size = 0.109
    font.extrude = 0.0007
    for prop in ("align_x", "align_y"):
        valid = [item.identifier for item in font.bl_rna.properties[prop].enum_items]
        if "CENTER" not in valid:
            raise RuntimeError("Cardinal text centering is unavailable")
    font.align_x = "CENTER"
    font.align_y = "CENTER"
    label = bpy.data.objects.new("CA | cardinal label " + letter, font)
    MODEL.objects.link(label)
    label.location = (x, -0.114, z)
    label.rotation_euler = (math.pi / 2, 0, 0)
    label.data.materials.append(dark)

print("Astrolabe revision: 3 turquoise faceted finials at 45/165/285 degrees, ")
print("72 five-degree ticks with 30-degree majors and N/E/S/W cardinal labels")
