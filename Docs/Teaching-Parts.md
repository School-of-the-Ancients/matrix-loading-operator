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

Controller rays stop on virtual model surfaces as well as panels. Hovering shows
the nearest eligible part; clicking/trigger selection retains its identity.
The part under the pointer (or retained selection) when a recording ends is saved
as `partReference` with the learner's exact words. A later pointer move cannot
rewrite that reference while transcription or teaching runs. The teacher checks
it against the current part catalog before answering questions such as “Is this
the shaft?” A missing or changed target must be clarified, not guessed.

This is geometry/metadata grounding, not camera vision or a scientific simulator.
Author descriptions remain claims; the teacher should separate intended function,
general principles and unsupported details. The existing aerial-screw annotation
describes its canvas, axle, handles, supports and platform and explicitly states
that only rotation is animated, without airflow or lift simulation.

The annotation API is `POST /api/web/assets/parts` with
`{assetId, expectedSha256, parts}` behind the existing same-origin authorization.
Native concept-image turns cannot write annotations. No executable code, URLs or
file paths are accepted in the part data. Part selection and guides are presentation
state, not permission to move an object or score a learner's understanding.
