# Spatial capture and content catalog candidate validation

Candidate branch: `codex/quest3-capture-content-catalogs`, based on merged commit
`67e3ffe5ceb6aea2387aaa0a0ceb241db09561f0`. Unity **6000.6.0f1**.
The [machine-readable inventory](spatial-content-validation.json) contains exact
artifact hashes, sizes, timestamps and evidence references.

## Verified

| Area | Evidence and boundary |
| --- | --- |
| Unity builds | Windows desktop, native room AR Android, and white-room Android builds succeeded; **352 core checks per target**. Current runtime source matches all copied fixture files: 13 desktop, 15 room AR, and 13 white-room Quest files. |
| Camera protocol | **14 Editor checks** passed for explicit capture modes, unsupported-device responses, calibrated projection and frame age. No Quest 3 camera or physical composite was tested. |
| PC service | Final frozen sources passed **378 Python tests** in 55.908 seconds, plus Node Operator interaction checks. The seven capability-flag follow-up tests are included in the final suite. Regressions cover a null room snapshot during an install receipt, same-client lease expiry, asynchronous response serialization, and worker-start cleanup. |
| Exported prefab bundle | **18 checks** passed against the actual Windows bundle in a temporary Unity Editor world: integrity, compatibility, loaded-prefab validation, registration, instantiation, provenance, undo/redo, serialized save/clear/restore, and rejection of a conflicting saved digest. This did not run the standalone player or PC install bridge. |
| Real image generation | **One** approved, bounded self-hosted ComfyUI image workflow completed at 512 × 512, four steps and batch size one. The connector retrieved and verified the PNG; the generated image was visually inspected. No video, MiniMax, runtime texture or skybox installation was tested. |
| Library UI | Manual browser inspection of the isolated preview showed Windows and Android pack results, disabled Install actions while offline, generation disabled without its explicit approval checkbox, and a completed generated-image preview. Three providers were configured, including one disabled handoff, with two Asset Store import-queue entries. These observations are not an automated test count. |

The real-generation receipt is [comfy-content-validation.json](comfy-content-validation.json).
Its 68.4 seconds measures submission to verified download, including independent
work between polls; it is not a GPU inference benchmark. The original workflow
files were preserved.

## Build artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Native AR APK, `Builds/SpatialContentPreview/MatrixOperatorAR.apk` | 84,740,382 | `6cd39a227f7decbc040af8f4a39cfd6f51520b7725f94a11513701edc9ff93c4` |
| White-room APK, `Builds/SpatialContentPreview/MatrixOperatorWhiteRoom.apk` | 54,158,252 | `9f4b2c386f4986af663de408e4e82847c8f07cd30c459c3c065c5df57d959ad3` |
| Windows player assembly, `Builds/ContentPreviewDesktop/MatrixOperator_Data/Managed/Assembly-CSharp.dll` | 113,664 | `6d4c23badc5f21634bac63154dc29d9209a7b0e83fe0057a7e2eb918ea6fe911` |
| Windows sci-fi fixture bundle | 51,670 | `7eceecaee3480572712d8654a7746065c9f82fba26381fec8f6797d896779a42` |
| Android sci-fi fixture bundle | 136,097 | `3b926e9f8cc85282e2814a81483c92aded9dff44f5b0174c5a921bdfb26b68f1` |

The complete Windows distribution is **254 files / 160,187,305 bytes**. Its
inventory digest is
`e7c8c42a70aa97028b7a44045d43b4e91d14c243bc2318301b748a9dc136943e`;
the inventory format is recorded in JSON. The launcher executable alone cannot
identify a Unity player version; it is shared across these builds.

Both content bundles were exported **after their corresponding acceptance
player build**: Windows bundle at 21:28 UTC, after desktop build data at 21:23;
Android bundle at 21:30 UTC, after the native AR APK at 21:26. The separate
white-room Android regression build completed later, at 21:32 UTC. This chronology
does not establish that the bundles were installed in any standalone player.

## Deployment and remaining acceptance

The new APKs **have not been installed**. Quest 3 hardware is unavailable, so
physical-camera permission, sensor alignment, mixed image quality and device
timing remain unverified. Quest Pro retains its previous virtual capture behavior;
it does not gain Quest 3 camera access from this change.

Automatic approval review blocked launching the standalone validation player and
restarting either running service. The actual PC-install and optional live-AI
placement harness is ready but **pending manual player launch**. The service on
port **8776** remains the previous running version. The separate preview on port
**8789** exposes the new library UI without claiming an online updated runtime.
That preview process loaded before the final capability-flag, lease-expiry,
response-serialization and worker-start fixes; the final 378-test PC source is
on disk but is **not loaded by either existing process**. Its attempted restart
was rejected before execution with only “blocked by policy” reported.
No old service or user scene was replaced by these checks.

Runtime pack support is limited to static prefab components and approved built-in
shaders. Existing Rotate/Bob commands can operate on registered props, but no
arbitrary scripts, downloaded animation clips, video surfaces or runtime skyboxes
are supported. Asset Store content still needs authorized import and export through
Unity; catalog entries are not permission to download proprietary packages.

Installed packs currently require explicit reinstallation after an app restart
(verified cached bytes are reused) before restoring a scene that references them.
Missing or conflicting versions fail explicitly and preserve the current scene.
Read [Content-Packs.md](../Docs/Content-Packs.md) for the exact contract and limits.
