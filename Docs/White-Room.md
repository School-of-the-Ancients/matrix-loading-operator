# Matrix Operator: the virtual white room

The current priority is an empty virtual room with useful Operator abilities. Education, mentors, curriculum, downloaded catalogs and physical-room scanning are separate later work. Quest Pro is the hardware target; Quest 3 is optional.

The room loads automatically with a fixed floor at y=0. Its stable `white-room-v1` / `white-floor` coordinate frame allows a saved arrangement to survive an application restart without a physical room scan. All units are metres. Headset recentering can change where the viewer stands in this virtual scene; this mode does not promise alignment with real furniture.

## Build and run on Windows

Use Unity **6000.6.0f1** and Python **3.10+**. In PowerShell at the repository root:

```powershell
./Build-WhiteRoom.ps1 -Target Desktop
./Start-ControlService.ps1
```

Keep the service terminal open. In a second terminal:

```powershell
& ./Builds/WhiteRoomDesktop/MatrixOperator.exe
```

Open <http://127.0.0.1:8765/>. The page reports **WHITE ROOM CONNECTED** when the app is exchanging state. The desktop player starts empty; the green placement point starts two metres forward of the origin. Click a floor point to move it. Click an object to select it. Hold right mouse and use WASD to move the camera, Q/E to lower/raise it. Release right mouse to edit through the panel.

The build script generates an independent Unity project under `.white-room-fixture/Desktop` using an explicit list of this repository's authored sources. It preserves the existing MRUK project. To open the white-room scene in Unity, open this generated project and `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomDesktop.unity`. **Sandbox → White room → Generate desktop scene** regenerates that generated scene and bundled props.

## Operator loop

The seven bundled assets are chair, table, wall, pedestal, block, orb and column. Furniture uses authored life-size geometry and scale 1; primitives start at scale 0.2. All have floor-aligned pivots. The catalog carries each asset's default scale, so desktop, headset, PC panel and offline commands agree.

In the PC panel, enter each request, choose **Create proposal**, review it, then **Apply reviewed proposal**. Wait for the runtime confirmation before continuing:

```text
Summon a chair here
Move it 50 cm left
Rotate it 45 degrees
Make it twice as big
Summon a table here
Select the chair
Duplicate it
Undo
Redo
Save as Demo
Clear the scene
Load Demo
```

Selection uses stable object identity. A name such as “the chair” must identify exactly one object; after duplicating, use the object picker or exact ID to disambiguate. Duplication copies the asset and transform, offsets local X by 0.3 m within coordinate limits, and returns a new ID. Undo/redo retain IDs and the last 32 successful edits while the app runs. History is not saved across restarts. Saved scenes retain schema version 1 and exact IDs, assets, anchors and transforms.

The PC page also has direct spawn, object selection, nine transform fields, duplicate, delete, undo, redo, clear, save and restore controls. It waits for queued edits before saving. A dirty transform draft detects an observed runtime change and reloads it before applying, preventing an old draft from silently replacing that observed change.

Saves are JSON under `ControlService/scenes/`. Reusing a name replaces that save atomically. `Load Demo` restores a saved scene. If a saved scene exactly matches a load request's name, it takes precedence; otherwise `load a chair` can summon a catalog asset. `summon a chair` is the unambiguous prop wording. Saves from MRUK rooms cannot be silently loaded into the white-room frame.

## Quest Pro build and controls

Install Unity Android Build Support, SDK/NDK and OpenJDK, then run:

```powershell
./Build-WhiteRoom.ps1 -Target Quest
./Install-WhiteRoom.ps1
```

The installer requires one USB-connected, ADB-authorized headset, installs `Builds/WhiteRoomQuest/MatrixOperator.apk`, forwards the PC service port with `adb reverse`, and launches `com.matt.matrixoperator.whiteroom`. Keep the PC service running. Close the desktop player before pairing the headset: the service leases one active runtime at a time, with a 15-second disconnect timeout.

The isolated Quest project lives at `.white-room-fixture/Quest`; its scene is `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomQuest.unity`. This fully virtual build uses Unity OpenXR, XR Management and Input System with Quest Pro/Quest 3 device profiles. It does not import Meta Core or MRUK and does not modify antivirus settings or quarantined files. The original passthrough/MRUK path remains available separately under the existing build scripts and documentation.

- Right trigger: select an object or floor placement point.
- A: summon the selected catalog prop. B: cycle props.
- X: delete the selected object.
- Left stick: nudge selected object by 10 cm in the floor axes.
- Right stick: turn 15 degrees or resize by 1.2; return sticks to neutral before another edit.
- PC panel: natural-language proposals, precise transforms, history, save and restore.

The rig requires floor-level tracking and pauses controller edits when head/controller tracking or focus is lost. Inputs must be released before editing resumes. It provides no artificial locomotion; move physically within your headset boundary. Visual comfort, Touch Pro mapping, floor height and recenter behavior need on-device validation.

## Validation and limitations

See [current validation evidence](../Validation/White-Room-Validation.md) and [durable progress log](Progress-Log.md). Compile/build, automated player tests, browser checks and hardware tests are recorded separately. Existing historical reports describe the earlier AR prototype and do not establish white-room behavior.

No compatible live AI provider was available in the checked configuration. The tested natural-language loop uses the explicitly labeled offline parser. The optional provider adapter is implemented and tested with mock HTTP responses, including strict command validation; live AI interpretation and voice are not claimed. [AI configuration and vocabulary](AI-Integration.md).
