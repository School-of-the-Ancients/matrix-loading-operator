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

At this Quest check, the manually authored derivative was linked by its
checked Blender source and checkpoint. A later selected-image Agent turn
reused that exact derivative and recorded a durable build in the copied
fixture, as documented below.

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

## Agent reuse/provenance follow-up (copied fixture)

This later trace used a copy of the acceptance scenes and asset catalog on an isolated loopback service at port `19870`. It did not alter the original acceptance world or the `18795` Quest fixture. The same Agent session `107c243008e941c09e8e7a7b871fd718` resumed native conversation `01a0e4be-7a58-7fd2-bcc1-fda94a5a3ec3`. The original ready Version 4 concept `4ecf4c7e86b34493b9a5502e381e4759` was selected. The new Agent turn's actual `input_image` decoded to 2,144,296 PNG bytes with SHA-256 `3ab3bf0cbb35dd2c44b5e2f4f41a5be24208eb35fdc41b351c3e1a1d0499dbc4`, matching the selected Version 4 image.

One explicit selected-image `creationMode: auto` turn, `01a0e65f-d388-7522-b3ff-f32a9f0a65cb`, reused the already tracked manual derivative. The Agent verified the existing [animated GLB](../WebRuntime/art/concept-v4-garden-bridge-animated.glb) at SHA-256 `e3bddc50b62828f1265f46704cef5cad2cd1ddfd6db589554e5937f059d9e49a` and requested native approval to register that exact file with only source path, expected hash, and name. The isolated catalog registered `web:luminous-garden-bridge-v4-animated:e3bddc50b628`; its validator reported one 2.0417-second **Lantern Pulse** clip, and the connected browser advertised that clip before placement.

After a separate reviewed spawn approval at scene revision `2`, typed request `526bb13235754e26b658569697213e89` returned `ok: true`. The browser observed new object `fa2cd874b1bb46eda06850070a296630` with the animated asset at `(0, 0, -8)`. The prior Block `e647674f24c541758de23075de9561c1`, static Version 4 GLB `0b8d7b29509943898939e9f01ab83a14`, and Version 2 procedural bridge `fb2853c93aa540afaefef60ca0ef1e14` kept their IDs and transforms. The scene had four objects and no pending commands.

The copied ConceptStore durably records build `6a95facc44a940f2b9b737625baf5a27` as `completed` for selected Version 4, the same image SHA and Agent turn, asset `web:luminous-garden-bridge-v4-animated:e3bddc50b628`, object `fa2cd874b1bb46eda06850070a296630`, and the exact spawn receipt. Its source names are the tracked [animated `.blend`](../WebRuntime/art/concept-v4-garden-bridge-animated.blend), animated GLB, and [build script](../WebRuntime/art/build_concept_v4_garden_bridge_animated.py). The recorded strategy is: “Reused the earlier manually authored Blender animation; validated its tracked clip-bearing GLB and spawned one bridge in the copied world.” This follow-up did not author or modify the derivative. `creationMode: auto` records the reuse and receipt; it does not independently validate editability of the compressed `.blend`.

The four-object copied world was saved and reopened as `Concept 91 selected v4 animated reuse acceptance` (checkpoint SHA-256 `76d01ea31b144dd0edf91d82c274ec023b936224811db5433365de538308da5f`). The checkpoint retains all four object IDs and a dependency on the exact animated GLB SHA with `Lantern Pulse`. The browser restored all four IDs. After the idle Agent turn, only the isolated `19870` service was restarted; the same session and conversation resumed idle with Version 4 still selected and the completed build intact, while the browser still reported four objects and the clip-bearing asset. The original acceptance portal, concepts, and asset manifest hashes remained unchanged. Playback of the new copied instance was not observed in this follow-up; the separate Quest wearer result above concerns the `18795` fixture.
