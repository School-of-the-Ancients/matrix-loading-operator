# Part-aware teaching

Registered Blender/GLB exhibits expose named model nodes as teaching targets to
any bound School professor. New imports and existing catalog entries receive this
inventory automatically. A name identifies geometry; it does not establish its
purpose, historical accuracy, physical operation or safety.

For useful explanations, author meaningful parts and concise descriptions.
Keep important components as separate named meshes where practical. A node may
include `extras.matrixPart` with `partId`, `label` and `description`; registration
validates these fields. The default inventory is limited to 64 parts per asset.

The PC Operator can also call `matrix_annotate_asset_parts(asset_id,
expected_sha256, parts)` after inspecting the exported file. Each entry includes
`partId`, `label`, `nodeIndex` and optional `primitiveIndex`, `description` and
`localPoint: {x,y,z}`. Node/primitive indices refer to the exported glTF, and points
use glTF node-local metres (Y-up), not unconverted Blender coordinates. Existing
GLB bytes, asset IDs, object transforms and animation bindings remain unchanged.
Annotations live in the local asset manifest, with a content revision that
invalidates old pointing cues when descriptions/targets change.

A joined mesh can expose submesh/material primitives or explicit landmarks.
Landmark selection applies within 35 cm of that node-local point; it is not
automatic semantic segmentation. Outside that range the actual mesh name remains
the target. Prefer separate meshes for accurate selection over a whole component.

The Professor receives object/part IDs, labels, descriptions and provenance.
It returns a validated `avatarAction` with an optional `partId`. Matrix resolves
the live model node after animation and transforms, turns the professor toward
it, and points. Highlight, arrow and label follow the same live target for the
spoken reply. Teaching guides can be set to both, highlight, arrow or hand only.

Controller rays stop on virtual model surfaces as well as panels. Hovering only
previews a part. Press A on the right controller or X on the left to select that
controller's pointed part; press B or Y to clear it. The selected name stays in
the AR controls and its highlight stays on the part as either pointer moves.
Selection is independent of editing: trigger still grabs, grip still records
speech, and the thumbstick button still controls the Operator panel. Selecting a
part never moves the object or starts its animation clip. The PC controls also
include a clear-selection button.
Floating name labels and other presentation sprites are excluded from world
picking. VRM avatars use a transformed body envelope for pointer hits, avoiding
per-frame skin-triangle intersection on standalone headsets; exhibit parts still
use their actual mesh surfaces.
Only the explicitly selected part when a recording ends is saved as
`partReference` with the learner's exact words. With no selection, hover contributes
no part reference. A later pointer move cannot rewrite that reference while
transcription or teaching runs. The teacher checks
it against the current part catalog before answering questions such as “Is this
the shaft?” A missing or changed target must be clarified, not guessed.

## Exact surface points and selected-view vision

A/X also pins unnamed geometry, retaining the hit's node/primitive-local point.
The marker follows that point through object transforms and node animation.
B/Y clears both the named part and the surface point. Trigger remains grab.
Named parts are helpful descriptions, not a prerequisite for selecting a point.

Selection captures one 960×720 virtual view with a yellow crosshair at that
point, using the existing virtual-frame renderer. The selected-view checkbox
controls whether this image accompanies the next Professor request. The scene
is rendered without the physical passthrough camera. If the point is outside
the view, the UI asks the wearer to look at it and select again instead of
silently capturing something else. Selecting a new point replaces the image;
the recording's reference and image are frozen when recording ends.

School validates the selected object, image identity, dimensions and bounded
JPEG data. It sends the image through native Codex image input in the same
teaching turn, with the existing tool restrictions. The temporary image is
deleted after the process finishes; only the point reference and conversation
remain in the learner archive. No image is sent merely by hovering or selecting.
Images may add model latency and subscription usage. This is snapshot vision,
not continuous live vision, camera passthrough, automatic segmentation or proof
of hidden mechanisms. A teacher can describe visible form and explain likely
function, while distinguishing uncertain inference from established facts.

The professor can return a whole-object point cue for the selected object; its
saved surface target then supplies the exact moving point. An explicit named
part cue continues to target that named part. Replaced assets or missing nodes
invalidate a target rather than moving the marker to an unrelated location.

This is geometry/metadata and snapshot grounding, not a scientific simulator.
Author descriptions remain claims; the teacher should separate intended function,
general principles and unsupported details. The existing aerial-screw annotation
describes its canvas, axle, handles, supports and platform and explicitly states
that only rotation is animated, without airflow or lift simulation.

The annotation API is `POST /api/web/assets/parts` with
`{assetId, expectedSha256, parts}` behind the existing same-origin authorization.
Native concept-image turns cannot write annotations. No executable code, URLs or
file paths are accepted in the part data. Part selection and guides are presentation
state, not permission to move an object or score a learner's understanding.
