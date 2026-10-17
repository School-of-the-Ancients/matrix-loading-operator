# #91: stronger Agent-authored Beacon derivative

This is a continuation of the same selected Version 4 concept and saved Agent
conversation used in [the first Agent-authored Beacon](Concept-91-Agent-Authored-Beacon-2026-09-28.md).
It runs only against the copied `19870` service. The prior five copied objects,
the original static bridge, the manually animated `Lantern Pulse` bridge, and
the first Beacon source and asset remain intact.

The new native turn `01a0e6bb-642b-7711-8842-832966194c1a` has Blender
creation mode and build request `d3b3bf96849b45cd8b5f13045d4f7d54` for
selected concept `4ecf4c7e86b34493b9a5502e381e4759`. Its actual
multimodal `input_image` decoded to one 2,144,296-byte PNG with SHA-256
`3ab3bf0cbb35dd2c44b5e2f4f41a5be24208eb35fdc41b351c3e1a1d0499dbc4`,
exactly matching the selected Version 4 image on disk. The Agent authored a
new script that checks the tracked first Beacon `.blend` SHA-256
`a78b02aa55c8ebbb69a305d6a24c608567d3b331c7782337c87627ea3b98c6fb`
before opening it and writes distinct derivative files without replacing the
earlier sources. The ignored scratch script SHA-256 is
`4fb695cd3f3759c15e21c066c0a458a56a9a401eba9cda769887b10ab7131d7f`.
The [tracked script](../WebRuntime/art/author_lantern_beacon_strong.py) differs
only in packaging changes that create its ignored output directory on a fresh
checkout and give a tracked invocation path while retaining overwrite refusal
(SHA-256 `69014c88b31419f20ab5726b7cd7b14e13f936e01d2dcbafae3f9f5bf79edbd3`).

The new editable [`.blend`](../WebRuntime/art/concept-v4-garden-bridge-beacon-strong.blend)
has SHA-256 `24fa1be2d4bcc636097b41601030ef4cbc394e045426acf0306b65b2a3823725`
and opens in Blender under the bounded, script-disabled source check. The
self-contained [GLB](../WebRuntime/art/concept-v4-garden-bridge-beacon-strong.glb)
has SHA-256 `7fcc4aa068bd7a18448835438e9a7c54267f79459ffd3860d73796ca3bd1c3ec`,
1,282,916 bytes, 91 meshes, 40,072 vertices, one embedded image, and one
2.0333-second `Lantern Beacon Strong` clip. It contains 16 tracks: location
and scale on each of eight amber glass panes. The clip loops back to its
start pose. Its mesh payloads and non-pane transforms match the earlier
Beacon GLB.

At 0.5 seconds, Three.js GLTFLoader/Matrix mixer measurements of one amber
pane show +9.34 cm height and +6.42 cm center rise. The earlier Agent Beacon
changed height by 1.70 cm with no center rise; the separately Quest-confirmed
manual `Lantern Pulse` changed height by 10.54 cm and center by 7.84 cm. At a
proposed `(0, 0, -5)` pose the pane would be about 4.69 m from the starting
eye, where the strong change subtends about 1.14° height and 0.78° bob.
The new browser regression test loads this exact GLB and checks more than
8 cm of height change and 5 cm of bob. WebRuntime passed **636/636** tests and
the production Vite build passed with the existing large-chunk warning.

Reviewed native `matrix_register_glb` registered asset
`web:luminous-garden-bridge-v4-beacon-strong:7fcc4aa068bd` with the exact
GLB digest above. The catalog and browser independently listed its 91 meshes,
embedded image, and named Strong clip. Typed `matrix_spawn_asset` receipt
`ff9cc06b61ae488bbee66181a3cf8743` succeeded for new object
`48ef258727f04b2b9564014edef5e438` at `(0, 0, -5)`, zero rotation,
unit scale. The five original copied object IDs and poses were unchanged.
Separate typed animation receipt `d6d745c315d744c3ae23448fef69b4c3`
succeeded; fresh scene revision 7 showed
`{loopClip: "Lantern Beacon Strong", selectClip: null}` on that same object.

Durable Blender-mode ConceptStore build request
`d3b3bf96849b45cd8b5f13045d4f7d54` completed for selected Version 4. It
links the selected image, the tracked parent Beacon `.blend`, new scratch
script/`.blend`/GLB source paths, registered asset, new object, and successful
creation receipt. Its build receipt field accepts one creation receipt for
one new object; the animation-bind receipt remains separate typed evidence.
The Agent's first recording attempt was rejected because it supplied both
receipts and an overlong strategy; the corrected record succeeded without a
duplicate spawn or world mutation.

The [named six-object checkpoint](concept-91-agent-strong-beacon-world-checkpoint.json)
is 5,403 bytes with SHA-256
`190a445f80d1c15aa22c87c261e4570a0d97be273fad02647e6ebde813e40e1c`.
It pins the four GLB dependency hashes and both Beacon loop bindings without
including credentials or private paths. After restarting only the copied
`19870` service, the named checkpoint matched byte-for-byte. The local browser
reauthenticated and used its two-step Restore world control. The UI reported
that the checkpoint restored. Fresh live state was online at runtime generation
2, scene revision 2, with all six checkpoint IDs and poses: the new Strong
Beacon at `(0, 0, -5)` looped `Lantern Beacon Strong`, while the older Beacon
retained its `Lantern Beacon` loop. The Agent Portal resumed the same session
and selected Version 4 with the latest build `completed`; no extra object or
build was created by the restore.

These measurements make a wearer check more useful, but they do not prove
Quest VR/AR readability.
