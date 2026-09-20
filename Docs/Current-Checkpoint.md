# Matrix Operator checkpoints

Latest milestone: **[Quest Pro room AR](Room-AR.md)** on `codex/quest-pro-room-ar`, [PR #6](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/6), based on merged PR #5. The actual Quest Pro loaded 28 manually configured MRUK anchors. The wearer verified outlines, voice orb placement on the real table and voice movement toward its center. PC save/clear/restore retained the exact scene; the wearer confirmed that the restored orb returned to the same spot on the real table. The requested same-session acceptance loop is complete. Hardware and automated evidence are separated in `Validation/room-ar-validation.json`.

Latest local AR save: **`RoomARAcceptance_20260920_171926`** in `ControlService/scenes/`. Start the PC service, connect USB, open **Matrix Operator AR**, verify outlines and confirm alignment before restoring. The AR APK is `Builds/RoomARQuest/MatrixOperatorAR.apk`, SHA-256 `BD83A89FEC5B4E6D966E7F3AF057CD92F0BC3B1A84954107045F6C7686850111`. App restart/relocalization and changed-anchor recovery remain hardware-unverified. The white-room app and its previous checkpoint below remain available.

Previous milestone: **push-to-talk and Codex model/reasoning selectors** are implemented, pushed and installed. Start with [Voice-And-Codex-Controls.md](Voice-And-Codex-Controls.md). The real audio-to-AI-to-Windows-player loop passed 24 checks. The Quest then supplied real microphone speech, received a real Codex proposal, acknowledged four edits and returned to its exact original 40-object scene through observed undo changes: 12 device/network checks passed in `Validation/voice-headset-results.json`. Separate wearer confirmation of physical buttons and HUD readability is pending. The earlier recovery checkpoint below remains intact; the pre-install layout is also saved as `BeforeVoiceInstall_20260920`.

Checkpoint: **2026-09-20 16:07:37 America/Denver**. The wearer confirmed **“it works”** and requested commit, push and a complete checkpoint.

Git recovery tag: `checkpoint/2026-09-20-160737` on `codex/quest-pro-ai-validation`, tracked by [PR #5](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/5). This file and the confirmation record are part of that checkpoint commit. Implementation and earlier synchronization were already published through `bc97027`.

## Current scene and files

- PC save: `MatrixCheckpoint_20260920_160737`, containing **40 objects**. It was saved through the running service, read back and SHA-256 checked. This is the scene at checkpoint time; subsequent edits are separate.
- Save SHA-256: `272134C61FE6F7D9F6684EAB7A3AC3BA42B70664489BCBF39315BFBB5FB8658D`. The live viewer pose is excluded from the save.
- Authoritative service/source checkout: the task's `outputs/matrix-white-room`. The running service is at `http://127.0.0.1:8765/`; verify health on resume.
- Desktop full clone: `Desktop/Game Design/Matrix Loading Operator`. Unity Hub source copies: `Matrix White Room Quest` and `Matrix White Room Desktop` in the same folder. Their separate source/prefab/scene state is preserved in the local checkpoint archive.
- Local archive: sibling `outputs/checkpoints/MatrixCheckpoint_20260920_160737/`. It includes a Git bundle, built players, PC saves, Unity Hub source exports, preserved Desktop-local Unity assets and a SHA-256 inventory. Builds and personal scenes remain local; credentials, Unity caches and vendor packages are excluded.

## Working behavior and evidence

The real Codex CLI planner uses existing ChatGPT sign-in on the PC. It receives scene state, prefab geometry/orientation, selection and tracked anchor-relative viewpoint, then composes arrangements using the seven bundled prefabs. Requests are reviewed in the Operator before Apply. The offline mode remains a separate finite parser.

The exact table/two-chair request and a room made from wall pieces passed **93 checks on Quest Pro**, including save, clear and exact restore. A separate actual Windows player passed **90 live AI checks**. Automated validation also passed **167 Python tests**, **169 Unity checks per build target**, and a **13-check isolated desktop preflight**. The wearer subsequently confirmed the result works; that general confirmation is distinct from individual harness assertions or a comprehensive comfort/collision assessment.

Installed Quest package: `com.matt.matrixoperator.whiteroom`. APK: `Builds/WhiteRoomQuest/MatrixOperator.apk`, 53,838,926 bytes, SHA-256 `5CFBD0F64763392F9F4EC120CF8AC0358A20E84B19302DD59761021E42C1ADED`. Both generated build targets use Unity **6000.6.0f1**. See the composition reports in `Validation` for exact execution evidence.

## Resume

1. Use this tagged checkout, or clone `source.bundle` from the local archive and check out the tag. Do not overwrite later work without checking its Git state.
2. If port 8765 is not already serving this project, run `./Start-CodexControlService.ps1` from the chosen full checkout. Keep credentials in Codex's existing PC login; no API-key substitute is required.
3. Connect the authorized Quest Pro, run `./Connect-QuestControl.ps1`, and open Matrix Operator in the headset. Keep the headset awake for viewer-relative requests.
4. Open the Operator page, choose **Codex (ChatGPT subscription)**, enter a request, review its summary/assumptions and Apply. Head motion is allowed; scene edits or selection changes invalidate a pending proposal. Proposals expire after two minutes.
5. To recover the checkpoint layout, choose `MatrixCheckpoint_20260920_160737` in Saved scenes and restore it. Restoring replaces the runtime scene; save any newer layout first. Scene persistence does not restore live head pose or undo history.

Native MRUK/passthrough results are recorded separately in [Room-AR.md](Room-AR.md). The earlier generated-assembly security failures remain in the progress log; consult the newer build evidence before assuming that historical blocker still applies. No physical-room success can be inferred from this white-room checkpoint. Catalogs and SOTA lessons remain deferred.
