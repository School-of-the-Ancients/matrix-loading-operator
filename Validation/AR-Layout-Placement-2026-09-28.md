# AR digital layout placement — 2026-09-28

## Behavior under review

`Archive + Place Here` preserves the digital world and creates a new room anchor at the wearer's current floor position and facing. The prior VR composition therefore moves and turns as one unit. Measured room outlines describe the physical scan, not the fit of the digital scene. This candidate adds explicit in-headset **World → Move / Turn Digital Layout** controls after a persistent room anchor is tracked. Each tap moves the digital root 0.25 m in its current facing or turns it 15°. Object IDs, authored local transforms, game and Citizens data do not change.

The root offset is browser-owned and stored only with the matching persistent room anchor. It is composed with the tracked anchor before `webFloorPose` is published to the existing room-placement guards. Every nudge invalidates the selected destination and tracking epoch, clears measured-room confirmation, and requires **I Checked Scene Clearance** before the separate measured-outline confirmation. An active Agent turn, pending receipt, or world exchange blocks adjustment. A browser checkpoint or world archive replacement during AR applies the same invalidation even when its offset matches, because different objects can occupy different physical space. Room recovery exports the old offset with its old anchor and starts the new anchor at zero.

The clearance review is the wearer's observation. Moving a pre-existing layout does not automatically prove that every object still fits a measured support or clears a wall, TV, or furniture. PC world checkpoints remain renderer-neutral and do not claim physical placement.

## Automated and desktop evidence

- Focused AR layout, origin, world-slot, and checkpoint checks: **55/55 passed**. They cover anchor × offset composition, old pin and epoch invalidation, separate layout/outline confirmation, same object IDs and local transforms, browser save/Exit AR/reopen, both different-offset and same-offset active AR checkpoint replacement, recovery archive reset, manual checkpoint provenance, and failed PC rollback. The full suite also includes queued world-switch rejection in the bridge test.
- Full WebRuntime suite on the refreshed v1.1 stack: **738/738 passed**, including in-headset panel hit targets for movement and the separate review buttons. Full ControlService suite: **895/895 passed** (one non-failing socket `ResourceWarning`). Production Vite build passed (bundle `view-QHxCC7Ip.js`). The release-builder checks passed **11/11**. The existing large JavaScript chunk warning remains.
- No desktop browser or Quest wearer has yet operated these new layout controls. Source tests and a build do not prove headset button legibility, real-room alignment, or clearance.

## Quest 3 wearer gate on the isolated v1.1 review service

Use the integrated v1.1 build on the separate port **18981** after the v1.0 review. Keep the wearer's current browser origin, room anchors, and saved worlds intact; use a disposable lab world or a verified browser checkpoint. Record the exact service commit and bundle, URL, headset browser version, anchor status, four object IDs and authored transforms, and the wearer's observation. Do not publish private room geometry or camera imagery.

1. Restore the four-object lab in VR, save its IDs/transforms, enter AR, and use **Archive + Place Here** only in the disposable recovery case. Wait for **ROOM ANCHORED**. Verify the old composition appears as one rigid layout, without a claim that it fits physical surfaces.
2. Open **World → Review Digital Layout** in the headset. Move and turn the composition to a wearer-chosen clear space using the 0.25 m / 15° buttons. Check readability and correct direction of each button. Inspect each object's relation to the floor, supports, wall, and TV. Verify its ID and authored local transform remain exact.
3. Verify a new nudge removes the old pinned destination and blocks measured placement. Press **I Checked Scene Clearance**, then separately confirm the measured room outlines. Repeat a nudge and verify a command tied to the previous tracking epoch fails rather than placing at the old room target.
4. Make one guarded same-ID move onto a measured support, inspect the receipt and final scene, then **Save World**. Exit AR and reopen the same Quest Browser origin. Verify the same persistent anchor relocalizes, the saved digital root offset returns, and IDs/local transforms remain exact. A missing or mismatched handle must keep the room-bound world hidden.
5. Record wearer pass/fail for actual physical clearance separately from automated identity/pose comparisons. Capture any denial, stale target, failed save, or anchor recovery message verbatim before retrying.

**Quest result: pending.** No wearer acceptance is claimed for this candidate.
