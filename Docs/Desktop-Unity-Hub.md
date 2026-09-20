# Desktop projects and files

The local handoff is under `Desktop\Game Design`:

| Folder | Use |
| --- | --- |
| `Matrix White Room Quest` | Add this folder to Unity Hub for the working virtual Quest scene. |
| `Matrix White Room Desktop` | Add this folder to Unity Hub for the Windows virtual scene. |
| `Matrix Loading Operator` | Full Git repository, authored source, PC service, build scripts, documentation, copied builds and local saves. |

In Unity Hub, choose **Add project from disk**, select the desired White Room folder, and use **Unity 6000.6.0f1**. Open `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomQuest.unity` or `Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomDesktop.unity`. Install Android Build Support with SDK/NDK and OpenJDK for Quest development. The exported `Assets/csc.rsp` retains the compilation symbols needed by each project.

The White Room folders are generated project copies. The Quest copy has since been opened by the user. The composition update copied eight unchanged authored scripts into each export, verified their contents and preserved existing scenes, prefabs and project settings. Builds and core checks ran in the generated repository fixtures, not at these Desktop paths. The newly generated scenes also contain the chair's optional facing-direction description; existing exported scenes retain their earlier serialized catalog. Lasting edits belong in the full repository; its `Build-WhiteRoom.ps1 -Target Quest` or `-Target Desktop` regenerates the corresponding `.white-room-fixture` project. Changes made only in the separate exported projects do not automatically flow back to Git.

The full repository root also contains the separate Meta MRUK project. Its native build and real-room headset validation remain pending; see [the recorded Meta assembly security blocker](Security-Block.md). Use the White Room Quest project for the virtual room already tested on Quest Pro.

## PC service and saved scenes

The copied Quest APK is `Matrix Loading Operator\Builds\WhiteRoomQuest\MatrixOperator.apk`. The copied Windows player is `Matrix Loading Operator\Builds\WhiteRoomDesktop\MatrixOperator.exe`. Existing PC save files are in that repository's `ControlService\scenes`. These local files are excluded from Git. The export reports record their file counts and SHA-256 verification without publishing save contents.

The running PC service still belongs to the original task checkout. Copying files does not move that running process or synchronize future saves. When switching to the Desktop repository, stop the existing service, then run the following from the Desktop repository in PowerShell:

```powershell
./Start-CodexControlService.ps1
```

Keep that terminal open. In a second terminal at the same repository, run:

```powershell
./Connect-QuestControl.ps1
```

The first command uses the native Codex CLI and its existing ChatGPT sign-in on this PC. If `codex.exe` is not on PATH, pass its full path with `-CodexExe`. No authentication files or API keys were copied. See [AI integration](AI-Integration.md) for configuration and the current live-test result. Open the Operator page at `http://127.0.0.1:8765/` and open Matrix Operator manually in the headset if needed.

Sources, tests, scripts, documentation and sanitized test reports belong in Git. Built players, APKs, personal saves, generated Unity caches and credentials remain local. See [Unity project export verification](../Validation/unity-hub-export.json) and [repository extras verification](../Validation/desktop-repository-export.json).
