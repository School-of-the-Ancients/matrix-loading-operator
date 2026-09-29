# Selected placement point review — 2026-09-28

## Source behavior recovered from Unity

The read-only archive in `Archive/Unity/Assets/Sandbox/Runtime/QuestRoomAdapter.cs` uses the right controller ray and trigger to select a measured MRUK floor or table hit. It converts the hit to the support anchor's local frame and rounds local Y to zero. `SandboxApp.cs` then keeps a cyan “Selected placement” sphere at that point. Its transient pointing observation is a separate value in the room snapshot. The archive has thumbstick object edits; it does not show a coordinate editor for the placement marker.

## WebXR interaction to review

1. In AR, review room outlines and confirm alignment. Aim at a measured support and press the controller trigger. A small cyan point stays on that support after the ray moves.
2. Aim at another spot on the support and press again. The same point moves. A different support can become the selected destination if currently measured and aligned.
3. Select an object, then pin a support destination. Pinning turns on **Attach selected object, pinned destination, and current pointing hit** for future Agent requests. Agent context contains both `selectedObjectId` and `selectedPlacement`, while `pointingTarget` remains the transient ray observation. Requests such as “move that there” should use the selected object and pinned destination. Typed move and spawn tools still require fresh spatial tokens and their normal guards.
4. In the browser Room controls, edit X/Z in metres on the selected support and choose **Move marker**, or choose **Clear marker**. The support boundary constrains edits. The controller trigger is the in-world way to reposition the point while immersed.
5. Lose room alignment, the origin, the measured support, or the current tracking epoch. The marker and coordinate editor become unavailable, and Agent context omits `selectedPlacement`. Reacquire and select again.
6. A controller trigger that misses the support must leave the marker unchanged even if the viewer-gaze hit-test reticle is visible on another spot. The ray and the reticle use different input origins.
7. Archive and open a new world or restore a checkpoint with the same virtual room ID. The old marker becomes unavailable in the replacement world. If a world switch rolls back, the prior marker remains valid.

The old “Room target” surface selector belongs to the archived Unity Operator compatibility page in `ControlService/index.html`. It is disabled when a WebXR client is connected. The current `/web/` interaction now uses a point selected with the ray rather than that selector.

## Original #168 head evidence (`9fe1d9a`)

- `WebRuntime`: `npm test` passed, 687 tests. `npm run build` passed. Focused point, view, Agent context, Blender placement, world-slot, and PC-checkpoint tests cover retention, repeated hits, object selection coexistence, boundary rejection, stale alignment/origin handling, controller ray misses, and same-room world replacement with rollback.
- `ControlService`: `python -m unittest discover` passed, 880 tests. Focused Agent context HTTP test accepts a valid measured point and rejects a missing support, outside point, and unverified alignment. Prompt coverage distinguishes a synthetic virtual-floor pin from an AR measured-support hit.
- Desktop UI: isolated Vite server on port 18980, Chrome `/web/`. Clicking two virtual-floor locations updated X/Z and moved the cyan marker. Editing X/Z and pressing **Move marker** changed its status to “adjusted point.” This page had no ControlService connection; a connection JSON error appeared, so Agent request delivery was not exercised in this desktop check.
- Quest wearer: not tested in this branch. The AR trigger, alignment loss, readability, and physical placement must be checked on device against this review list.

These checks do not claim physical collision, safe object fit, or successful live world mutation. The existing typed tool guards and receipts decide those operations.

The Blender bridge test also checks that the exchanged PC selection matches the pinned destination projection while the selected object ID remains intact, including an AR pin on another measured support. A changed PC selection or marker is rejected. The Agent prompt identifies `web-floor` raycast points as virtual rather than measured room evidence.

## Restack on durable room-aware placement

PR #168 was restacked on #160 at `e152aa9`. A Blender-created GLB aimed at a measured AR support now queues `placement: 'surface'` with the current support ID and tracking epoch as `roomConstraint`. Capture and delivery require the same fresh aligned room and origin as the runtime's guarded surface spawn. The browser converts a successful spawn to a canonical `web-floor` object and checks measured overlap; the Blender bridge confirms the PC receipt's `room-surface-spawn` outcome, support ID, and exact stored transform. A failed or uncertain placement leaves the registered GLB in the catalog and does not queue a retry.

On this restacked source, WebRuntime `npm test` passed 697/697 and `npm run build` passed. ControlService `python -m unittest discover -q` passed 884/884. The added Blender regression executes a guarded spawn in `MatrixWorld`, confirms its PC and browser receipt, saves it, exits AR, and restores the same object ID and transform. It also covers lost support before and after queue guard, stale measured context, missing durable outcome, and one queue on an uncertain receipt. These are automated checks; current-head Quest wearer placement and marker readability remain open.
