"""Copper Astrolabe first draft, phase 2: curved orbits, sapphire, and foot."""

import math

import bpy


SCENE = bpy.context.scene
MODEL = bpy.data.collections.get("Copper Astrolabe | Model")
if MODEL is None or bpy.data.objects.get("CA | 48-tooth brass outer ring") is None:
    raise RuntimeError("Phase 1 structure is missing; refusing to add parts")

brass = bpy.data.materials["CA | Aged brass"]
copper = bpy.data.materials["CA | Burnished copper"]
bright = bpy.data.materials["CA | Polished edges"]
blue = bpy.data.materials["CA | Faceted sapphire"]
blue_light = bpy.data.materials["CA | Azure facets"]
blue_dark = bpy.data.materials["CA | Midnight facets"]
CZ = 1.70


def to_model(obj):
    for collection in tuple(obj.users_collection):
        collection.objects.unlink(obj)
    MODEL.objects.link(obj)
    return obj


def tube(name, points, radius, material, cyclic=False):
    curve = bpy.data.curves.new(name + " curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 24
    curve.bevel_depth = radius
    curve.bevel_resolution = 4
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, xyz in zip(spline.points, points):
        point.co = (*xyz, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    MODEL.objects.link(obj)
    obj.data.materials.append(material)
    return obj


# Each strut is a sampled, bowed spatial arc. Its two ends meet the inner
# perimeter; the middle sweeps toward the sapphire and out in depth.
for index, (phase, bow) in enumerate([
    (0.0, -0.66),
    (math.pi / 2, 0.58),
    (math.pi, -0.62),
    (3 * math.pi / 2, 0.64),
]):
    points = []
    for step in range(97):
        t = step / 96
        angle = phase + math.pi * t
        inset = math.sin(math.pi * t)
        radius = 1.16 - 0.53 * inset
        points.append((radius * math.cos(angle), bow * inset,
                       CZ + radius * math.sin(angle)))
    tube("CA | curved orbit strut %d" % (index + 1), points,
         0.025 if index % 2 == 0 else 0.020,
         copper if index % 2 == 0 else bright)


# Two differently tilted gimbals make the mechanism legible from a three-
# quarter view. They are copper tubes, not flat decorative decals.
gimbal_one = []
gimbal_two = []
tilt = math.radians(50)
yaw = math.radians(47)
for i in range(192):
    t = 2 * math.pi * i / 192
    gimbal_one.append((0.94 * math.cos(t),
                       0.94 * math.sin(t) * math.sin(tilt),
                       CZ + 0.94 * math.sin(t) * math.cos(tilt)))
    gimbal_two.append((0.82 * math.cos(t) * math.cos(yaw),
                       0.82 * math.cos(t) * math.sin(yaw),
                       CZ + 0.82 * math.sin(t)))
tube("CA | inclined copper meridian", gimbal_one, 0.018, copper, cyclic=True)
tube("CA | inner brass meridian", gimbal_two, 0.013, bright, cyclic=True)

for i, angle in enumerate((0, math.pi / 2, math.pi, 3 * math.pi / 2)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6,
        radius=0.058, location=(1.16 * math.cos(angle), -0.035,
                                CZ + 1.16 * math.sin(angle)))
    pivot = to_model(bpy.context.object)
    pivot.name = "CA | orbit pivot %d" % (i + 1)
    pivot.data.materials.append(bright)


bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.42,
                                      location=(0, 0, CZ))
core = to_model(bpy.context.object)
core.name = "CA | hand-faceted blue core"
core.rotation_euler = (0.19, -0.17, 0.24)
core.data.materials.append(blue)
core.data.materials.append(blue_light)
core.data.materials.append(blue_dark)
for face in core.data.polygons:
    face.use_smooth = False
    if face.normal.y < -0.36 and face.normal.z > -0.2:
        face.material_index = 1
    elif face.normal.x < -0.45:
        face.material_index = 2


def cylinder(name, radius, depth, z, vertices, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                        depth=depth, location=(0, 0, z))
    obj = to_model(bpy.context.object)
    obj.name = name
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("Turned edge", "BEVEL")
    bevel.width = min(0.018, depth / 4)
    bevel.segments = 2
    return obj


cylinder("CA | twelve-sided bronze foot", 0.53, 0.10, 0.075, 12, copper)
cylinder("CA | bright foot cap", 0.46, 0.045, 0.146, 12, bright)
cylinder("CA | central support stem", 0.083, 0.19, 0.253, 16, brass)
cylinder("CA | stem collar", 0.13, 0.035, 0.341, 16, copper)

foot_trim = []
for i in range(96):
    t = 2 * math.pi * i / 96
    foot_trim.append((0.492 * math.cos(t), 0.492 * math.sin(t), 0.130))
tube("CA | foot rim inlay", foot_trim, 0.009, bright, cyclic=True)

print("Copper Astrolabe phase 2: four curved struts, two gimbals, faceted core, foot")
