# #147 — two-hand thumbstick transforms of grabbed objects

This candidate starts from `main` at `b48c1ca` and changes the canonical
`WebRuntime/` grab path. It does not change the scene schema, ControlService,
desktop pointer drag, or the published v0.8 package.

## Controls and safety

Hold the trigger on an editable object in VR or AR. Tracked movement and rotation
of that controller continue to carry it. The grabbing hand's `xr-standard`
thumbstick uses axes 2/3 for translation: X moves laterally relative to the
viewer, Y moves forward/back relative to the viewer's horizontal heading, and
holding that stick click changes Y to vertical. The free opposite hand's stick
uses X for side-to-side yaw and Y for up/down pitch, including flips, on the
same held object. Grabbing with the other hand exchanges these roles. Stick
click still recalls the Operator panel after the grab ends; a click made during
the grab must not unexpectedly open it on release. A gold outline follows the
held object without controller text labels. A successful grab hides a
head-following Operator panel so its text does not occlude the object; a panel
deliberately pinned to a wall or world position remains visible. Release does
not restore a hidden panel; a fresh stick click outside the grab recalls it.

The translation dead zone is 0.18. Translation moves at most 0.75 metres per
second, each frame contributes at most 0.1 seconds, and the stick offset is
capped at 3 metres from the original controller-held pose. The offset is applied
in world space and converted into the object's current anchor frame before
committing. Rotation uses the same 0.18 dead zone, at most 120 degrees per
second, and a 0.1-second contribution per frame. It does not change the
object's position or unrelated world state.
Missing/non-finite axes on either hand stop that hand's stick effect. Lost
headset or grabbing-controller tracking, missing XR frames, a stale AR origin,
and a mode that no longer permits the grab suspend held motion. Disconnecting
the free hand stops its rotation without discarding a valid grab; disconnecting
the grabbing hand or ending the XR session cancels the grab and releases paused
physics so a new selection is possible. Releasing after the AR origin becomes
unavailable discards the transient edit. Creator release uses the existing
`set_transform` path and Undo; Play/Test only moves a running dynamic body and
returns it to simulation.

## Automated validation on the revised two-hand candidate

- WebRuntime: **598/598** Node tests passed, including two-hand source binding,
  role reversal, yaw/pitch and full-flip math, AR parent transforms, Undo, save
  and reopen, Play/Test grab behavior, and following-panel hide/pinned-panel
  preservation with later recall.
- ControlService: **798/798** Python tests passed.
- Vite production build passed with `view-P0ugTY58.js`; `git diff --check`
  passed. The build has the existing large-chunk size warning.

These results validate source behavior and the built bundle. They do not
establish Quest wearer acceptance.

## Automated validation on the earlier translation-only head

- At `2c8a5a3`, WebRuntime: **592/592** Node tests passed. Focused coverage exercises the
  dead zone, frame rate, 3 m cap, rotated/moving AR parent, local bounds under
  an offset world origin, controller/headset tracking and origin loss, source binding and removal,
  session-exit cancellation,
  failed rigid-move cleanup, click/panel behavior including a press between XR frames,
  Play/Test rigid-body path,
  same-ID transform, Undo, and browser scene save/reopen.
- ControlService: **798/798** Python tests passed.
- Vite production build passed; `git diff --check` passed.

These are source and automated results for the earlier translation-only head.
They do not validate the revised two-hand mapping.

## Quest VR observation on the earlier head — control acceptance failed

The Quest 3 wearer (Android 14, Quest Browser `152.0.0.44.30.1069357998`)
entered VR on the isolated `http://127.0.0.1:18790/web/`
origin served from head `2c8a5a3` with bundle `view-BwmdZD3K.js`. Dragon object
`a1ac7127476540cfbe214e170c2ab210` was spawned at `(0, 1.5, -2)` with
scale `0.5`; Flight receipt `d317d2b4c8814e04b9e114b5d89bf171` succeeded.
At `2026-09-28T01:00:52Z`, the service reported the same object at position
`(-1.316, 0.8, -2.969)` and rotation in degrees `(-8.57, 7.06, 0.89)`, retaining its ID,
Flight, and scale. This pose observation does not establish which input caused
the change.

The wearer confirmed the Dragon was visible and flapping. They said grabbing
already let them move it, but the thumbstick controls were wrong: they wanted
side-to-side spins and up/down flips during the grab. They also reported that
controller text filled the view. This is a failed control and UI acceptance on
the old head. No AR wearer result or two-hand wearer result has been recorded.

## Remaining Quest acceptance

Run VR and AR separately on the revised exact PR head using an isolated browser origin
and a disposable world. Record the Quest OS, Browser version, URL, bundle/commit,
XR features, object ID, initial/final transform, and wearer observations.

1. Grab a distant animated object with one hand. Move it with tracked controller
   motion, then use that hand's stick X for a small sideways adjustment, Y for
   beyond-arm depth, and click plus Y for height. With the free hand's stick,
   use X to yaw both ways and Y to pitch both ways through a visible flip.
   Check the gold outline, the absence of controller text, and UI readability.
   A head-following Operator panel should clear once the grab begins. Repeat
   with an intentionally pinned panel and confirm it stays pinned.
   Repeat with the hands exchanged and check that both sticks can affect the
   same held object without position/rotation drift when released to neutral.
2. Release in Creator Mode. Confirm the same ID, animation, scale and unrelated
   objects; Undo and save/reopen must preserve the authored transform.
3. Click either stick outside a grab to recall/hide/show the Operator panel.
   Check that stick axes without a grab do not move or rotate objects and that
   a click held through grab release does not open the panel unexpectedly.
4. In running Play/Test, grab a dynamic body, translate and rotate it by stick,
   release it, and verify simulation resumes without an authored `set_transform`.
5. In AR, repeat only when the room origin is ready. Check that unavailable
   tracking suspends motion and rotation, a disconnected free controller stops
   its rotation while the valid grab can continue, and a stale-origin release
   does not save the edit.

Keep #147 open until both mode-specific wearer runs pass. This candidate does
not constitute a physical-room alignment or collision claim.
