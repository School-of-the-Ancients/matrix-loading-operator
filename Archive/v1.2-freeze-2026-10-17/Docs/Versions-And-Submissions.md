# Versions and coursework submissions

The native Unity builds below are historical releases, not the build path for new coursework. The owner selected Three.js/WebXR for future Matrix runtime and submissions; source is retained in the [Unity archive](../Archive/Unity/README.md). Download all preserved builds from [GitHub Releases](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases). Each prerelease has its own source and validation scope; later tests do not retroactively validate an older package.

## Current WebXR releases

| Version | Published date | Status | Source checkpoint |
| --- | --- | --- | --- |
| [v1.2.0](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.2.0) | October 4, 2026, America/Denver | Checkpoint prerelease; remaining acceptance in #173 | `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0` |
| [v1.1.0](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.1.0) | September 29, 2026 | Stable Latest | `9453ef06b1873937822c1cf985115f05f72e1e20` |

The [v1.2 checkpoint guide](V1.2-Checkpoint.md) records verified ZIP/manifest/checksums, startup, controls, scope deferrals and validation limits. GitHub records its publication at October 5, 2026, 00:15:34 UTC, which is October 4 in the owner's timezone. The package is PC/WebXR, not an APK. Keep published tags/assets fixed; newer documentation on main is not part of the frozen ZIP.

## Historical Unity milestones

| Version | Original build date | Experience | APK variants | Source checkpoint |
| --- | --- | --- | --- | --- |
| [v0.1.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.1.0-preview.1) | September 20, 2026 | White-room AI composition, reviewed edits, Undo and save/restore | White room | `6e20899` |
| [v0.2.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.2.0-preview.1) | September 20, 2026 | Headset push-to-talk and Codex model/reasoning controls | White room | `a30d6f1` |
| [v0.3.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.3.0-preview.1) | September 20, 2026 | Quest Pro room-aware AR placement and table-aligned restore | AR | `6962eaf` |
| [v0.4.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.4.0-preview.1) | September 20, 2026 | Live Rotate/Bob behaviors with Undo and persistence | AR and white room | `94a6177` |
| [v0.5.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.5.0-preview.1) | September 21, 2026 | Rendered image feedback and the stale voice-loading HUD fix | AR and white room | `af9c30c` |

Seven unique APKs were recovered from the Codex checkpoints and build folders, including the archive referenced in **Locate Virt-A-Mate files**. Duplicate backups and Gradle intermediates have matching hashes and are not separate versions. Earlier white-room prototypes used output paths that were later overwritten; no original binaries for those earlier stages were found. They are not represented as recovered releases.

These original APKs were not rebuilt, re-signed or edited. All retain embedded Android version name `1.0` and version code `1`; identify the actual milestone by its release tag and SHA-256. White-room and AR are separate app packages. Source provenance is recorded in each manifest; this is not a claim that rebuilding a commit reproduces an identical APK.

## Historical WebXR checkpoints

| Version | Published | Artifact | Source checkpoint |
| --- | --- | --- | --- |
| [v0.6.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.6.0-preview.1) | September 26, 2026 | `Matrix-WebXR-PC-v0.6.0-preview.1.zip` with manifest and checksums | `add6e299` |
| [v0.7.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.7.0-preview.1) | September 26, 2026 | `Matrix-WebXR-PC-v0.7.0-preview.1.zip` with manifest and checksums | `0cb8c23` |

These are preserved working checkpoints, not proof that the full #122 Creator Mode flow or every Quest VR/AR check passed. The [current checkpoint](Current-Checkpoint.md) and [Quest acceptance matrix](../WebRuntime/QUEST3_ACCEPTANCE.md) describe the observed behavior and remaining gates.

## Run a historical Unity version

1. Download the desired APK and **PCService ZIP from the same release**. Read the included `RELEASE-README.md` and milestone runbooks.
2. Keep a PC save of the current scene before switching versions. Old releases cannot be assumed to preserve features added later; room-aware saves also depend on the headset's configured anchors.
3. Sideload the chosen APK. Extract its PC service separately from other releases. Python, native Codex sign-in and, for speech, the local speech setup are separate prerequisites. Optional SOTA lesson services are not included.
4. Start that release's service and connect its matching runtime. Device URL, service port and USB reverse port must match. Default is 8765; a retained `control.json` override such as 8776 must be matched on all three ends. Forwarding unlike ports is rejected by HTTP Host validation.

The archives exclude saved room scenes, credentials, signing keys, speech environments and model weights. Their PC-service source files were checked against the tagged Git blobs and tested with an isolated health/Operator-page startup. Read the release notes for the distinction between build checks and actual headset testing.

## Preserve a new WebXR submission

Choose a tested WebXR release for the submission and include its exact release URL, tag, package checksum, source commit, and device/browser evidence in the report. Keep that release fixed; later changes get a new version rather than replacing its package or moving its tag. GitHub may allow edits, so this is the project's preservation policy, not a claim of server-enforced immutability.

For a new milestone:

Use the [WebXR release builder](../Tools/README-WebXR-Release.md) for the
committed-source ZIP, external manifest, SHA256SUMS, and isolated extracted
service/host smoke check. It does not perform Quest validation or publication.

1. Commit the intended WebRuntime and ControlService source. Build and validate that exact WebXR/PC-service package, recording source commit, dependency versions, package hash, tested browser/headset mode, and remaining limitations.
2. Preserve the built package, manifest, checksums, matching PC service, and any portable demo world or required catalog assets under a new versioned checkpoint. Test the package after extraction in an isolated profile/service before release.
3. Create a new annotated version tag pointing at that checkpoint. Create a draft GitHub prerelease and attach the WebXR/PC package, manifest and checksums. Verify uploaded asset sizes and SHA-256 digests before publishing.
4. Add the submission's demonstration video, report and slides. Keep personal room scans, room identifiers, saved private worlds and credentials out of public assets. Describe how to recreate any room-specific setup on the evaluator's device.
5. Record what the audience can do in this version and what is new since the previous submission. Link the selected release rather than the changing `main` branch.

## Planned submission experiences

These are the proposed coursework targets supplied by the user, not completed submissions or a claim of instructor approval. Select each final release after its own acceptance check.

| Submission | Proposed experience | Distinct contribution to freeze |
| --- | --- | --- |
| Project 1, October 6 | **Matrix Operator: Describe Your Reality** | A WebXR Operator journey: create/place, resize or move, Undo, save, reopen and restore. Demonstrate physical-table alignment only if the WebXR AR wearer check passes; otherwise label the virtual-floor result accurately. |
| Project 2, October 27 | **Matrix Playground: Build a Playable Room** | A WebXR world with one coherent procedural or registered-GLB content workflow and a meaningful tested interaction; record Quest 3 mode-specific acceptance. |
| Project 3, December 1 | **School of the Ancients: An AI Classroom** | A reusable WebXR experiment/lesson with prediction, manipulation, observations and feedback in the headset; keep School curriculum and learner records in the School product. |

Each submission needs its own demonstration and explanation of the new contribution. WebXR browser checks, Quest VR observations and Quest AR observations are separate evidence. The WebXR camera/render Review View remains uncalibrated; actual Quest 3 physical-camera permission, alignment, image quality and performance acceptance require wearer evidence. Installing a historical Unity APK does not validate a WebXR feature. See [visual feedback](Visual-Feedback.md), the [current checkpoint](Current-Checkpoint.md), [Quest acceptance](../WebRuntime/QUEST3_ACCEPTANCE.md), and [learning sessions](Learning-Sessions.md) for the earlier lesson prototype's limits.
