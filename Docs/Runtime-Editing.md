# Runtime prefab editing progress

Updated 2026-09-20. This lane implements the handover's bundled-prefab editing contract; Quest Pro device validation is coordinated separately.

## Existing runtime retained

`SandboxWorld` already supplies stable generated object IDs, registered assets and anchors, bounded full transforms, targeted spawn/move/rotate/scale/delete, clear, detached state snapshots, schema-1 JSON documents, and all-or-nothing validation before scene replacement. Objects are parented to their room target and saved in that target's local coordinate frame. A changed room ID or missing anchor rejects restoration without silently placing objects at the world origin. No catalog or downloaded prefab support was introduced.

## Changes in this lane

- `Assets/Sandbox/Runtime/SandboxApp.cs`: validates a replacement world before disposing the current world; a malformed room registry preserves live objects and selection.
- Selection now stays on an existing object when a different object is deleted. Invalid selections preserve the valid current selection. Reloading a document preserves selection when that ID still exists; clear or deletion of the selected object clears it.
- `InvalidateRoom(string message)` explicitly disposes the old world, clears targets and placement, and sets `World` to null before an MRUK adapter removes anchors. The adapter remains responsible for guarding unsaved objects and setting `RoomReloading`. This avoids publishing a stale room after room loading fails.
- Placement material lifetime is tracked separately, and owned temporary objects are cleaned up correctly in both play mode and Editor tests.
- `Assets/Sandbox/Editor/SandboxCoreChecks.cs`: adds 13 application-level checks to the previous 67. The new checks cover selection targeting, manual revisions retaining the same ID, serialization -> clear -> restore in the same app, restoration after translating/rotating the room frame, invalid room replacement preserving objects, explicit room invalidation, and recovery.

`SandboxData.cs`, `SandboxWorld.cs`, and `DesktopControls.cs` did not require changes. Existing command names, DTO fields, and schema version remain compatible with the PC service and AI adapter.

## Validation evidence

- Passed: Roslyn source compilation of `SandboxData.cs`, `SandboxWorld.cs`, and `SandboxApp.cs` against the installed Unity 6000.6.0f1 metadata.
- Passed: separate source compilation of `SandboxCoreChecks.cs` against that freshly compiled runtime assembly and Unity Editor metadata.
- Compiler outputs and response files: task `work/runtime-editing-check/`.
- Not performed by this lane: Unity Editor execution of the expanded 80-check suite, player/PC service end-to-end execution, Android build, Quest Pro install, passthrough/room data/controller testing. The coordinating agent owns those runs; see the central progress log and final validation artifacts for actual results.

## Resume / coordination

The MRUK lane owns `QuestRoomAdapter.cs` and calls `InvalidateRoom` immediately before loading replacement device room data, after its no-objects guard. The root lane owns `PcBridge.cs` and skips exchanges while `World` is null or `RoomReloading` is true. Run `ArSandbox.SandboxCoreChecks.Run` through the existing build/validation entry point; a complete pass should report 80 checks. These additions do not establish hardware correctness by themselves.
