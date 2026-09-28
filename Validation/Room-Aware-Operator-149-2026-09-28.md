# Room-aware Operator #149 — WebXR review

This review began on `codex/room-aware-149` from `main` at `db2142a`.
PR #159 subsequently merged as `1ad61d0`, and panorama voice routing PR #162
merged as `704068c`. This branch is now rebased onto `704068c`; its room-aware
implementation commit is `1515241`. The combined source includes generated
panoramas, natural spoken panorama routing, and room-aware Operator context.
Rebase validation below is separate from Quest wearer proof.

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
  geometry. The prompt shows only a limited set of plane poses and polygons.
  A physical camera frame is never a metric room measurement.
- `matrix_spawn_on_surface` places a new session-local object on a measured
  support through the usual Matrix queue and observed receipt.
  `matrix_move_with_room_constraint` moves an existing virtual-floor object
  while retaining its object ID. The browser checks its complete footprint
  against the latest measured support sample and tracking epoch at execution
  time, including after small plane-boundary changes. A moved virtual
  object remains in the digital scene when AR ends; plane-anchored additions
  do not.
- Ordinary text turns without spatial opt-in retain the existing small
  runtime context. The PC-owned Agent can separately request the bounded
  private `matrix_room_spatial_context` read while the AR runtime is connected;
  this read is available to the owner Agent on any turn. No raw room image,
  private credential, or unrestricted room scan is written to a public review
  artifact.

## Wearer review sequence

The original isolated #160 desktop review used `http://127.0.0.1:18966/web/`
before #150 merged. The combined review port is
`http://127.0.0.1:18970/web/`, with separate private scene,
asset, and environment directories and no loopback token. Its checkpoint
picker contains `quest150-codex-moonlit-forest-garden-v1` (the eleven-object
garden with the selected generated panorama). A desktop review restored that
checkpoint and observed eleven objects and the expected panorama; the desktop
tab was then closed to release the single writer lease for Quest. This is
staging evidence, not a wearer result. The 18970 service was started from
pre-hotfix commit `99acfde`; restart it and rebuild WebRuntime from the new
branch head before using that port for exact-head Quest acceptance.

On Quest, select **PC world checkpoints →
quest150-codex-moonlit-forest-garden-v1**, then **Restore world → Confirm
restore**. Use the 18970 page for all remaining wearer checks. Record the
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
   `matrix_spawn_on_surface` can test session-local measured placement.
5. Exit AR, then save and reopen to verify the digital composition and moved
   virtual object. Do not expect the session-local measured-plane spawn to
   survive AR exit.

Record Quest Browser version, presentation, room plane count, origin/alignment
status, tracking loss or relocalization, exact receipts, observed object IDs,
and the wearer's visible VR/AR result. Keep the user's private room polygon
and camera pixels out of this record.

## Evidence status

| Gate | Result |
| --- | --- |
| ControlService full suite | Original branch: `python -m unittest discover -v`: 865 passed, 0 failed. Rebased on #159 and again on #162: `python -m unittest discover`: 879 passed, 0 failed each time. |
| WebRuntime full suite and production build | Original branch: `npm test`: 642 passed, 0 failed. Rebased on #159: 674 passed, 0 failed. Rebased on #162: 675 passed, 0 failed; `npm run build`: passed. |
| Isolated desktop review | `http://127.0.0.1:18966/web/` served the final build with separate scene and asset directories; the PC checkpoint list contained `quest91-agent-strong-beacon-six-objects`, and UI restore displayed six original objects. The Agent Portal connected and read the six IDs/transforms at scene revision 3; it reported desktop mode, zero measured planes, and no physical fit claim. |
| Agent composition / typed receipts | After service restart, Agent recaptured all six original IDs/transforms at source scene revision 1, then created two pedestal/orb pairs and one curved bench with five individually approved, succeeded typed receipts. Final live revision 11 had 11 objects. |
| PC checkpoint and desktop reopen | Saved `quest149-lantern-garden-eleven-objects`, then reloaded the page and explicitly restored it through the PC checkpoint picker; UI reported 11 objects. Comparing checkpoint payloads found all six original IDs and transforms unchanged and exactly five new IDs. Saved checkpoint SHA-256: `C8E2D4BB4631C9AFC20E4BC14045E5C40FE09646E7BE28C154255C3BAB88FA84`. |
| Combined #150 + #149 desktop staging | `http://127.0.0.1:18970/web/` was started from pre-hotfix `99acfde` with separate private review state. A desktop tab restored `quest150-codex-moonlit-forest-garden-v1` and observed the eleven-object garden and expected generated panorama; the tab was closed before Quest review. Restart/rebuild is required for exact-head review after PR #162. No Quest result is inferred. |
| Quest VR save/reopen composition | Pending on the combined 18970 build; desktop restore and the earlier 18968/18969 wearer observations do not establish this exact build's VR result. |
| Quest AR measured move and alignment | Pending wearer check |

Automated and desktop checks are not Quest wearer evidence.

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
