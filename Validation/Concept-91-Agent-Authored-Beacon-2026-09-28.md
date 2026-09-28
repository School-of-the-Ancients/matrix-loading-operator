# #91: selected image to Agent-authored Blender animation

This is an isolated desktop continuation of the same #91 Agent conversation,
not another concept pipeline or a change to the Quest acceptance worlds. The
copied service used port `19870`; the original `18791` and `18795` worlds were
not modified. It began with four copied objects and selected native Codex
Version 4, concept `4ecf4c7e86b34493b9a5502e381e4759`.

The new Agent turn received the **actual selected PNG** as multimodal input:
2,144,296 decoded bytes, SHA-256
`3ab3bf0cbb35dd2c44b5e2f4f41a5be24208eb35fdc41b351c3e1a1d0499dbc4`,
matching [Version 4](concept-91-codex-version-4-selected.png). It continued
Agent session `107c243008e941c09e8e7a7b871fd718` and native conversation
`01a0e4be-7a58-7fd2-bcc1-fda94a5a3ec3`. The authoring turn was
`01a0e681-b4ea-72d0-af3e-ed59a50cfb23`; the later bind-only turn was
`01a0e695-365a-7150-8906-379ef132904f`.

The Agent authored [a Blender script](../WebRuntime/art/author_concept_v4_garden_bridge_beacon.py)
(SHA-256 `499e2f945d91abdfceb58fb9395b077bfcbb7bec4933f54dfcc0728fa7dd7ac5`).
It hash-checks the earlier static Version 4 `.blend` before opening it, adds a
new `Lantern Beacon` NLA clip to eight existing amber glass panes, and writes
a separate editable [`.blend`](../WebRuntime/art/concept-v4-garden-bridge-beacon.blend)
(SHA-256 `a78b02aa55c8ebbb69a305d6a24c608567d3b331c7782337c87627ea3b98c6fb`)
and [GLB](../WebRuntime/art/concept-v4-garden-bridge-beacon.glb)
(SHA-256 `e700d15395ef3b23b0c8669f22b64328248543da902e0145cffa16e9e33fef77`).
These files were copied unchanged from the Agent's ignored scratch output
into tracked art for review. The original static and manually animated sources
remain separate. The source opens under the same bounded, script-disabled
Blender validation used by the Blender-mode result gate.

The registered GLB is 1,275,256 bytes, with 91 meshes, 40,072 vertices, one
embedded image, and one 2.0333-second `Lantern Beacon` clip. The connected
browser advertised this clip. Reviewed native registration produced asset
`web:luminous-garden-bridge-v4-beacon:e700d15395ef`. Reviewed typed spawn
receipt `4f210e38ca85490fadee2c218cea7332` succeeded for new object
`ff5f6a636523499689f03522c208fc7b` at `(0, 0, -14)`. All four prior
objects retained their IDs and poses. Durable ConceptStore build
`5b6ec92a50014773841fac701d1682ed` has `creationMode: blender`, status
`completed`, the selected image and new source files, exact asset/object, and
that succeeded spawn receipt.

A separate same-conversation bind-only follow-up used the typed animation
tool. Receipt `3b4017562be249db9f0e6f17b8ecd5c6` returned
`status: succeeded`; the browser scene observed
`animation: {loopClip: "Lantern Beacon", selectClip: null}` on the same object.
The [named five-object checkpoint](concept-91-agent-authored-beacon-world-checkpoint.json)
has SHA-256 `1622cfb051a9756dcbb6bcf72bb45f011d194c4c5c13cd337140c088c7f9d32b`
and pins the new GLB digest and loop clip. After the isolated service restarted,
the five IDs and poses, animation binding, selected concept, and completed
build remained. The named checkpoint also restored five objects with no pending
commands: original Block `e647674f24c541758de23075de9561c1`, static
Version 4 bridge `0b8d7b29509943898939e9f01ab83a14`, Version 2 procedural
bridge `fb2853c93aa540afaefef60ca0ef1e14`, previously manual animated
bridge `fa2cd874b1bb46eda06850070a296630`, and new Beacon
`ff5f6a636523499689f03522c208fc7b`.

The real GLB passed the PC asset validator and a Three.js browser mixer test
that advances its named clip. ControlService passed **849/849**, WebRuntime
**635/635**, the production Vite build passed with the existing large-chunk
warning, and `git diff --check` passed. The new Beacon clip changes pane
height by about four percent; these desktop checks establish a valid moving
clip and observed binding, not headset readability. The separate
[manual `Lantern Pulse` derivative](Concept-91-Animated-Bridge-2026-09-27.md)
is the one previously wearer-confirmed in Quest VR and AR. The Beacon has not
yet been worn on Quest.

The bind-only follow-up also exposed a UI classification bug: its text
mentioned the already completed selected build and said not to spawn, yet the
client opened an extra selected-build request. That extra request failed when
the bind-only turn ended, making the UI's latest-record message say no result
even though the completed Beacon record survived restart. The unrelated
ConceptStore record `62d9f9fb08ce458597c8249d7392687a` was preserved.
After the first classifier fix, an isolated read-only follow-up saying
“Do not build, create, spawn…” exposed a comma-separated negation case and
created failed record `d79276f33c84433eb0c3be243bb02d8e`. That turn was
cancelled before any native approval or world command; the five-object scene
and clip binding were unchanged. #155 now filters both wordings in browser
and PC classifiers, with exact wording regression tests. The updated live UI
reported the earlier completed result alongside the first failed attempt;
the copied-world records were not rewritten to hide either bug.
