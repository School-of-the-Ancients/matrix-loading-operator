# Room-aware Operator #149 — WebXR review

This review began on `codex/room-aware-149` from `main` at `db2142a`.
PR #159 subsequently merged as `1ad61d0`, panorama voice routing PR #162
merged as `704068c`, and release privacy PR #164 merged as `88c05e0`.
The current #160 branch includes those merged changes and the durable surface
placement described in `Durable-AR-Surface-149-2026-09-28.md`. The historical
review results below retain their original source revisions. Run the current
head procedure below for Quest acceptance; earlier wearer checks do not prove
the current branch.

## Implemented contract

- The browser's current WebXR plane observations remain in the normal Matrix
  runtime snapshot. A transient `spatialObservation` reports plane age, room
  tracking epoch, and the located web-floor pose in XR reference space. It is
  excluded from the authored scene revision and saved world.
- An opted-in Agent turn captures presentation and tracking epoch. The PC
  compares them with the connected runtime before constructing a bounded
  `roomSpatial` context from its validated snapshot. The private
  `matrix_room_spatial_context` tool provides a fresh read before editing.
- `roomSpatial` labels unusable geometry explicitly. Its token binds room,
  scene revision, runtime generation, tracking epoch, alignment and measured
  geometry. A support-specific token binds those guards to the chosen support;
  changes to unrelated, unshown planes no longer expire a placement. The
  prompt shows only a limited set of plane poses and polygons. A fresh spatial
  read can prioritize a chosen anchor; both validators and their queue rechecks
  use the same priority so a table remains available in a dense room.
  A physical camera frame is never a metric room measurement.
- `matrix_spawn_on_surface` places a new canonical `web-floor` object on a
  measured support through the usual Matrix queue and observed receipt.
  `matrix_move_with_room_constraint` moves an existing virtual-floor object
  while retaining its object ID. The browser checks its complete footprint
  against the latest measured support sample and tracking epoch at execution
  time, including after small plane-boundary changes. The new and moved
  digital objects retain their IDs and transforms after AR exit and
  save/reopen. Measured WebXR plane IDs and geometry remain temporary.
- Ordinary text turns without spatial opt-in retain the existing small
  runtime context. The PC-owned Agent can separately request the bounded
  private `matrix_room_spatial_context` read while the AR runtime is connected;
  this read is available to the owner Agent on any turn. No raw room image,
  private credential, or unrestricted room scan is written to a public review
  artifact.
- In AR, CHAT and transcribed Quest voice route requests about the wearer's
  room or a pointed physical surface to the Agent with current selection,
  pointing, presentation, and tracking context. This includes "reorganize this
  based on my room," "move the orb to the center of this table," and "put that
  there." Ordinary catalog placement and digital moves retain their planner
  route. The direct Agent text panel's context checkbox remains explicit.

## Current-head Quest wearer review sequence

Use a fresh isolated service from the exact #160/#161 integrated source and
record its commit and URL. Keep its private scene, asset, environment, and
Agent state separate from older review services. In Quest VR, restore the
private six-object lab candidate or a reviewed equivalent and inspect the
same object IDs. On entering AR, a checkpoint without this room's origin may
hide its old overlay. Use **Archive and place world here**, confirm the local
archive, then confirm the visible plane outlines align before selecting
**Outlines align — enable AR editing**. Do not infer alignment from passthrough
alone.

1. Ask Operator for a placement that crosses a measured shelf or wall plane.
   Confirm a readable rejection occurs before any edit and the scene IDs and
   transforms remain unchanged. Measured planes cannot establish clearance
   from unmeasured furniture; the wearer must assess physical TV clearance.
2. Ask Operator to create one clear object on a measured support. Verify a
   succeeded `matrix_spawn_on_surface` receipt, its new object ID, the chosen
   support, and the resolved `web-floor` transform. Then move an existing
   virtual-floor object with `matrix_move_with_room_constraint`; verify a
   succeeded receipt, unchanged object ID, and visible fit. Inspect the final
   scene after each receipt.
3. Reuse an intentionally stale room token after a tracking epoch or support
   change. Confirm a 409 rejection without a queued edit or changed object.
   Do not retry a denied or uncertain mutation without a fresh read and
   review.
4. Save, Exit AR, reopen, and compare both object IDs and transforms with the
   receipts. Check them again in VR. The measured support is a transient
   observation; the accepted objects are persistent digital `web-floor`
   entities. Record the current room alignment separately on AR return.

Record Quest Browser and OS versions, presentation, room plane count,
origin/alignment status, tracking changes, exact receipts, object IDs, and
wearer-visible VR/AR results. Keep private room polygons and camera pixels
out of this record. Camera sharing and recovery have their own #26 checklist.

## Historical wearer review sequence

The original isolated #160 desktop review used `http://127.0.0.1:18966/web/`
before #150 merged. The combined review port was
`http://127.0.0.1:18970/web/`, with separate private scene,
asset, and environment directories and no loopback token. Its checkpoint
picker contains `quest150-codex-moonlit-forest-garden-v1` (the eleven-object
garden with the selected generated panorama). A desktop review restored that
checkpoint and observed eleven objects and the expected panorama; the desktop
tab was then closed to release the single writer lease for Quest. This is
staging evidence, not a wearer result. The 18970 service was restarted from
`dcdfef7` for the natural AR routing check. Its Quest world remains connected;
the guarded-move fix is staged separately at `http://127.0.0.1:18973/web/`
for a fresh exact-head wearer retest without replacing that live session.

On Quest, select **PC world checkpoints →
quest150-codex-moonlit-forest-garden-v1**, then **Restore world → Confirm
restore**. Use the 18973 page for the guarded-move retest. Record the
Quest Browser version, restored checkpoint, and source commit with the new
evidence.

1. Restore the named eleven-object world in Quest Browser. In VR, inspect the
   five new garden elements around the six preserved bridges/block. Record the
   visible result and any rendering or reachability problem.
2. Save/reopen or restore the same named checkpoint and confirm the six original
   and five added digital objects remain visible with their supported IDs.
3. Enter AR with the same saved composition. Allow Quest room planes and the
   room origin to settle. Check the visible outlines before selecting **Outlines
   align — enable AR editing**. If tracking or alignment is unavailable,
   record the stated reason; do not claim a physical fit.
4. Ask Operator to reorganize one existing object against a measured support.
   It should refresh `matrix_room_spatial_context`, use the current token, and
   obtain a succeeded `matrix_move_with_room_constraint` receipt. Confirm that
   the object visibly fits the measured support and keeps its ID. A separate
   `matrix_spawn_on_surface` was originally planned as session-local placement.
5. Exit AR, then save and reopen to verify the digital composition and moved
   virtual object. This historical expectation for a temporary surface spawn
   was superseded by durable `web-floor` placement on the current branch.

Record Quest Browser version, presentation, room plane count, origin/alignment
status, tracking loss or relocalization, exact receipts, observed object IDs,
and the wearer's visible VR/AR result. Keep the user's private room polygon
and camera pixels out of this record.

## Evidence status

| Gate | Result |
| --- | --- |
| ControlService full suite | Original branch: `python -m unittest discover -v`: 865 passed, 0 failed. Rebased on #159 and again on #162: `python -m unittest discover`: 879 passed, 0 failed each time. |
| WebRuntime full suite and production build | Original branch: `npm test`: 642 passed, 0 failed. Rebased on #159: 674 passed, 0 failed. Rebased on #162: 675 passed, 0 failed; `npm run build`: passed. |
| Natural AR request routing | AR-specific room phrases now route to the Agent; ordinary digital and non-AR routes remain covered. `npm test`: 677 passed, 0 failed; `npm run build` and `git diff --check`: passed. This is source-level evidence only. |
| Isolated desktop review | `http://127.0.0.1:18966/web/` served the final build with separate scene and asset directories; the PC checkpoint list contained `quest91-agent-strong-beacon-six-objects`, and UI restore displayed six original objects. The Agent Portal connected and read the six IDs/transforms at scene revision 3; it reported desktop mode, zero measured planes, and no physical fit claim. |
| Agent composition / typed receipts | After service restart, Agent recaptured all six original IDs/transforms at source scene revision 1, then created two pedestal/orb pairs and one curved bench with five individually approved, succeeded typed receipts. Final live revision 11 had 11 objects. |
| PC checkpoint and desktop reopen | Saved `quest149-lantern-garden-eleven-objects`, then reloaded the page and explicitly restored it through the PC checkpoint picker; UI reported 11 objects. Comparing checkpoint payloads found all six original IDs and transforms unchanged and exactly five new IDs. Saved checkpoint SHA-256: `C8E2D4BB4631C9AFC20E4BC14045E5C40FE09646E7BE28C154255C3BAB88FA84`. |
| Combined #150 + #149 desktop staging | `http://127.0.0.1:18970/web/` was restarted from `dcdfef7` with separate private review state. A desktop tab had restored `quest150-codex-moonlit-forest-garden-v1` and observed the eleven-object garden and expected generated panorama; the tab was closed before Quest review. |
| Quest 18970 AR attempt | Service observed the eleven-object world, AR ready/aligned, 38 measured planes, and a selected existing orb. The wearer reported an error and “PC review needed.” The Agent's two guarded moves returned 409 before a request ID; no Agent move receipt or pending edit exists. A separate PC command request was denied because its effect could not be reviewed in XR. The Agent turn was stopped. The orb had an X/Z tilt, which violates the support-fit guard; same-revision room reads also produced different global tokens while the chosen support stayed stable. The bridge hid the exact 409 reason, so neither guard can be identified as the first rejection. |
| Guarded-move repair | The private bridge preserves concise 409 reasons; the Agent is told to upright a tilted object explicitly and use the chosen plane's support-specific spatial token. A targeted fresh read and corresponding queue checks keep that support in a bounded context even when many floor planes precede it. Targeted tests and the full ControlService suite (879/879) passed. The repaired source at `c41de1f` has now produced succeeded same-ID measured moves on Quest, detailed below. |
| Quest VR save/reopen composition | The 18973 Quest service restored the named eleven-object PC checkpoint before entering AR, and a live ID comparison found all eleven checkpoint IDs plus the same panorama asset. An explicit exact-build wearer VR visual report and save/reopen check remain pending. |
| Quest AR measured move and alignment | On 18973, the wearer explicitly archived and placed the PC-restored world at a new physical origin, then confirmed aligned outlines. The service observed 38 planes, ready/aligned room context, and succeeded same-ID moves. The wearer said the first orb placement works. Stale-token rejection, final layout assessment, and save/reopen remain pending. |

Automated and desktop checks are not Quest wearer evidence.

## Repaired Quest 18973 live review

The isolated service at `http://127.0.0.1:18973/web/` serves source
`c41de1f` on Quest 3 Browser `152.0.0.44.30.1069357998` (Android 14,
build `UP1A.231005.007.A1`). It restored the PC checkpoint
`quest150-codex-moonlit-forest-garden-v1`, payload SHA-256
`2f0c9c0ec40868a4c867312877b2c8932d3c47f290b7318241c6c34db6b039fd`.
Comparing checkpoint and live scene IDs found the same eleven objects and
panorama asset. The source checkpoint has no AR origin binding. Entering AR
correctly hid its old world and reported an unavailable origin rather than
claiming a physical fit. The wearer selected **Archive and place world here**
and confirmed the local recovery archive, preserving all eleven objects; the
new room reached ready/aligned with 38 WebXR planes. This placement step must
be included in future PC-checkpoint review instructions.

The selected existing orb `0a12383fe11d485984362445458f27c5` began with
an X/Z tilt. Agent reviewed a measured-support move and explicitly made the
orb upright. Succeeded Matrix receipts `a198b1accad446c39f3377a763abbd2b`
and `05d9052eb7b941c7aa5b5730149d94fb` moved that same ID to its final
support-fit position; the wearer reported **“it works.”** The live scene still
had eleven objects and the original panorama. This is wearer evidence for one
measured placement, without recording private surface geometry.

For the wearer's room-aware reorganization request, an initial Agent turn was
cancelled before any new world edit so the wearer could add a design clause.
The revised turn used fresh aligned AR context. Reviewed, succeeded guarded
receipts moved the other orb `b495e5e4ae2f46d3a6048e1b813bc488` onto a
measured TABLE (`88d3acb7c6ac414eaee60d4e2fbb0452`) and the two existing
pedestals `7df21d354bdc458cacea85cf40b5cc11` and
`aa0d3620632a46328fe81358c74c42af` onto a measured FLOOR
(`2a4f77db6f1a47cbaecfea7171b26e1` and
`8e1cc4e1b1d543caa1e6fd5988c9a1a0`). Each retained its object ID;
the scene stayed at eleven objects. The Agent also proposed moving the curved
bench, but the room-move tool rejected it before a request ID because this
procedural asset has no measured bounds; the bench remained at its original
transform. The wearer has not yet assessed the complete composition.

Still required on this live build: verify stale room context rejects without
an edit; exit AR, save, reopen, and compare IDs, transforms, panorama and
physical-alignment status; obtain the wearer's VR composition and final AR
layout observations. No Quest save/reopen or stale-context result is inferred
from the successful move receipts.

## Rebase integration review

Room-aware source commit `1515241` now descends from the #162 merge commit
`704068c`. This rebase added no conflicts. The earlier seven shared-file
conflicts with #150 were resolved by retaining both
sets of capabilities: panorama catalog and Agent tools, generated panorama
context, background rendering and AR hiding; plus room observations, measured
support tools, tracking guards and alignment checks. The automatically merged
Agent bridge and XR context paths were inspected. A combined WebRuntime test
sets a panorama, enters AR, confirms a measured support, moves an existing
virtual object with the current room constraint, and verifies the panorama and
object ID survive AR exit. This is source-level evidence only.

The focused cross-feature runs passed: 67 ControlService tests and 43
WebRuntime tests. The #159 rebase full suites passed 879/879 ControlService and
674/674 WebRuntime tests; the #162 rebase passed 879/879 ControlService and
675/675 WebRuntime tests and the production Vite build. Quest
review of the exact rebased build is still required for a measured AR move
and wearer-confirmed physical fit.

The remaining exact-build gates are: restore/reopen the eleven-object world in
Quest VR; enter AR and verify room alignment against visible outlines; make
one measured, room-constrained move of an existing object with a succeeded
receipt and stable ID; verify the physical fit; reject a stale room token
without an edit; then exit AR, save, and reopen with that move preserved.
