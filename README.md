# Matrix Loading Operator

The operator layer of School of the Ancients VR: “Operator, load the Renaissance with Leonardo da Vinci.” The long-term concept is a scene that responds with “Greetings scholar, what shall we invent today?”

The first implemented step is an **AR Sandbox** with bundled props, runtime scene editing, and PC-side language commands and persistence. Historical characters and downloadable worlds are outside this prototype.

Quest Pro with manually configured room data is the primary target. Quest 3 is optional. The project uses bundled block, orb, and column prefabs; there is no downloadable catalog or dependency on VaM.

**Working and tested:** the Windows simulation completes room load → text-command spawn → resize/move/rotate the same object → PC save → clear → exact restore in one running Unity application. **Not yet hardware-tested:** real MRUK room loading, passthrough, Quest controllers, and tracking. No headset was connected. The APK build is blocked by Malwarebytes quarantining Meta's generated `AIBlocks.dll`; [current evidence and resume details](Docs/Security-Block.md).

## Open a fresh clone

Clone this repository and add its root folder in Unity Hub. Install Unity **6000.6.0f1**; native Quest builds also require Android Build Support, SDK/NDK and OpenJDK. Unity resolves the pinned dependencies in `Packages/manifest.json` on import.

This repository contains source, scenes, prefabs, settings and sanitized validation summaries. Builds, imported SDK caches, credentials, local room saves and raw logs are excluded. The MIT license applies to the authored project code; Unity and Meta dependencies retain their respective licenses and are restored through Package Manager.

Open `Assets/Sandbox/Scenes/QuestSandbox.unity` for the native room application, or `DesktopFixture.unity` for the explicit simulation. Before batch-building, close the project's Editor. In PowerShell at the repository root, run `./Build-Desktop.ps1` or `./Build-Quest.ps1`; both accept `-UnityEditor` for a different editor executable location. Desktop builds from this full project also import the Meta SDK. The previously verified desktop build used an independent no-Meta fixture, so it is not proof that this full project currently imports successfully past the reported quarantine.

## Run the desktop prototype after building

1. In PowerShell at this project folder, run `./Start-ControlService.ps1` (Python 3.10+). Keep that terminal open.
2. Run the generated `Builds/Desktop/AR-Sandbox.exe` (not included in Git).
3. Open [the PC control panel](http://127.0.0.1:8765/). It explicitly identifies **DESKTOP SIMULATION**.
4. A simulated table is selected initially. In the player, click a surface to choose “here,” or click a prop to select “it.”
5. Enter each request below, choose **Create proposal**, inspect it, then **Apply reviewed proposal**. Wait for the runtime's acknowledgement before the next request.

```text
Put a block here
Make it twice as big
Move it 20 cm left
Rotate it 45 degrees
Put an orb here
Delete it
Save as Demo
Clear the scene
Load Demo
```

The restored block retains its original object ID, asset, room target, size, rotation, and anchor-local position. The same app stays running throughout. Directions are relative to the chosen surface axes, not the user's gaze. Save files are JSON in `ControlService/scenes`; repeating a name replaces that save atomically. Select a restored object again before saying “it.” Close the desktop simulation before connecting the Quest; the service pairs with one running application at a time.

## Quest Pro setup and native build

Source project: Unity **6000.6.0f1**, Meta Core/MRUK **205.0.0**, built-in rendering, OpenXR, ARM64 IL2CPP. Android SDK/NDK/JDK support was installed on the original validation workstation; install it through Unity Hub on a fresh machine. Open `Assets/Sandbox/Scenes/QuestSandbox.unity` (or **Sandbox → Open Quest scene**). `SandboxProjectSetup.Generate` creates bundled assets and both scenes through Unity Editor APIs.

After the security detection is resolved, close the project's Editor and run `./Build-Quest.ps1`. A successful build writes `Builds/Quest/AR-Sandbox.apk`; **that file does not currently exist**. `./Install-Quest.ps1` installs the APK and sets `adb reverse tcp:8765 tcp:8765` for one USB-authorized headset. Run the PC service, then launch AR Sandbox from the Quest's installed apps. No firewall changes are needed for this USB path.

In the standalone Quest Pro, use **Space Setup** to manually outline the floor and a table, then grant the app spatial-data permission. The application requests actual device **Scene Model V1**; it does not substitute the simulation or require Quest 3 depth/high-fidelity scanning. Room and surface UUIDs identify placements. Recreating the configured room can change those IDs; mismatched saves fail explicitly instead of shifting to a guessed origin.

Controllers:

- Right trigger: select a surface point or existing object. A: add prop. B: cycle prop.
- X: delete the selected object. Left stick: move. Right stick: rotate/resize.
- Y: retry room loading. **Left grip + Y:** open native Space Setup, then reload.
- Save and clear sandbox objects before room setup/reload; existing objects prevent it.

See [MRUK and Quest Pro details](Docs/MRUK-QuestPro.md) for setup, sample references, and the physical acceptance checklist. Real room setup must occur on-device; Link is not a substitute for this test.

## AI and offline language commands

No usable compatible AI configuration was found on the original validation workstation. The default **Offline commands** mode is a finite English parser, **not an AI model**. Unsupported or ambiguous language produces an error; it does not invent assets or IDs.

The replaceable AI adapter supports a configured OpenAI-compatible `/chat/completions` provider. Set `SANDBOX_AI_BASE_URL`, `SANDBOX_AI_MODEL`, and, for a remote provider, `SANDBOX_AI_KEY` in the service's environment, then restart it. It can also use explicitly configured OpenAI/OpenRouter key+model variables. No model is guessed from a key alone. Credentials stay in the PC process, outside Unity and scene saves. See [AI integration and supported phrases](Docs/AI-Integration.md).

The provider receives the request, available props, current objects, room targets, and selection. Proposals are validated, expire after two minutes, and are bound to the current application session and scene/selection revision. Applying a stale or already-used proposal fails; create another. Save/load intents run on the PC and require prior edits to finish. Live model interpretation has **not** been tested; mock HTTP tests validate the adapter protocol and failures. Voice input is not implemented.

## Validation and continuation

| Scope | Result |
| --- | --- |
| Unity core/application checks | 80 passed; independent no-Meta fixture |
| Actual Windows player + PC language/save loop | 41 passed; explicit offline parser and simulated room |
| PC HTTP service + AI adapter | See current `Validation/service-tests.txt`; includes mock provider, stale proposals, save/load and failure handling |
| Quest adapter Editor/Android source branches + build setup | C# metadata compilation passed; not a native APK build |
| Android build | Blocked by antivirus quarantine during Meta assembly compilation |
| Headset + live AI provider | Not run: no connected headset or configured provider |

Reproduce PC tests with `python -m unittest discover -s ControlService -v`. Reproduce the actual player loop with `python Validation/Run-Prototype-Loop.py`; it uses a temporary service/save folder and terminates only its own test player. [Exact runtime evidence](Validation/prototype-loop-results.json), [core evidence](Validation/core-results.json), and the [durable progress log](Docs/Progress-Log.md) record what passed and how to resume. The [validation report](Validation/Prototype-Validation.md) separates source, simulation, build, and hardware results.

Published validation reports describe the original local runs and have workstation paths redacted. Raw logs remain local. See [handoff status](Docs/Publication.md) before resuming native validation.
