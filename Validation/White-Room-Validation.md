# White-room validation — 2026-09-20

This report concerns the fully virtual Matrix Operator. Earlier prototype reports concern separate MRUK/simulation paths.

The later [Quest Pro continuation session](Quest-Pro-Session.md) records successful device installation, the launch blocker and an attach-only test runner. The build/player results below are the existing baseline, not fresh headset runtime evidence.

| Evidence | Result | Boundary |
| --- | --- | --- |
| Unity desktop core/application checks | **129 passed, 0 failed** | Real Unity Editor execution, including wire deserialization and history |
| Unity Android core/application checks | **129 passed, 0 failed** | Executed during the final Android build |
| Windows player integration | **95 passed, 0 failed** | Actual Unity players use the production service CLI; optional learning core unavailable |
| PC HTTP service + language/learning adapters | **99 passed, 0 failed** | Includes mock-provider transport and restore recovery; no live model claim |
| Browser controls | Passed the flows below | Real page and actual Windows player |
| Arranged Editor gallery preview | Rendered and visually inspected | Seven actual prefabs, floor contact and camera bounds checked; startup scene remains empty |
| Desktop build | Produced `Builds/WhiteRoomDesktop/MatrixOperator.exe` | Desktop control visuals and physical input are not covered by headless integration tests |
| Quest build | Produced ARM64 `Builds/WhiteRoomQuest/MatrixOperator.apk` | Metadata checked; subsequently installed successfully on the actual Quest Pro |
| Quest runtime / Touch Pro / tracking | **Not tested** | Device now authorized; app launch pending, PC runtime still offline |
| Live AI / voice | **Not tested / not implemented** | Offline parser is explicit; no invented credentials |

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

Reports: `white-room-desktop-core-results.json`, `white-room-quest-core-results.json`, `white-room-loop-results.json`, `white-room-service-tests.txt`. Raw Unity logs stay local and ignored. Published paths in core reports are redacted.

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

When a Quest Pro is connected and authorized, run `Install-WhiteRoom.ps1`, then validate opaque white-room rendering, floor height, head pose, Touch Pro ray/button mappings, one-edit-per-stick-deflection behavior, loss/recovery of tracking, physical boundary/recenter comfort, USB PC connection, and the same save/restore loop on-device. Record those as new hardware evidence; do not infer them from this APK build.
