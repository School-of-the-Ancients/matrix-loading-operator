"""Copper Astrolabe first draft, phase 3: separate studio preview stage."""

import bpy
from mathutils import Vector


SCENE = bpy.context.scene
STAGE = bpy.data.collections.get("Copper Astrolabe | Preview Stage")
if STAGE is None or bpy.data.objects.get("CA | hand-faceted blue core") is None:
    raise RuntimeError("Model phases are incomplete; refusing to stage preview")
if len(STAGE.objects) != 0:
    raise RuntimeError("Preview stage is already populated; refusing to duplicate it")


def stage_object(obj):
    STAGE.objects.link(obj)
    return obj


def point_at(obj, xyz):
    direction = Vector(xyz) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


world = SCENE.world
if world is None:
    world = bpy.data.worlds.new("CA | midnight studio world")
    SCENE.world = world
world.use_nodes = True
background = next((node for node in world.node_tree.nodes
                   if node.type == "BACKGROUND"), None)
if background is not None:
    background.inputs["Color"].default_value = (0.016, 0.024, 0.050, 1.0)
    background.inputs["Strength"].default_value = 0.42

floor_mat = bpy.data.materials.new("CA | midnight preview floor")
floor_mat.use_nodes = True
floor_mat.diffuse_color = (0.018, 0.027, 0.047, 1.0)
floor_shader = next(node for node in floor_mat.node_tree.nodes
                    if node.type == "BSDF_PRINCIPLED")
floor_shader.inputs["Base Color"].default_value = (0.018, 0.027, 0.047, 1.0)
floor_shader.inputs["Metallic"].default_value = 0.12
floor_shader.inputs["Roughness"].default_value = 0.42

floor_mesh = bpy.data.meshes.new("CA | floor preview mesh")
floor_mesh.from_pydata([(-20, -20, 0), (20, -20, 0),
                        (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
floor_mesh.update()
floor = stage_object(bpy.data.objects.new("CA | preview floor", floor_mesh))
floor.data.materials.append(floor_mat)

camera_data = bpy.data.cameras.new("CA | preview camera data")
camera = stage_object(bpy.data.objects.new("CA | preview camera", camera_data))
camera.location = (3.35, -6.5, 3.25)
point_at(camera, (0, 0, 1.63))
camera_data.type = "ORTHO"
camera_data.ortho_scale = 4.08
SCENE.camera = camera


def area_light(name, location, target, energy, size, color):
    data = bpy.data.lights.new(name + " data", "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = stage_object(bpy.data.objects.new(name, data))
    obj.location = location
    point_at(obj, target)
    return obj


area_light("CA | warm brass key", (3.2, -3.8, 5.2), (0, 0, 1.6),
           650, 4.0, (1.0, 0.76, 0.52))
area_light("CA | cool facet fill", (-3.8, -2.7, 2.4), (0, 0, 1.6),
           470, 3.3, (0.43, 0.64, 1.0))
area_light("CA | copper rim", (-0.7, 3.0, 4.5), (0, 0, 1.7),
           820, 3.0, (1.0, 0.62, 0.29))

SCENE.render.resolution_x = 1024
SCENE.render.resolution_y = 1024
SCENE.render.resolution_percentage = 100
SCENE.render.film_transparent = False

for area in bpy.context.screen.areas:
    if area.type == "VIEW_3D":
        area.spaces.active.region_3d.view_perspective = "CAMERA"

print("Copper Astrolabe phase 3: studio stage ready; engine=" + SCENE.render.engine)
