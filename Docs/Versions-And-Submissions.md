# Versions and preserved submissions

## Frozen release identities

| Version | Status | Source |
| --- | --- | --- |
| [v1.2.0](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.2.0) | Frozen checkpoint; remaining physical and matched-latency acceptance in #173 | `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0` |
| [v1.1.0](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.1.0) | Retained stable release | `9453ef06b1873937822c1cf985115f05f72e1e20` |

The [v1.2 checkpoint guide](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/Docs/V1.2-Checkpoint.md) is the entry for requirements,
verified ZIP/manifest/checksums, startup, controls and scope. This is a PC/WebXR
bundle, not an APK. Its publication was October 5, 2026 at 00:15:34 UTC
(October 4 in America/Denver).

Keep published tags and assets fixed. PR #207 and later main-branch changes are
subsequent source work, not part of the published v1.2 ZIP. The pre-cleanup
snapshot at `60ab4599752147f2e590293208bee4692965a524` preserves repository
history; it does not replace the release source above. Later tests do not
retroactively validate an earlier package.

## Preserve a new WebXR submission

Select the exact release for a submission and record its URL, tag, source commit,
package checksum and browser/headset evidence. Link that release, not the
changing main branch. Preserve limitations and pending checks alongside passes.

When a new release is authorized:

1. Commit the intended WebRuntime and ControlService source. Use the
   [release builder](../Tools/README-WebXR-Release.md) to create the committed-source
   ZIP, external manifest and SHA256SUMS. Record dependency versions and the
   matching service, assets and tested browser/headset mode.
2. Test the extracted package with an isolated profile/service. Preserve the
   package, manifest, checksums and any included portable world/catalog assets
   together. The builder's service/host smoke checks do not perform Quest
   validation or publish a release.
3. Create a new annotated version tag and draft prerelease. Verify uploaded sizes
   and SHA-256 digests before authorized publication. Never replace an older
   package or move its tag. This is project policy, not a claim that GitHub
   enforces immutable releases.
4. Attach the demonstration video, report and slides where applicable. State
   what the audience can do, the contribution since the previous submission,
   and any setup they must recreate. Exclude private worlds, room scans/IDs,
   credentials and signing keys from public assets.

Keep runtime and PC service versions matched when switching releases, and save
the current world first. Older versions may not preserve newer state. Speech
models, Blender and native Codex setup are external prerequisites where used;
do not assume they are included in a package.

## Historical releases and plans

[GitHub Releases](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases)
retains the published downloads. The
[preserved version record](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Versions-And-Submissions.md)
contains the original Unity APK provenance, earlier WebXR checkpoints, matching
runtime/service instructions and proposed course submissions. Unity source
remains in [Archive/Unity](../Archive/Unity/README.md). Those historical build
and device observations keep their original identities and scope.
