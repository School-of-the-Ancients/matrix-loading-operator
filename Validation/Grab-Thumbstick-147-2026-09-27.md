# #147 — grabbed-object thumbstick translation

This candidate starts from `main` at `b48c1ca` and changes the canonical
`WebRuntime/` grab path. It does not change the scene schema, ControlService,
desktop pointer drag, or the published v0.8 package.

## Controls and safety

Hold the trigger on an editable object in VR or AR. Tracked controller motion
and rotation continue to carry it. The grabbing controller's `xr-standard`
thumbstick uses axes 2/3: X moves laterally relative to the viewer, Y moves
forward/back relative to the viewer's horizontal heading, and holding the stick
click changes Y to vertical. The other hand's axes cannot move the grab. Stick
click still recalls the Operator panel after the grab ends; a click made during
the grab cannot unexpectedly open it on release. A gold outline follows the
held object, with brief control labels beside the controller.

The radial dead zone is 0.18. Input moves at most 0.75 metres per second, each
frame contributes at most 0.1 seconds, and the stick offset is capped at 3
metres from the original controller-held pose. The offset is applied in world
space and converted into the object's current anchor frame before committing.
Missing/non-finite axes, lost controller tracking, missing XR frames, a stale
AR origin, and a mode that no longer permits the grab suspend held motion. A
disconnected input source cancels its grab and releases paused physics so a
new selection is possible. Releasing after the AR origin becomes unavailable discards
the transient edit. Creator release uses the existing `set_transform` path and
Undo; Play/Test only moves a running dynamic body and returns it to simulation.

## Validation on this candidate

- WebRuntime: **589/589** Node tests passed. Focused coverage exercises the
  dead zone, frame rate, 3 m cap, rotated/moving AR parent, local bounds under
  an offset world origin, tracking and origin loss, source binding and removal,
  failed rigid-move cleanup, click/panel behavior, Play/Test rigid-body path,
  same-ID transform, Undo, and browser scene save/reopen.
- ControlService: **798/798** Python tests passed.
- Vite production build passed; `git diff --check` passed.

These are source and automated results. No Quest wearer result has been recorded
for the new stick controls.

## Remaining Quest acceptance

Run VR and AR separately on the exact PR head using an isolated browser origin
and a disposable world. Record the Quest OS, Browser version, URL, bundle/commit,
XR features, object ID, initial/final transform, and wearer observations.

1. Grab a distant animated object. Move it with tracked controller motion,
   then use X for a small sideways adjustment, Y for beyond-arm depth, and
   click plus Y for height. Check the outline and labels are readable.
2. Release in Creator Mode. Confirm the same ID, animation, scale and unrelated
   objects; Undo and save/reopen must preserve the authored transform.
3. Click the stick outside a grab to recall/hide/show the Operator panel.
   Check that stick axes without a grab do not move objects.
4. In running Play/Test, grab a dynamic body, move it by stick, release it, and
   verify simulation resumes without an authored `set_transform`.
5. In AR, repeat only when the room origin is ready. Check that unavailable
   tracking suspends motion and a stale-origin release does not save the edit.

Keep #147 open until both mode-specific wearer runs pass. This candidate does
not constitute a physical-room alignment or collision claim.
