# White-room validation — 2026-09-20

This report concerns the fully virtual Matrix Operator. Earlier prototype reports concern separate MRUK/simulation paths.

The [Quest Pro continuation session](Quest-Pro-Session.md) records **21 actual-device command/persistence checks** and now **61 successful live Codex AI loop checks**. The wearer confirms seeing the AI changes and their scene restored. The earlier 27/1 attempt remains recorded separately; build/player, wearer and model evidence remain distinct below.

| Evidence | Result | Boundary |
| --- | --- | --- |
| Unity desktop core/application checks | **129 passed, 0 failed** | Real Unity Editor execution, including wire deserialization and history |
| Unity Android core/application checks | **129 passed, 0 failed** | Executed during the final Android build |
| Windows player integration | **95 passed, 0 failed** | Actual Unity players use the production service CLI; optional learning core unavailable |
| PC HTTP service + language/learning adapters | **136 passed, 0 failed** | Includes Codex CLI boundary tests, mock HTTP provider and restore recovery; separate from live inference |
| Browser controls | Passed the flows below | Real page and actual Windows player |
| Arranged Editor gallery preview | Rendered and visually inspected | Seven actual prefabs, floor contact and camera bounds checked; startup scene remains empty |
| Desktop build | Produced `Builds/WhiteRoomDesktop/MatrixOperator.exe` | Desktop control visuals and physical input are not covered by headless integration tests |
| Quest build | Produced ARM64 `Builds/WhiteRoomQuest/MatrixOperator.apk` | Metadata checked; subsequently installed successfully on the actual Quest Pro |
| Quest runtime command/persistence loop | **21 passed, 0 failed** | Actual authorized Quest Pro app; same-ID edits and exact save/clear/restore; all 17 original objects restored afterward |
| Headset visuals / Touch Pro / tracking | White room, selection, visible AI changes and restored scene, **wearer-reported** | Full button/stick, floor-height, tracking/recenter and comfort checklist remains pending |
| Live Codex CLI + actual Quest | **61 passed, 0 failed** | Five real turns; reviewed spawn, same-ID resize, save, clear, exact restore; original table and selection restored |
| Earlier live Codex attempt | **27 passed, 1 failed**, retained | Spawn acknowledged; resize proposal HTTP 409; original three objects restored |
| Unity Hub source exports | **103 Quest + 90 Desktop files SHA-256 verified** | Complete Assets/Packages/ProjectSettings copies; not opened or rebuilt at Desktop destinations |
| MRUK hardware / voice | **Untested / unimplemented** | Virtual-room AI success does not establish physical-room behavior |

## Real application loop

`Run-WhiteRoom-Loop.py` starts its own real Windows Unity player and the production `server.py` CLI with a temporary save directory. The CLI creates its normal optional LearningBridge; the core URL points to a reserved non-listening loopback port. The catalog endpoint correctly returns 503 while ordinary white-room operations remain available. Only the Unity processes send client snapshots. The run verifies the white-room catalog and stable floor, furniture scale, same-ID natural-language movement/rotation/resize, selection, duplication with fresh identity, undo/redo, deletion and undo, clear and undo, a real PC JSON save, exact restore, and rejection of ambiguous selection. It also loads a save from another room: Unity rejects it and preserves the scene, then editing and saving continue. It terminates its first player, lets an unacknowledged plain load expire through the actual 15-second service lease, launches a fresh empty player, and restores identical saved IDs, assets, anchors and transforms. Both player logs are checked for runtime exceptions. Test processes and temporary saves are cleaned up.

The first end-to-end attempt exposed a real serialization mismatch: Unity JsonUtility materialized omitted optional DTO fields. A valid `select` from HTTP was rejected even though direct C# checks passed. The executor now accepts those empty serialization defaults while rejecting meaningful extras; the PC boundary still rejects extra JSON fields. Regression checks exercise the actual wire representation. The final 95-check loop passes this boundary.

Integrating current main exposed another bug: an ordinary failed/expired scene load created a learning-checkpoint recovery barrier even with no lesson active. Two regression tests failed before the fix. Scene-only restores now skip that barrier when no lesson is active; actual learning/checkpoint restores preserve acknowledgement and recovery behavior. The retained optional UI lives at `/learning`, with the focused white-room page at `/`. Both pages and catalog-based furniture size were checked in the browser against the rebuilt player.

Reproduce:

```powershell
./Build-WhiteRoom.ps1 -Target Desktop
python -W error::ResourceWarning -m unittest discover -s ControlService -v
python Validation/Run-WhiteRoom-Loop.py
./Build-WhiteRoom.ps1 -Target Quest
```

Reports: `white-room-desktop-core-results.json`, `white-room-quest-core-results.json`, `white-room-loop-results.json`; the latest PC suite is `codex-service-tests.txt` (136 tests), superseding the earlier 99-test `white-room-service-tests.txt` run. Raw logs stay local and ignored. Published paths in core reports are redacted.

## Live Codex and Desktop export evidence

The user selected subscription access; native `codex.exe login status` reported ChatGPT sign-in. `Start-CodexControlService.ps1` starts that mode while leaving credentials under Codex management. [codex-headset-loop-success.json](codex-headset-loop-success.json) records **61/0** at 21:29:28.530–21:30:15.351 UTC: five real Codex turns, each with zero tool calls, reviewed spawn/same-ID resize/save/clear/restore and actual Quest acknowledgements. Exact IDs, assets, anchors and transforms survived restore; the original table and selection were restored afterward. The wearer separately confirmed seeing the changes and their scene restored. No C# or PC source change, build or unit-test rerun occurred for this result; the existing 136 tests remain separate evidence.

The [earlier 27/1 report](codex-headset-loop-results.json) is preserved: spawn succeeded, resize proposal returned HTTP 409, and all three original objects were recovered. Changed chair yaw supported stale-context rejection, but the HTTP body and rotation source were unavailable. The successful retry supersedes the incomplete-loop status without rewriting that earlier result.

[unity-hub-export.json](unity-hub-export.json) verifies Unity 6000.6.0f1 source copies at Desktop → Game Design → **Matrix White Room Quest** and **Matrix White Room Desktop**. Each has its generated scene, metadata and README; no caches, credentials, Meta Core/MRUK packages or source-machine path references were copied. The full **Matrix Loading Operator** Desktop checkout and copied local builds/saves are covered by the separate [repository export report](desktop-repository-export.json) and [Desktop guide](../Docs/Desktop-Unity-Hub.md). These source exports add no compile/build evidence.

## Browser observations

The real PC page on localhost showed **WHITE ROOM CONNECTED** and explicitly labeled offline language mode. Verified:

- Proposed a life-size chair at the selected point; nothing spawned until Apply.
- Runtime acknowledged spawn; precise X and yaw edits changed that same object.
- Duplicate returned a distinct ID; undo removed it and redo restored its identity.
- Saved on the PC, cleared to zero objects, and restored the same two object IDs and transforms.
- Selected a restored chair through the dropdown; a subsequent language revision targeted that ID.
- A dirty transform draft did not overwrite a newer runtime change: Apply rejected the old draft and reloaded the current transform.
- Changing a proposal's request disabled Apply and required a new proposal.
- Browser error/warning log was empty. Desktop-width panel layout was inspected visually.

## Quest artifact and remaining acceptance

![Arranged gallery of the seven bundled props rendered by Unity](white-room-preview.png)

This is an arranged Editor gallery rendered with the actual scene camera and materials. It verifies visible prefab geometry, scale, floor contact, lighting and framing, not the startup arrangement, desktop input or headset rendering. `WhiteRoomPreview.Render` creates the temporary gallery, checks bounds and camera visibility, writes a BMP with `-previewOutput`, then destroys temporary resources and verifies that the saved empty startup scene is unchanged. The published PNG is a format conversion of that render.

Final build uses standard Unity OpenXR 1.18.0, XR Management 4.7.0 and Input System 1.20.0. Resolved Meta Core/MRUK package count: zero. The build preserves the original MRUK project and does not alter security settings.

APK metadata: `com.matt.matrixoperator.whiteroom`, ARM64, target SDK 34, UnityPlayerGameActivity, supported devices `cambria|eureka` (Quest Pro / Quest 3). It includes Internet/OpenXR permissions; no scene-data or passthrough permission. Final rebuilt APK after integrating main: **40,992,075 bytes**, SHA256 `4D93BDE08321D44E8A517C53144F8812FBBEA7415E87895A8726DFF8D0523331`.

Source inspection of Unity's installed OpenXR provider confirms that enabled interaction profiles create and attach the controller action maps used by the direct Input System controls. This supports the implementation choice but does not establish physical-controller behavior.

The APK above is already installed and remains unchanged. Use `Connect-QuestControl.ps1` after USB reconnects; open Matrix Operator manually from Unknown Sources if needed. Actual command/save/restore acknowledgements and wearer-confirmed selection are now recorded. Continue the remaining floor-height, head pose, full Touch Pro mappings, one-edit-per-stick-deflection, tracking/focus recovery and boundary/recenter comfort checks without inferring them from the build or JSON results.
