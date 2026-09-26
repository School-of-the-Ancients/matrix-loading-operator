# Matrix Loading Operator

> **Repo map:** this repository contains several Matrix generations/tracks. Before making architectural changes, read **[PROJECTS.md](PROJECTS.md)**. Coding agents should also read **[AGENTS.md](AGENTS.md)**. New generalized runtime work defaults to the Three.js/WebXR + Codex Agent Portal track unless the controlling issue says otherwise.

Matrix lets an Operator create and change spatial scenes by voice or text. The current generalized client is **[Matrix Web](WebRuntime/README.md)**: a Three.js scene on desktop and a WebXR White Room or passthrough AR scene in Quest Browser. A PC-local [ControlService](ControlService/README.md) connects that client to a persistent Codex Agent Portal, asset and component catalogs, validated scene commands, and runtime receipts. The original Unity apps remain supported for their own builds and content packs.

| Track | Use it for | Entry point |
| --- | --- | --- |
| **Matrix Web — current default** | Blender/GLB creation, animation, reusable components, virtual-floor physics, Agent-driven scene edits, browser/Quest AR and VR | [`/web/`](WebRuntime/README.md) |
| **Matrix Unity — original** | Native Quest/desktop builds, MRUK room AR, Unity prefabs and AssetBundles, historical coursework scenes | [Unity quick start](#desktop-quick-start) |
| **Matrix World** | Persistent geospatial worlds such as Matrix Boulder and future Earth-aligned overlays | [Project map](PROJECTS.md#3-matrix-world) |
| **AI Citizens** | Character embodiment, planning, memory and social simulation | [Project map](PROJECTS.md#4-ai-citizens--character-body) |

Matrix is an independent spatial runtime. [School of the Ancients](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap) is a separate product that may later use Matrix through a versioned API; mentors, lessons and learner records belong to School. See [PROJECTS.md](PROJECTS.md#6-school-of-the-ancients-is-a-separate-product) for ownership and routing.

**[Releases](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases)** · **[Current checkpoint and evidence](Docs/Current-Checkpoint.md)** · **[Product requirements](PRD.md)** · **[Implementation plan](IMPLEMENTATION_PLAN.md)** · **[Issues](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues)**

## Start Matrix Web

Requirements: Python 3.10+, Node.js `^20.19.0 || >=22.12.0` with npm (the supported Vite ranges), and a PC-local Codex CLI signed in with ChatGPT for the Agent Portal. Install the optional Matrix MCP Python dependency in the same Python environment as the service. From a fresh checkout on Windows:

```powershell
git clone https://github.com/School-of-the-Ancients/matrix-loading-operator.git
Set-Location matrix-loading-operator
python -m pip install -r ControlService/requirements-agent-mcp.txt
Set-Location WebRuntime
npm.cmd ci
npm.cmd run build
Set-Location ..
.\Start-CodexControlService.ps1
```

Open **http://127.0.0.1:8765/web/** on the PC. Select **CODEX** and connect to start or resume the PC Agent conversation. The launcher defaults to workspace-write access with reviewed approvals; the PC owner can choose `-AgentSandbox danger-full-access -AgentApprovals automatic` before launching. The headset displays the effective mode but cannot raise its own access. For local headset voice input, run `./Setup-LocalSpeech.ps1` once before starting the service. [Agent and runtime details](WebRuntime/README.md#operator-in-ar-or-vr) explain selection, review, receipts and limits.

For Quest Browser over an authorized USB debugging connection, run `adb reverse tcp:8765 tcp:8765` on the PC, then open **http://127.0.0.1:8765/web/** in the headset. Enter VR for the White Room or AR for passthrough. Quest Browser data at that exact origin holds the browser world checkpoint; use **WORLD → SAVE WORLD** for an explicit save. The PC backup made by that in-world action is scene-only. [Web save and restore](WebRuntime/README.md#save-and-restore) describes the separate PC whole-world checkpoint.

Current Web capabilities include validated Blender/GLB registration and import, Flight/selection animation clips, bounded numeric components, [bounded vertical drops for eligible imported GLBs](Docs/Web-Floor-Physics.md), and typed position/rotation changes to an existing virtual-floor object. These use the current scene revision and browser runtime receipts. Physical AR surface placement still requires room alignment, and virtual-floor physics does not provide general rigid-body or object-to-object collisions. [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md) separates wearer observations from desktop checks; the [typed rotation validation](Validation/WebRuntime-Typed-Rotation-2026-09-26.md) includes a Quest VR voice follow-up and receipt, with AR still untested for that tool.

## Find the right guide

| I want to… | Start here |
| --- | --- |
| Use the current desktop or Quest browser client | [Matrix Web runtime](WebRuntime/README.md) |
| Create and animate a GLB, or use Blender MCP through the PC Agent | [Blender authoring tiers](WebRuntime/BLENDER_AUTHORING_TIERS.md), [asset workflow](WebRuntime/README.md#blender-assets) |
| Save a Web scene and game | [Web save and restore](WebRuntime/README.md#save-and-restore), [PC checkpoints](ControlService/WORLD_CHECKPOINTS.md) |
| Inspect current Web headset evidence and open gaps | [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md), [current checkpoint](Docs/Current-Checkpoint.md) |
| Work on a Unity desktop or Quest app | [Original Unity quick start](#desktop-quick-start), [Unity AR](#quest-ar-quick-start), [content packs](Docs/Content-Packs.md) |
| Connect an independent local application | [Client API v1](Docs/Client-API-v1.md) |
| Choose a project track or implementation owner | [Project map](PROJECTS.md), [agent instructions](AGENTS.md) |

## Original Unity client

The guides below describe the original Unity Matrix Operator at `/` and its native desktop/Quest apps. They remain valid for matching Unity-era source, APK and PC service versions; they are separate from the current `/web/` workflow. For historical release capability, use the [version guide](Docs/Versions-And-Submissions.md).

![Unity-rendered gallery of the seven bundled props: chair, table, wall, pedestal, block, orb and column](Validation/white-room-preview.png)

*An arranged Unity Editor preview. The Unity app starts with an empty scene.*

### Desktop quick start

For a source build, install **Unity 6000.6.0f1** and **Python 3.10+**. Quest builds also need Unity's Android Build Support, SDK/NDK and OpenJDK. The basic PC service uses Python's standard library; voice has a separate setup step.

Clone the repository and run these commands in PowerShell. A plain clone starts on `main`; if following an unmerged PR or a tagged milestone, switch to its branch or tag before building.

```powershell
git clone https://github.com/School-of-the-Ancients/matrix-loading-operator.git
Set-Location matrix-loading-operator
.\Build-WhiteRoom.ps1 -Target Desktop
.\Start-ControlService.ps1
```

Keep the service terminal open. In a second terminal at the same repository:

```powershell
& .\Builds\WhiteRoomDesktop\MatrixOperator.exe
```

1. Open the [Operator](http://127.0.0.1:8765/), wait for **WHITE ROOM CONNECTED**, and set **Language mode → Offline commands (limited vocabulary)**.
2. Click a floor point in the player to choose where a prop should go.
3. Enter **“Summon a chair here”** in the browser, choose **Create proposal**, review it, and **Apply**. Wait for the runtime acknowledgement.
4. Click the chair to select it, then try **“Make it twice as big”** and **“Undo”** as separate proposals.

Selecting offline mode uses the deterministic **offline parser**, so no AI account is required. Use its [supported vocabulary](Docs/AI-Integration.md#offline-vocabulary). For open-ended requests, use the Codex service below.

Hold the right mouse button and use **WASD** to move the desktop camera; **Q/E** lowers/raises it. Release the mouse button to work in the browser. The [white-room guide](Docs/White-Room.md) covers more controls and opening the generated project in Unity.

Build scripts accept `-UnityEditor '<full path to Unity.exe>'` if your installation is elsewhere. Close the generated project's Editor before batch-building it.

### Quest AR quick start

This connection walkthrough supports **Quest Pro and Quest 3** with developer mode enabled, a USB data cable, an awake headset and authorized USB debugging. Quest Pro has the recorded room-placement and content-pack walkthrough; **Quest 3 camera-composite validation still needs hardware testing**. The USB helper currently rejects Quest 3S, even though the candidate camera code targets 3/3S; its connection-helper support remains to be added.

1. From the repository, build the AR app:

   ```powershell
   .\Build-RoomAR.ps1
   ```

2. Install the resulting APK. Replace the serial with the intended device from `adb devices -l`:

   ```powershell
   $adb = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe'
   & $adb devices -l
   $questSerial = '<your connected Quest serial>'
   & $adb -s $questSerial install -r '.\Builds\RoomARQuest\MatrixOperatorAR.apk'
   ```

3. Start one PC service from this checkout and leave it running. For typed offline commands use `.\Start-ControlService.ps1`; for AI use [the Codex setup below](#use-voice-and-choose-an-ai-model). In a second terminal run:

   ```powershell
   .\Connect-QuestControl.ps1
   ```

4. Open **Matrix Operator AR** manually in the headset's **Unknown Sources** app list. The separate **Matrix Operator** app is the fully virtual room.
5. Complete the headset's **Space Setup** and allow **spatial data** permission. Wait for room localization and inspect the floor/table outlines against the real room.
6. In the [Operator](http://127.0.0.1:8765/), choose **Outlines align — enable editing** after verifying alignment. Point at an open floor or tabletop patch and press **right trigger** to select it.
7. Try **“Put an orb here”** through the proposal/review/Apply flow.

After reconnecting USB, click **Reconnect Quest** beside the Operator's connection status. Keep the headset awake with Matrix open. The button restores the USB connection and waits for the app to check in; a successful USB operation alone is not reported as an online runtime. `Connect-QuestControl.ps1 -Port <your-port>` remains a terminal fallback.

The page displays **This Operator** with its address and a **Content library** link. If the running Quest app is configured for another local port, **Reconnect Quest** offers a link to that Operator instead of changing your app settings. For example, a headset configured for `8789` will not appear on a separate service at `8765`. The button requires the updated PC service; update/restart that service once after installing this feature. No APK update is needed.

Only one runtime owns a service connection: quit the desktop player or other Matrix app before switching; the inactive lease expires after 15 seconds.

The default port is **8765**. If using another port, the service, app URL and USB forwarding must all match. An APK update preserves app data, including a previous `control.json` URL. See [troubleshooting](#troubleshooting) and the full [room AR runbook](Docs/Room-AR.md).

### Use voice and choose an AI model

The Codex provider uses the native Codex CLI's existing **ChatGPT sign-in** on the PC. Install/sign in to that CLI first; the launcher checks its login state. Credentials do not need to be pasted into the Operator.

From the repository, with the previous service stopped:

```powershell
# Once per checkout, if you want headset speech:
.\Setup-LocalSpeech.ps1

# Start the AI-enabled service and keep this terminal open:
.\Start-CodexControlService.ps1
```

Refresh the Operator, choose **Codex (ChatGPT subscription)**, then select an available model and reasoning effort. If `codex.exe` is not on PATH, supply `-CodexExe '<full path to codex.exe>'`. Provider options are in [AI integration](Docs/AI-Integration.md).

| Headset action | Control |
| --- | --- |
| Select a prop or placement point | Point and press **right trigger** |
| Record a request | Hold **left trigger**; release to submit |
| Apply the voice proposal after reviewing it | **Y** |
| Undo one edit | **Left grip**; in AR, undo happens on release |

On the first voice attempt, accept microphone permission, release the trigger, then hold it again. Speech is transcribed on the PC; the transcript and scene context go to the selected AI provider. Keep other edits idle during planning. Read the proposal and wait for an acknowledgement after Apply: transcription alone does not change the scene.

See [voice controls](Docs/Voice-And-Codex-Controls.md) for cancellation, tracking and model selection, and [AR controls](Docs/Room-AR.md#controls-in-room-ar) for spawning, nudging, resizing and room reload.

### Make your first scene

Start with a selected floor/table point and, in AR, confirmed room alignment. Use one request at a time: **create → review → Apply → wait for confirmation**.

| Request | What to check |
| --- | --- |
| “Put an orb here.” | The orb appears at the selected point. |
| “Make it twice as big.” | The same selected orb changes size. |
| “Make this orb rotate slowly and float gently.” | With the AI provider, Rotate/Bob behavior is configured on that orb. |
| “Stop the bobbing but keep it rotating.” | Only the requested behavior changes. |
| “Undo.” | One successful edit reverses; a multi-command proposal may need several undos. |

**“Here”** means the selected placement point; **“it”** means the selected object. Select a prop in the player or PC object list before editing it. Larger layouts such as **“Put a table in front of me with two chairs”** require the AI provider and suitable tracked room space.

Rotate and Bob are built-in configurable behaviors. They are not downloaded animation clips or a physics simulation. See [behavior controls and limits](Docs/Runtime-Behaviors.md).

#### Save, clear and restore

1. Wait for pending edits to finish. Under **Save and restore**, enter a new name such as `MyFirstRoom` and choose **Save current scene**.
2. After the save is confirmed, choose **Clear scene**.
3. Select that save and choose **Restore selected scene**. Check the arrangement in the player.

Alternatively, request **“Save scene as MyFirstRoom”**, **“Clear the scene”**, and **“Restore MyFirstRoom”** as separate reviewed proposals. Reusing a name replaces that save. Saves live on the PC in `ControlService/scenes/` by default; Undo history lasts only while the app runs.

AR restores require the same room and compatible anchors. An updated player automatically reloads exact saved content packs from its verified device cache when you restore after an app restart. The PC service must remain reachable; the upstream content provider can be offline. Missing, corrupt or incompatible cached content produces an error and preserves the current scene. See [cached restore](Docs/Content-Packs.md#restore-after-restarting-the-app) and [room recovery](Docs/Room-AR.md#missing-anchors-and-recovery).

### Browse, preview and use a prefab

Open the [Content library](http://127.0.0.1:8765/content#prefabBrowser) on the **same service as your runtime**. Substitute your service's port if it differs.

1. The **Prefab browser** shows the connected app's bundled and installed props. Use its name, availability and source filters.
2. Choose **Browse available packs** to include individual prefabs from configured catalogs. A fresh checkout needs [provider configuration](Docs/Content-Catalogs.md#configure-providers-on-the-pc) before external packs appear.
3. Choose **Preview prefab** when a matching sample exists. It shows a thumbnail and larger image without installing a pack or changing your room. The supplied samples are Unity Editor renders, not an interactive 3D viewer; providers must publish a matching image for each preview.
4. Choose **Install pack** and wait for the running app's `ready` acknowledgement. This installs the whole pack. Quest uses **Android** bundles; a Windows bundle is a separate build.
5. Choose **Use in Operator** on an installed prop. It selects the prop and fills an empty request; it does not call AI or spawn anything. Select a placement point, create a fresh proposal, review and Apply.

The [content library user guide](Docs/Content-Library-User-Guide.md) includes a complete sci-fi beacon walkthrough, restart/restore steps and AI examples.

#### Can I import anything from the Unity Asset Store?

The current loader supports **static mesh prefabs with supported materials and simple colliders**. Prepare them in Unity, export a platform-specific pack, configure its catalog, then install it in Matrix. Exact Unity version **6000.6.0f1** and target platform must match the player.

| Change | Rebuild the APK? |
| --- | --- |
| Add another supported static prop | **No.** Export and install a new content pack. |
| Change a supported prop's mesh, material or texture | **No.** Export a new pack version. |
| Add a prefab preview image | **No.** Publish the matching catalog sample. |
| Start from an older APK without the content loader | **Yes.** Install a loader-enabled app and matching service first. |
| Add C# behavior, Animator playback, rigged characters or another unsupported feature | **Yes.** Implement and validate that runtime capability, then build the updated app. |

The **Unity asset preparation checklist** records manual progress:

| Status | Meaning |
| --- | --- |
| **Queued** | Recorded a package URL or staged an existing package for later work. |
| **Acquired** | Obtained the licensed source asset. |
| **Imported** | Imported it into a Unity Editor project. |
| **Exported** | Built the Matrix pack and catalog files. |
| **Failed / Cancelled** | Recorded why preparation stopped. |

Changing a status does not perform those actions. **Installed / ready** is a separate result from the running app. Follow the [Asset Store walkthrough](Docs/Content-Library-User-Guide.md#bring-in-a-new-unity-asset-store-prop) and [pack authoring guide](Docs/Content-Packs.md).

For a single asset in a fixed Unity scene, direct Unity authoring is simpler. Matrix's preparation pays off when you reuse the installed app to compose many scenes with new packs, reviewed AI edits, Undo and save/restore.

#### How does the AI know what it can use?

Each proposal receives the connected app's prefab IDs, measured geometry, selection, room context and advertised behavior capabilities. The PC supplies [planner instructions and capability contracts](ControlService/ai_adapter.py); users do not need to paste a separate guide into every request.

The PC content library also searches Poly Haven's public models, HDRIs and textures, Sketchfab's downloadable-model listings, and Openverse's openly licensed audio when you select those sources. These are discovery results with source links and license details, not ready-to-place prefabs or playable sounds. In explicit AI mode, missing-asset requests can use the configured **ready local Poly Haven packs**: the service installs up to four compatible choices on the connected player, waits for registration, and replans before offering a reviewed scene edit. Only **installed** assets can be placed. AI does not acquire Asset Store assets, run Unity imports/exports, or start generation jobs on its own. Other sources still need their authoring and import workflows.

**Generate with ComfyUI** is a separate, explicitly approved workflow in the library. Its image goes to the PC cache; it does not automatically create a headset background or 3D environment. Catalog categories such as animations, sounds and behaviors organize resources, and do not imply those runtime loaders exist. See [content and AI usage](Docs/Content-Library-User-Guide.md#what-can-i-ask-the-ai-to-do).

### Show the AI a scene capture

1. In **Scene preview**, choose an available image source and **Capture current view**.
2. Inspect the preview and select an explicitly listed image-capable AI model.
3. Check **Send this preview with my typed request**, or choose **Include preview in next headset voice request**.
4. Ask a visual question or request a correction. Read-only image reviews do not need Apply; proposed edits still do.

Capturing alone does not call AI. Captures expire after 30 seconds and after relevant scene/selection/session changes; recapture when needed.

On **Quest Pro**, the capture contains virtual objects and visible room outlines, without physical passthrough pixels. The **Quest 3/3S** AR camera-composite path is implemented as a candidate, but permission, alignment, image quality and performance remain hardware-unverified. Physical depth/occlusion is not implemented. See [visual feedback](Docs/Visual-Feedback.md) for supported modes and evidence.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| PC service offline / runtime disconnected | Keep its terminal open, connect Quest by USB, open Matrix and click **Reconnect Quest**. Follow the matching Operator link if the headset uses a different port. |
| Port already in use | Reuse the intended service or stop it before starting its replacement. Both launcher scripts accept `-Port`; USB forwarding alone does not change the app's retained URL. |
| Another app owns the connection | Quit the other Matrix app or desktop player and allow 15 seconds for its lease to expire. |
| Room loading / editing disabled | Check spatial permission, Space Setup and localization. Inspect and confirm outlines on the PC. Reload an empty room with **left-stick click**; **Y applies voice proposals**. See [room recovery](Docs/Room-AR.md#missing-anchors-and-recovery). |
| Voice unavailable | Run speech setup in the service's checkout, check microphone permission and PC connection, then release/re-hold left trigger. Use matching current APK/service versions; earlier releases had a stale loading-status label. |
| Only offline mode appears | Start the Codex service with a valid CLI sign-in, then refresh the Operator. |
| Prefab missing / no preview button | Use **Browse available packs** and check enabled provider configuration. Previews require a matching published image. |
| Install disabled / AI cannot use the prop | Check the app has the loader, exact Unity/platform compatibility and a fresh `ready` result. An exported checklist item is not an installation. |
| Restore needs a pack | Update the player for automatic cached restore. If it reports missing/corrupt/incompatible cache, reinstall the exact original pack/version, then restore again. |
| Image cannot be attached to AI | Use an advertised image-capable model and recapture a fresh view. See [visual feedback](Docs/Visual-Feedback.md). |

For a configured LAN connection instead of USB forwarding, see the [PC connection guide](ControlService/README.md#connect-a-native-quest-client). Check the [current checkpoint](Docs/Current-Checkpoint.md) for known deployment gaps: a refreshed browser does not update the running service or installed APK.

## Development

| Location | Purpose |
| --- | --- |
| `WebRuntime/` | Current Three.js/WebXR client, HTML surfaces, world persistence, interactions and Node tests |
| `ControlService/` | Shared PC service, Agent Portal, Matrix tools, validation, catalogs and Python tests |
| `Assets/Sandbox/Runtime/` | Unity state, command execution, room adapters, capture and content loading |
| `Assets/Sandbox/Editor/` | Scene generation, pack export, preview rendering and validation |
| `Docs/` | User guides, architecture and milestone notes |
| `Validation/` | Validation runners and sanitized evidence |

Unity build scripts stage isolated projects in `.white-room-fixture/` and `.room-ar-fixture/`. Change the repository's source and regenerate; edits only in generated projects do not flow back. Builds, local scenes, caches, credentials and raw room captures are excluded from Git.

Run PC checks from the repository root:

```powershell
python -m unittest discover -s ControlService -v
Set-Location WebRuntime
npm test
npm run build
Set-Location ..

# Original Unity Operator page checks:
node ControlService/test_operator_panel.js
node ControlService/test_content_panel.js
```

Build scripts run Unity checks. PC tests and compilation do not establish headset alignment, input or rendering. See the [Web Quest acceptance matrix](WebRuntime/QUEST3_ACCEPTANCE.md) and [current checkpoint](Docs/Current-Checkpoint.md) for mode-specific evidence; [spatial/content validation](Validation/Spatial-Content-Validation.md) and the [Quest prefab walkthrough](Validation/content-headset-walkthrough.json) record earlier Unity work. Validation runners offering `--run` can invoke AI or edit a scene; read their guide before using that mode.

Further reading: [project map](PROJECTS.md), [Web runtime](WebRuntime/README.md), [Agent Portal](ControlService/AGENT_PORTAL.md), [implementation plan](IMPLEMENTATION_PLAN.md), [original Unity architecture](Docs/AI/UnityProjectContext.md), [progress history](Docs/Progress-Log.md) and [submission release checklist](Docs/Versions-And-Submissions.md#freeze-each-submission).

Authored code uses the [MIT license](LICENSE). Unity, Meta and imported content retain their respective licenses; preserve asset attribution and distribution terms when publishing packs.
