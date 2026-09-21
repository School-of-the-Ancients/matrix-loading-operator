# Versions and coursework submissions

Download preserved builds from [GitHub Releases](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases). Each release freezes original APKs, a matching PC-service ZIP, source tag, release manifest and SHA-256 checksums. These are development prereleases. The recorded test evidence belongs to each milestone; later validation does not retroactively validate an older APK.

## Preserved milestones

| Version | Original build date | Experience | APK variants | Source checkpoint |
| --- | --- | --- | --- | --- |
| [v0.1.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.1.0-preview.1) | September 20, 2026 | White-room AI composition, reviewed edits, Undo and save/restore | White room | `6e20899` |
| [v0.2.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.2.0-preview.1) | September 20, 2026 | Headset push-to-talk and Codex model/reasoning controls | White room | `a30d6f1` |
| [v0.3.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.3.0-preview.1) | September 20, 2026 | Quest Pro room-aware AR placement and table-aligned restore | AR | `6962eaf` |
| [v0.4.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.4.0-preview.1) | September 20, 2026 | Live Rotate/Bob behaviors with Undo and persistence | AR and white room | `94a6177` |
| [v0.5.0-preview.1](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.5.0-preview.1) | September 21, 2026 | Rendered image feedback and the stale voice-loading HUD fix | AR and white room | `af9c30c` |

Seven unique APKs were recovered from the Codex checkpoints and build folders, including the archive referenced in **Locate Virt-A-Mate files**. Duplicate backups and Gradle intermediates have matching hashes and are not separate versions. Earlier white-room prototypes used output paths that were later overwritten; no original binaries for those earlier stages were found. They are not represented as recovered releases.

These original APKs were not rebuilt, re-signed or edited. All retain embedded Android version name `1.0` and version code `1`; identify the actual milestone by its release tag and SHA-256. White-room and AR are separate app packages. Source provenance is recorded in each manifest; this is not a claim that rebuilding a commit reproduces an identical APK.

## Run a historical version

1. Download the desired APK and **PCService ZIP from the same release**. Read the included `RELEASE-README.md` and milestone runbooks.
2. Keep a PC save of the current scene before switching versions. Old releases cannot be assumed to preserve features added later; room-aware saves also depend on the headset's configured anchors.
3. Sideload the chosen APK. Extract its PC service separately from other releases. Python, native Codex sign-in and, for speech, the local speech setup are separate prerequisites. Optional SOTA lesson services are not included.
4. Start that release's service and connect its matching runtime. Device URL, service port and USB reverse port must match. Default is 8765; a retained `control.json` override such as 8776 must be matched on all three ends. Forwarding unlike ports is rejected by HTTP Host validation.

The archives exclude saved room scenes, credentials, signing keys, speech environments and model weights. Their PC-service source files were checked against the tagged Git blobs and tested with an isolated health/Operator-page startup. Read the release notes for the distinction between build checks and actual headset testing.

## Freeze each submission

Choose a tested release for the submission and include its exact release URL, tag and APK checksum in the report. Keep that release fixed; later changes get a new version rather than replacing its APK or moving its tag. GitHub may allow edits, so this is the project's preservation policy, not a claim of server-enforced immutability.

For a new milestone:

1. Commit the intended source and record the Unity/package environment. Build and validate the exact APK; record its source checkpoint, package identity, date, hash, tested device and remaining limitations.
2. Immediately preserve the APK in a versioned checkpoint folder before another build overwrites `Builds/`. Preserve the source-matched PC service and a manifest alongside it.
3. Create a new annotated version tag pointing at that checkpoint. Create a draft GitHub prerelease and attach the APK variants, PC service, manifest and checksums. Verify uploaded asset sizes and SHA-256 digests before publishing.
4. Add the submission's demonstration video, report and slides. Include a portable demo scene when appropriate; keep personal room scans, room identifiers and credentials out of public assets. A room-bound demo can instead document how to recreate the setup on the evaluator's headset.
5. Record what the audience can do in this version and what is new since the previous submission. Link the selected release rather than the changing `main` branch.

## Planned submission experiences

These are the proposed coursework targets supplied by the user, not completed submissions or a claim of instructor approval. Select each final release after its own acceptance check.

| Submission | Proposed experience | Distinct contribution to freeze |
| --- | --- | --- |
| Project 1, October 6 | **Matrix Operator: Describe Your Reality** | A polished real-table demonstration: place, resize, float, Undo, save, clear and restore. Current AR/behavior milestones supply the foundation; image inspection is optional. |
| Project 2, October 27 | **Matrix Playground: Build a Playable Room** | Quest 3 validation, one coherent content pack/import workflow and one meaningful interaction. |
| Project 3, December 1 | **School of the Ancients: An AI Classroom** | One complete guided lesson with prediction, manipulation, observations and feedback in the headset. |

Each submission needs its own demonstration and explanation of the new contribution. Quest 3 physical-camera-plus-virtual capture remains a planned integration; it is not enabled by changing headsets. See [visual feedback](Visual-Feedback.md) for the current virtual-only boundary and [learning sessions](Learning-Sessions.md) for the earlier lesson prototype's validation scope.
