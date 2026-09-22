# Content catalogs and the Editor import queue

The PC service can search independently configured local-file and HTTP catalogs,
retrieve versioned artifacts, verify their SHA-256 hashes, and hand compatible
Unity content packs to the player. Each result includes its provider, license,
version, platform, dependencies, and runtime suitability. This is the first
shared connector path for issue #9. It is not limited to Scenario.

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

The service supports 32 configured providers, 1,000 entries per catalog, 128 MiB
per artifact, and a 2 GiB content cache. Full caches return a clear error. Archive
unneeded cache files manually on the PC; the service does not silently evict packs
that saved scenes might need. Each artifact has an immutable version and checksum.
Different versions or platforms require an explicit choice. For each version, an
explicitly selected platform takes precedence over `Any`; `Any` is a fallback
when that platform has no exact entry. Multiple compatible versions still require
an explicit version. A failed provider appears as a per-provider error while other
catalog results remain usable.

See [Content packs](Content-Packs.md) for the Unity Editor export menu, JSON
specification, exact build target requirements, and fixture export command.

## Catalog contract

Catalogs use `schemaVersion: 1` and an `assets` array. Every entry requires:

| Field | Meaning |
| --- | --- |
| `assetId`, `version`, `title` | Stable catalog identity and human-readable title |
| `category` | `environments`, `objects`, `games`, `characters`, `voices`, `animations`, `sounds`, or `behaviors` |
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

Downloaded GLB/glTF files and Unity packages currently require Editor conversion.
Their search results explicitly report `requiresEditor: true`. Downloaded images,
video, and audio are reviewed source material until a compatible content export
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

## Coverage of the eight categories

| Category | Current slice | Next integration |
| --- | --- | --- |
| Environments/backgrounds | Catalog, local media generation, Editor queue, prefab packs | Reviewed skybox/background application and environment-specific tools |
| Objects/prefabs | Versioned prefab packs, verified cache, runtime registration | Additional licensed content libraries and import formats |
| Games/templates | Catalog and Editor queue | Template dependency and capability review |
| Characters | Prefab packs and Editor queue | Rig, material, animator, and performance validation |
| Voices | Catalog and Editor queue | Voice provider adapter and runtime audio mapping |
| Animations | Catalog and prefab pack source path | Clip/rig compatibility and runtime animation selection |
| Sound effects | Catalog and Editor queue | Audio provider adapter and bounded runtime playback |
| Actions/behaviors/scripts | Metadata, Editor queue, existing compiled declarative behaviors | Reviewed additions to the compiled behavior allowlist |

Catalog availability is separate from runtime support. A searchable asset is not
automatically compatible with Quest. Two independently configured catalog
providers and local HTTP fixtures validate the shared connector contract; those
tests do not establish third-party content licensing or actual Quest headset
loading. Keep those integration and hardware results separate.
