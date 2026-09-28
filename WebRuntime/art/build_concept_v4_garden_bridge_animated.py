"""Add one lantern animation to the selected Version 4 Blender bridge.

Run with Blender 5.2:
  blender -b --factory-startup --python WebRuntime/art/build_concept_v4_garden_bridge_animated.py

This opens the immutable accepted .blend and writes separately named derivatives.
The deck, rails, materials, original source, original GLB, and saved checkpoint
are left untouched. Lantern glass moves only inside its existing housing.
"""

from hashlib import sha256
from pathlib import Path

import bpy


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "concept-v4-garden-bridge.blend"
SOURCE_SHA256 = "514fd733245cc6085bba3e564ba1ac4419b1e1812c4a2c12d26a46d0abfd3268"
STEM = "concept-v4-garden-bridge-animated"
CLIP = "Lantern Pulse"
COLLECTION = "Version 4 luminous garden bridge | exported"

if sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
    raise RuntimeError("Accepted Version 4 Blender source changed; inspect it before deriving animation")

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
model = bpy.data.collections.get(COLLECTION)
if model is None:
    raise RuntimeError("Accepted bridge export collection is missing")
parts = list(model.objects)
glass = sorted((obj for obj in parts if obj.name.endswith("amber glass")),
               key=lambda obj: obj.name)
if len(glass) != 8 or len(parts) != 91:
    raise RuntimeError(f"Expected 91 original parts and 8 lantern panes; found {len(parts)} and {len(glass)}")
wood = bpy.data.images.get("Packed warm walnut plank grain")
if wood is None or wood.packed_file is None:
    raise RuntimeError("Accepted bridge's packed wood texture is missing")

scene.render.fps = 24
scene.render.fps_base = 1
scene.frame_start = 1
scene.frame_end = 49

for obj in glass:
    if obj.animation_data and (obj.animation_data.action or obj.animation_data.nla_tracks):
        raise RuntimeError(f"Lantern pane already has animation: {obj.name}")
    base_z = obj.location.z
    # The panes remain between deck and handrail across the complete cycle.
    # First and last keys match so the browser's one-clip auto-loop is seamless.
    for frame, z_offset, height_scale in (
        (1, 0, 1), (13, .08, 1.25), (25, 0, 1),
        (37, -.05, .75), (49, 0, 1),
    ):
        obj.location.z = base_z + z_offset
        obj.scale.z = height_scale
        obj.keyframe_insert(data_path="location", frame=frame, group=CLIP)
        obj.keyframe_insert(data_path="scale", frame=frame, group=CLIP)
    action = obj.animation_data.action
    action.name = f"{obj.name} - {CLIP}"
    track = obj.animation_data.nla_tracks.new()
    track.name = CLIP
    track.strips.new(CLIP, 1, action)
    obj.animation_data.action = None

scene.frame_set(1)
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]

output_blend = HERE / f"{STEM}.blend"
output_glb = HERE / f"{STEM}.glb"
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))
bpy.ops.export_scene.gltf(
    filepath=str(output_glb), export_format="GLB", use_selection=True,
    export_animations=True, export_animation_mode="NLA_TRACKS",
    export_nla_strips=True, export_apply=True,
    export_cameras=False, export_lights=False,
)
print(f"ANIMATED_BRIDGE_COMPLETE parts={len(parts)} panes={len(glass)} clip={CLIP} glb={output_glb}")
