# Native Unity import blocked by security detection

## Current Quest Pro attempt — 2026-09-20, 12:10 local

The user requested continued autonomous prototype work, Quest Pro primary. A native build was attempted from an isolated copy because the source project remained open in Unity. Android compilation again stopped with Bee `Access is denied`. The latest Malwarebytes report confirms `Trojan.Injector.MSIL`, **quarantine successful**, for:

`<local-workspace>/work/native-validation/Library/Bee/artifacts/1300b0aE.dag/Meta.XR.BuildingBlocks.AIBlocks.dll`

SHA-256: `BCCA0E3C6CD5E3671B40105CE7D1AA79B65AD9F69C60FEE732C902B2B53672FC` (same Android assembly hash as the earlier attempt).

Raw build logs remain local and are not distributed. No APK was created. The user's earlier Meta Core allow-list change did not prevent this quarantine. No exclusions, restores, antivirus changes, or vendor-code edits were performed by Codex. This is an external native-build blocker, separate from the passing authored-code and desktop checks. The package-provenance findings below remain evidence of origin, not a false-positive determination.

Resume after the user resolves the security detection: close the source project's Editor, run `Build-Quest.ps1`, inspect the first fatal error or successful APK result, then connect the Quest Pro and run `Install-Quest.ps1`. The native copy is only a validation workspace; authoritative source remains `outputs/AR-Sandbox`. Recheck current files/device state before another attempt. Do not describe the APK or headset behavior as tested until that succeeds.


## Earlier retry result

After the user's allow-list change, Unity's Windows-target import and scene generation completed successfully (exit 0, `SANDBOX_SETUP_OK`). The Quest scene, OVR rig/passthrough, MRUK component, prefabs, and OpenXR settings were generated.

The subsequent Android-target import failed with Bee `Access is denied` while processing the AIBlocks assembly. Malwarebytes' real-time detection reports confirm **successful quarantine** of two further compiled copies, both named `Trojan.Injector.MSIL`:

| Local time on 2026-09-20 | Generated file | SHA-256 |
| --- | --- | --- |
| 11:49:49 | `Library/Bee/artifacts/1300b0aE.dag/Meta.XR.BuildingBlocks.AIBlocks.dll` | `BCCA0E3C6CD5E3671B40105CE7D1AA79B65AD9F69C60FEE732C902B2B53672FC` |
| 11:50:50 | `Library/ScriptAssemblies/Meta.XR.BuildingBlocks.AIBlocks.dll` | `F11F2794E241B2686872A51DE75EC53E9FC26A830C13FC2CF8A24072E044E7FB` |

Both paths are relative to `<local-workspace>/outputs/AR-Sandbox`. Both detections reported 158,208 bytes. The reports are `ac5aa788-b51b-11f1-9a7e-6c02e03e0c6a.json` and `d1342962-b51b-11f1-b87f-6c02e03e0c6a.json` under Malwarebytes' `RtpDetections` directory. Only threat names, paths, hashes, and cleanup results were retained here, not account or machine identifiers.

The earlier allowed path was a different compilation output (`1900b0aE.dag`). The retry does not demonstrate that the existing allow-list entry covers the two additional paths. No further native build was attempted after confirming these quarantines. No APK was produced. The user controls Malwarebytes' allow-list decision; Codex did not add exceptions or restore files.

## Resume authorization

Later on September 20, 2026, the user reported adding Meta XR Core to the Malwarebytes allow list. At the user's direction, native import and build work resumed. The project-only build blocker marker was removed. Codex did not change Malwarebytes settings or restore quarantined files. The allow-list change is the user's decision; it is not a vendor confirmation that the detection was a false positive. The original investigation below is retained as history.

On September 20, 2026, the user reported a Malwarebytes `Trojan.Injector.MSIL` quarantine during the initial native project import. The reported generated assembly path was:

`Library/Bee/artifacts/1900b0aE.dag/Meta.XR.BuildingBlocks.AIBlocks.dll`

This assembly is generated from Meta XR Core SDK's AI Building Blocks source during Unity compilation. The sandbox does not reference those optional AI feature classes, but their assembly is included in the installed Core package.

Native imports and builds were paused. No quarantined file was restored, no antivirus exclusion was added, and no vendor package was changed to bypass the detection. The Quest adapter and build setup are source-authored but have not passed native compilation or headset validation.

## Read-only provenance check

The package was obtained from Unity's default package registry:

- Package: `com.meta.xr.sdk.core` version `205.0.0`.
- Registry metadata: [Unity package registry](https://packages.unity.com/com.meta.xr.sdk.core).
- Official archive: [Meta Core 205.0.0](https://download.packages.unity.com/com.meta.xr.sdk.core/-/com.meta.xr.sdk.core-205.0.0.tgz).
- Archive size: 214,749,594 bytes.
- Registry SHA-1 and independently computed archive SHA-1 both: `c0efcbf2ba7073389408996e55bbf8c3fcc04485`.
- Independently computed archive SHA-256: `6425df5b32dc74c7a5e449a956babb5f4d5e0179b1b612ff0e894b55f2c63850`.

The archive was read in memory. All 55 `.cs` and `.asmdef` files whose paths contain `/AIBlocks/` matched the local package cache byte-for-byte, using SHA-256 comparisons: 55 matches, zero differences, zero missing files. This included runtime and Editor AI Blocks source.

These checks establish package/source provenance. They do **not** establish that the quarantined compiled DLL is benign or that the detection is a false positive. The quarantined DLL itself was not retrieved or executed for this comparison.

## Assembly inclusion

The runtime `Meta.XR.BuildingBlocks.AIBlocks.asmdef` has `autoReferenced: true`, empty `defineConstraints`, and empty platform include/exclude lists. Its version defines conditionally enable integrations, but do not provide a documented whole-assembly opt-out. Avoid editing the package cache or recreating the quarantined artifact as a workaround. Resolving the security finding is separate from implementing the sandbox's own scene commands and PC service.
