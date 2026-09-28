"""Build the selected Version 4 garden bridge as editable Blender source and GLB.

Run with Blender 5.2:
  blender -b --factory-startup --python WebRuntime/art/build_concept_v4_garden_bridge.py

The model uses metres, with the span along X, width along Y, and height along Z.
Only the bridge collection is exported; studio lights, floor and camera are
Blender preview aids. The packed wood texture is embedded in the GLB.
"""

from math import cos, exp, pi, sin
from pathlib import Path
from random import Random

import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
STEM = "concept-v4-garden-bridge"
LENGTH = 3.4
HALF_LENGTH = LENGTH / 2
PLANK_WIDTH = 1.18

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 28
scene.render.resolution_x = 1440
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.world.color = (.72, .68, .64)

model = bpy.data.collections.new("Version 4 luminous garden bridge | exported")
scene.collection.children.link(model)
parts = []


def deck_z(x):
    t = max(-1.0, min(1.0, x / HALF_LENGTH))
    return .19 + .35 * (1 - t * t)


def rail_z(x):
    t = max(-1.0, min(1.0, x / HALF_LENGTH))
    return deck_z(x) + .78 + .07 * (1 - t * t)


def lower_arch_z(x):
    t = max(-1.0, min(1.0, x / HALF_LENGTH))
    return .045 + .29 * (1 - t * t)


def material(name, color, metallic=0, roughness=.4, emission=None, strength=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission is not None:
        shader.inputs["Emission Color"].default_value = (*emission, 1)
        shader.inputs["Emission Strength"].default_value = strength
    return mat


dark_metal = material("01 | charcoal bronze structural metal", (.035, .032, .029), .82, .33)
aged_brass = material("02 | aged brass collars and finials", (.39, .27, .13), .8, .3)
turquoise = material("03 | turquoise enamel edge and rails", (.025, .43, .45), .62, .26)
turquoise_highlight = material("04 | bright turquoise rail highlight", (.065, .60, .60), .56, .22)
wood_end = material("05 | wood end grain", (.24, .115, .055), .05, .66)
amber = material("06 | warm amber emissive strips", (1.0, .47, .11), .05, .23,
                 (1.0, .34, .045), 4.5)
amber_glass = material("07 | warm amber lantern glass", (.95, .36, .09), .12, .22,
                       (1.0, .22, .025), 2.4)

# A deterministic image texture gives each editable plank fine lengthwise grain.
# It is packed into the .blend and embedded in the self-contained GLB.
wood_image = bpy.data.images.new("Packed warm walnut plank grain", width=512, height=256,
                                 alpha=False)
rand = Random(42504)
pixels = []
for row in range(256):
    v = row / 255
    for column in range(512):
        u = column / 511
        warp = .020 * sin(2 * pi * (u * 1.7 + .1)) + .008 * sin(2 * pi * u * 5.1)
        grain = (.46 + .20 * sin(2 * pi * (v * 19 + warp))
                 + .09 * sin(2 * pi * (v * 43 + warp * 1.7))
                 + .045 * sin(2 * pi * (v * 91 + warp * 2.4)))
        knot = exp(-((u - .70) / .10) ** 2 - ((v - .48) / .08) ** 2)
        value = max(.18, min(.84, grain - .12 * knot + rand.uniform(-.023, .023)))
        pixels.extend((.29 + .24 * value, .13 + .17 * value, .055 + .105 * value, 1))
wood_image.pixels[:] = pixels
wood_image.pack()
wood = material("08 | packed warm walnut plank grain", (.47, .25, .13), .02, .68)
wood_nodes = wood.node_tree.nodes
wood_tex = wood_nodes.new("ShaderNodeTexImage")
wood_tex.name = "Packed wood grain"
wood_tex.image = wood_image
wood.node_tree.links.new(wood_tex.outputs["Color"],
                         wood_nodes.get("Principled BSDF").inputs["Base Color"])


def put(obj, mat):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    model.objects.link(obj)
    if mat is not None:
        obj.data.materials.append(mat)
    parts.append(obj)
    return obj


def mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    model.objects.link(obj)
    data.materials.append(mat)
    parts.append(obj)
    return obj


def bevel(obj, width=.008, segments=2):
    modifier = obj.modifiers.new("Soft machined edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.affect = "EDGES"
    normals = obj.modifiers.new("Weighted face normals", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    return obj


def cube(name, location, dimensions, mat, edge=.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    put(obj, mat)
    if edge:
        bevel(obj, edge)
    return obj


def sweep(name, y, z_func, width, height, mat, start=-HALF_LENGTH,
          stop=HALF_LENGTH, count=37, edge=.004):
    """Rectangular beam with an actual smoothly curved mesh centreline."""
    vertices = []
    for i in range(count):
        x = start + (stop - start) * i / (count - 1)
        z = z_func(x)
        vertices.extend(((x, y - width / 2, z - height / 2),
                         (x, y + width / 2, z - height / 2),
                         (x, y + width / 2, z + height / 2),
                         (x, y - width / 2, z + height / 2)))
    faces = [(3, 2, 1, 0)]
    for i in range(count - 1):
        a, b = 4 * i, 4 * (i + 1)
        faces.extend(((a, a + 1, b + 1, b),
                      (a + 1, a + 2, b + 2, b + 1),
                      (a + 2, a + 3, b + 3, b + 2),
                      (a + 3, a, b, b + 3)))
    last = 4 * (count - 1)
    faces.append((last, last + 1, last + 2, last + 3))
    obj = mesh(name, vertices, faces, mat)
    if edge:
        bevel(obj, edge)
    return obj


def rod(name, start, end, radius, mat, vertices=8):
    a, b = Vector(start), Vector(end)
    mid = (a + b) / 2
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                        depth=direction.length, location=mid)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    put(obj, mat)
    return obj


# An open, dark metal arch remains visible below the timber deck.
for side, y in (("left", -.625), ("right", .625)):
    sweep(f"{side} upper charcoal stringer", y, lambda x: deck_z(x) - .095,
          .055, .095, dark_metal)
    sweep(f"{side} lower arched frame", y, lower_arch_z, .052, .052,
          dark_metal, start=-1.59, stop=1.59)
    sweep(f"{side} turquoise deck edge", y * 1.025,
          lambda x: deck_z(x) - .012, .062, .038, turquoise)
    sweep(f"{side} narrow edge highlight", y * 1.065,
          lambda x: deck_z(x) + .006, .012, .010, turquoise_highlight,
          edge=.002)
    for index, x in enumerate((-1.12, -.56, 0, .56, 1.12)):
        rod(f"{side} underdeck arch brace {index + 1}",
            (x, y, lower_arch_z(x) + .02),
            (x, y, deck_z(x) - .12), .019, aged_brass)

for i, x in enumerate((-1.45, -1.0, -.5, 0, .5, 1.0, 1.45)):
    cube(f"underdeck cross joist {i + 1}",
         (x, 0, deck_z(x) - .11), (.052, 1.26, .055), dark_metal)

# 26 distinct, slightly wedge-shaped boards follow the parabola rather than
# hiding a flat deck under curved decorative trim.
board_count = 26
pitch = LENGTH / board_count
for i in range(board_count):
    left = -HALF_LENGTH + i * pitch + .006
    right = -HALF_LENGTH + (i + 1) * pitch - .006
    y0, y1 = -PLANK_WIDTH / 2, PLANK_WIDTH / 2
    top0, top1 = deck_z(left), deck_z(right)
    vertices = [(left, y0, top0 - .060), (left, y1, top0 - .060),
                (right, y1, top1 - .060), (right, y0, top1 - .060),
                (left, y0, top0), (left, y1, top0),
                (right, y1, top1), (right, y0, top1)]
    faces = [(4, 5, 6, 7), (0, 3, 2, 1), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = mesh(f"walnut plank {i + 1:02}", vertices, faces, wood)
    uv = obj.data.uv_layers.new(name="wood grain UV")
    for face in obj.data.polygons:
        for loop_index in face.loop_indices:
            vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = ((vertex.y - y0) / (y1 - y0),
                                      (vertex.x - left) / (right - left))
    bevel(obj, .003, 1)

# A continuous pair of slender handrails bends upward with the deck. The
# amber strip is a separate emissive mesh immediately below each rail.
for side, y in (("left", -.74), ("right", .74)):
    sweep(f"{side} black rail core", y, lambda x: rail_z(x) - .027,
          .075, .060, dark_metal, start=-1.62, stop=1.62)
    sweep(f"{side} turquoise handrail", y,
          lambda x: rail_z(x) + .012, .096, .048, turquoise,
          start=-1.63, stop=1.63)
    sweep(f"{side} rail top highlight", y,
          lambda x: rail_z(x) + .039, .046, .009, turquoise_highlight,
          start=-1.60, stop=1.60, edge=.001)
    sweep(f"{side} warm amber rail light", y * .955,
          lambda x: rail_z(x) - .069, .024, .019, amber,
          start=-1.55, stop=1.55, edge=.002)

# Four lantern posts, with emissive glass and brass finials, carry the rails.
for side, y in (("left", -.74), ("right", .74)):
    for end, x in (("near", -1.57), ("far", 1.57)):
        label = f"{side} {end} lantern"
        top = rail_z(x)
        cube(f"{label} turquoise foot", (x, y, .07),
             (.19, .19, .14), turquoise, .012)
        cube(f"{label} bronze plinth", (x, y, .18),
             (.125, .125, .09), aged_brass, .008)
        cube(f"{label} charcoal upright", (x, y, (.19 + top) / 2),
             (.081, .081, top - .19), dark_metal, .007)
        cube(f"{label} inner amber glass", (x, y - .043 if y > 0 else y + .043,
                                            deck_z(x) + .31),
             (.031, .012, .43), amber_glass, .005)
        cube(f"{label} outer amber glass", (x, y + .043 if y > 0 else y - .043,
                                            deck_z(x) + .31),
             (.031, .012, .43), amber_glass, .005)
        cube(f"{label} turquoise capital", (x, y, top + .003),
             (.15, .15, .058), turquoise, .009)
        cube(f"{label} brass finial neck", (x, y, top + .055),
             (.046, .046, .058), aged_brass, .004)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8,
                                              radius=.055,
                                              location=(x, y, top + .12))
        ball = bpy.context.object
        ball.name = f"{label} brass sphere"
        put(ball, aged_brass)

# Selection-only export keeps preview objects out of Matrix's model asset.
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.export_scene.gltf(filepath=str(HERE / f"{STEM}.glb"),
                          export_format="GLB", use_selection=True,
                          export_animations=False, export_cameras=False,
                          export_lights=False, export_apply=True)

# A pale studio helps compare the model to the selected concept. It is saved
# in the editable .blend but excluded from the GLB above.
preview_mat = material("Preview only | pale ground", (.81, .77, .73), 0, .85)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.023))
ground = bpy.context.object
ground.name = "Preview only | studio floor"
ground.data.materials.append(preview_mat)

bpy.ops.object.camera_add(location=(-5.2, -5.4, 3.1))
camera = bpy.context.object
camera.name = "Preview only | three-quarter camera"
camera.rotation_euler = (Vector((0, 0, .62)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 4.9
scene.camera = camera
for name, location, energy, color, size in (
        ("Preview only | warm key", (-3, -4, 6), 900, (1.0, .82, .64), 5),
        ("Preview only | soft fill", (3, 2, 5), 1100, (.75, .88, 1), 5),
        ("Preview only | rim", (1, 4, 3.5), 700, (1, .72, .42), 3)):
    bpy.ops.object.light_add(type="AREA", location=location)
    lamp = bpy.context.object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.color = color
    lamp.data.shape = "DISK"
    lamp.data.size = size
    lamp.rotation_euler = (Vector((0, 0, .6)) - lamp.location).to_track_quat("-Z", "Y").to_euler()

scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(HERE / f"{STEM}-preview.png")
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / f"{STEM}.blend"))
bpy.ops.render.render(write_still=True)
print(f"BRIDGE_BUILD_COMPLETE parts={len(parts)} glb={HERE / (STEM + '.glb')}")
