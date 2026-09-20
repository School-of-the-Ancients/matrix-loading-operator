# Quest Pro room AR

Source implementation handoff, 2026-09-20. The goal is: **place an orb on the real table by voice, move it by voice, save, clear, and restore it on the same table**.

## Current status

The source contains the native passthrough scene, MRUK Scene Model V1 loading, labeled outlines, room context, surface placement checks, and the existing voice, Codex selector, editing, undo, and PC persistence integration. The room is loaded from the headset's manually configured Space Setup data; missing data is reported explicitly.

**A successful native AR APK build and the actual Quest Pro acceptance test are still pending at this handoff.** Native import/build attempts encountered access denial on Meta's generated `Meta.XR.BuildingBlocks.AIBlocks.dll`. See the current build log and progress log before resuming. Previous white-room headset results do not establish passthrough or physical alignment success. Do not mark the acceptance checklist below complete from automated checks alone.

The two device apps are separate so the working white room remains available:

| Mode | Headset app | Android package |
| --- | --- | --- |
| Existing virtual sandbox | Matrix Operator | `com.matt.matrixoperator.whiteroom` |
| Native room AR | Matrix Operator AR | `com.matt.arsandbox` |

Both use the same seven bundled prefab IDs and the same PC service. Save the white-room arrangement before switching. Quit the previous app so it releases the PC connection; the service's inactive client lease expires after 15 seconds. A room AR save cannot be restored into the white room because their room IDs differ.

## Build and connect on the Omen

Run these commands from the full Matrix Loading Operator checkout. The script generates an isolated `.room-ar-fixture` with the repository's pinned official Meta Core/MRUK packages. It does not rewrite either Unity Hub white-room project.

```powershell
.\Build-RoomAR.ps1
```

A successful run must report `ROOM_AR_BUILD_OK` in `Validation\room-ar-quest.log` and produce `Builds\RoomARQuest\MatrixOperatorAR.apk`. A leftover APK without this run's success marker is not a successful build. `-PrepareOnly` stages source and package configuration without running Unity or claiming compilation. The generated scene is `Assets/Sandbox/RoomAR/Scenes/QuestRoomAR.unity` inside that fixture; the editor menu is **Sandbox > Room AR > Generate Quest Pro scene**.

After a verified build, keep the Quest awake, connect its USB data cable, and accept **Allow USB debugging** inside the headset. Select the actual device serial for installation:

```powershell
$adb = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe'
& $adb devices -l
$questSerial = '<replace with the connected Quest Pro serial>'
& $adb -s $questSerial install -r '.\Builds\RoomARQuest\MatrixOperatorAR.apk'
```

Use the existing PC control service if it is already running. Otherwise start it and leave that terminal open:

```powershell
.\Start-CodexControlService.ps1
```

In a second terminal in the same checkout:

```powershell
.\Connect-QuestControl.ps1
```

Open the [PC Operator](http://127.0.0.1:8765/). Open **Matrix Operator AR** manually from the headset's **Unknown Sources** app list. If the HUD reports that another app owns the PC connection, quit the other Matrix Operator app and wait for the lease to expire. The USB connection script establishes forwarding; it does not launch an app.

Existing local speech installation and Codex sign-in are reused. A new checkout needs `.\Setup-LocalSpeech.ps1` once before voice can work. Choose **Codex (ChatGPT subscription)** and the desired **Codex model** / **Reasoning effort** in the PC panel. See [Voice and Codex controls](Voice-And-Codex-Controls.md) for provider setup.

## Configure and verify the physical room first

1. On Quest Pro, use **Settings > Environment Setup / Physical Space > Space Setup** to manually mark the floor, walls, and table. Run Space Setup on the standalone headset. This flow does not require Quest 3 depth or passthrough camera access.
2. Open Matrix Operator AR and allow **spatial data** access when requested. The passthrough view should show the real room. If no configured room is found, the HUD and PC panel report that state; the app does not substitute a sample room.
3. Look around until the configured room localizes. Labeled debug outlines start visible: **green floor**, **blue walls**, **amber furniture**, and **purple ceiling**. Labels show the semantic name, a short anchor ID, and dimensions.
4. Check the table's top and edges, the floor, and walls against reality. If any are wrong, correct Space Setup and reload. While the room is empty, clicking the left stick reloads its data; holding left grip while clicking the left stick explicitly opens Space Setup.
5. Once the outlines visibly align, click **Outlines align — enable editing** in the PC panel. This is the wearer's confirmation. Reloading or changing room geometry requires a new confirmation.
6. Press left trigger once to request **microphone access**, if needed. Accept it, release the trigger, and then hold it again to speak. Granting permission alone does not record a request.

If spatial data permission was denied, enable it in the headset's app permissions, then click the left stick to retry. A localization or setup failure remains visible. There is no automatic room-capture popup on an ordinary failed load.

## Controls in room AR

| Control | Action |
| --- | --- |
| Point and press right trigger | Select the nearest visible prop, or a supported floor/furniture-top placement point. Selecting a surface clears the old selected object. |
| Hold / release left trigger | Record / submit speech to the PC. |
| Y | Apply the reviewed voice proposal. |
| Press and release left grip | Undo one edit. Release triggers undo in AR so the grip can also modify Space Setup without undoing first. |
| A / B / X | Spawn the chosen prefab / cycle prefab / delete the selected prop. |
| Left stick gesture | Move the selected prop 10 cm along one local surface axis. Return to neutral before repeating. |
| Right stick gesture | Turn 15 degrees or resize by 1.2×. Return to neutral before repeating. |
| Click left stick | Reload an empty room. |
| Hold left grip and click left stick | Open manual Space Setup, then reload its result. |
| Click right stick | Show or hide labeled outlines. |

Walls and other context-only surfaces can be pointed at but do not accept support placement. Physical objects remain part of room data; selecting a real table does not turn it into an editable virtual table.

## Acceptance test to perform on the headset

Keep the PC service connected and leave controller edits idle during each AI request. Read the heard text and proposal before pressing Y. A successful transcription is not a successful edit; wait for runtime confirmation.

1. Verify and confirm outlines as above. Point at the real table top and press right trigger.
2. Say **“Put an orb on my table.”** Review and apply. Verify that the orb rests on the table rather than floating, sinking, or appearing on the floor.
3. Point at the orb and select it. Say **“Move this 20 centimeters to my right, keeping it on this table.”** Review and apply. Verify that the same orb moves in the intended direction and remains on the table. If there is insufficient room for the requested move, rejection is appropriate; select a position with more space and repeat.
4. In **Save and restore**, enter a new name such as `AR Table Orb Test` and click **Save current scene**. Wait until queued edits have finished before saving.
5. Click **Clear scene** and verify the orb disappears. Choose that save and click **Restore selected scene**. Verify the orb returns at the saved table-relative position, with the same size and orientation.
6. For a stronger persistence check, save, quit and reopen the AR app without changing Space Setup, reacquire the room, verify outlines again, and restore. Walk around the table and check alignment from more than one viewpoint.

Record the APK hash, room/table anchor IDs, request transcripts, command results, and the wearer's observation separately. Automated identity/pose comparisons cannot confirm that a virtual orb visually rests on the physical table.

## Missing anchors and recovery

Each virtual prop stores its exact room ID, anchor ID, and anchor-relative transform. Restore validates the complete scene against the current room and current support geometry before replacing anything. A different room, missing anchor, invalid footprint, or unavailable support rejects the entire restore and preserves the current arrangement. Saved transforms are not silently shifted to a replacement table or reinterpreted in world coordinates.

If room or individual anchor geometry changes while props exist, alignment is invalidated and physical editing stops. The PC can still receive a **read-only recovery snapshot** of stored object data, even if a native anchor and its rendered children have disappeared. Use **Save current scene** to preserve that data, then **Clear scene**, reload the room, inspect outlines, and confirm alignment again. Reload refuses to discard an occupied scene.

After recapturing or deleting a room, the headset may assign different UUIDs. A recovery save retains the old IDs and can legitimately fail to restore into the new setup; this prototype does not guess an anchor remapping. Keep the original save for an explicit future recovery decision.

## Context and data handling

The AI receives available prefab geometry, virtual scene objects, MRUK anchor IDs and semantic labels, room-relative geometry, headset pose, and controller pointing/selection. Voice captures that context when recording begins. Provider authentication stays on the PC, and the model/reasoning selectors continue to govern subsequent requests.

Speech audio is sent to the local PC speech worker. Codex receives the transcript and structured scene/room context; this implementation does not capture or upload passthrough camera images. PC saves retain scene and room metadata in `ControlService/scenes/`; live headset pose and pointing are omitted. Placement proposals use the existing command executor and history, with prefab footprint checks and actual MRUK surface raycasts.

Meta's [manage and query scene data documentation](https://developers.meta.com/horizon/documentation/unity/unity-mr-utility-kit-manage-scene-data/) describes manual Space Setup, on-device capture, and world locking. Actual alignment and tracking behavior still require the headset checks above.
