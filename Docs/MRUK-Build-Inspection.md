# MRUK native build inspection

Read-only inspection on 2026-09-20, before the room-aware AR implementation/build. This report is a baseline, not evidence that the new AR player compiled or ran. No package files, antivirus settings, existing Unity assets, or quarantined files were changed.

## Build evidence

- Authoritative source uses Unity **6000.6.0f1** and registry packages **Meta XR Core 205.0.0 / MRUK 205.0.0**. The MRUK package declares Unity 6000.0.66f2 as its baseline and depends on Core 205.0.0.
- The historical Android failure is `outputs/AR-Sandbox/Validation/quest-pro-build.log:2677-2679`: Bee could not launch the cache upload for the generated `Meta.XR.BuildingBlocks.AIBlocks.dll`; Windows returned **GetLastError 5: Access is denied**. `Docs/Security-Block.md` records the associated Malwarebytes quarantine at 12:10 local. It was not a C# diagnostic, Gradle failure, or headset failure.
- The latest available Malwarebytes detection-file timestamp at inspection remained **12:10:40**. This alone does not prove the security issue is resolved.
- A later Desktop full-clone Editor import produced `Meta.XR.BuildingBlocks.AIBlocks.dll`, `meta.xr.mrutilitykit.dll`, and `Assembly-CSharp.dll` at about **15:21**. Its `Logs/Editor.log:2906` reports completed script compilation; targeted searches found no C# errors or compilation-failed messages. Those are **Editor artifacts**, not Android/IL2CPP build evidence.
- The visible Unity window was **Matrix White Room Quest / WhiteRoomQuest**, with Windows, Mac, Linux selected. Preserve that open project and its authored scene. Its title is sufficient for this observation; complete Unity command lines were not printed because they can contain Hub credentials.

The legitimate next build is the ordinary native source/package build, preferably in a separate fixture so it cannot rewrite the user's open white-room scene. Do not copy old compiled assemblies into it. Preserve the original security-failure logs and stop at a new security denial if one occurs.

## Optional AI Blocks are not a documented build switch

The installed Core assembly definition `Scripts/BuildingBlocks/AIBlocks/Meta.XR.BuildingBlocks.AIBlocks.asmdef` is `autoReferenced: true`, with empty platform filters and `defineConstraints`. Its version defines enable individual integrations; none is a supported whole-assembly exclusion. This inspection found **no supported package configuration that removes the flagged optional assembly while retaining Core 205 unchanged**. Editing the package cache, altering that asmdef, copying a previously compiled DLL, or restoring quarantine would not be a supported configuration remedy.

## Existing native setup to extend

`Build-Quest.ps1` calls `ArSandbox.SandboxProjectSetup.BuildQuest`. The generated native scene already uses:

- `OVRCameraRig`, floor-level tracking, transparent camera clear color, and `OVRPassthroughLayer` as an underlay;
- MRUK device data, explicit **Scene Model V1**, high-fidelity loading disabled, and world locking enabled;
- Android ARM64/IL2CPP, OpenXR Meta features, Touch Pro interaction support, Quest Pro (`cambria`) and Quest 3 (`eureka`) targets;
- required scene and passthrough support, enabled anchor support, and manifest generation through `OVRManifestPreprocessor`.

Its baseline package ID is `com.matt.arsandbox`, separate from the installed white room's `com.matt.matrixoperator.whiteroom`. Keeping separate IDs/build outputs preserves the working app during AR validation. The native generator currently has older interaction wiring; voice, proposal confirmation, and undo must be explicitly connected to the AR rig. Verify `RECORD_AUDIO`, scene permission, internet access, scene/anchor support, and passthrough features in the **built manifest**, rather than assuming settings alone prove inclusion.

## Quest Pro room path

Meta documents on-headset Space Setup, including manual outlining, and explicitly excludes performing capture through Link. The intended Quest Pro path uses those manually configured scene anchors. Missing room data must stay a visible runtime state, rather than silently loading sample-room JSON. [Manage/query scene data](https://developers.meta.com/horizon/documentation/unity/unity-mr-utility-kit-manage-scene-data/)

Meta's scene setup requires a camera rig, scene permission, passthrough support, and updated Android manifest. [MRUK getting started](https://developers.meta.com/horizon/documentation/unity/unity-mr-utility-kit-gs/)

Depth API requires Quest 3 or Quest 3S. Do not use environment-depth placement as the Quest Pro fallback. Room-anchor geometry and MRUK raycasts are the relevant placement inputs here. [Depth API requirements](https://developers.meta.com/horizon/documentation/unity/unity-depthapi-overview/)

Installed MRUK 205 source confirms:

- `MRUK.LoadSceneFromDevice(bool requestSceneCaptureIfNoDataFound = true, bool removeMissingRooms = true, SceneModel sceneModel = SceneModel.V1)` exposes the explicit V1 load path (`Core/Scripts/MRUK.cs:1052`).
- `MRUK.Shared.cs:250` distinguishes missing scene permission from absent rooms and retries capture at most once. Capture completion still requires checking discovery's result.
- Anchors expose persistent `Anchor.Uuid`, semantic `Label`, `PlaneRect`, `PlaneBoundary2D`, `VolumeBounds`, and a geometry-based `Raycast`. The sandbox should retain anchor-relative transforms and object IDs when translating these into its existing command executor.
- Query APIs do not require adding guessed physical colliders to the whole room. Draw outlines from the actual loaded geometry and retain current room/anchor identity in scene saves.

## Validation still required

No build, install, permission request, MRUK discovery, or headset interaction was performed by this inspection lane. Native compilation, built-manifest verification, labeled-outline alignment, real microphone requests against table anchors, and save/reload alignment remain separate evidence requirements. A passing white-room build or Editor import does not satisfy them.
