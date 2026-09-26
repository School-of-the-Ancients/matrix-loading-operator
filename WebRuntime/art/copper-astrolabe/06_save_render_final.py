"""Copper Astrolabe revision: save a separate final .blend and preview PNG."""

import bpy


SCENE = bpy.context.scene
BASE = r"C:\Users\theto\Documents\Codex\2026-09-25\g\work\m1-portal-astrolabe"
INITIAL = BASE + r"\copper-astrolabe-initial.blend"
FINAL = BASE + r"\copper-astrolabe-final.blend"
PREVIEW = BASE + r"\copper-astrolabe-final.png"

if bpy.data.filepath.lower() != INITIAL.lower():
    raise RuntimeError("The open scene is not the Astrolabe initial draft")
for name in ("CA | 48-tooth brass outer ring", "CA | hand-faceted blue core",
             "CA | turquoise gem finial 1", "CA | turquoise gem finial 2",
             "CA | turquoise gem finial 3", "CA | engraved 5-degree ticks",
             "CA | cardinal label N", "CA | cardinal label E",
             "CA | cardinal label S", "CA | cardinal label W"):
    if bpy.data.objects.get(name) is None:
        raise RuntimeError("Required draft or revision object is missing: " + name)

valid_formats = [item.identifier for item in
    SCENE.render.image_settings.bl_rna.properties["file_format"].enum_items]
if "PNG" not in valid_formats:
    raise RuntimeError("PNG output is unavailable")
SCENE.render.image_settings.file_format = "PNG"
SCENE.render.image_settings.color_mode = "RGBA"
SCENE.render.resolution_x = 1400
SCENE.render.resolution_y = 1400
SCENE.render.resolution_percentage = 100
SCENE.render.filepath = PREVIEW

bpy.ops.wm.save_as_mainfile(filepath=FINAL, check_existing=False)
bpy.ops.render.render(write_still=True)

model = bpy.data.collections["Copper Astrolabe | Model"]
print("Final Astrolabe saved: " + FINAL)
print("Final preview rendered: " + PREVIEW)
print("Model objects=%d; scene objects=%d; engine=%s"
      % (len(model.objects), len(SCENE.objects), SCENE.render.engine))
