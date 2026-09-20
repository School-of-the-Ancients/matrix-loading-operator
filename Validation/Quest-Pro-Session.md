# Quest Pro session — 2026-09-20

Follow-up to merged PR #3, targeting `codex/quest-pro-codex-ai`. PR #3 merged at 20:51:13 UTC as `cef60be32c45cf8ff96849c5144a4c0df3394efc`; the installed runtime/build baseline remains `d130e9221a23f73d3bd455fe608e3f3c6a8f15f3`. **The actual Quest Pro command/save/load loop passed all 21 checks.** The wearer confirms the white room, restored objects and selection work. Live Codex inference has completed one acknowledged spawn; its full edit/persistence loop and MRUK remain unfinished.

## Observed this session

| Check | Actual result |
| --- | --- |
| Host | HP OMEN 30L Desktop |
| Existing Quest APK | 40,992,075 bytes; SHA256 `4D93BDE08321D44E8A517C53144F8812FBBEA7415E87895A8726DFF8D0523331` |
| APK source baseline | All seven authored runtime files match the generated Quest fixture sources; no runtime edits or rebuild this session |
| PC service | Healthy on loopback port 8765; received the actual Quest's `white-room-v1` snapshot after USB reverse forwarding was restored |
| Competing desktop player | No `MatrixOperator` process running |
| USB/ADB progression | Initially absent, then unauthorized, then authorized after the user accepted debugging. Connected model verified as `Quest Pro`, manufacturer `Oculus` |
| Installation and PC forwarding | `adb install -r` returned `Success`; port 8765 reverse forwarding succeeded; existing app data was not erased |
| Launch | User manually opened Matrix Operator and reported the white room loaded; exact Android package process observed |
| Connection recovery | Reverse mapping had disappeared before the app opened; `adb reverse tcp:8765 tcp:8765` restored the PC connection without an app/source change |
| Actual headset executor | **21 checks passed, 0 failed**, 21:02:16–21:02:22 UTC. Spawn, same-ID scale/move/rotate, PC save, clear, exact restore, and finally original-scene/selection recovery |
| User scene preservation | All 17 original objects and the original selection were restored. Backup: `HeadsetBackup_20260920_210216_42d0e4e7`; edited test save: `HeadsetLoop_20260920_210216_42d0e4e7`. Saves stay on the PC and are excluded from Git |
| Harness-only checks | Syntax/help, pure helpers and two isolated interruption-reporting regressions passed; these are separate from the actual device run |
| Wearer observations | White room loaded; objects restored and selection works. Full tracking/focus, floor-height, button/stick and comfort checks are not inferred |
| Current planner | User selected ChatGPT/Codex subscription access. Native CLI reports `Logged in using ChatGPT`; PC service supports `codex-cli` via `Start-CodexControlService.ps1`. Codex manages its login; no token extraction or API-key substitution |
| Live Codex attempt | **27 checks passed, 1 failed**. Reviewed chair spawn received an actual Quest acknowledgement; the next resize proposal returned HTTP 409. No full AI-loop success |
| AI-run recovery | The original three objects were restored. Unique backup: `CodexBackup_20260920_211322_4819b3b1`; recovery save preserved the interrupted test state |
| PC regression suite | **136 tests passed**, including the new CLI adapter and retained service/planner/persistence checks |
| Unity Hub exports | Quest 103 files and Desktop 90 files hash-verified under Desktop → Game Design; Unity 6000.6.0f1. No compile/build in those new folders |

Direct device evidence is [headset-loop-results.json](headset-loop-results.json). Attribution combines the verified Quest Pro package PID, no competing desktop player, the service becoming connected after USB forwarding, and the wearer's launch report. That harness uses direct commands and neither launches a desktop substitute nor submits synthetic snapshots. The separate live attempt is [codex-headset-loop-results.json](codex-headset-loop-results.json); unit evidence is [codex-service-tests.txt](codex-service-tests.txt). Wearer observations, the 129-check Unity builds and 95 Windows-player checks remain distinct evidence in [White-Room-Validation.md](White-Room-Validation.md).

Read-only package investigation found `com.unity3d.player.UnityPlayerGameActivity` enabled/exported with MAIN, LAUNCHER and Quest VR categories, without DEFAULT. Ordinary activity-resolution queries find it; the same query with `MATCH_DEFAULT_ONLY` does not. This explains the package-only implicit launch failure under Android's [default-category requirement](https://developer.android.com/guide/topics/manifest/category-element). The explicit launch command was not executed because approval review returned “blocked by policy” without further detail; no alternate launch mechanism was attempted.

## Reconnect or repeat pass one

1. Keep Quest Pro awake and connect it directly to this Omen with a USB data-capable cable. Accept USB debugging if prompted. If Windows still sees no physical USB device, try another existing cable/port. The evidence does not identify a particular bad cable or driver. Air Link alone does not create this USB connection.
2. Check `adb devices -l` using Unity's SDK ADB. Require one authorized headset, or choose an explicit serial. Verify the model before installing.
3. Check `http://127.0.0.1:8765/api/health`. If the service has stopped, run `./Start-CodexControlService.ps1` for the selected subscription mode, or `./Start-ControlService.ps1` for the ordinary/offline service. Keep desktop sandbox players closed; wait for any old lease to expire.
4. The APK is already installed and was manually launched. Run `./Connect-QuestControl.ps1` after USB reconnects to verify and restore only the service port mapping. Open **Matrix Operator** from **Unknown Sources** if it has stopped. On a fresh device, `./Install-WhiteRoom.ps1` performs installation/forwarding but its implicit launch currently fails on this Quest OS; the error does not undo installation.
5. Have the wearer check the white floor, correct floor height, head tracking, controller ray, A/B/X actions, stick edits and tracking/focus recovery. Record these observations separately.
6. Run `python Validation/Run-Headset-Loop.py`, then `--run` after confirming the headset owns the service connection and pausing other edits. The controlled test saves the original scene, spawns/scales/moves/rotates a chair, saves/clears/restores exact identities and anchor-local transforms, and finally restores the original scene. It changes undo history; retain the backup if recovery fails. It never starts a desktop substitute or injects client snapshots.

The harness cannot independently identify which device owns the existing bridge lease. Package-process inspection, the offline-to-online transition after launch, absence of another runtime, and wearer confirmation are required attribution evidence. Its JSON report explicitly records this boundary.

## Live AI pass: partial result and next check

The user selected their ChatGPT/Codex subscription. `Start-CodexControlService.ps1` verifies the native CLI's saved ChatGPT sign-in and selects `codex-cli`. This follows the documented [authentication](https://learn.chatgpt.com/docs/auth) and [noninteractive CLI](https://learn.chatgpt.com/docs/non-interactive-mode) paths; account usage limits apply. The project does not read or export login tokens.

At 21:13:21–21:13:39 UTC, live Codex produced the requested normal-size chair proposal with no tool calls. Review, Apply and the actual Quest acknowledgement succeeded. The next resize proposal returned HTTP 409. Recovery evidence showed the test chair at yaw 45, while the verified spawn requested yaw 0; existing objects, catalog and anchors were unchanged. This supports stale-scene rejection, but the HTTP error body was not captured and the rotation's source is unknown, so the exact cause remains unconfirmed. The run stopped and restored all three pretest objects, preserving a recovery save. No further model calls were made.

Next, repeat with controller/browser edits paused during inference and verify resize targets the same ID, followed by the full reviewed save/clear/restore sequence. Do not relabel the existing partial run as passing. Detailed visual/controller acceptance remains separate. The two Unity exports and full Desktop repository copy are available; see the [Desktop guide](../Docs/Desktop-Unity-Hub.md).

## Manual-room pass remains pending

Then use the existing MRUK Scene Model V1 loader for Quest Pro manual floor/table setup and spatial permission. Preserve room/surface UUIDs and anchor-local coordinates through the same command executor and saves. Validate missing-anchor and wrong-room restore failures preserve the current arrangement. Follow [Meta Building Blocks findings](../Docs/Meta-Building-Blocks-Review.md); stock component spawning must not bypass the sandbox registry. The prior [Meta assembly quarantine](../Docs/Security-Block.md) remains a separate unresolved native-MR build issue, not a failure of the built OpenXR virtual APK. No protection settings were changed or quarantined binaries restored.
