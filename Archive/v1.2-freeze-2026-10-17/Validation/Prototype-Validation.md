# Prototype validation — 2026-09-20

Overall status: **Blocked for native Quest delivery; desktop prototype passed.** Quest Pro manual room setup is the primary implementation. Quest 3 is optional. The current hardware and live-model paths must not be described as tested.

| Acceptance criterion | Status | Evidence and limit |
| --- | --- | --- |
| Load actual manually configured room | Implemented; hardware not run | Device-only MRUK V1 floor/table anchors, native Space Setup and retry. No headset connected. |
| Load simulated room | Passed | Actual Windows player reports `simulated-room-v1`, 3 bundled props and 2 targets. |
| Spawn a bundled prefab | Passed in desktop player | Text `Put a block here`, reviewed proposal, Unity acknowledgement and stable ID. |
| Revise same object through language | Passed in desktop player | Resize by 2, move 20 cm left, yaw +45 degrees; ID retained. Offline constrained parser, not a model. |
| Add another prop and delete by identity | Passed in desktop player | Orb received distinct ID and alone was deleted. |
| PC save → clear → restore | Passed in desktop player | Real JSON file written; exact IDs/assets/anchors/local transforms restored in same process. |
| AI provider adapter | Passed with mock HTTP | Context, auth, JSON contract, bounds, known IDs, malformed/refused/oversized replies, no credential forwarding on redirect. No live model configured. |
| Stale/replayed proposal rejection | Passed | HTTP tests cover scene/selection revision, lease/session, expiry, pending commands and single use. |
| Browser control | Passed | Actual in-app browser created/applied spawn and same-ID resize; displayed desktop simulation, offline mode and runtime confirmation. |
| APK build | Blocked | `quest-pro-build.log`: Meta AIBlocks compilation hit Access Denied; Malwarebytes confirmed successful quarantine. No APK. |
| Physical passthrough/controller/room persistence | Not run | ADB lists no devices. No installation or hardware interaction occurred. |

## Executed checks

- Unity 6000.6.0f1 independent fixture: **80 passed, 0 failed** (`core-results.json`, `core-prototype.log`, exit 0).
- Rebuilt Windows player: `desktop-prototype-build.log` contains `SANDBOX_BUILD_OK`, exit 0. Built from authored runtime and Unity packages, without Meta SDK. Executable engine binary timestamps alone do not identify its newly rebuilt data; the build log and actual player tests do.
- Actual player + HTTP + offline language loop: **41 passed, 0 failed** (`prototype-loop-results.json`), no runtime exceptions. Reproduce with `python Validation/Run-Prototype-Loop.py`.
- Python service/adapter: **49 tests passed** (`service-tests.txt`); final run with ResourceWarning treated as an error. Includes 32 adapter and 17 HTTP tests.
- Quest authored adapter compiled against installed metadata in Editor and Android preprocessor branches; build setup also compiled. All three returned 0 (`quest-source-check.txt`). Deprecation warnings concern SDK permission callbacks, label-filter factory and passthrough layering. These are not IL2CPP, SDK-wide compilation, or device validation.
- Android source-copy import failed during the pre-existing vendor-assembly security issue before APK generation. No authored C# compiler error was reported before that failure. See `Docs/Security-Block.md` for the distinction between package provenance and detection classification.

## Changes and boundaries

Runtime fixes preserve selection when another object is deleted, reject invalid object selection, validate replacement room state before discarding old state, and invalidate dead anchors during room reload. PC bridge pauses polling while room data is being replaced. Native controls add setup/retry and Quest Pro instructions; serialized field names remain intact.

New AI adapter and service proposal records keep model configuration on the PC. Proposals never execute before Apply; room coordinates and selected object IDs come from current runtime state. Offline language limitations are visible. PC saves are atomic; mismatched room/anchor loads retain existing objects.

This continuation changed authored scripts, service/UI, tests and documentation. It did not change installed VaM software, import assets from it, add downloadable catalogs, modify antivirus settings, restore quarantined binaries, invent API access, or replace the user's open Unity scene. The Android validation copy lives outside the deliverable source in `work/native-validation`; the open main project remains authoritative.

## Resume

1. Resolve the reported Meta assembly detection, then run `Build-Quest.ps1` with the main project's Editor closed. Read its first fatal error, or verify the resulting APK; do not infer success from source-only checks.
2. Connect and authorize Quest Pro over USB, run `Install-Quest.ps1`, start `Start-ControlService.ps1`, launch the installed app, grant spatial data and manually configure floor/table in Space Setup.
3. Repeat the README's loop on real surfaces. Record passthrough, actual room/target counts, cancellation/denial/retry behavior, same-object edits and anchor-local restore. Then test across app/headset restart separately.
4. If a model is desired, configure an explicitly chosen compatible endpoint/key/model and repeat the proposal loop. Mock-provider success is not a live interpretation result.

No test player or service is left running after validation. Start the service and desktop app using the README when trying the local prototype.
