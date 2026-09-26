"""Export the revised Astrolabe model collection as a self-contained GLB.

Executed via Blender MCP in the open final GUI scratch scene. Temporary
evaluated mesh copies include curves and text; the saved .blend is unchanged.
"""

import bpy


SCENE = bpy.context.scene
BASE = r"C:\Users\theto\Documents\Codex\2026-09-25\g\work\m1-portal-astrolabe"
FINAL = BASE + r"\copper-astrolabe-final.blend"
GLB = BASE + r"\copper-astrolabe-final.glb"
if bpy.data.filepath.lower() != FINAL.lower():
    raise RuntimeError("Active Blender file is not the Astrolabe final scratch scene")
model = bpy.data.collections.get("Copper Astrolabe | Model")
stage = bpy.data.collections.get("Copper Astrolabe | Preview Stage")
if model is None or stage is None:
    raise RuntimeError("Astrolabe model or separate preview stage is missing")
if len(model.objects) != 51:
    raise RuntimeError("Unexpected model object count; refusing to export")
if any(obj.type not in ("MESH", "CURVE", "FONT") for obj in model.objects):
    raise RuntimeError("Model collection contains a non-geometry object")
if bpy.data.collections.get("CA | temporary GLB export") is not None:
    raise RuntimeError("A temporary export collection already exists")

properties = bpy.ops.export_scene.gltf.get_rna_type().properties
valid_material_modes = [item.identifier for item in
    properties["export_materials"].enum_items]
if "EXPORT" not in valid_material_modes:
    raise RuntimeError("GLB material export mode is unavailable")
# Blender 5.2 exposes export_format as a dynamic enum with no RNA items;
# Blender MCP's GLB contract and the operator itself validate "GLB".

temp_collection = bpy.data.collections.new("CA | temporary GLB export")
SCENE.collection.children.link(temp_collection)
before_selection = tuple(bpy.context.selected_objects)
before_active = bpy.context.view_layer.objects.active
temporary_objects = []
dg = bpy.context.evaluated_depsgraph_get()

try:
    for source in model.objects:
        evaluated = source.evaluated_get(dg)
        mesh = bpy.data.meshes.new_from_object(evaluated,
            preserve_all_data_layers=True, depsgraph=dg)
        if mesh is None or len(mesh.vertices) == 0:
            raise RuntimeError("No evaluated geometry for " + source.name)
        copy = bpy.data.objects.new(source.name + " | GLB", mesh)
        temp_collection.objects.link(copy)
        copy.matrix_world = source.matrix_world.copy()
        temporary_objects.append(copy)

    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in temporary_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = temporary_objects[0]

    result = bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError("Blender GLB exporter did not finish: " + str(result))
    print("Blender MCP safe-mode bpy.ops.export_scene.gltf: " + str(result))
    print("GLB path=" + GLB)
    print("Evaluated model-only mesh objects=" + str(len(temporary_objects)))
    print("Preview floor, camera and lights were excluded")
finally:
    for obj in temporary_objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    bpy.data.collections.remove(temp_collection)
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in before_selection:
        if obj.name in bpy.data.objects:
            obj.select_set(True)
    if before_active is not None and before_active.name in bpy.data.objects:
        bpy.context.view_layer.objects.active = before_active
