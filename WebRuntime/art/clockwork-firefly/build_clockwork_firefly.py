"""Build the editable Clockwork Firefly and its two-clip Matrix GLB.

Run with Blender 5.2:
    blender -b --factory-startup --python WebRuntime/art/clockwork-firefly/build_clockwork_firefly.py

The self-contained GLB uses Wingbeat as its loop and Beacon Pulse as its
one-shot selection response. Preview staging stays in the .blend only.
"""
from math import cos, pi, radians, sin
from pathlib import Path

import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 40
scene.render.resolution_x = 1080
scene.render.resolution_y = 810
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.frame_start = 1
scene.frame_end = 49
scene.render.filepath = str(HERE / "clockwork-firefly-preview.png")
scene.view_settings.view_transform = "AgX"


def material(name, color, metallic=0.0, roughness=0.35, emission=None, strength=0.0):
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


bronze = material("Aged brushed bronze", (0.43, 0.22, 0.085), .83, .32)
bright_bronze = material("Polished brass edges", (0.78, 0.49, 0.18), .87, .23)
dark_iron = material("Dark clockwork joints", (0.045, 0.061, 0.064), .79, .37)
wing_glass = material("Pale jade wing enamel", (0.25, 0.69, 0.61), .12, .26,
                      (0.04, 0.28, 0.22), .34)
wing_vein = material("Bronze wing filigree", (0.75, 0.52, 0.22), .8, .28)
lantern = material("Amber lantern glass", (1.0, .47, .075), .08, .18,
                   (1.0, .26, .012), 3.2)
lantern_highlight = material("Beacon white gold", (1.0, .78, .22), .04, .2,
                             (1.0, .55, .06), 3.5)
eye_glass = material("Turquoise optical eyes", (.035, .41, .42), .19, .16,
                     (.01, .59, .58), 1.3)

firefly = bpy.data.collections.new("Clockwork Firefly - export")
scene.collection.children.link(firefly)
art = []


def add(obj, mat=None, parent=None):
    for collection in tuple(obj.users_collection):
        collection.objects.unlink(obj)
    firefly.objects.link(obj)
    if mat is not None:
        obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    art.append(obj)
    return obj


def empty(name, at=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    firefly.objects.link(obj)
    obj.location = at
    if parent is not None:
        obj.parent = parent
    art.append(obj)
    return obj


root = empty("Firefly root")
flight = empty("Hovering clockwork body", parent=root)


def sphere(name, at, scale, mat, parent=flight, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return add(obj, mat, parent)


def ico(name, at, scale, mat, parent=flight, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return add(obj, mat, parent)


def rod(name, a, b, radius, mat, parent=flight, vertices=10):
    a, b = Vector(a), Vector(b)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                        depth=direction.length, location=(a + b) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return add(obj, mat, parent)


def torus(name, at, major, minor, mat, parent=flight, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=7,
                                     major_radius=major, minor_radius=minor,
                                     location=at, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return add(obj, mat, parent)


def plate(name, at, scale, mat, parent=flight, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bevel = obj.modifiers.new("Soft machined edges", "BEVEL")
    bevel.width = .12
    bevel.segments = 2
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return add(obj, mat, parent)


# The positive-Y end is the head. The firefly hovers above the virtual floor.
sphere("Copper thorax", (0, .12, 1.18), (.29, .35, .27), bronze)
sphere("Brass head shell", (0, .57, 1.18), (.22, .24, .21), bright_bronze)
sphere("Dark face plate", (0, .76, 1.15), (.17, .065, .15), dark_iron)
for side in (-1, 1):
    sphere(f"Optical eye {side:+d}", (side * .145, .749, 1.205),
           (.075, .045, .075), eye_glass, segments=14, rings=8)
    ico(f"Eye glint {side:+d}", (side * .151, .788, 1.232),
        (.026, .012, .026), lantern_highlight)

# A luminous core remains exposed between distinct machined abdomen bands.
beacon = empty("Beacon lantern core", (0, -.51, 1.15), flight)
sphere("Warm segmented abdomen", (0, 0, 0), (.235, .58, .215),
       lantern, beacon, segments=24, rings=16)
for i, y in enumerate((-.16, -.40, -.65, -.89), 1):
    torus(f"Abdomen brass band {i}", (0, y, 1.15), .222, .028,
          bright_bronze, rotation=(pi / 2, 0, 0))
    plate(f"Dorsal armor scale {i}", (0, y, 1.357),
          (.235, .135, .045), bronze)
ico("Tail cap", (0, -1.105, 1.15), (.16, .12, .15), bronze)

# Two broad jade wings have an actual moving hinge and a vein network.
wing_roots = []
for side, label in ((-1, "Port"), (1, "Starboard")):
    pivot = empty(f"{label} wing hinge", (side * .23, -.02, 1.36), flight)
    wing_roots.append((side, pivot))
    outline = [(0, 0, 0), (side * .27, .13, .05),
               (side * .72, .08, .10), (side * 1.02, -.26, .07),
               (side * .89, -.52, .06), (side * .50, -.79, .045),
               (side * .08, -.51, .02)]
    mesh = bpy.data.meshes.new(f"{label} wing surface")
    mesh.from_pydata(outline, [], [(0, i, i + 1) for i in range(1, 6)])
    mesh.update()
    wing = bpy.data.objects.new(f"{label} etched wing", mesh)
    wing = add(wing, wing_glass, pivot)
    solid = wing.modifiers.new("Thin wing edge", "SOLIDIFY")
    solid.thickness = .012
    for i in range(1, 6):
        rod(f"{label} wing rim {i}", outline[i], outline[i + 1],
            .009, wing_vein, pivot, 8)
    for i in (2, 3, 4, 5):
        rod(f"{label} wing vein {i}", outline[0], outline[i],
            .006, wing_vein, pivot, 7)
    sphere(f"{label} wing axle", (0, 0, 0), (.075, .085, .072),
           dark_iron, pivot, 12, 8)

# Clockwork sprockets flank the thorax, with small brass teeth.
for side, label in ((-1, "Port"), (1, "Starboard")):
    torus(f"{label} exposed gear", (side * .275, .11, 1.20), .15, .027,
          bright_bronze, rotation=(0, pi / 2, 0))
    for tooth in range(5):
        angle = 2 * pi * tooth / 5
        y = .11 + .16 * cos(angle)
        z = 1.20 + .16 * sin(angle)
        plate(f"{label} gear tooth {tooth + 1}",
              (side * .29, y, z), (.055, .066, .057), bronze,
              rotation=(angle, 0, 0))
    sphere(f"{label} gear hub", (side * .307, .11, 1.20),
           (.055, .055, .055), dark_iron, segments=12, rings=8)

# Six folded legs and two curved antennae complete the silhouette.
for side, label in ((-1, "Port"), (1, "Starboard")):
    for index, y in enumerate((.39, -.03, -.45), 1):
        elbow = (side * .42, y + .03, .87)
        foot = (side * .55, y + .16, .62)
        rod(f"{label} leg {index} upper", (side * .21, y, 1.06), elbow,
            .021, bronze)
        rod(f"{label} leg {index} lower", elbow, foot, .013, dark_iron)
        ico(f"{label} leg {index} brass foot", foot,
            (.033, .04, .027), bright_bronze)
    base = (side * .095, .75, 1.32)
    bend = (side * .15, .98, 1.55)
    tip = (side * .23, 1.18, 1.62)
    rod(f"{label} antenna stem", base, bend, .015, dark_iron)
    rod(f"{label} antenna tip", bend, tip, .009, bright_bronze)
    ico(f"{label} antenna beacon", tip, (.04, .04, .04), lantern_highlight)

# The one-shot clip scales the lamp and sends two bright rings outward.
pulse_rings = []
for i, offset in enumerate((-.20, .17), 1):
    pulse = empty(f"Beacon pulse wave {i}", (0, -.51 + offset, 1.15), flight)
    torus(f"Beacon pulse ring {i}", (0, 0, 0), .25, .018,
          lantern_highlight, pulse, rotation=(pi / 2, 0, 0))
    pulse.scale = (.001, .001, .001)
    pulse_rings.append(pulse)


def clip(obj, name, channels):
    """Group object transform keys into one named exported NLA clip."""
    obj.animation_data_create()
    obj.animation_data.action = None
    for path, keys in channels.items():
        for frame, value in keys:
            setattr(obj, path, value)
            obj.keyframe_insert(data_path=path, frame=frame, group=name)
    action = obj.animation_data.action
    action.name = f"{obj.name} - {name}"
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action)
    obj.animation_data.action = None


clip(flight, "Wingbeat", {"location": [
    (1, (0, 0, 0)), (7, (0, 0, .06)), (13, (0, 0, 0)),
    (19, (0, 0, .06)), (25, (0, 0, 0))]})
for side, wing in wing_roots:
    clip(wing, "Wingbeat", {"rotation_euler": [
        (1, (0, -side * radians(12), 0)),
        (7, (0, -side * radians(56), 0)),
        (13, (0, side * radians(8), 0)),
        (19, (0, -side * radians(56), 0)),
        (25, (0, -side * radians(12), 0))]})
    clip(wing, "Beacon Pulse", {"rotation_euler": [
        (1, (0, -side * radians(12), 0)),
        (9, (0, -side * radians(70), 0)),
        (23, (0, -side * radians(45), 0)),
        (33, (0, -side * radians(12), 0))]})
clip(beacon, "Beacon Pulse", {"scale": [
    (1, (1, 1, 1)), (7, (.94, .95, .94)),
    (14, (1.28, 1.13, 1.28)), (23, (1.16, 1.04, 1.16)),
    (33, (1, 1, 1))]})
for index, pulse in enumerate(pulse_rings):
    delay = (index - 1) * 5
    clip(pulse, "Beacon Pulse", {"scale": [
        (1, (.001, .001, .001)),
        (7 + delay, (.001, .001, .001)),
        (15 + delay, (1.20, 1.20, 1.20)),
        (24 + delay, (1.67, 1.67, 1.67)),
        (33, (.001, .001, .001))]})

# Export just the clockwork art; lights, camera and stage are Blender-only.
scene.frame_set(1)
for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in art:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
glb_path = HERE / "clockwork-firefly.glb"
bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB",
                          use_selection=True, export_animations=True,
                          export_animation_mode="NLA_TRACKS", export_nla_strips=True,
                          export_apply=False)

# A dim plinth keeps the hover height legible in the saved, editable scene.
stage_mat = material("Preview midnight stage", (.015, .035, .052), .16, .58)
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1.45, depth=.10,
                                    location=(0, 0, .10))
stage = bpy.context.object
stage.name = "Preview plinth - not exported"
stage.data.materials.append(stage_mat)
bpy.ops.object.camera_add(location=(3.0, 4.3, 2.85))
camera = bpy.context.object
camera.name = "Preview camera - not exported"
camera.rotation_euler = (Vector((0, -.05, 1.07)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 3.75
scene.camera = camera
for name, at, energy, color, size in [
    ("Amber key", (2.5, 3.0, 4.0), 850, (1.0, .72, .38), 3.5),
    ("Jade rim", (-3.0, -2.4, 3.2), 1000, (.24, .93, .79), 3.0),
    ("Soft blue fill", (-1.8, 3.0, 2.2), 420, (.48, .73, 1.0), 4.5)]:
    bpy.ops.object.light_add(type="AREA", location=at)
    light = bpy.context.object
    light.name = f"{name} - not exported"
    light.data.energy = energy
    light.data.color = color
    light.data.shape = "DISK"
    light.data.size = size
    light.rotation_euler = (Vector((0, 0, 1.05)) - light.location).to_track_quat("-Z", "Y").to_euler()
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (.013, .032, .045, 1)
background.inputs["Strength"].default_value = .45
scene.frame_set(7)
blend_path = HERE / "clockwork-firefly.blend"
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
bpy.ops.render.render(write_still=True)
print(f"CLOCKWORK_FIREFLY_READY {glb_path}")
