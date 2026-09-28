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
held object without held-item description or stick-instruction labels. Grabbing
does not hide the Operator panel. If the wearer hides it, clicking either
thumbstick after releasing the object recalls it; the
[Quest controls FAQ](../WebRuntime/README.md#quest-controls-faq) records this.

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

- WebRuntime: **602/602** Node tests passed, including two-hand source binding,
  role reversal, yaw/pitch and full-flip math, AR parent transforms, Undo, save
  and reopen, Play/Test grab behavior, bounded release momentum and safe
  cancellation, and panel click suppression during a grab.
- ControlService: **798/798** Python tests passed.
- Vite production build passed with `view-Dyy84z0d.js`; `git diff --check`
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
held-item description and stick-instruction text filled the view. This is a
failed control and UI acceptance on the old head. The wearer later clarified
that the Operator panel itself was fine.

## Quest VR observation on the interim two-hand build — partial pass

On 2026-09-28 UTC, the Quest 3 connected to the isolated
`http://127.0.0.1:18791/web/` origin, which served interim head `ecca164`
with production bundle `view-P0ugTY58.js`. The client reported
`threejs-webxr`/`vr`, Creator Mode paused, ready virtual room
`web-virtual-room-v1`, and an empty scene before the test mutation. The
registered Ice Dragon was queued at `(-1.722, 1.5, -0.818)` with scale `0.5`
using fresh client/revision/room/runtime guards. Spawn request
`0cf8282679ce4c2c925e746959186d4e` returned `ok:true` with object ID
`1894e1a2812c4243a85393bb707621d3`; Flight binding request
`79bc1aa593234bda864948bbf006fb70` also returned `ok:true` for that ID.

The wearer reported **both hand roles work**: the grabbing hand's stick moves
the object and the free hand's stick spins/flips it. At `01:35:30Z`, service
revision 37 retained that ID, Flight, and scale at position
`(-0.714, 1.513, -3.132)` and rotation in degrees
`(-141.07, -49.28, -170.39)`. Service pose changes alone cannot identify the
input that caused them; the control observation is the wearer's report.

An interim UI edit automatically hid the head-following Operator panel on grab.
The wearer clarified that the panel was fine and requested its original
behavior, so commit `1a1855f` reverted that edit. The obstructive held-item
description and stick instructions remain removed. A small recall hint was
briefly added, then removed at the wearer's request in favor of a user-guide
FAQ. The final
`view-sss3M221.js` bundle still needs an exact-bundle wearer check.

In the disposable VR scene, Undo request
`1939583b937549cf8db2f46f47d9e7e8` returned `ok:true` and changed the
same Dragon from position `(-1.689, 1.773, -2.942)` and rotation
`(-150.08, -43.31, -164.98)` at revision 30 to position
`(-1.833, 1.721, -2.868)` and rotation `(-150.3, -46.07, -165.34)` at
revision 32. Scale `0.5` and Flight were retained. The wearer was away from
the computer and did not notice the change; this is a runtime Undo result,
not a wearer-visible Undo pass. Manual checkpoint and full browser close/reopen,
Play/Test, and AR remain untested on the revised controls.

## Quest VR UI retest on `21f56bc` — panel and recall worked

The isolated service served production bundle `view-DVj-S6vR.js` at
`http://127.0.0.1:18791/web/` with `Cache-Control: no-store`. The wearer
reported refreshing that Quest Browser tab and re-entering VR. They saw the
Dragon and explicitly confirmed that the Operator panel stayed visible while
grabbing. At `2026-09-28T01:55:02Z`, the live VR Creator scene still contained
the same Dragon ID `1894e1a2812c4243a85393bb707621d3`, scale `0.5`, and
Flight binding. The service reused its client ID and runtime generation across
the reported refresh, so those fields alone do not prove a reload; the wearer
observation establishes the corrected panel behavior in the headset.
The reported page refresh also kept the Dragon present with the same ID,
scale, and Flight binding; a manual checkpoint and full browser close/reopen
still need a separate check.

When asked to hide the panel outside a grab, the wearer reported that the
`CLICK STICK · OPEN OPERATOR` cue was **completely absent**. The wearer
confirmed that a second stick click **does** restore the Operator panel and
decided this small quality-of-life instruction belongs in the user guide.
The invisible cue was removed from the candidate; the FAQ now answers
"Where did the Operator screen go?" This VR UI result does not satisfy the
remaining full VR, Play/Test, or AR gate.

## Quest VR final-bundle wearer retest — controls and Undo passed

On the same isolated `http://127.0.0.1:18791/web/` origin, after the cue was
removed and production bundle `view-sss3M221.js` was served, the wearer
reported refreshing the Quest Browser page and re-entering VR. They confirmed
the Dragon was present, that the grabbing hand's stick moved it, that the free
hand's stick spun and flipped it, that the gold outline was visible, and that
the Operator panel stayed visible during the grab. This is a wearer report for
the final control and UI mapping; it does not establish AR behavior.

At `2026-09-28T02:05:45Z`, the service reported VR Creator revision 59 with
the same Dragon ID `1894e1a2812c4243a85393bb707621d3` at position
`(-1.014, 1.181, -4.808)` and rotation in degrees
`(-157.31, -12.32, -145.16)`, retaining scale `0.5` and `Flight`. After a
deliberate further grab and release, the wearer used the Operator World page's
Undo and reported that the Dragon returned toward its previous pose while
Flight kept playing. At revision 86, the service still reported that same ID,
scale, and animation at position `(-0.045, 1.769, -2.982)` and rotation
`(-178.09, 14.48, -169.88)`. This confirms wearer-visible Undo behavior;
the observed service poses do not identify which stick caused each movement.

The wearer chose the concise FAQ answer for finding a hidden Operator panel
after an experimental in-headset cue was invisible. The gold outline and
direct object response provide the visible held-object feedback, while the
README carries the detailed stick mapping the wearer found obstructive in VR.

The wearer then tapped **SAVE WORLD** on the World page, closed the Quest
Browser tab, reopened the same URL, and re-entered VR. They reported that the
same flapping Dragon was restored at the saved pose. The browser checkpoint
also made a scene-only PC backup named `WebWorld_20260928020807`. The new
service client ID `390722f17c684bcfae4fff9b3224d872` and runtime generation
2 establish a new browser runtime. At revision 93, the service reported the
same Dragon ID at position `(-1.64, 1.209, -2.651)`, rotation
`(177.2, -11.67, 171.75)`, scale `0.5`, and `Flight`.

## Quest VR Play/Test finding and release-momentum correction

In the same disposable VR world, guarded spawn request
`22bf2326b4974bdb9d842b999712499b` created separate built-in Block
`da7269149586473c80b337604e37bee4` at `(1.321, 1.3, -1.69)`, scale
`0.5`. Guarded target request `64c8b68e21da46c4a1aa6bc0f6bedbae`
attached a dynamic bounded-box rigid body to that ID; both receipts were
`ok:true`. The Dragon remained separate with Flight bound. The wearer entered
running Play/Test, confirmed the Block fell, could be grabbed, translated and
spun/flipped with the two sticks, and resumed simulation on release.

The wearer found a physics gap: releasing while moving made the Block drop
straight down instead of carrying the movement as a throw. The cause was the
pre-existing rigid release path, which set both velocities to zero when
switching from kinematic grab to dynamic simulation. The candidate now hands
off recent parent-local XR pose motion as at most 6 m/s linear and 12 rad/s
angular velocity on a normal tracked release. Gaps, stillness, cancellation,
and tracking loss use zero momentum. The lower-level API rejects invalid or
over-limit velocities before changing a held body. Automated tests and the
`view-Dyy84z0d.js` build pass. The wearer then refreshed the Quest Browser
page, re-entered VR Play/Test, swung and released the Block, and reported
**"Yes, it flings."** During that run, the service observed the same Block ID
unheld at revision 210, position `(1.798, 5.743, -1.145)`, with velocity
`(0.784, -1.351, 3.649)` m/s and nonzero angular velocity. At revision 211 it
had continued to `(2.225, 2.671, 1.225)` with the same lateral and depth
velocity components while gravity increased downward speed. This corroborates
a moving release and subsequent arc; the headset result is the wearer's
observation. The Dragon retained its ID, Flight, and scale.

## Remaining Quest acceptance

The VR control, UI, Undo, browser reopen, and Play/Test throw checks above
passed. The separate AR wearer run remains open.

Run VR and AR separately on the revised exact PR head using an isolated browser origin
and a disposable world. Record the Quest OS, Browser version, URL, bundle/commit,
XR features, object ID, initial/final transform, and wearer observations.

1. Grab a distant animated object with one hand. Move it with tracked controller
   motion, then use that hand's stick X for a small sideways adjustment, Y for
   beyond-arm depth, and click plus Y for height. With the free hand's stick,
   use X to yaw both ways and Y to pitch both ways through a visible flip.
   Check the gold outline, the absence of held-item instruction text, that the
   Operator panel remains visible during a grab, and UI readability.
   Repeat with the hands exchanged and check that both sticks can affect the
   same held object without position/rotation drift when released to neutral.
2. Release in Creator Mode. Confirm the same ID, animation, scale and unrelated
   objects; Undo and save/reopen must preserve the authored transform.
3. Click either stick outside a grab to hide/show the Operator panel. Stick
   axes without a grab must not move or rotate objects; a click held through
   grab release must not open the panel unexpectedly. The guide documents how
   to recall a hidden panel.
4. In running Play/Test, grab a dynamic body, translate and rotate it by stick,
   release it, and verify simulation resumes without an authored `set_transform`.
5. In AR, repeat only when the room origin is ready. Check that unavailable
   tracking suspends motion and rotation, a disconnected free controller stops
   its rotation while the valid grab can continue, and a stale-origin release
   does not save the edit.

Keep #147 open until both mode-specific wearer runs pass. This candidate does
not constitute a physical-room alignment or collision claim.
