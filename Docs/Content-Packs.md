# Downloadable static prefab packs

The content loader adds static props to an already-built Matrix player. The PC
catalog supplies an explicit pack manifest and serves its exact bundle bytes;
the player verifies them, loads all prefabs, measures their bounds, and registers
the complete pack. Existing objects, selection and undo/redo history remain in
place. Installed props use ordinary spawn, transform, rotate/bob, duplicate,
delete, undo and scene save/restore commands.

This initial runtime supports **static object prefabs**, not arbitrary Unity
projects or downloaded code. Media and other library resource formats are not
implicitly executable prefab packs.

## Export a pack

Use the same exact Unity Editor version as the player (currently
**6000.6.0f1**), with this repository's runtime and Editor content-pack files.
Import assets into that project through their normal authorized workflow.
Importing an Asset Store package may add scripts or custom shaders; remove or
convert unsupported components before exporting a static prop. Player behavior
or compiled-code changes require rebuilding the player.

1. Select imported `.prefab` assets in the Project window.
2. Choose **Matrix → Content Packs → Create specification for selected prefabs**.
3. Edit the JSON specification: assign a provider, pack and version, permanent
   asset IDs, useful descriptions, the intended platform, and the actual license
   and attribution. Set `distributionPermissionConfirmed` only when this pack's
   intended distribution is permitted. The template is deliberately not ready
   to export before these fields are filled in.
4. Set the Editor's active target to **Android** or **Standalone Windows 64-bit**.
5. Choose **Matrix → Content Packs → Export from JSON specification** and select
   an output directory. The exporter writes a bundle, `content-pack.json`, and
   a PC-provider `catalog.json` in that directory.
6. Configure a file catalog provider whose ID exactly matches `providerId` and
   whose manifest path points to that `catalog.json`. The catalog entry identifies
   the pack; its `metadata.contentPack.assets` lists the individual runtime props.
   Refresh the PC library, prepare the pack and install it on the connected player.

The equivalent Editor batch entry point is:

```text
-executeMethod ArSandbox.SandboxContentPackExporter.ExportFromArguments
-contentPackSpec <absolute-spec.json> -contentPackOutput <absolute-output-folder>
```

Use `-buildTarget Android` or `-buildTarget Win64` when opening an appropriate
isolated project for the command. The exporter refuses a different active target.
It does not silently switch or rebuild a player's project.

Example specification (the named prefab must already exist):

```json
{
  "providerId": "my-library",
  "packId": "scifi-props",
  "version": "1.0.0",
  "platform": "Android",
  "license": { "name": "Your content license", "url": "", "attribution": "Your attribution" },
  "distributionPermissionConfirmed": false,
  "assets": [{
    "assetId": "my-library:scifi-props:1.0.0:beacon",
    "prefabPath": "assets/myprops/beacon.prefab",
    "displayName": "Sci-fi Beacon",
    "description": "A floor-standing cyan energy beacon with a dark protective shell.",
    "spawnScale": 1.0
  }]
}
```

## Add visual samples to a catalog

The browser can show PNG/JPEG samples using the existing catalog download cache.
These are optional author-provided images; they never instantiate a prefab or
change the scene. Use the same imported source that produced the published pack.
If geometry or materials changed, export a new pack version before associating
new samples. An Editor image is not proof of the installed bundle's appearance.

`SandboxPrefabPreview` renders actual prefab meshes and materials in temporary
Unity Editor preview scenes. It preserves the authored assets and records their
dependency hashes. Its trusted input specification is:

```json
{"assets":[{"assetId":"my-library:scifi-props:1.0.0:beacon","prefabPath":"Assets/MyProps/Beacon.prefab"}]}
```

Run Unity with graphics enabled (omit `-nographics`):

```text
-batchmode -quit -executeMethod ArSandbox.SandboxPrefabPreview.RenderFromArguments
-prefabPreviewSpec <absolute-spec.json> -prefabPreviewOutput <absolute-output-folder>
```

Then publish those image files into the existing catalog:

```text
python Validation/Add-Prefab-Previews.py --catalog <catalog.json> --report <output-folder/preview-report.json> --output-report <preview-inventory.json>
```

The publisher checks the PNG digest, size, dimensions, prefab path and Unity
version, then adds separate hashed PNG entries while preserving every bundle entry.
Its special bundled IDs are limited to Matrix's seven authored baseline props.
For downloaded prefabs, use their exact namespaced IDs.

Image associations use descriptive `metadata.tags`: `prefab-preview`,
`prefab:<exact-runtime-id>`, `unity:<exact-version>` and either `bundled` or
`bundle:<exact-pack-sha256>`. Downloaded-prop samples must share the pack provider
and target platform. Images are limited to 1 MiB by the browser, fetched only on
**Preview prefab**, and verified against the declared image hash and size.
These associations are the publisher's declaration; they do not cryptographically
prove that an image depicts the bundled geometry. No player rebuild is needed.

## Compatibility and limits

Each manifest records `schemaVersion`, `providerId`, `packId`, `version`,
`platform`, exact `unityVersion`, SHA-256, byte length, license and prefab entries.
IDs have the immutable form `provider:pack:version:localId`. Every segment has
1–32 ASCII letters, digits, periods, underscores or hyphens, beginning with a
letter or digit; the whole ID is at most 128 characters. A different bundle may
not replace the same installed asset IDs: export a new version instead.

- Android and Windows bundles are distinct. Editor version and platform must
  match the running player exactly. Render pipeline is the built-in renderer.
- A bundle is self-contained, at most **128 MiB** compressed, with **1–32 props**.
  External bundle dependencies are rejected. The combined runtime registry is
  at most **512 assets**, including bundled props.
- Each prefab is limited to **256 transforms**, **1,024 components**, **200,000
  distinct mesh vertices**, **1–64 mesh renderers**, and **32 materials/textures**.
  Textures are 2D and at most **4,096 × 4,096**. These are rejection bounds, not
  a performance guarantee; author substantially smaller props for standalone XR.
- Allowed components are `Transform`, `MeshFilter`, `MeshRenderer`, `BoxCollider`,
  `SphereCollider` and `CapsuleCollider`. Scripts, missing scripts, cameras,
  lights, audio sources, rigidbodies, skinned meshes and particle systems fail
  validation. Shader choices are `Standard`, `Unlit/Color`, and `Unlit/Texture`.
- Prefabs must have finite positive rendered bounds no larger than 100 metres
  on an axis. Bounds are measured from actual loaded mesh data, not accepted
  from an untrusted catalog description.

## Integrity, trust and recovery

Downloads go only to `/api/content/files/<sha256>` on the existing PC service
origin. The existing bearer token is used when configured. Redirects are
disabled. A streaming byte limit, final size and SHA-256 check run before Unity
loads the bundle. All prefab components are checked before any instance is
created. A failed download, incompatible player, invalid prefab or changed room
leaves the registry and scene unchanged.

Only use packs exported from trusted content. SHA-256 verifies bytes, not the
publisher's identity. Unity AssetBundle deserialization and shader processing are
not a sandbox for hostile files; the static-component allowlist does not make
arbitrary downloaded bundles safe. The exporter also rejects script,
ScriptableObject and executable dependencies. No assembly or C# loader exists.

Keep the application-private cached manifests unchanged. The current schema pins
bundle bytes and source/version fields, but does not separately hash or sign the
manifest's asset-ID-to-prefab-path mapping. A deliberately rewritten mapping
between two valid roots in the same bundle is outside these integrity checks.
Treat cache metadata as trusted local state; reinstall the original export if it
has been edited. This slice does not migrate saved scenes to signed metadata.

### Restore after restarting the app

The device keeps verified bundles and manifests in its application-private
`content-packs-v1` directory. Updated players automatically register the exact
cached dependencies **when a saved scene is loaded**. Startup does not load every
pack. Schema-1 scenes retain their existing format: downloaded props identify
the provider, pack, version, digest, platform and exact Unity version.

1. Install the pack, place its props, and save the scene through the PC Operator.
2. Quit and restart Matrix. Keep the PC service reachable; the upstream content
   provider can be disabled or unavailable.
3. In AR, reacquire the same room and confirm the labeled outlines.
4. Restore the saved scene normally. The player checks cached metadata (at most
   64 KiB per manifest), compatibility, size, SHA-256 and the existing static
   prefab policy, registers required packs, then performs the ordinary atomic
   scene load. No provider lookup or bundle download occurs in this path.

Missing/corrupt bundles or manifests, changed provenance, unsupported dependencies,
and incompatible Unity/platform versions fail explicitly. The current scene and
Undo history remain unchanged. A verified pack already registered during a
multi-pack restore may stay available if a later dependency fails; no partial
scene replacement occurs. Repair by reinstalling the **exact original pack** and
retrying. A different version is never silently substituted.

While bundles load, heartbeats continue and later PC commands remain ordered.
If the wearer edits the scene (including Undo/Redo), the room changes, or alignment
becomes unavailable, the pending restore is rejected before scene replacement.
Retry after reviewing the current room. Legacy scenes using bundled assets work
as before. Existing installed APKs need a rebuild for this feature.

Desktop process-restart acceptance is recorded in
[the desktop report](../Validation/cached-content-restore-desktop.json), with
[core/build checks](../Validation/cached-content-restore-core.json). It uses a separate validation
product/cache and a real procedural bundle with its provider disabled, including
missing/corrupt/incompatible-cache failures and Undo/Redo. **Quest cold-restart,
MRUK anchor recovery, visuals and device performance remain pending**; no headset
installation or running service was changed for this validation.

## Validation fixture

After building a player, invoke
`ArSandbox.SandboxContentPackExporter.ExportFixtureFromArguments` in its matching
Editor fixture with `-contentPackOutput <directory>`. It creates a procedural
dark/cyan sci-fi beacon and exports provider **`matrix-fixture`**, pack
**`scifi-props`**, version **`1.0.0`**, asset
**`matrix-fixture:scifi-props:1.0.0:beacon`**. Creating/exporting it after the player
build ensures the prefab was not part of the player's original asset registry.

`SandboxContentChecks.Run` exercises manifest rejection, bounded compatibility,
same-origin URL construction, integrity failures, atomic registration, unchanged
live object identities/history, measured bounds, provenance retention, ordinary
edits/undo, exact save/clear/restore, and missing or conflicting version recovery.
Actual bundle export/install and device rendering require separate runtime
validation; merely passing these checks does not establish those results.

For a reproducible cold-restart test, build a uniquely named validation player:

```powershell
./Build-WhiteRoom.ps1 -Target Desktop -ValidationId cold-restore-unique -OutputPath Builds/ColdRestore/MatrixOperator.exe
```

Export the procedural pack **after** that build using the batch method above.
Then run (substitute that pack output directory):

```powershell
python Validation/Run-Cached-Content-Restore.py --player Builds/ColdRestore/MatrixOperator.exe --pack work/content-pack --validation-id cold-restore-unique --work work/cold-restore-unique --report Validation/cached-content-restore-desktop.json
```

The runner verifies the player's distinct product name, refuses an already-used
cache/profile, starts a private loopback service on a free port, and stops only
its own player processes. It preserves fixture logs/cache for inspection. Use a
new validation ID and work directory for the next run. This is a headless Windows
runtime test, not visual or headset acceptance.

For the live Windows loop, start a separate owned service and player, point its
provider configuration at the exported fixture, then run:

```text
python Validation/Run-Content-Pack-Loop.py --service-url http://127.0.0.1:<test-port> --run --isolated-fixture --real-codex
```

Omit `--real-codex` to skip the model request, or omit `--run` for read-only
preflight. The run verifies actual download/registration acknowledgements,
ordinary commands, undo/redo, exact save/clear/restore and a rejected missing-pack
restore. It restores the pretest scene in `finally`; the newly installed registry
remains in that disposable player until it exits. This is desktop runtime evidence,
not a claim that a headset wearer inspected the downloaded geometry.
