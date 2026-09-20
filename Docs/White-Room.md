# Matrix Operator: the virtual white room

The virtual room has passed 21 command/persistence checks on the actual Quest Pro; the wearer confirms restored objects and selection work. The current pass uses the user's ChatGPT/Codex subscription through the PC CLI: a live spawn succeeded, but HTTP 409 stopped the next resize proposal. Finish that AI loop before the existing MRUK path with manually configured room surfaces. Education, mentors, curriculum, voice and downloaded catalogs are separate later work. Quest 3 is optional.

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

The previously merged learning activity remains on the separate optional <http://127.0.0.1:8765/learning> page, also linked under Connection settings. Ordinary white-room editing and scene-only save/load require no learning-core process. If you explicitly load a save containing a learning checkpoint, use that page for its learning-core connection and checkpoint recovery controls.

The build script generates an independent Unity project under `.white-room-fixture/Desktop` using an explicit list of this repository's authored sources. It preserves the existing MRUK project. To open the white-room scene in Unity, open this generated project and `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomDesktop.unity`. **Sandbox → White room → Generate desktop scene** regenerates that generated scene and bundled props.

## Open the Desktop exports in Unity Hub

In Unity Hub choose **Add project from disk**, then select one of these folders under **Desktop → Game Design**. Use Unity **6000.6.0f1**:

| Project folder | Scene to open |
| --- | --- |
| Matrix White Room Quest | `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomQuest.unity` |
| Matrix White Room Desktop | `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomDesktop.unity` |

These complete Unity source copies contain Assets, Packages and ProjectSettings, with all metadata. The Quest copy's 103 files and Desktop copy's 90 files match their generated sources by SHA-256. Neither export was opened or rebuilt at its new location. Unity creates caches on first import; the Quest target also needs Android Build Support. No Meta Core/MRUK packages or credentials were copied. [Export evidence](../Validation/unity-hub-export.json).

The sibling **Matrix Loading Operator** full repository copy also contains the copied builds and local saves. Make authoritative source changes there and regenerate with `Build-WhiteRoom.ps1`; changes made only in a generated Hub copy do not flow back automatically. Follow the [Desktop guide](Desktop-Unity-Hub.md) when switching the running PC service to that checkout.

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

The installer requires one USB-connected, ADB-authorized headset and installs `Builds/WhiteRoomQuest/MatrixOperator.apk` while preserving app data. Installation and forwarding succeeded on Quest Pro, but its implicit launch failed; open **Matrix Operator** manually from **Unknown Sources**. The installed APK remains the same validated artifact. Keep the PC service running and close the desktop player: the service leases one active runtime at a time, with a 15-second disconnect timeout.

After unplugging/reconnecting USB, run `./Connect-QuestControl.ps1` to restore forwarding without reinstalling or launching anything. It verifies the exact Quest model, PC health and port mapping while preserving other reverse rules. Supply `-Serial` if several authorized devices are connected; `-Port` defaults to 8765. This repaired the observed offline connection on the actual Quest Pro.

After installation, a repeatable device check is available:

```powershell
python Validation/Run-Headset-Loop.py
python Validation/Run-Headset-Loop.py --run
```

The first command only inspects the connected app and service. Run the second after confirming that the headset owns the PC connection, with controller and browser editing paused. It saves the existing arrangement under a unique PC backup name, spawns and edits a chair through the existing executor, saves/clears/restores it, then restores the original arrangement. In-memory undo history is changed by these edits and cannot be restored from the scene save. The report records acknowledgements and exact object/anchor identities separately from wearer observations. It does not invoke a language parser or model. If recovery cannot complete, retain the named backup and follow the report's recovery instruction. These controls cannot prove visual rendering, floor height or physical input; the wearer must check those. See the [current hardware session](../Validation/Quest-Pro-Session.md).

The isolated Quest project lives at `.white-room-fixture/Quest`; its scene is `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomQuest.unity`. This fully virtual build uses Unity OpenXR, XR Management and Input System with Quest Pro/Quest 3 device profiles. It does not import Meta Core or MRUK and does not modify antivirus settings or quarantined files. The original passthrough/MRUK path remains available separately under the existing build scripts and documentation.

- Right trigger: select an object or floor placement point.
- A: summon the selected catalog prop. B: cycle props.
- X: delete the selected object.
- Left stick: nudge selected object by 10 cm in the floor axes.
- Right stick: turn 15 degrees or resize by 1.2; return sticks to neutral before another edit.
- PC panel: natural-language proposals, precise transforms, history, save and restore.

The rig requires floor-level tracking and pauses controller edits when head/controller tracking or focus is lost. Inputs must be released before editing resumes. It provides no artificial locomotion; move physically within your headset boundary. The wearer confirmed object selection; the complete button/stick, tracking recovery, floor-height, recenter and comfort checklist is still separate.

## Validation and limitations

See [current validation evidence](../Validation/White-Room-Validation.md) and [durable progress log](Progress-Log.md). Compile/build, automated player tests, browser checks and hardware tests are recorded separately. Existing historical reports describe the earlier AR prototype and do not establish white-room behavior.

For the selected subscription mode, stop the previous PC service and run `./Start-CodexControlService.ps1`. The native Codex CLI is signed in with ChatGPT and manages its own credentials. The first live model proposal spawned a chair with a runtime acknowledgement; the next resize proposal returned HTTP 409. A changed chair rotation in recovery supports stale-context rejection, but the exact cause is unconfirmed. The run recorded 27 passed checks and one failure, then restored all three original objects. Full live AI save/clear/restore remains unfinished. The explicit offline parser and compatible API route remain available separately; voice is unimplemented. [AI configuration and vocabulary](AI-Integration.md).
