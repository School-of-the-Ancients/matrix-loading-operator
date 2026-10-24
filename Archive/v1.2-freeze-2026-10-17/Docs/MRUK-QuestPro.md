# Quest Pro room integration

Updated 2026-09-20. The current user request makes **Quest Pro with manually configured room data the primary target**. Quest 3 remains an optional compatible target. This supersedes earlier Quest 3 wording in historical inspection notes.

## What is implemented

- The native scene uses Meta MRUK/Core 205.0.0 with an `OVRCameraRig`, passthrough underlay, floor-level tracking, and MRUK world locking.
- The adapter requests the app's spatial data permission, then loads **device Scene Model V1**. It does not require a Quest 3 depth mesh, high-fidelity room model, camera access, or automatic room scanning.
- Quest Pro room configuration means the headset's **Space Setup** flow: manually mark the room floor and a table. Those real device anchors provide stable room/anchor UUIDs. No fabricated or desktop room is substituted in the native scene.
- If no room exists, a standalone Android load may open Space Setup once through MRUK. **Y** retries room loading. **Hold left grip and press Y** explicitly opens Space Setup, then loads its result. The system API can report that setup closed even if the user canceled, so the adapter always checks actual room discovery afterward.
- After discovery, the adapter allows up to ten seconds for the current room to localize. Missing permission, room, localization, or usable surface produces a visible retry/setup message.
- Floor and table anchors become stable +Y-up placement frames. The right controller ray selects an existing prop or a placement point. A spawns, B cycles bundled props, X deletes the selected object; left stick moves and right stick rotates/resizes.
- Reload/setup is refused while there are objects in the world. Save and clear first. Before MRUK changes its anchor objects, the adapter invalidates the previous empty sandbox world; a failed reload therefore cannot leave the PC bridge targeting dead room transforms.
- Scene and passthrough support remain required. OpenXR Touch Pro support is enabled. Quest Pro is listed first in the build setup; Quest 3 remains enabled without introducing a separate feature path.

## Evidence and references

The installed package's `Samples~/GitHub/Readme.txt` says samples moved to GitHub starting at v76. The first-party [Unity MRUK sample collection](https://github.com/oculus-samples/Unity-MRUtilityKitSample) provides Basic, Floor Zone, Multi Spawn, and related scenes. This pass prioritized those MRUK patterns and the installed SDK source; no VaM investigation was performed.

Exact installed-source references under `Library/PackageCache`:

- `com.meta.xr.mrutilitykit@2979546e7179/Core/Scripts/ImmersiveSceneDebugger.cs`, `GetLaunchSpaceSetupDebugger`: request `OVRScene.RequestSpaceSetup()`, then reload device data. Its raycast examples query MRUK room geometry directly rather than assuming physical Unity colliders exist for every room surface.
- `com.meta.xr.mrutilitykit@2979546e7179/Core/Scripts/MRUK.cs`, `LoadSceneFromDevice`: `requestSceneCaptureIfNoDataFound`, missing-room removal, and explicit `SceneModel.V1` parameters.
- `com.meta.xr.mrutilitykit@2979546e7179/Core/Scripts/MRUK.Shared.cs`, `LoadSceneFromDeviceSharedLib`: missing-permission/no-room results and a single capture/retry flow. Its Editor warning explicitly says scene capture cannot run over Link or XR Simulator.
- `com.meta.xr.sdk.core@c0efcbf2ba70/Scripts/OVRAnchor/OVRScene.cs`: setup pauses the app; completion does not prove the user created a room.

Meta's [manage/query scene data guide](https://developers.meta.com/horizon/documentation/unity/unity-mr-utility-kit-manage-scene-data/) documents on-headset Space Setup and manual capture, device data loading, and world locking. Its [getting-started guide](https://developers.meta.com/horizon/documentation/unity/unity-mr-utility-kit-gs/) describes scene permissions, camera rig, passthrough, and manifest configuration. Unity's [Quest development guide](https://docs.unity.com/en-us/engine/6000.0/manual/xr/configuring-project-for/meta-quest-develop) lists Quest Pro as a supported target. These source checks support the chosen integration; they do not establish that this particular headset is configured or working.

## Headset demonstration

1. In Quest Pro standalone mode, complete Space Setup and manually outline a floor and table. Current OS labels may say Physical Space or Environment Setup. Leave the existing configured room unchanged between save and restore.
2. Launch the APK and allow spatial data. Look around until the status reports a device room and at least one floor/table target. If needed, press Y. Left grip + Y opens setup when the scene is empty.
3. Connect the running PC service through the project's ADB reverse or configured LAN route. Confirm the HUD reports PC connectivity.
4. Aim at a real table/floor and press right trigger. Add a bundled prop, revise that same object from the PC natural-language control, save, clear, then restore in the same running app.
5. Confirm the restored asset, object identity, rotation, size, and room-relative placement. Confirm selection still works after restoring.

Space Setup must run on the headset, not in Link. Existing room data may be used through Link only with its spatial-data sharing setting enabled; Link is not the primary acceptance path. Recapturing/deleting the room can change its UUIDs and makes old scene saves intentionally fail room/anchor validation rather than relocate silently.

## Validation boundary and resume checklist

This lane inspected the installed API implementations and existing scene generator, preserved serialized field names and `.meta` GUIDs, and coordinated the new `SandboxApp.InvalidateRoom(string)` call with the runtime editing lane. The root task owns compilation, automated checks, APK generation, ADB discovery, and their durable evidence files.

No headset interaction or hardware test was performed by this lane. A passing desktop fixture or C# compilation does **not** validate headset permission prompts, passthrough, manual capture, controller rays, physical room localization, tracking stability, or on-device persistence.

When hardware is available, record the headset model/OS, APK build, room/target counts, permission denial/retry, canceled setup, manual table/floor selection, complete save/clear/restore loop, and tracking after removing/replacing the headset. Keep these results separate from source/build/desktop tests.
