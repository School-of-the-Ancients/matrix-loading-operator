# #91: animated derivative of the selected Version 4 bridge

Date: 2026-09-27. This follow-up extends the [selected-image desktop
result](Concept-91-Live-2026-09-27.md) on PR #155. It does not replace that
result or alter its saved world.

## Source and animation

The earlier Codex Agent turn received the actual selected Version 4 image
(SHA-256 `3ab3bf0cbb35dd2c44b5e2f4f41a5be24208eb35fdc41b351c3e1a1d0499dbc4`)
and authored `concept-v4-garden-bridge.blend` (SHA-256
`514fd733245cc6085bba3e564ba1ac4419b1e1812c4a2c12d26a46d0abfd3268`).
The [derivative script](../WebRuntime/art/build_concept_v4_garden_bridge_animated.py)
checks that source hash before opening it. It keys translation and height scale
on the eight amber lantern-glass panes, writes a separate
[`concept-v4-garden-bridge-animated.blend`](../WebRuntime/art/concept-v4-garden-bridge-animated.blend),
and exports a separate
[`concept-v4-garden-bridge-animated.glb`](../WebRuntime/art/concept-v4-garden-bridge-animated.glb).
The deck and rails remain static. The original `.blend`, original GLB
(SHA-256 `27db9e18cca49ee37a249f0e30919bb852b30876361bed15e4d11e0e27524e3c`),
and [original checkpoint](concept-91-blender-world-checkpoint.json) are unchanged.

`inspect_glb` accepted the derivative: SHA-256
`e3bddc50b62828f1265f46704cef5cad2cd1ddfd6db589554e5937f059d9e49a`,
1,280,716 bytes, 40,072 vertices, 91 meshes, one embedded image, and one
named 2.0417-second clip, **Lantern Pulse**. Its 16 channels move eight panes.
The real GLB passed a Three.js mixer test confirming a pane changes height and
the one-clip loop continues. The full WebRuntime suite passed **631/631** and
the production build passed; the existing large-chunk warning remains. The
full ControlService suite passed **845/845** after this derivative was added.

## Isolated browser world and receipt

The GLB was registered in a new catalog on `127.0.0.1:18795` as
`web:luminous-garden-bridge-v4-animated:e3bddc50b628`. A separate browser
runtime advertised that exact asset with the `Lantern Pulse` clip. A typed
`spawn` command at `(0, 0, -2)` on `web-floor` returned request ID
`e57fe8817129474d95b4d6906e6bc68e`; the live PC state later reported
`ok: true` and observed object `1710fcd7073340018740c44fc003c6b7`
with that exact asset. The desktop browser rendered the textured bridge. This
confirms registration, receipt-backed placement, and geometry loading; it does
not by itself prove wearer-visible animation.

The browser saved a named [full-world PC
checkpoint](concept-91-animated-bridge-world-checkpoint.json). `GET
/api/web/worlds` listed it; the file retains the object ID, transform, GLB
hash, and `Lantern Pulse` dependency. The `18795` scene and catalog are
isolated from the earlier `18791` world and the `18794` gallery fixture.

## Quest VR wearer result

The Quest wearer restored **Concept 91 animated bridge acceptance** on the
isolated `18795` page, entered VR, and reported both the bridge and its lantern
animation visible. They initially asked whether the bridge's black appearance
was a rendering error, then recognized and accepted it as the design. The
animated derivative and accepted original GLB have the same seven PBR
materials; the structural metal has a very dark charcoal base color and high
metallic value. No material change was made. A subsequent service state at
revision 27 reported the exact registered animated asset and object ID above.

The new derivative is linked by its checked Blender source and this
checkpoint; no second selected-image Agent turn or new durable ConceptStore
build record is claimed for this manual animation follow-up.

## Quest AR origin safeguard

The first direct VR-to-AR entry after restoring this **PC** checkpoint showed
passthrough but hid the bridge. The wearer saw `ROOM RELOCALIZATION FAILED`,
and the service reported `roomContext.state: missing` while still retaining the
same object ID and asset in the scene. This is the intended origin safeguard:
PC checkpoints contain no browser AR room handle, so a nonempty restored world
has `originBinding: unknown` and cannot be silently placed in a physical room.
The wearer used WORLD → ARCHIVE + PLACE HERE → CONFIRM PLACE HERE on this
isolated fixture and then reported the same bridge and its moving amber panes
visible in passthrough AR. Between checks, taking off and replacing the Quest
headset left the AR page blank; the wearer restarted Quest Browser. The exact
button sequence and cause of that one resume failure are unverified. The
service subsequently reported a new runtime
generation in `ar`, `roomContext.state: ready`, 38 detected room planes, and
the same object ID and exact asset ID. Its room-context message still called
virtual-floor objects **unanchored previews**, with `alignmentVerified: false`;
this check establishes AR visual placement and animation, not measured
physical alignment or a reopen/relocalization guarantee. The named PC
checkpoint remained listed after recovery.
