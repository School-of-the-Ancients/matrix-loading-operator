"""Author Lantern Beacon Strong from the hash-bound tracked Beacon .blend.

Run with Blender 5.2, for example:
    blender -b --factory-startup --python WebRuntime/art/author_lantern_beacon_strong.py

This script also works after it is copied to WebRuntime/art. Its only Blender
input is the tracked Beacon .blend. It refuses to replace either output.
"""

from hashlib import sha256
from pathlib import Path

import bpy


SOURCE_NAME = "concept-v4-garden-bridge-beacon.blend"
SOURCE_SHA256 = "a78b02aa55c8ebbb69a305d6a24c608567d3b331c7782337c87627ea3b98c6fb"
BRIDGE_COLLECTION = "Version 4 luminous garden bridge | exported"
CLIP = "Lantern Beacon Strong"


def file_hash(path):
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


script_path = Path(__file__).resolve()
repo_root = next(
    (
        folder for folder in (script_path.parent, *script_path.parents)
        if (folder / "WebRuntime" / "art" / SOURCE_NAME).is_file()
    ),
    None,
)
if repo_root is None:
    raise RuntimeError("Could not locate the tracked Beacon source from this script location")
source = repo_root / "WebRuntime" / "art" / SOURCE_NAME
output_dir = repo_root / "work" / "quest91-agent-v4"
blend_output = output_dir / "concept-v4-garden-bridge-beacon-strong.blend"
glb_output = output_dir / "concept-v4-garden-bridge-beacon-strong.glb"

if bpy.app.version[:2] != (5, 2):
    raise RuntimeError(f"Blender 5.2 required; found {bpy.app.version_string}")
if file_hash(source) != SOURCE_SHA256:
    raise RuntimeError("Tracked Beacon source SHA-256 mismatch; source was not opened")
output_dir.mkdir(parents=True, exist_ok=True)
if blend_output.exists() or glb_output.exists():
    raise RuntimeError("Refusing to overwrite an existing strong Beacon output")

# Do not open any other .blend. The source hash was checked first.
bpy.ops.wm.open_mainfile(filepath=str(source))
if Path(bpy.data.filepath).resolve() != source.resolve():
    raise RuntimeError("Blender opened an unexpected source")

collection = bpy.data.collections.get(BRIDGE_COLLECTION)
if collection is None:
    raise RuntimeError("Expected bridge collection is missing")
bridge_meshes = sorted(
    (obj for obj in collection.all_objects if obj.type == "MESH"),
    key=lambda obj: obj.name,
)
lanterns = [
    obj for obj in bridge_meshes
    if obj.name.endswith("inner amber glass") or obj.name.endswith("outer amber glass")
]
if len(lanterns) != 8:
    raise RuntimeError(f"Expected eight existing amber glass panes; found {len(lanterns)}")
wood_image = bpy.data.images.get("Packed warm walnut plank grain")
if wood_image is None or wood_image.packed_file is None:
    raise RuntimeError("Packed wood texture is missing")

# Clear the old Beacon actions and NLA playback in the NEW in-memory copy.
# Mesh data, materials, and every non-animated object transform stay intact.
original_geometry = {
    obj.name: (
        len(obj.data.vertices),
        len(obj.data.polygons),
        tuple(slot.material.name if slot.material else None for slot in obj.material_slots),
    ) for obj in bridge_meshes
}
original_transforms = {
    obj.name: tuple(tuple(row) for row in obj.matrix_world)
    for obj in bridge_meshes if obj not in lanterns
}
rest = {obj.name: (tuple(obj.location), tuple(obj.scale)) for obj in lanterns}
for obj in bridge_meshes:
    if obj.animation_data:
        obj.animation_data_clear()
for action in list(bpy.data.actions):
    if action.name.startswith("Lantern Beacon | "):
        bpy.data.actions.remove(action, do_unlink=True)

scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start = 1
scene.frame_end = 61
frames = (1, 16, 31, 46, 61)
for obj in lanterns:
    base_location, base_scale = rest[obj.name]
    # Opposite post phases make the stronger 22% pane height pulse and 6.5 cm
    # vertical bob easy to see while both ends of the loop return to rest.
    phase = -1.0 if " far lantern " in obj.name else 1.0
    height_factors = (1.0, 1.0 + phase * 0.22, 1.0,
                      1.0 - phase * 0.20, 1.0)
    vertical_offsets = (0.0, phase * 0.065, 0.0,
                        -phase * 0.065, 0.0)
    for frame, height_factor, offset in zip(frames, height_factors, vertical_offsets):
        obj.scale = (base_scale[0], base_scale[1], base_scale[2] * height_factor)
        obj.location = (base_location[0], base_location[1], base_location[2] + offset)
        obj.keyframe_insert(data_path="scale", frame=frame, group=CLIP)
        obj.keyframe_insert(data_path="location", frame=frame, group=CLIP)
    action = obj.animation_data.action
    if action is None:
        raise RuntimeError(f"No action created for {obj.name}")
    action.name = f"{CLIP} | {obj.name}"
    track = obj.animation_data.nla_tracks.new()
    track.name = CLIP
    strip = track.strips.new(CLIP, frames[0], action)
    strip.blend_type = "REPLACE"
    strip.extrapolation = "HOLD"
    obj.animation_data.action = None
    obj.location = base_location
    obj.scale = base_scale

scene.frame_set(1)
if {
    obj.name: (
        len(obj.data.vertices),
        len(obj.data.polygons),
        tuple(slot.material.name if slot.material else None for slot in obj.material_slots),
    ) for obj in bridge_meshes
} != original_geometry:
    raise RuntimeError("Bridge mesh or material assignment changed")
if {
    obj.name: tuple(tuple(row) for row in obj.matrix_world)
    for obj in bridge_meshes if obj not in lanterns
} != original_transforms:
    raise RuntimeError("A non-lantern bridge transform changed")
if wood_image.packed_file is None:
    raise RuntimeError("Packed wood texture was lost")
if any(obj.animation_data and obj.animation_data.nla_tracks
       for obj in bridge_meshes if obj not in lanterns):
    raise RuntimeError("Unexpected non-lantern animation remains")
if any(len(obj.animation_data.nla_tracks) != 1 or
       obj.animation_data.nla_tracks[0].name != CLIP for obj in lanterns):
    raise RuntimeError("Expected exactly one strong clip per amber pane")

# Avoid Blender's .blend1 backup and save only the new editable derivative.
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(blend_output))

bpy.ops.object.select_all(action="DESELECT")
for obj in bridge_meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = bridge_meshes[0]
bpy.ops.export_scene.gltf(
    filepath=str(glb_output),
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
print(f"LANTERN_BEACON_STRONG_COMPLETE panes={len(lanterns)} "+
      f"blend={blend_output} glb={glb_output}")
