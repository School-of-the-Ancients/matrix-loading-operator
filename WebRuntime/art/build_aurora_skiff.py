"""Build an editable animated Aurora Skiff and a self-contained Matrix GLB.

Run with Blender 5.2: blender -b --factory-startup --python build_aurora_skiff.py
The GLB has Cruise (loop) and Ion Burst (play once on selection) clips.
"""
from math import radians
from pathlib import Path

import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 20
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.frame_start = 1
scene.frame_end = 49
scene.world.color = (.012, .025, .055)


def material(name, color, metallic=0, roughness=.32, emission=None, strength=0):
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


navy = material("Midnight titanium", (.025, .065, .12), .72, .27)
silver = material("Pearl alloy", (.48, .68, .76), .64, .24)
teal = material("Aurora enamel", (.035, .44, .53), .38, .23)
dark = material("Engine graphite", (.012, .025, .045), .4, .34)
glass = material("Sapphire canopy", (.025, .28, .43), .3, .12, (.015, .12, .2), .25)
cyan = material("Ion cyan", (.2, .84, 1), .05, .18, (.05, .58, 1), 3)
flare = material("Ion plume", (.22, .76, 1), 0, .3, (.07, .46, 1), 2.3)
gold = material("Navigation amber", (1, .43, .08), .18, .25, (.9, .24, .02), 1.7)

ship = bpy.data.collections.new("Aurora Skiff - exported")
scene.collection.children.link(ship)
art = []


def add(obj, mat=None, parent=None):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    ship.objects.link(obj)
    if mat is not None:
        obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    art.append(obj)
    return obj


def empty(name, at=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    ship.objects.link(obj)
    obj.location = at
    if parent is not None:
        obj.parent = parent
    art.append(obj)
    return obj


root = empty("Skiff root")
flight_rig = empty("Flight rig", parent=root)


def mesh(name, verts, faces, mat, parent=flight_rig):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    ship.objects.link(obj)
    obj.parent = parent
    art.append(obj)
    return obj


def sphere(name, at, scale, mat, parent=flight_rig, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return add(obj, mat, parent)


def rod(name, start, end, r0, r1, mat, parent=flight_rig, vertices=12):
    start, end = Vector(start), Vector(end)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r0, radius2=r1,
                                    depth=(end-start).length, location=(start+end)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = (end-start).to_track_quat("Z", "Y").to_euler()
    return add(obj, mat, parent)


def torus(name, at, major, minor, mat, parent=flight_rig):
    bpy.ops.mesh.primitive_torus_add(major_segments=28, minor_segments=8,
                                     location=at, major_radius=major, minor_radius=minor)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler.x = radians(90)
    return add(obj, mat, parent)


# Eight-sided tapered fuselage, long needle nose, armored spine, and glazed cockpit.
rings = [(-1.65, .18, .13, 1.35), (-1.3, .38, .22, 1.36),
         (-.55, .48, .27, 1.38), (.45, .43, .26, 1.40),
         (1.25, .25, .17, 1.42), (2.15, .015, .02, 1.43)]
verts = []
for y, width, height, z in rings:
    verts.extend([(width, y, z), (width*.7, y, z+height),
                  (0, y, z+height*1.2), (-width*.7, y, z+height),
                  (-width, y, z), (-width*.7, y, z-height),
                  (0, y, z-height*1.1), (width*.7, y, z-height)])
faces = [tuple(reversed(range(8)))]
for i in range(len(rings)-1):
    for j in range(8):
        faces.append((i*8+j, i*8+(j+1)%8, (i+1)*8+(j+1)%8, (i+1)*8+j))
faces.append(tuple((len(rings)-1)*8+j for j in range(8)))
mesh("Faceted titanium fuselage", verts, faces, navy)
sphere("Panoramic sapphire canopy", (0, .55, 1.67), (.31, .64, .18), glass)
rod("Canopy center spar", (0, -.12, 1.81), (0, 1.22, 1.64), .026, .012, silver)
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    rod(f"Canopy rail {tag}", (side*.27, -.1, 1.63),
        (side*.16, 1.13, 1.59), .03, .013, silver)
    rod(f"Bow highlight {tag}", (side*.09, 1.55, 1.49),
        (side*.015, 2.21, 1.44), .045, .005, teal)

# Hinged swept wings: their pivot transforms become visible in both clips.
wing_rigs = []
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    pivot = empty(f"Wing pivot {tag}", (side*.40, -.20, 1.35), flight_rig)
    wing_rigs.append((side, pivot))
    wing = [(0, .43, .04), (side*.48, .23, .08), (side*1.55, -.33, .05),
            (side*2.18, -1.12, .015), (side*1.06, -1.06, .02),
            (side*.15, -.62, .01)]
    mesh(f"Swept wing {tag}", wing, [(0, 1, 5), (1, 4, 5), (1, 2, 4), (2, 3, 4)], silver, pivot)
    mesh(f"Aurora wing inset {tag}",
         [(side*.44, .08, .092), (side*1.34, -.39, .064),
          (side*1.76, -.98, .031), (side*.92, -.77, .045)],
         [(0, 1, 2, 3)], teal, pivot)
    rod(f"Wing leading edge {tag}", (0, .43, .065),
        (side*2.18, -1.12, .025), .044, .015, navy, pivot)
    sphere(f"Wingtip beacon {tag}", (side*2.12, -1.12, .04),
           (.07, .07, .055), cyan if side < 0 else gold, pivot, 12, 8)
    mesh(f"Ventral stabilizer {tag}",
         [(side*.85, -.98, 1.28), (side*1.16, -1.64, 1.20),
          (side*.79, -1.35, .83)], [(0, 1, 2)], teal)

# Twin ion nacelles, articulated light cones, and a retracting jump halo.
plumes = []
for side in (-1, 1):
    tag = "L" if side < 0 else "R"
    x = side*.78
    sphere(f"Ion nacelle {tag}", (x, -1.05, 1.27), (.25, .68, .23), dark)
    rod(f"Engine fairing {tag}", (x, -.75, 1.27), (x, -1.57, 1.27),
        .21, .18, navy)
    torus(f"Bright exhaust collar {tag}", (x, -1.55, 1.27), .18, .045, silver)
    sphere(f"Ion core {tag}", (x, -1.60, 1.27), (.15, .06, .15), cyan)
    plume_rig = empty(f"Plume rig {tag}", (x, -1.62, 1.27), flight_rig)
    plume = rod(f"Ion plume {tag}", (0, 0, 0), (0, -.78, 0),
                .16, .005, flare, plume_rig, 16)
    plumes.append(plume_rig)

halo_rig = empty("Jump halo rig", (0, -1.75, 1.38), flight_rig)
torus("Jump halo", (0, 0, 0), .64, .035, cyan, halo_rig)
halo_rig.scale = (.001, .001, .001)
rod("Dorsal antenna", (0, -1.05, 1.57), (0, -1.42, 2.0), .04, .007, silver)
sphere("Amber comm light", (0, -1.43, 2.01), (.07, .07, .07), gold,
       flight_rig, 12, 8)


def clip(obj, name, channels):
    """Place transform keys in one named NLA track for one exported GLB clip."""
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


clip(flight_rig, "Cruise", {
    "location": [(1, (0, 0, 0)), (13, (0, 0, .085)),
                 (25, (0, 0, 0)), (37, (0, 0, -.045)), (49, (0, 0, 0))],
    "rotation_euler": [(1, (0, 0, radians(-2))),
                       (25, (0, 0, radians(2))),
                       (49, (0, 0, radians(-2)))]})
clip(flight_rig, "Ion Burst", {
    "location": [(1, (0, 0, 0)), (9, (0, -.18, .16)),
                 (22, (0, .28, .3)), (37, (0, 0, 0))],
    "rotation_euler": [(1, (0, 0, 0)), (12, (radians(11), 0, 0)),
                       (29, (radians(5), 0, 0)), (37, (0, 0, 0))]})
for side, pivot in wing_rigs:
    clip(pivot, "Cruise", {"rotation_euler": [
        (1, (0, -side*radians(4), 0)),
        (25, (0, side*radians(5), 0)),
        (49, (0, -side*radians(4), 0))]})
    clip(pivot, "Ion Burst", {"rotation_euler": [
        (1, (0, -side*radians(4), 0)),
        (12, (0, side*radians(25), 0)),
        (28, (0, side*radians(20), 0)),
        (37, (0, -side*radians(4), 0))]})
for plume in plumes:
    clip(plume, "Cruise", {"scale": [
        (1, (1, .65, 1)), (13, (1, 1.05, 1)),
        (25, (1, .68, 1)), (37, (1, 1.1, 1)), (49, (1, .65, 1))]})
    clip(plume, "Ion Burst", {"scale": [
        (1, (1, .65, 1)), (7, (1, .28, 1)),
        (16, (1.25, 2.3, 1.25)), (28, (1.16, 1.8, 1.16)),
        (37, (1, .65, 1))]})
clip(halo_rig, "Ion Burst", {"scale": [
    (1, (.001, .001, .001)), (7, (.001, .001, .001)),
    (16, (1, 1, 1)), (27, (1.5, 1.5, 1.5)),
    (37, (.001, .001, .001))]})

scene.frame_set(1)
for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in art:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=str(HERE / "aurora-skiff.glb"), export_format="GLB",
                          use_selection=True, export_animations=True,
                          export_animation_mode="NLA_TRACKS", export_nla_strips=True,
                          export_apply=False)

# Studio lighting and camera are editable Blender-only presentation content.
bpy.ops.object.camera_add(location=(5.2, 6.5, 4.2))
camera = bpy.context.object
camera.name = "Preview camera"
camera.rotation_euler = (Vector((0, 0, 1.35)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 6.4
scene.camera = camera
for name, at, energy, color, size in [
    ("Ice key", (3.2, 2.6, 6), 1100, (.43, .78, 1), 5),
    ("Warm rim", (-3.4, -2.1, 4.7), 950, (1, .64, .32), 4),
    ("Blue fill", (1, -5, 2.5), 700, (.08, .33, 1), 4)]:
    bpy.ops.object.light_add(type="AREA", location=at)
    lamp = bpy.context.object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.color = color
    lamp.data.shape = "DISK"
    lamp.data.size = size
    lamp.rotation_euler = (Vector((0, 0, 1.3)) - lamp.location).to_track_quat("-Z", "Y").to_euler()
scene.render.filepath = str(HERE / "aurora-skiff-preview.png")
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "aurora-skiff.blend"))
bpy.ops.render.render(write_still=True)
