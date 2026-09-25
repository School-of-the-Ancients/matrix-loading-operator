# Content catalogs and the Editor import queue

The PC service can search independently configured local-file and HTTP catalogs,
retrieve versioned artifacts, verify their SHA-256 hashes, and hand compatible
Unity content packs to the player. Each result includes its provider, license,
version, platform, dependencies, and runtime suitability. This is the first
shared connector path for issue #9. It is not limited to Scenario.

With no private catalog configuration, the PC service offers **read-only Poly
Haven discovery**. Its public API lists 3D models, HDRIs, and textures; Matrix
maps these to objects, environments, and materials. Search is paged at 100
results per request. The PC caches index metadata in memory for ten minutes.
These public results are source listings until the optional local mirror and
Unity exporter produce compatible packs. Poly Haven's assets are CC0; the
provider card gives the credit required for use of its live API. See the
[asset license](https://polyhaven.com/license) and
[API terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md).

For a full local 1K library on this PC, run
`python Tools/Mirror-PolyHaven.py --output "$env:USERPROFILE\Documents\Codex\MatrixPolyHavenLibrary" --download`.
It records one checksum-verified,
versioned Quest-sized representation of every current index entry, with a
per-asset success or failure row in `download-results.jsonl`. Rerunning reuses
verified files. Models retain the 1K FBX and declared texture dependencies;
HDRIs use 1K HDR panoramas; texture entries retain available 1K material maps.
When 1K is unavailable, the mirror tries 2K. The source library is on the PC,
not inside the APK or headset storage.

`ArSandbox.PolyHavenPrefabExporter.ExportAvailableBatchFromArguments` converts
the staged library into one versioned Android pack per asset in a Unity Editor
fixture. Its `-polyHavenSourceRoot` points at the library root and
`-contentPackOutputRoot` at `Packs\Android`; an Editor opened with Android as
its active build target is required. The batch journal records exported,
reused and failed assets independently. `python Tools/Build-PolyHaven-Catalog.py
--library "$env:USERPROFILE\Documents\Codex\MatrixPolyHavenLibrary" --platform Android` verifies every bundle
and writes a combined catalog plus `matrix-content-config.json`; set
`MATRIX_CONTENT_CONFIG` to that config before starting the PC service. The
AI ranks the entire configured local pack catalog and receives a bounded
candidate shortlist. Installing a selected pack sends only that pack to the
headset; later placements reuse its verified cache without rebuilding the APK.
Set `MATRIX_CONTENT_CACHE` to a directory beside the library so the active
verified pack cache is easy to inspect. The 2 GiB cache
contains requested packs, not the entire source library.

With Codex AI enabled, launch the service with
`./Start-CodexControlService.ps1`. It detects this PC's library at
`$env:USERPROFILE\Documents\Codex\MatrixPolyHavenLibrary` when no content
config is already set. Use `-ContentLibrary` to select another library; the
launcher sets both content paths for that service session.

Models are static object prefabs. An HDRI exports as an inward panorama dome,
and a texture exports as a material sample tile. Those are placeable previews
using the existing static prefab loader. They do not change Unity's global
skybox or apply a material to an arbitrary scene object. Rigged characters,
animations, sound playback, and new scripts need separate runtime capabilities.
The exporter simplifies oversized meshes and omits imported mesh parts whose
coordinates lie far outside the main object. Check the resulting prefab's
appearance and frame time on a Quest before treating any particular model as
device-ready. A source or exporter change that alters pack bytes must receive
a new published version so saved scenes can retrieve the exact earlier pack.

Matrix also exposes **Sketchfab public model search** as an explicitly selected
source. Its official API returns at most 24 models per cursor page; the page
controls use the API's cursors. Results retain each model's displayed license
and link to its source page. Sketchfab's [Download API](https://sketchfab.com/developers/download-api)
requires end-user OAuth, so this connector is discovery-only: it does not use
a shared account or download an archive. The player must review the specific
license and prepare a compatible Unity content pack before an asset can spawn.

**Openverse public audio search** is another explicitly selected source. Its
API can be used anonymously and returns paged results with creator, license,
attribution, and the original source page. Matrix retains those fields, excludes
items marked mature, and labels all entries as discovery-only. The current
player has no general sound playback/import capability, so finding a sound
does not make it audible in the room. Openverse indexes multiple upstream
providers; review each item's actual license and source before reuse. See the
[Openverse API client documentation](https://docs.openverse.org/packages/js/api_client/index.html)
and [audio search documentation](https://docs.openverse.org/api/index.html).

Unity Asset Store acquisitions and `.unitypackage` files use an explicit Editor
queue. The queue tracks `queued`, `acquired`, `imported`, `exported`, `failed`, and
`cancelled`; changing a status records the operator's action. It does not buy
assets, bypass licensing, or execute downloaded code. Import licensed packages in
Unity, inspect them, and export supported prefabs into a platform-specific content
pack. New C# capabilities still require a reviewed application build. Bundles
cannot install new C# or DLL behavior at runtime.

## Configure providers on the PC

Copy `ControlService/content-config.example.json` into a private directory such as
`work/content-config.json`. Set `MATRIX_CONTENT_CONFIG` to that file before starting
the PC service. Relative manifest and workflow paths resolve against the config
file's directory, so update them when copying the example. `MATRIX_CONTENT_CACHE`
optionally changes the cache directory; the running service defaults to a
`.content-cache` subdirectory under its configured scenes directory.

```powershell
$env:MATRIX_CONTENT_CONFIG = (Resolve-Path .\work\content-config.json).Path
$env:MATRIX_CONTENT_CACHE = Join-Path (Get-Location) 'work\content-cache'
python .\ControlService\server.py --port 8776
```

Set the local provider's `id` to the `providerId` embedded in its exported pack.
Set `manifest` to the exported `catalog.json`. Enable the provider after the file
exists. A shared HTTP catalog uses `manifestUrl`; optional `tokenEnv` names a PC
environment variable containing its bearer token. Never put the token itself in
catalogs or browser fields. HTTP artifact locations must stay on the manifest's
origin. Redirects are rejected, so configure the final provider URL.

The service supports 32 configured providers, 3,000 entries per local/HTTP
manifest, paged search across enabled providers, 128 MiB
per artifact, and a 2 GiB content cache. Full caches return a clear error. Archive
unneeded cache files manually on the PC; the service does not silently evict packs
that saved scenes might need. Each artifact has an immutable version and checksum.
Different versions or platforms require an explicit choice. For each version, an
explicitly selected platform takes precedence over `Any`; `Any` is a fallback
when that platform has no exact entry. Multiple compatible versions still require
an explicit version. A failed provider appears as a per-provider error while other
catalog results remain usable.
`POST /api/content/search` accepts `query`, `category`, `providerId`, `offset`
(starting at zero), and `limit` (1–100). Results include `total`, `hasMore`,
`offset`, and `limit`. Select `providerId: "sketchfab"` for the large external
model search and pass the returned `nextCursor` as `cursor` for its next page;
that source has no reported total. Select `providerId: "openverse-audio"` for
20-result pages of audio, advancing with the returned `offset + limit`. The
default "all" search covers local, HTTP, and Poly Haven catalogs; choose the
larger external searches explicitly. Search results are only metadata. In an
explicit AI mode, the Operator ranks all locally prepared packs and the public
Poly Haven index against the request, then receives at most 40 candidate
summaries. It can spawn only assets installed in the player.

See [Content packs](Content-Packs.md) for the Unity Editor export menu, JSON
specification, exact build target requirements, and fixture export command.

## Catalog contract

Catalogs use `schemaVersion: 1` and an `assets` array. Every entry requires:

| Field | Meaning |
| --- | --- |
| `assetId`, `version`, `title` | Stable catalog identity and human-readable title |
| `category` | `environments`, `objects`, `games`, `characters`, `voices`, `animations`, `sounds`, `behaviors`, or `materials` |
| `format` | A supported media/model/package format; executable code formats are rejected |
| `targetPlatform` | Unity build target such as `Android`, `StandaloneWindows64`, or `Any` for source media |
| `location` | Relative local file or same-origin HTTP artifact URL |
| `sha256`, `byteLength` | Expected bytes, checked before the artifact becomes available |
| `license` | `{name, url, attribution}`; missing license names are rejected |
| `dependencies` | Exact `{providerId, assetId, version}` references; no implicit dependency downloads |
| `metadata` | Descriptive tags, dimensions, orientation, Quest suitability, projection, and pack metadata |

For `format: "assetbundle"`, `metadata.contentPack` holds the runtime manifest.
Its `packId` equals the catalog `assetId`; `providerId` equals the configured
provider's id. The version, platform, hash, and byte length must match the catalog
entry. The pack includes an exact `unityVersion` and up to 32 prefab entries with
namespaced ids `providerId:packId:version:localId`, prefab paths, display names,
descriptions, and spawn scales. The player independently validates the manifest,
bundle, supported components, and target compatibility before registration.

Downloaded GLB/glTF/FBX files, HDR/EXR images, and Unity packages currently require
Editor conversion. Every non-bundle search result explicitly reports
`requiresEditor: true`. Downloaded images, video, and audio are reviewed source
material until a compatible content export
uses them. A panorama is not a three-dimensional environment or a room scan.
Dependency references are retained, but this initial runtime path installs
self-contained packs. Keep third-party license and attribution requirements with
every exported artifact.

## Local ComfyUI generation

The `comfyui` connector tests `/system_stats` and `/object_info`, submits to
`/prompt`, polls the specific `/history/{prompt_id}` and `/queue` entries, and
retrieves final media through `/view`. These are the official self-hosted
[ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes).
Provider testing does not generate anything.

Configure the exact worker URL that is actually running ComfyUI. Fleet SSH aliases
and available model files do not prove a working ComfyUI endpoint. Keep private
network addresses and workflow files in `work/`, outside committed examples.

Export a workflow in **API graph format**, inspect its nodes and installed models,
and configure it on the PC:

```json
{
  "id": "room-background",
  "title": "Reviewed local room background",
  "path": "workflows/room-background-api.json",
  "localOnly": true,
  "promptNode": "6",
  "promptInput": "text"
}
```

Add this entry to the provider's `workflows` list. `localOnly: true` records the
operator's confirmation that the selected graph uses local compute and contains
no paid API nodes. It is not an automatic audit of custom nodes. The browser can
select configured workflow ids and optionally replace the one configured text
input; it cannot submit arbitrary graphs. A regular ComfyUI UI workflow containing
`nodes` and `links` must be exported or deliberately converted first. Each run
requires an explicit approval flag; merely searching or planning a scene never
submits a generation request.

Generation is asynchronous. The UI can poll only its recorded job and retrieve
bounded final outputs into the verified PC cache. Generation history is limited
to 200 jobs, including submissions awaiting a provider response. A full history
rejects new submissions before contacting the worker; failed submissions release
their reserved capacity. Cancelling removes only that
queued prompt id. It does not interrupt a running job on a shared GPU worker.
Missing queue/history entries are reported as `missing`, rather than pretending
the worker is still processing them. Generated media still needs review and a
compatible content export before headset use. Images and videos follow their own
configured workflows; a video workflow is not selected implicitly for an image.

The example `generation-handoff` provider records the MiniMax request without
claiming an available H3 workflow. A local MiniMax model can use this same ComfyUI
connector once its complete workflow is reviewed and validated; a filename alone
does not prove a working pipeline. A separate paid API adapter would need a
verified model/API, account configuration, cost review, and output contract.

`ControlService/comfy_workflow.py` provides a deliberately narrow converter for
the reviewed Krea image workflow. It checks live worker schemas, required inputs,
model and enum availability, numeric bounds, connection types, and graph cycles.
It records dropped disconnected notes, fixed seed UI controls, and an explicitly
disabled LoRA model passthrough. Unknown executable nodes, active dynamic LoRAs,
or unfamiliar widget layouts are rejected. Conversion preserves the original UI
workflow and records its canonical hash. Video workflows need a separate review
and API export; this image converter never guesses their layouts.

## Coverage of the content categories

| Category | Current slice | Next integration |
| --- | --- | --- |
| Environments/backgrounds | Poly Haven HDRI discovery, catalogs, local media generation, Editor queue, prefab packs | Reviewed skybox/background application and environment-specific tools |
| Objects/prefabs | Poly Haven and Sketchfab model discovery, versioned prefab packs, verified cache, runtime registration | Guided glTF conversion and additional licensed content libraries |
| Games/templates | Catalog and Editor queue | Template dependency and capability review |
| Characters | Prefab packs and Editor queue | Rig, material, animator, and performance validation |
| Voices | Catalog and Editor queue | Voice provider adapter and runtime audio mapping |
| Animations | Catalog and prefab pack source path | Clip/rig compatibility and runtime animation selection |
| Sound effects/audio | Openverse audio discovery, catalog and Editor queue | Reviewed audio import, attribution display, and bounded runtime playback |
| Actions/behaviors/scripts | Metadata, Editor queue, existing compiled declarative behaviors | Reviewed additions to the compiled behavior allowlist |
| Materials/textures | Poly Haven texture discovery and catalog | Reviewed material import and platform texture limits |

The internet does not expose a single interoperable database of every game,
character, voice, animation, and sound. Openverse can discover some openly
licensed audio without those credentials; direct [Freesound API](https://freesound.org/docs/api/overview.html)
use requires an API credential, and original-file downloads require OAuth.
[Scenario](https://docs.scenario.com/get-started/generation/3d-model-generation/3d-model-generation-scenario)
provides text/image-to-3D generation rather than a public pack of game-ready
prefabs. [Blockade Labs](https://api-documentation.blockadelabs.com/api/skybox.html)
provides skybox generation, which is background imagery rather than room
geometry. [Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
offers biped animation assets but its rigs and clips need character compatibility
review. These sources need specific adapters, authentication, license handling,
conversion, and player tests before Matrix can claim to load them.

Catalog availability is separate from runtime support. A searchable asset is not
automatically compatible with Quest. Two independently configured catalog
providers and local HTTP fixtures validate the shared connector contract; those
tests do not establish third-party content licensing or actual Quest headset
loading. Keep those integration and hardware results separate.
