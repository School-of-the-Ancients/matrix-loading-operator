"""Copper Astrolabe first draft, phase 4: save editable scene and PNG."""

import bpy


SCENE = bpy.context.scene
if bpy.data.objects.get("CA | 48-tooth brass outer ring") is None:
    raise RuntimeError("Custom toothed ring is missing")
if bpy.data.objects.get("CA | hand-faceted blue core") is None:
    raise RuntimeError("Faceted core is missing")
if SCENE.camera is None:
    raise RuntimeError("Preview camera is missing")

BASE = r"C:\Users\theto\Documents\Codex\2026-09-25\g\work\m1-portal-astrolabe"
BLEND = BASE + r"\copper-astrolabe-initial.blend"
PREVIEW = BASE + r"\copper-astrolabe-initial.png"

valid_formats = [item.identifier for item in
    SCENE.render.image_settings.bl_rna.properties["file_format"].enum_items]
if "PNG" not in valid_formats:
    raise RuntimeError("PNG output is unavailable in this Blender instance")
SCENE.render.image_settings.file_format = "PNG"
SCENE.render.image_settings.color_mode = "RGBA"
SCENE.render.filepath = PREVIEW

# The model and preview rig remain in separate collections inside the .blend.
bpy.ops.wm.save_as_mainfile(filepath=BLEND, check_existing=False)
bpy.ops.render.render(write_still=True)

model = bpy.data.collections["Copper Astrolabe | Model"]
mesh_objects = [obj for obj in model.objects if obj.type == "MESH"]
verts = sum(len(obj.data.vertices) for obj in mesh_objects)
faces = sum(len(obj.data.polygons) for obj in mesh_objects)
print("Saved initial draft: blend=" + BLEND + "; preview=" + PREVIEW)
print("Model objects=%d, mesh objects=%d, source mesh vertices=%d, source faces=%d"
      % (len(model.objects), len(mesh_objects), verts, faces))
