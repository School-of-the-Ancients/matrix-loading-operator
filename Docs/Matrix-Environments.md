# Matrix panorama environments

Issue [#150](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/150) adds an equirectangular image around the existing Three.js/WebXR world. The panorama is a scene-level environment, not a selectable or grabbable object. It supplies distant visual context; it does not create geometry, collisions, room measurements, physical alignment, or image-based lighting.

## Asset and scene contract

The PC stores reviewed panorama images in a separate `WebEnvironmentCatalog` under the directory selected by `ControlService/server.py --web-environments`. The default directory is `ControlService/web_environments/`. Its `manifest.json` lists content-addressed entries, and each immutable image is named `<sha256>.png`. The catalog accepts non-interlaced, 8-bit RGB or RGBA PNGs with a 2:1 equirectangular aspect ratio, dimensions up to 4096 × 2048, and size up to 32 MiB. Registration checks the PNG structure and pixels before making it available to the browser. A selected general 2D concept alone is not a runtime skybox.

For prompt-generated panorama drafts, the existing Codex image generator is the default when available on the authenticated Agent Portal session. The prompt explicitly requests a 2:1 PNG, seamless 360-degree equirectangular image. The actual returned bytes must pass the same PNG decoder and 2:1 limits before the draft is ready; a different aspect ratio or JPEG/WebP fails visibly and is never resized. ComfyUI remains an optional PC-local generator. Its reviewed single-image graph renders a 1024 × 512 latent image: the service overrides the single `EmptyLatentImage` width and height before live worker schema validation, rather than stretching a 4:3 result. Pixel shape and prompt alone cannot prove a perfectly continuous 360-degree scene, so preview the image and inspect it in VR. The ComfyUI route requires a configured, reachable worker and a reviewed API graph. Neither route requires a remote image API key.

The registered entry has an ID of the form `panorama:<slug>:<digest-prefix>` and a full SHA-256 digest. The authenticated browser catalog route is `GET /api/web/environments`; the matching image route is `GET /api/web/environments/<sha256>.png`. The browser validates catalog metadata and the image identity before using it. Keep the PC catalog with worlds that reference it. The catalog and image bytes are separate from the GLB registry and from `ControlService/content_catalog.py` discovery listings.

From the repository root in PowerShell, register a reviewed image into the same catalog directory used by the service:

```powershell
$panorama = (Resolve-Path .\work\review-panorama.png).Path
$catalog = Join-Path (Get-Location) 'work\panorama-review\web_environments'
python .\ControlService\register_web_environment.py $panorama --name 'Review panorama' --catalog $catalog
python .\ControlService\server.py --port 18796 --scenes .\work\panorama-review\scenes --web-assets .\work\panorama-review\web_assets --web-environments $catalog
```

Set a fresh `SANDBOX_TOKEN` in that shell and use an isolated browser origin for review. The CLI prints the registered ID, digest, dimensions, and browser URL. The `matrix_register_panorama` tool offers the same PC-side registration from an absolute local source path, expected SHA-256, and reviewed name. It rejects bytes that changed since the digest was recorded. Registration does not make a generated image into a skybox; a separate set action must succeed.

The optional field `scene.environment` contains the current selection:

```json
{
  "schemaVersion": 1,
  "kind": "equirectangular",
  "assetId": "panorama:example:aaaaaaaaaaaa",
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "yawDegrees": 90
}
```

`yawDegrees` is finite and in `[0, 360)`. The ID suffix must match the digest prefix. The field is absent when the world has no panorama; existing worlds without it retain their neutral background. Changing the panorama or its orientation changes this descriptor, not ordinary object IDs or transforms. Removing it deletes the field.

## Reviewed Operator actions

The Operator should inspect the live scene and registered catalog first. `matrix_list_environments(offset, limit)` lists compatible registered images. `matrix_get_environment(room_id, scene_revision)` requests a typed observation of the current world descriptor. `matrix_set_environment(room_id, scene_revision, asset_id, yaw_degrees)` applies a registered image; `yaw_degrees` defaults to zero. `matrix_remove_environment(room_id, scene_revision)` returns to the neutral background. After each action, including the read, `matrix_environment_status(request_id)` retrieves the exact typed result. Registration through the Agent uses `matrix_register_panorama(source_path, expected_sha256, name)` and remains PC-side.

Set and remove require the ready digital world in paused Creator Mode; they are blocked in passthrough AR, read-only visits, and while an object is grabbed. The request captures the observed environment as its expected value, so a concurrent change fails rather than silently replacing another choice. The set command carries the registered asset ID, full digest, projection kind, and bounded yaw to the browser. These actions use the normal Matrix command queue, an explicit owner UI action or reviewed Agent approval, exact request ID, runtime receipt, and post-operation scene inspection. A `succeeded` status requires both a successful receipt and matching observed scene state. Treat `queued`, `failed`, and `unconfirmed` as unresolved until the exact status and current world are inspected; do not send a duplicate change on an uncertain outcome. A request, catalog listing, or generated image is not proof that a panorama appeared in a browser.

For a manually supplied image, use this sequence in a connected `/web/` world:

1. Register a valid 2:1 PNG on the PC in the service's configured environment catalog. Record its asset ID and full SHA-256 digest. Refresh the browser catalog and confirm the image bytes load from the authenticated route.
2. Read the current scene revision, room ID, and environment. Ask Operator to apply the registered image with a specific yaw. Review the exact action, wait for the corresponding receipt, then read the scene again and inspect the desktop render.
3. Change to a second registered image or yaw, then remove the environment through separate reviewed actions. After each receipt, confirm the prior objects retain their IDs and transforms.

In the review page, enter the service token and choose **Start or resume Codex** in the Agent Portal. The Panorama controls accept a text or speech scene description, create versions through Codex-native or configured ComfyUI, show ready previews, and let the owner select and apply a version at a chosen yaw. Applying registers the chosen 2:1 image, refreshes the browser catalog, then waits for the typed action receipt. A ready preview alone is not the active background. For an already registered sample, Codex can still list panoramas and propose a reviewed set/change action. In AR, panorama changes are blocked while passthrough stays visible; return to desktop or VR Creator Mode to change the saved environment.

The authenticated panorama draft flow uses the existing Agent session and the existing concept image cache, with a separate purpose and selection:

1. `POST /api/agent/concepts` with `{sessionId,prompt,purpose:"panorama",providerId?}` starts a text-to-image draft. Text or speech can supply the prompt. Omitting `providerId` chooses Codex-native when available, otherwise configured ComfyUI; either can be requested explicitly. `POST /api/agent/concepts/variation` with `{sessionId,sourceConceptId,purpose:"panorama",providerId?}` creates another version from the prior prompt, with a distinct seed for ComfyUI; it is a new text-to-image sample rather than an image-conditioned edit. `GET /api/agent/concepts?sessionId=...` reports `panoramaJobs`, ready `panoramas`, and `selectedPanoramaId`; the original `jobs`, `concepts`, and `selectedConceptId` remain object-design concepts. A pano variation cannot use an object concept as its source.
2. Preview a ready version, then `POST /api/agent/concepts/select` with `{sessionId,conceptId,purpose:"panorama"}`. Selection does not change the world. `POST /api/agent/concepts/register-panorama` with `{sessionId,conceptId,name}` requires that exact selection, rechecks the content digest and 2:1 PNG, and returns the registered catalog entry. The PC concept record retains the source prompt, provider, configured workflow and effective submitted graph digests when applicable, seed when applicable, image digest, and registered asset ID. The public catalog exposes the image identity and display name without the private PC path or full generation prompt. Re-registering identical bytes returns the existing asset ID and display name.
3. In desktop or VR Creator Mode, `POST /api/agent/environments/action` with `{action:"set",room_id,scene_revision,asset_id,yaw_degrees}` queues the same typed action used by the MCP tool. Poll `GET /api/agent/environments/actions/<requestId>` for the exact receipt and observed environment. A `succeeded` result contains its matching `environment` and `outcome`; `queued` or `unconfirmed` is not proof of application. The browser refreshes the catalog before using a newly registered image. Each explicit application leaves existing object IDs alone.

An image-only #91 concept turn does not call these actions or alter panorama selection. A panorama draft cannot be used as an object-build concept. Existing manually supplied compatible PNGs still use `matrix_register_panorama` or the PC CLI and the same set/change path.

## Rendering and persistence

Desktop and immersive VR present the panorama as a distant visual background. Passthrough AR retains the scene's environment identity while avoiding an opaque sky over the physical room. The panorama does not prove that the virtual world is physically aligned to that room.

The descriptor travels with the full browser world, manual browser checkpoint, and browser world archives. A named PC world checkpoint stores the descriptor and a separate dependency entry binding the panorama ID to its full PNG digest; it does not embed image bytes. Save or restore the named PC world only from a connected, paused desktop virtual room using the existing `/api/web/world/save` and `/api/web/world/load` flow. Keep the matching `--web-environments` directory when restarting or moving that PC world. The older scene-only `/api/save` route is a separate backup path.

If the registered panorama is absent, corrupt, or no longer matches the saved digest, restore must report the dependency problem and retain the active world and saved browser copies. Restore the matching catalog and image, refresh, and retry. Do not substitute a different image under the old ID. A browser archive switch must preserve the outgoing whole world and fail safely when the incoming world's panorama dependency is unavailable.

## Validation and release evidence

Automated contract tests can show schema validation, stale expected-value rejection, catalog integrity, browser save/restore, and PC checkpoint dependency checks. A desktop browser run should additionally record the exact image digest, typed action and receipt, rendered result, unchanged object IDs, and restart/reopen outcome. Quest VR evidence requires a wearer to confirm the panorama surrounds the same scene. Quest AR evidence requires a wearer to confirm passthrough is not silently hidden and no physical-alignment claim is made. Desktop screenshots and tests do not substitute for either wearer check.

The release builder packages committed source and the built Web client. It does not include a private panorama catalog, browser storage, or world checkpoint by default. The optional sanitized demo path in `Tools/Build-WebXR-Release.py` is a separate hosted Ada/Bo fixture with GLB dependencies; it is not a panorama-world export. For v1.0, validate the extracted frozen package with an explicitly reviewed panorama and matching isolated PC data, then record Quest VR/AR observations on that exact package. Exclude credentials and private room imagery from public artifacts.
