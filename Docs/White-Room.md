# Matrix Operator: the virtual white room

The original white-room headset milestone on September 20, 2026 passed 21 direct command/persistence checks and 61 live Codex AI loop checks on the actual Quest Pro. Five real model turns completed spawn, same-ID resize, save, clear and exact restore; the wearer confirmed seeing the AI changes and their scene restored.

Current source also includes [headset voice](Voice-And-Codex-Controls.md), Rotate/Bob, and [downloadable static prefab packs](Content-Library-User-Guide.md). Native [room-aware AR](Room-AR.md) has separate Quest Pro hardware evidence. Consult the [current checkpoint](Current-Checkpoint.md) for the build and validation scope of each feature; the original white-room results do not validate later features. Quest 3 is not required for this virtual mode.

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

The original workstation exports used these folders under **Desktop → Game Design**. If those copies are available, choose **Add project from disk** in Unity Hub and use Unity **6000.6.0f1**; a fresh clone does not contain these workstation folders:

| Project folder | Scene to open |
| --- | --- |
| Matrix White Room Quest | `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomQuest.unity` |
| Matrix White Room Desktop | `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomDesktop.unity` |

At export time, these complete Unity source copies contained Assets, Packages and ProjectSettings, with all metadata. The Quest copy's 103 files and Desktop copy's 90 files matched their generated sources by SHA-256; neither export had been opened or rebuilt at its new location. This historical inventory does not establish that a copy contains current source. Unity creates caches on first import; the Quest target also needs Android Build Support. No Meta Core/MRUK packages or credentials were copied. [Export evidence](../Validation/unity-hub-export.json).

The original sibling **Matrix Loading Operator** repository copy also held copied builds and local saves. Make source changes in your chosen full repository checkout and regenerate with `Build-WhiteRoom.ps1`; changes made only in a generated Hub copy do not flow back automatically. Follow the [Desktop guide](Desktop-Unity-Hub.md) when switching the running PC service to a different checkout.

## Operator loop

The seven bundled assets are chair, table, wall, pedestal, block, orb and column. Furniture uses authored life-size geometry and scale 1; primitives start at scale 0.2. All have floor-aligned pivots. The catalog carries each asset's default scale, so desktop, headset, PC panel and offline commands agree.

In the PC panel, enter each request, choose **Create proposal**, review it, then **Apply reviewed proposal**. Wait for the runtime confirmation before continuing:

For live AI, refresh the page and select **Codex (ChatGPT subscription)** first. If only offline mode appears, the browser may still have the older page loaded. Keep controller edits idle while inference and Apply are in progress.

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

The installer requires one USB-connected, ADB-authorized headset and installs `Builds/WhiteRoomQuest/MatrixOperator.apk` while preserving app data. In the original Quest Pro check, installation and forwarding succeeded but implicit launch failed; open **Matrix Operator** manually from **Unknown Sources**. Keep the PC service running and close the desktop player: the service leases one active runtime at a time, with a 15-second disconnect timeout.

After unplugging/reconnecting USB, run `./Connect-QuestControl.ps1` to restore forwarding without reinstalling or launching anything. It verifies the exact Quest model, PC health and port mapping while preserving other reverse rules. Supply `-Serial` if several authorized devices are connected; `-Port` defaults to 8765. Match the PC service port, headset's configured service URL, and USB reverse port, including any retained override from an earlier installation. This repaired the observed offline connection on the actual Quest Pro.

After installation, a repeatable device check is available:

```powershell
python Validation/Run-Headset-Loop.py
python Validation/Run-Headset-Loop.py --run
```

The first command only inspects the connected app and service. Run the second after confirming that the headset owns the PC connection, with controller and browser editing paused. It saves the existing arrangement under a unique PC backup name, spawns and edits a chair through the existing executor, saves/clears/restores it, then restores the original arrangement. In-memory undo history is changed by these edits and cannot be restored from the scene save. The report records acknowledgements and exact object/anchor identities separately from wearer observations. It does not invoke a language parser or model. If recovery cannot complete, retain the named backup and follow the report's recovery instruction. These controls cannot prove visual rendering, floor height or physical input; the wearer must check those. See the [current hardware session](../Validation/Quest-Pro-Session.md).

The isolated Quest project lives at `.white-room-fixture/Quest`; its scene is `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomQuest.unity`. This fully virtual build uses Unity OpenXR, XR Management and Input System with Quest Pro/Quest 3 device profiles. It does not import Meta Core or MRUK and does not modify antivirus settings or quarantined files. The original passthrough/MRUK path remains available separately under the existing build scripts and documentation.

- Right trigger: select an object or floor placement point.
- Hold/release left trigger: record speech and submit it for transcription and a proposal.
- Y: apply the reviewed voice proposal. Left grip: Undo one runtime edit.
- A: summon the selected catalog prop. B: cycle props.
- X: delete the selected object.
- Left stick: nudge selected object by 10 cm in the floor axes.
- Right stick: turn 15 degrees or resize by 1.2; return sticks to neutral before another edit.
- PC panel: natural-language proposals, precise transforms, history, save and restore.

The rig requires floor-level tracking and pauses controller edits when head/controller tracking or focus is lost. Inputs must be released before editing resumes. It provides no artificial locomotion; move physically within your headset boundary. The wearer confirmed object selection; the complete button/stick, tracking recovery, floor-height, recenter and comfort checklist is still separate.

## Validation and limitations

See the [original white-room validation](../Validation/White-Room-Validation.md), [current checkpoint](Current-Checkpoint.md), and [durable progress log](Progress-Log.md). Compile/build, automated player tests, browser checks and hardware tests are recorded separately. Historical AR prototype reports do not establish white-room behavior.

For the selected subscription mode, stop the previous PC service and run `./Start-CodexControlService.ps1`. The native Codex CLI uses the PC's ChatGPT sign-in and manages its own credentials. In the original white-room milestone, the complete five-turn model-driven spawn/resize/save/clear/restore sequence passed **61 checks, 0 failures**, with actual Quest acknowledgements and the original table/selection restored afterward. The wearer confirmed the visible AI changes and restored scene. The earlier 27/1 attempt is retained in that session's history. Later [voice](Voice-And-Codex-Controls.md) and [room-AR](Room-AR.md) milestones have their own implementation and hardware evidence; the broader tracking/comfort checklist remains separate. The explicit offline parser and compatible API route remain available. [AI configuration and vocabulary](AI-Integration.md).
