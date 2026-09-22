# Matrix Operator checkpoints

## Current candidate: Quest 3 capture and content catalogs

Branch **`codex/quest3-capture-content-catalogs`**, based on merged checkpoint
**`67e3ffe`**. The candidate adds an explicit Quest 3 physical-camera capture path,
a PC content library and approved generation workflow, and versioned static
AssetBundle props that register through the existing scene executor. Quest Pro
continues to use virtual-only captures; unsupported mixed capture fails explicitly.
See [content catalogs](Content-Catalogs.md), [pack authoring](Content-Packs.md), and
the [candidate validation record](../Validation/Spatial-Content-Validation.md).

The library now includes an individual-prefab browser with search, availability
and source filters, measured dimensions, exact pack provenance, and explicit
whole-pack installation. **Use in Operator** selects an installed prop and
prepares an empty request without automatically invoking AI or editing the scene.
These PC page changes need no APK rebuild. **Preview prefab** shows a matching
catalog image as a thumbnail and larger sample without changing the scene.
The seven bundled props and beacon have actual Unity Editor studio renders;
these are authored-prefab samples, not headset screenshots or interactive 3D.
Start with the [user guide](Content-Library-User-Guide.md).

Three player builds succeeded with **352 core checks per build**, plus **14
camera protocol/projection checks**. Final PC source passed **378 Python tests**
and the Node Operator checks. The actual exported Windows bundle passed
**18 Unity Editor checks** covering registration, instantiation, provenance and
scene recovery. One bounded real ComfyUI image-generation job completed and its
image was inspected. The validation inventory records those Python/Node results,
artifact hashes and the limits of the original candidate checks.

**Quest Pro deployment and pack registration are verified:** the updated AR APK
is installed, and the Android sci-fi beacon pack was installed through the PC
service and acknowledged `ready` by the runtime. The available asset count is
now **eight**, including `matrix-fixture:scifi-props:1.0.0:beacon`. Real Codex placed
it at a wearer-selected floor point, and the wearer confirmed its appearance and
alignment. A second applied proposal enlarged it by 25%; Undo restored the exact
original scene. PC save, acknowledged clear, and restore preserved the exact
scene and pack provenance. `BeaconDemo_PR27_20260921` retains that one-beacon scene
on the review service. The wearer also confirmed it returned to the same floor
spot and original size after restore.
The first AI placement attempt proposed no commands, reporting that its requested
viewer-relative point was outside the floor boundary. Evidence is recorded in the
[headset walkthrough](../Validation/content-headset-walkthrough.json).

**The final PC service still needs a restart.** Port **8789** is serving the live
walkthrough from the existing process. It predates the final
`contentLibrary` capability flag and lease/worker fixes; passing source checks do
not mean those fixes are loaded. Automatic approval review rejected its restart
with only "blocked by policy" reported. Port
**8776** remains the previous running service. The separate Windows player
install/AI acceptance loop remains pending. Quest 3 camera permission, alignment,
image quality and performance checks still require Quest 3 hardware.

Static packs do not add arbitrary scripts, downloaded animation clips or runtime
skyboxes. After an app restart, explicitly reinstall the matching pack before
restoring a saved scene that uses it; verified cached bytes can be reused.

## Historical: rendered scene feedback before this candidate

Previous increment: **[Rendered scene feedback](Visual-Feedback.md)** for issue [#8](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/8), on `codex/rendered-scene-feedback` from merged `main` commit `80cf846`. Explicit PC capture/preview and typed/next-voice image inclusion are implemented with a matching snapshot/session/revision, bounded JPEG transfer, truthful AR disclosure, supported Codex model checks, read-only image reviews, and existing reviewed edits/undo. The isolated actual graphical Windows player passed **83 checks**, including three real Codex turns, two image attachments, exact edit/undo/save/clear/restore and visible behavior phases. **323 Python tests** and the Operator interaction suite pass. See [validation](../Validation/visual-feedback-validation.json) for final build counts, artifacts, and remaining acceptance.

The updated AR APK is installed on Quest Pro without clearing app data. The wearer confirmed the room outlines aligned. Three timed read-only captures and a separate real Codex image review passed; the harness made no scene edits. A later AI request returned HTTP 409 during active wearer/operator use and is not counted as a passed inference. Capture-frame wall time uses a monotonic clock because Unity's XR delta did not reflect observed capture stalls. See the [headset report](../Validation/visual-feedback-headset-results.json) for timings. Physical voice/buttons with image inclusion and standalone animated-object capture remain untested; these have automated/desktop coverage. The older service and saved scenes remain available. The new AR panel is on port **8776** with matching app URL and USB reverse mapping; port 8765 is the older service. The previous installed APK is retained locally. Issue #8 remains open for review.

The wearer also reproduced the stale voice "Room loading" notice while confirming that the trigger still worked. The final build clears only that loading-owned notice when localization finishes; recording behavior is unchanged. Seven regression checks cover the correction, with **321 Unity checks passing in each of three builds**. Quest 3 physical-camera plus virtual-content compositing is documented as a planned follow-up, not enabled by this virtual-only capture implementation.

Latest completed milestone: **[Live Rotate/Bob behaviors](Runtime-Behaviors.md)** on `codex/runtime-prefab-behaviors`, [PR #7](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/7), based on completed AR checkpoint **`6962eaf`**. Existing props support independent pause/resume, disabling, removal, undo/redo, and saved behavior configuration. The placed wrapper remains authoritative; its animated child does not change the saved pose or scene revision each frame. A shared PC-derived skill catalog exposes only capabilities advertised by the connected player. General programs, interaction triggers, physics, generated C#, and navigation remain proposed.

Validation: **292 Python tests**, **301 Unity checks in each of three successful builds**, and **46 actual Windows-player checks including four real Codex requests**. Additional actual Quest Pro validation passed **30 checks**, with separate wearer confirmation of bobbing and restored table alignment. See [behavior-validation.json](../Validation/behavior-validation.json), [desktop results](../Validation/behavior-desktop-results.json), and [headset results](../Validation/behavior-headset-results.json).

Actual Quest speech **“Make this orb rotate slowly and float gently above the table”** reached real Codex (`gpt-5.6-sol`, `xhigh`) and produced two acknowledged commands on the same orb: Y rotation at 15 degrees/second and upward bob at 0.03 meters / 0.5 Hz. The wearer confirmed visible bobbing. Device checks exercised a one-centimeter baseline move and undo, independent pause/resume, removing Bob and undoing removal, and exact behavior-bearing save/clear/load. The wearer confirmed the orb returned to the same physical table spot and continued bobbing. The uniform orb's visible rotation was not separately verified.

**Live scene at completion:** the pretest one-orb scene **`BeforeVoiceRestart_20260920_175100`** was restored exactly and its static orb reselected. **`AnimatedRoomBehavior_20260920_181054`** preserves the tested animated version. The earlier two-object orb/block scene remains saved as **`BeforeBehaviorVoice_20260920_174538`**. Recheck live state before restoring; subsequent wearer edits are separate.

The earlier silent-capture problem recovered after the user-reported restart and USB/developer authorization recovery. ADB was authorized, port 8765 was restored, and system microphone mute was then false. No source, build, microphone code, or silence threshold changed during recovery; the original system/HAL mute policy remains unidentified. One post-restart room restore was observed with 28 anchors, seven support surfaces, aligned outlines, and unchanged manual room IDs. Recreated/deleted native anchors remain hardware-untested. A known cosmetic voice status can still say “Room loading” after `BindRoom`; when actual room state is ready and the PC is connected, the trigger can start speech despite that stale line.

Local behavior checkpoint: sibling **`outputs/checkpoints/RuntimeBehaviors_20260920/`**, containing a source bundle, the new AR APK, preserved baseline and animated scene saves and a SHA-256 inventory. The Desktop full checkout and both Unity Hub source exports are synchronized; its unrelated Unity assets remain preserved.

Before-update save: **`BeforeBehaviors_20260920_172929`** in `ControlService/scenes/`. The prior working AR APK and save are preserved locally in sibling `outputs/checkpoints/RoomARBeforeBehaviors_20260920/`. Current AR build: `Builds/RoomARQuest/MatrixOperatorAR.apk`, SHA-256 `C94A760F55B15B01CF7E5FACFCF6CDDE165AB4BBC91014567A49F18DF9A79DAC`. The white-room regression APK was built but not installed over its working app.

To continue, verify the service on port 8765 and the authorized USB reverse mapping, manually open **Matrix Operator AR**, check room alignment, and confirm the system microphone is unmuted. Restore `AnimatedRoomBehavior_20260920_181054` to view the preserved animation, or select the static orb and hold/release left trigger for a new request, review, and apply with Y. Keep credentials on the PC. The [LLMR review](LLMR-Behavior-Runtime.md) and [GOAP next-step note](GOAP-Next-Step.md) separate implemented foundations from later composable programs and character navigation.

Previous completed milestone: **[Quest Pro room AR](Room-AR.md)** on `codex/quest-pro-room-ar`, [PR #6](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/6), based on merged PR #5. The actual Quest Pro loaded 28 manually configured MRUK anchors. The wearer verified outlines, voice orb placement on the real table and voice movement toward its center. PC save/clear/restore retained the exact scene; the wearer confirmed that the restored orb returned to the same spot on the real table. The requested same-session acceptance loop is complete. Hardware and automated evidence are separated in `Validation/room-ar-validation.json`.

AR acceptance save: **`RoomARAcceptance_20260920_171926`**. The APK used for that earlier acceptance had SHA-256 `BD83A89FEC5B4E6D966E7F3AF057CD92F0BC3B1A84954107045F6C7686850111`; it is the preserved previous build, not the current behavior APK. That earlier acceptance covered one session; the subsequent behavior milestone adds the limited post-restart evidence described above. Changed-anchor recovery remains hardware-unverified. The white-room app and its earlier checkpoint below remain available.

Previous milestone: **push-to-talk and Codex model/reasoning selectors** are implemented, pushed and installed. Start with [Voice-And-Codex-Controls.md](Voice-And-Codex-Controls.md). The real audio-to-AI-to-Windows-player loop passed 24 checks. The Quest then supplied real microphone speech, received a real Codex proposal, acknowledged four edits and returned to its exact original 40-object scene through observed undo changes: 12 device/network checks passed in `Validation/voice-headset-results.json`. Separate wearer confirmation of physical buttons and HUD readability is pending. The earlier recovery checkpoint below remains intact; the pre-install layout is also saved as `BeforeVoiceInstall_20260920`.

Checkpoint: **2026-09-20 16:07:37 America/Denver**. The wearer confirmed **“it works”** and requested commit, push and a complete checkpoint.

Git recovery tag: `checkpoint/2026-09-20-160737` on `codex/quest-pro-ai-validation`, tracked by [PR #5](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/5). This file and the confirmation record are part of that checkpoint commit. Implementation and earlier synchronization were already published through `bc97027`.

## Earlier white-room checkpoint scene and files

- PC save: `MatrixCheckpoint_20260920_160737`, containing **40 objects**. It was saved through the running service, read back and SHA-256 checked. This is the scene at checkpoint time; subsequent edits are separate.
- Save SHA-256: `272134C61FE6F7D9F6684EAB7A3AC3BA42B70664489BCBF39315BFBB5FB8658D`. The live viewer pose is excluded from the save.
- Authoritative service/source checkout: the task's `outputs/matrix-white-room`. The running service is at `http://127.0.0.1:8765/`; verify health on resume.
- Desktop full clone: `Desktop/Game Design/Matrix Loading Operator`. Unity Hub source copies: `Matrix White Room Quest` and `Matrix White Room Desktop` in the same folder. Their separate source/prefab/scene state is preserved in the local checkpoint archive.
- Local archive: sibling `outputs/checkpoints/MatrixCheckpoint_20260920_160737/`. It includes a Git bundle, built players, PC saves, Unity Hub source exports, preserved Desktop-local Unity assets and a SHA-256 inventory. Builds and personal scenes remain local; credentials, Unity caches and vendor packages are excluded.

## Working behavior and evidence

The real Codex CLI planner uses existing ChatGPT sign-in on the PC. It receives scene state, prefab geometry/orientation, selection and tracked anchor-relative viewpoint, then composes arrangements using the seven bundled prefabs. Requests are reviewed in the Operator before Apply. The offline mode remains a separate finite parser.

The exact table/two-chair request and a room made from wall pieces passed **93 checks on Quest Pro**, including save, clear and exact restore. A separate actual Windows player passed **90 live AI checks**. Automated validation also passed **167 Python tests**, **169 Unity checks per build target**, and a **13-check isolated desktop preflight**. The wearer subsequently confirmed the result works; that general confirmation is distinct from individual harness assertions or a comprehensive comfort/collision assessment.

Installed Quest package: `com.matt.matrixoperator.whiteroom`. APK: `Builds/WhiteRoomQuest/MatrixOperator.apk`, 53,838,926 bytes, SHA-256 `5CFBD0F64763392F9F4EC120CF8AC0358A20E84B19302DD59761021E42C1ADED`. Both generated build targets use Unity **6000.6.0f1**. See the composition reports in `Validation` for exact execution evidence.

## Recover the earlier white-room checkpoint

1. Use this tagged checkout, or clone `source.bundle` from the local archive and check out the tag. Do not overwrite later work without checking its Git state.
2. If port 8765 is not already serving this project, run `./Start-CodexControlService.ps1` from the chosen full checkout. Keep credentials in Codex's existing PC login; no API-key substitute is required.
3. Connect the authorized Quest Pro, run `./Connect-QuestControl.ps1`, and open Matrix Operator in the headset. Keep the headset awake for viewer-relative requests.
4. Open the Operator page, choose **Codex (ChatGPT subscription)**, enter a request, review its summary/assumptions and Apply. Head motion is allowed; scene edits or selection changes invalidate a pending proposal. Proposals expire after two minutes.
5. To recover the checkpoint layout, choose `MatrixCheckpoint_20260920_160737` in Saved scenes and restore it. Restoring replaces the runtime scene; save any newer layout first. Scene persistence does not restore live head pose or undo history.

Native MRUK/passthrough results are recorded separately in [Room-AR.md](Room-AR.md). The earlier generated-assembly security failures remain in the progress log; consult the newer build evidence before assuming that historical blocker still applies. No physical-room success can be inferred from this white-room checkpoint. Catalogs and SOTA lessons remain deferred.
