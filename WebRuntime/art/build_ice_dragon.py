"""Build the editable Ice Dragon scene and its two-clip Matrix GLB.

Run with Blender 5.2: blender -b --factory-startup --python build_ice_dragon.py
The GLB uses Flight as its loop and Frost Burst as its selection response.
"""
from math import radians
from pathlib import Path
import math
import random

import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.world.color = (0.025, 0.045, 0.085)
scene.frame_start = 1
scene.frame_end = 49
scene.render.film_transparent = False


def material(name, color, metallic=0, roughness=0.35, emission=None, strength=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1)
        shader.inputs["Emission Strength"].default_value = strength
    return mat


midnight = material("Midnight blue scales", (0.018, 0.085, 0.17), .32, .28)
armor = material("Glacial blue armor", (0.055, .28, .42), .32, .24)
ice = material("Faceted turquoise ice", (.16, .77, .89), .12, .21, (.035, .3, .46), .3)
frost = material("Frost white", (.72, .94, 1), .07, .19, (.2, .53, .67), .28)
wing_mat = material("Icy wing membrane", (.18, .59, .75), .13, .25, (.025, .13, .2), .22)
deep_wing = material("Wing ridge", (.025, .19, .3), .24, .27)
eye_mat = material("Luminous eyes", (.3, .94, 1), .02, .13, (.12, .86, 1), 2.5)
breath_mat = material("Frost breath shards", (.36, .9, 1), 0, .18, (.24, .78, 1), 2.0)

dragon = bpy.data.collections.new("Ice Dragon - exported")
scene.collection.children.link(dragon)
art = []


def add(obj, mat=None, parent=None):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    dragon.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    art.append(obj)
    return obj


def empty(name, at=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    dragon.objects.link(obj)
    obj.location = at
    if parent:
        obj.parent = parent
    art.append(obj)
    return obj


root = empty("Dragon root")
body_rig = empty("Hover body", parent=root)


def sphere(name, at, scale, mat, parent=body_rig, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return add(obj, mat, parent)


def ico(name, at, scale, mat, parent=body_rig, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return add(obj, mat, parent)


def tapered(name, start, end, r0, r1, mat, parent=body_rig, vertices=9):
    start, end = Vector(start), Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r0, radius2=r1,
                                    depth=direction.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return add(obj, mat, parent)


def poly(name, vertices, faces, mat, parent):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    dragon.objects.link(obj)
    obj.parent = parent
    art.append(obj)
    return obj


# A long, low silhouette reads as a dragon from the default desktop camera.
sphere("Barrel chest", (0, 0, 1.4), (.52, .79, .39), midnight)
sphere("Breastplate", (0, .4, 1.39), (.43, .45, .35), armor)
sphere("Shoulder armor", (0, .03, 1.66), (.38, .62, .2), armor)
sphere("Hip armor", (0, -.57, 1.36), (.38, .38, .32), midnight)
for i in range(5):
    y = .52 - i * .23
    sphere(f"Ventral ice plate {i + 1}", (0, y, 1.09), (.29 - .02*i, .115, .055), ice)

# Neck, muzzle, jaw, sapphire eyes and paired swept horns.
tapered("Tall serpentine neck", (0, .55, 1.55), (0, 1.04, 2.05), .27, .19, armor)
sphere("Faceted crown", (0, 1.1, 2.05), (.27, .36, .24), midnight)
sphere("Long muzzle", (0, 1.39, 1.96), (.22, .37, .14), armor)
jaw = empty("Hinged lower jaw", (0, 1.13, 1.89), body_rig)
sphere("Lower jaw", (0, .23, -.065), (.2, .29, .06), midnight, jaw)
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    ico(f"Eye socket {tag}", (side*.242, 1.23, 2.12), (.065, .12, .1), deep_wing)
    ico(f"Glowing eye {tag}", (side*.285, 1.265, 2.14), (.043, .074, .062), eye_mat)
    tapered(f"Swept horn {tag}", (side*.17, .99, 2.21),
            (side*.39, .55, 2.61), .105, 0, frost)
    tapered(f"Cheek spike {tag}", (side*.22, 1.18, 2.00),
            (side*.43, .92, 2.12), .07, 0, ice)
    ico(f"Nostril {tag}", (side*.14, 1.65, 2.035), (.024, .035, .018), deep_wing)

# Layered spine crystals run down the back into the tail.
for i in range(9):
    y = .62 - i * .31
    height = .28 * (1 - i / 12)
    z = 1.77 - max(0, i - 4) * .08
    tapered(f"Dorsal crystal {i + 1}", (0, y, z),
            (0, y-.075, z+height), .105*(1-i/13), 0, frost)

tail_rig = empty("Tail sway", (0, -.65, 1.35), body_rig)
tail_points = [(0, 0, 0), (0, -.45, -.1), (0, -.91, -.16),
               (0, -1.35, -.15), (0, -1.73, -.02)]
for i, (a, b) in enumerate(zip(tail_points, tail_points[1:])):
    tapered(f"Tapered tail {i + 1}", a, b, .25-i*.05, .2-i*.05, armor, tail_rig)
for side in (-1, 1):
    poly(f"Tail fin {'L' if side < 0 else 'R'}",
         [(0,-1.67,0), (side*.35,-2.13,.19), (side*.13,-2.02,-.23), (0,-1.73,-.02)],
         [(0,1,2),(0,2,3)], ice, tail_rig)

# Clawed feet and arms; each claw is a separate bright ice point.
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    tapered(f"Hind leg {tag}", (side*.31,-.53,1.25),
            (side*.47,-.84,.79), .2, .11, midnight)
    sphere(f"Hind talon palm {tag}", (side*.48,-.74,.75), (.15,.21,.095), armor)
    tapered(f"Foreleg {tag}", (side*.35,.45,1.43),
            (side*.48,.7,.89), .145, .085, armor)
    sphere(f"Foreclaw palm {tag}", (side*.48,.78,.88), (.12,.17,.08), midnight)
    for i in range(3):
        x = side*(.40+i*.08)
        tapered(f"Crystal claw {tag}-{i}", (x,.86,.86),
                (x+side*.02,1.09,.78), .04, 0, frost, vertices=7)

# Broad swept wings with multiple scalloped membranes and raised spar veins.
wing_roots = []
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    hinge = empty(f"Wing hinge {tag}", (side*.35, -.1, 1.7), body_rig)
    wing_roots.append((side, hinge))
    outline = [(0,0,0), (side*.52,-.06,.13), (side*1.18,-.11,.21),
               (side*2.07,-.27,.28), (side*1.63,-.78,.08),
               (side*1.43,-1.47,-.11), (side*.94,-1.05,-.09),
               (side*.39,-1.25,-.08), (side*.22,-.51,0)]
    panels = [(0,1,8),(1,2,7),(1,7,8),(2,3,4),(2,4,5),
              (2,5,6),(2,6,7)]
    poly(f"Scalloped wing {tag}", outline, panels, wing_mat, hinge)
    for a,b in [(0,2),(2,3),(2,5),(2,7),(0,8)]:
        tapered(f"Wing vein {tag} {a}-{b}", outline[a], outline[b], .035, .013,
                deep_wing, hinge, vertices=6)
    for i in (3,5,7):
        ico(f"Wingtip frost {tag}-{i}", outline[i], (.07,.11,.085), frost, hinge)

# The click/trigger clip fans these shards out of the open mouth.
rng = random.Random(8788)
breath = []
for i in range(12):
    shard = ico(f"Frost burst shard {i+1:02d}", (0, 1.66, 1.96),
                (.075, .21, .075), breath_mat, body_rig)
    shard.scale = (.001, .001, .001)
    breath.append(shard)


def clip(obj, name, channels):
    """Store keyed object transforms under one NLA track name per GLB clip."""
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


clip(body_rig, "Flight", {"location": [(1,(0,0,0)), (13,(0,0,.13)),
                                       (25,(0,0,0)), (37,(0,0,.13)), (49,(0,0,0))]})
clip(tail_rig, "Flight", {"rotation_euler": [(1,(0,0,radians(-10))),
                                                  (13,(0,0,0)),
                                                  (25,(0,0,radians(10))),
                                                  (37,(0,0,0)),
                                                  (49,(0,0,radians(-10)))]})
for side, wing in wing_roots:
    clip(wing, "Flight", {"rotation_euler": [(1,(0,-side*radians(11),0)),
                                                (13,(0,-side*radians(35),0)),
                                                (25,(0,-side*radians(11),0)),
                                                (37,(0,side*radians(12),0)),
                                                (49,(0,-side*radians(11),0))]})
    clip(wing, "Frost Burst", {"rotation_euler": [(1,(0,-side*radians(11),0)),
                                                     (8,(0,-side*radians(45),0)),
                                                     (23,(0,-side*radians(37),0)),
                                                     (37,(0,-side*radians(11),0))]})
clip(jaw, "Frost Burst", {"rotation_euler": [(1,(0,0,0)),
                                            (7,(radians(-24),0,0)),
                                            (30,(radians(-18),0,0)),
                                            (37,(0,0,0))]})
for i, shard in enumerate(breath):
    angle = i * math.tau / len(breath)
    spread = .12 + rng.random()*.3
    end = (math.cos(angle)*spread, 1.95 + rng.random()*1.05,
           1.96 + math.sin(angle)*spread)
    start = (0, 1.66, 1.96)
    clip(shard, "Frost Burst", {
        "location": [(1,start),(8,start),(28,end),(37,end)],
        "scale": [(1,(.001,)*3),(8,(.001,)*3),
                  (12,(.07,.2,.07)),(28,(.045,.13,.045)),(37,(.001,)*3)]})

# Restore rest pose for export and include only the dragon collection.
scene.frame_set(1)
for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in art:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
glb_path = HERE / "ice-dragon.glb"
bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB",
                          use_selection=True, export_animations=True,
                          export_animation_mode="NLA_TRACKS", export_nla_strips=True,
                          export_apply=False)

# A presentation camera and lights remain in the editable .blend only.
bpy.ops.object.camera_add(location=(4.5, 6.6, 3.5))
camera = bpy.context.object
camera.name = "Preview camera"
direction = Vector((0, 0, 1.35)) - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 5.7
scene.camera = camera
for name, location, energy, color, size in [
    ("Cool key", (2.5, 4.5, 5), 950, (.47,.82,1), 4),
    ("Arctic rim", (-4,-2,4), 1350, (.09,.66,1), 3),
    ("Blue fill", (-1,5,2), 400, (.57,.84,1), 2)]:
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.color = color
    light.data.shape = "DISK"
    light.data.size = size
    light.rotation_euler = (Vector((0,0,1.3))-light.location).to_track_quat("-Z","Y").to_euler()
scene.frame_set(8)
scene.render.filepath = str(HERE / "ice-dragon-preview.png")
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "ice-dragon.blend"))
bpy.ops.render.render(write_still=True)
print(f"ICE_DRAGON_READY {glb_path}")
