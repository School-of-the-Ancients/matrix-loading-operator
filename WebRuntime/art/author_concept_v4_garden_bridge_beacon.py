"""Add a new Lantern Beacon clip to the verified static Version 4 bridge.

Run with Blender 5.2 in background mode from a factory startup scene:
    blender -b --factory-startup --python work/quest91-agent-v4/author_lantern_beacon.py

The static source is hash checked before Blender opens it. Only the eight
existing amber lantern glass meshes receive animation. The bridge mesh,
materials, packed wood texture, and studio setup are retained in the new
editable file. The GLB contains only the original bridge collection.
"""

from hashlib import sha256
from pathlib import Path

import bpy


OUTPUT_DIR = Path(__file__).resolve().parent
REPO_ROOT = OUTPUT_DIR.parent.parent
SOURCE = REPO_ROOT / "WebRuntime" / "art" / "concept-v4-garden-bridge.blend"
SOURCE_SHA256 = "514fd733245cc6085bba3e564ba1ac4419b1e1812c4a2c12d26a46d0abfd3268"
BLEND = OUTPUT_DIR / "concept-v4-garden-bridge-beacon.blend"
GLB = OUTPUT_DIR / "concept-v4-garden-bridge-beacon.glb"
BRIDGE_COLLECTION = "Version 4 luminous garden bridge | exported"
CLIP = "Lantern Beacon"


def file_sha256(path):
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if bpy.app.version[:2] != (5, 2):
    raise RuntimeError(f"Blender 5.2 required, got {bpy.app.version_string}")
if file_sha256(SOURCE) != SOURCE_SHA256:
    raise RuntimeError("Static source SHA-256 mismatch; Blender source was not opened")
if BLEND.exists() or GLB.exists():
    raise RuntimeError("Refusing to overwrite an existing derivative")

# The hash check above happens before opening the only allowed Blender source.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
if Path(bpy.data.filepath).resolve() != SOURCE.resolve():
    raise RuntimeError("Blender opened an unexpected source")

collection = bpy.data.collections.get(BRIDGE_COLLECTION)
if collection is None:
    raise RuntimeError("Expected exported bridge collection is missing")
bridge_meshes = [obj for obj in collection.all_objects if obj.type == "MESH"]
lanterns = sorted(
    (obj for obj in bridge_meshes
     if obj.name.endswith("inner amber glass") or obj.name.endswith("outer amber glass")),
    key=lambda obj: obj.name,
)
if len(lanterns) != 8:
    raise RuntimeError(f"Expected eight existing amber glass panes, found {len(lanterns)}")
if any(obj.animation_data and obj.animation_data.action for obj in bridge_meshes):
    raise RuntimeError("Static bridge already has animation")
wood_image = bpy.data.images.get("Packed warm walnut plank grain")
if wood_image is None or wood_image.packed_file is None:
    raise RuntimeError("Static bridge packed wood texture is missing")

# Four lanterns share one clip, with near/far posts alternating phase. Scale
# changes only 4% in Z and returns to the rest pose at the loop boundary.
scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start = 1
scene.frame_end = 61
frames = (1, 16, 31, 46, 61)
for obj in lanterns:
    baseline = tuple(obj.scale)
    factors = (1.0, 1.04, 1.0, 0.96, 1.0)
    if " far lantern " in obj.name:
        factors = (1.0, 0.96, 1.0, 1.04, 1.0)
    for frame, factor in zip(frames, factors):
        obj.scale = (baseline[0], baseline[1], baseline[2] * factor)
        obj.keyframe_insert(data_path="scale", frame=frame, group=CLIP)
    action = obj.animation_data.action
    if action is None:
        raise RuntimeError(f"Could not create action for {obj.name}")
    action.name = f"{CLIP} | {obj.name}"
    track = obj.animation_data.nla_tracks.new()
    track.name = CLIP
    strip = track.strips.new(CLIP, frames[0], action)
    strip.blend_type = "REPLACE"
    strip.extrapolation = "HOLD"
    obj.animation_data.action = None
    obj.scale = baseline

scene.frame_set(1)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

bpy.ops.object.select_all(action="DESELECT")
for obj in bridge_meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = bridge_meshes[0]
bpy.ops.export_scene.gltf(
    filepath=str(GLB),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_merge_animation="NLA_TRACK",
    export_nla_strips=True,
    export_cameras=False,
    export_lights=False,
    export_apply=True,
)
print(f"BEACON_BUILD_COMPLETE blend={BLEND} glb={GLB} panes={len(lanterns)}")
