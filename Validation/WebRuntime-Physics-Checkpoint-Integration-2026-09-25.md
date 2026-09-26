# Matrix Web physics and checkpoint integration — 2026-09-25

## Source and scope

This local integration branch starts at PR #93 (`61927bc`) and merges the open
M1 asset trace (#87), M2 whole-world checkpoint (#88), and M4 XR transition
stack (#86, #89, #90). The PRs remain open; none was merged on GitHub. The
combined check uses the current Three.js WebRuntime and PC ControlService.

The first combined test exposed a real M2/M3 contract gap:
`State._checked_world_checkpoint` forwarded component and animation capability
versions to `snapshot`, but omitted `physicsSchemaVersion`. A connected browser
that advertised physics could run a GLB drop, yet **Save world** rejected its
authored physics configuration with “Scene physics requires the WebXR physics
runtime.” The integration change forwards that already-advertised version.
The new Python regression failed before this fix and passed afterward.

## Automated checks

- Windows 11, Python 3.13.14: `python -m unittest discover -s ControlService
  -p test_*.py -q` — **637 passed**.
- Node 24.16.0: `npm test` in `WebRuntime` — **122 passed**.
- Vite 7.3.6: `npm run build` — passed.
- `git diff --check` — passed.

The new browser test combines an imported animated GLB, verified rendered
bounds, floor contact, browser storage restore, and AR entry/exit. It asserts
that the authored height, stable object ID, clips and physics configuration
survive, while the transient solver state does not. It also requires an
explicit new run after the restored GLB instance has been verified. The new
ControlService test covers the PC checkpoint with an animated registered GLB,
settled observation, a fresh service-state instance, and the same persistence
boundary.

## Isolated desktop browser and PC restart

Used scratch scenes and a copy of the existing test GLB catalog. Port 18776
served the initial browser; port 18777 served a fresh PC process and browser
origin with the **same** scratch scene and asset directories. The normal live
Matrix service and saved scenes were not changed.

1. The PC command API queued a spawn for the real Ice Dragon
   (`web:ice-dragon:2f5620d245e2`) at authored `(0, 2, -2)`, scale `0.5`.
   Receipt `3f15be17…` succeeded with object ID
   `3b4d8e8b9c4f48289d9694669c3b4d23`. The browser rendered the GLB.
2. Bound `Flight` as its loop and `Frost Burst` on selection; receipt
   `f983c643…` succeeded. `set_physics` with restitution `0.35` returned
   successful receipt `5e664f61…`; the browser reported a matching `settled`
   run at virtual-floor y=0 with five approximate contacts. The authored
   transform remained y=2. The desktop browser visibly showed the Dragon on
   the White Room floor.
3. The browser **Save world** control saved `Integrated Physics Dragon`.
   Its checkpoint payload digest is
   `92ae6907e1263544f0861a5af6ed5ab3b8adcace4ac4b3805aeb1b454da803fa`.
   The file contains the exact ID, transform, both clips, physics config and
   full GLB hash dependency. It contains no `physicsStates`.
4. After a PC service restart on port 18777, a new desktop browser origin
   started with zero objects. **Restore world → Confirm restore** reported
   success and displayed the same Dragon at authored y=2. The PC snapshot
   retained the same object ID, clips and physics config with an empty
   `physicsStates` array.
5. Explicit `set_physics` produced successful receipt `836ef94e…`, a new
   execution ID and five approximate floor contacts. It did not resume merely
   because the checkpoint was restored.

The simple offline proposal parser did not recognize the exploratory prompt
“Spawn the Ice Dragon two meters above the White Room floor in front of me”; it
reported that the asset was missing or ambiguous. The tested placement used
the typed, validated Matrix command API instead. This check does not establish
that the offline parser handles that wording or that a Codex turn authored this
particular placement.

## Remaining evidence

The combined build has not yet been checked by a Quest wearer. The prior
port-18772 #90 wearer run established VR → AR → VR entry and correct VR floor;
its subsequent VR CODEX push-to-talk check showed changed labels and one turn.
Those results are for the #90 branch, not this combined physics build. AR
physical-floor contact, object-to-object collision, and general rigid-body
physics remain outside this bounded virtual-floor capability.
