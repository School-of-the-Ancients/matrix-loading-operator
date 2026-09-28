# Room-aware Operator #149 — WebXR review

This review began on `codex/room-aware-149` from `main` at `db2142a`.
PR #159 subsequently merged as `1ad61d0`; this branch was rebased onto that
commit. The combined source includes generated panoramas and room-aware
Operator context. Rebase validation below is separate from Quest wearer proof.

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

The original isolated #160 review used `http://127.0.0.1:18966/web/`. For the
rebased branch, use a fresh combined review service and a separate scene and
asset directory containing the generated panorama. Leave the service token
empty on a loopback review. Record its actual URL, source commit, and restored
checkpoint with the new wearer evidence. The earlier 18966 review predates
the #150 merge.
Select **PC world checkpoints → quest149-lantern-garden-eleven-objects**,
then **Restore world → Confirm restore**. The desktop runtime tab must be
closed before Quest takes the single writer lease.

1. Restore the named eleven-object world in Quest Browser. In VR, inspect the
   five new garden elements around the six preserved bridges/block. Record the
   visible result and any rendering or reachability problem.
2. Save/reopen or restore the same named checkpoint and confirm the six original
   and five added digital objects remain visible with their supported IDs.
3. Enter AR with the same saved composition. Allow Quest room planes and the
   room origin to settle. Check the visible outlines before selecting **Confirm
   room**. If tracking or alignment is unavailable, record the stated reason;
   do not claim a physical fit.
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
| ControlService full suite | Original branch: `python -m unittest discover -v`: 865 passed, 0 failed. Rebased branch: `python -m unittest discover`: 879 passed, 0 failed. |
| WebRuntime full suite and production build | Original branch: `npm test`: 642 passed, 0 failed. Rebased branch: `npm test`: 674 passed, 0 failed; `npm run build`: passed. |
| Isolated desktop review | `http://127.0.0.1:18966/web/` served the final build with separate scene and asset directories; the PC checkpoint list contained `quest91-agent-strong-beacon-six-objects`, and UI restore displayed six original objects. The Agent Portal connected and read the six IDs/transforms at scene revision 3; it reported desktop mode, zero measured planes, and no physical fit claim. |
| Agent composition / typed receipts | After service restart, Agent recaptured all six original IDs/transforms at source scene revision 1, then created two pedestal/orb pairs and one curved bench with five individually approved, succeeded typed receipts. Final live revision 11 had 11 objects. |
| PC checkpoint and desktop reopen | Saved `quest149-lantern-garden-eleven-objects`, then reloaded the page and explicitly restored it through the PC checkpoint picker; UI reported 11 objects. Comparing checkpoint payloads found all six original IDs and transforms unchanged and exactly five new IDs. Saved checkpoint SHA-256: `C8E2D4BB4631C9AFC20E4BC14045E5C40FE09646E7BE28C154255C3BAB88FA84`. |
| Quest VR save/reopen composition | Pending wearer check; desktop restore is not VR proof |
| Quest AR measured move and alignment | Pending wearer check |

Automated and desktop checks are not Quest wearer evidence.

## Rebase integration review

Rebased source commit `2563ed7` descends from the #159 merge commit
`1ad61d0`. The seven shared-file conflicts were resolved by retaining both
sets of capabilities: panorama catalog and Agent tools, generated panorama
context, background rendering and AR hiding; plus room observations, measured
support tools, tracking guards and alignment checks. The automatically merged
Agent bridge and XR context paths were inspected. A combined WebRuntime test
sets a panorama, enters AR, confirms a measured support, moves an existing
virtual object with the current room constraint, and verifies the panorama and
object ID survive AR exit. This is source-level evidence only.

The focused cross-feature runs passed: 67 ControlService tests and 43
WebRuntime tests. The rebased full suites passed 879/879 ControlService and
674/674 WebRuntime tests, and the production Vite build succeeded. Quest
review of the exact rebased build is still required for a measured AR move
and wearer-confirmed physical fit.
