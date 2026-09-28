# Matrix panorama environments

Issue [#150](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/150) adds an equirectangular image around the existing Three.js/WebXR world. The panorama is a scene-level environment, not a selectable or grabbable object. It supplies distant visual context; it does not create geometry, collisions, room measurements, physical alignment, or image-based lighting.

## Asset and scene contract

The PC stores reviewed panorama images in a separate `WebEnvironmentCatalog` under the directory selected by `ControlService/server.py --web-environments`. The default directory is `ControlService/web_environments/`. Its `manifest.json` lists content-addressed entries, and each immutable image is named `<sha256>.png`. The catalog accepts non-interlaced, 8-bit RGB or RGBA PNGs with a 2:1 equirectangular aspect ratio, dimensions up to 4096 × 2048, and size up to 32 MiB. Registration checks the PNG structure and pixels before making it available to the browser. A ComfyUI or Codex concept image must meet the same image contract before it can be registered as a panorama; a selected 2D concept alone is not a runtime skybox.

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

Set and remove require the ready digital world in paused Creator Mode; they are blocked in passthrough AR, read-only visits, and while an object is grabbed. The request captures the observed environment as its expected value, so a concurrent change fails rather than silently replacing another choice. The set command carries the registered asset ID, full digest, projection kind, and bounded yaw to the browser. These actions use the normal Matrix command queue, approval boundary, exact request ID, runtime receipt, and post-operation scene inspection. A `succeeded` status requires both a successful receipt and matching observed scene state. Treat `queued`, `failed`, and `unconfirmed` as unresolved until the exact status and current world are inspected; do not send a duplicate change on an uncertain outcome. A request, catalog listing, or generated image is not proof that a panorama appeared in a browser.

Use this sequence for a connected `/web/` world:

1. Register a valid 2:1 PNG on the PC in the service's configured environment catalog. Record its asset ID and full SHA-256 digest. Refresh the browser catalog and confirm the image bytes load from the authenticated route.
2. Read the current scene revision, room ID, and environment. Ask Operator to apply the registered image with a specific yaw. Review the exact action, wait for the corresponding receipt, then read the scene again and inspect the desktop render.
3. Change to a second registered image or yaw, then remove the environment through separate reviewed actions. After each receipt, confirm the prior objects retain their IDs and transforms.

An image-only #91 concept turn does not call these actions. A chosen concept can guide an explicit environment request once a suitable image has passed panorama validation and registration.

## Rendering and persistence

Desktop and immersive VR present the panorama as a distant visual background. Passthrough AR retains the scene's environment identity while avoiding an opaque sky over the physical room. The panorama does not prove that the virtual world is physically aligned to that room.

The descriptor travels with the full browser world, manual browser checkpoint, and browser world archives. A named PC world checkpoint stores the descriptor and a separate dependency entry binding the panorama ID to its full PNG digest; it does not embed image bytes. Save or restore the named PC world only from a connected, paused desktop virtual room using the existing `/api/web/world/save` and `/api/web/world/load` flow. Keep the matching `--web-environments` directory when restarting or moving that PC world. The older scene-only `/api/save` route is a separate backup path.

If the registered panorama is absent, corrupt, or no longer matches the saved digest, restore must report the dependency problem and retain the active world and saved browser copies. Restore the matching catalog and image, refresh, and retry. Do not substitute a different image under the old ID. A browser archive switch must preserve the outgoing whole world and fail safely when the incoming world's panorama dependency is unavailable.

## Validation and release evidence

Automated contract tests can show schema validation, stale expected-value rejection, catalog integrity, browser save/restore, and PC checkpoint dependency checks. A desktop browser run should additionally record the exact image digest, typed action and receipt, rendered result, unchanged object IDs, and restart/reopen outcome. Quest VR evidence requires a wearer to confirm the panorama surrounds the same scene. Quest AR evidence requires a wearer to confirm passthrough is not silently hidden and no physical-alignment claim is made. Desktop screenshots and tests do not substitute for either wearer check.

The release builder packages committed source and the built Web client. It does not include a private panorama catalog, browser storage, or world checkpoint by default. The optional sanitized demo path in `Tools/Build-WebXR-Release.py` is a separate hosted Ada/Bo fixture with GLB dependencies; it is not a panorama-world export. For v1.0, validate the extracted frozen package with an explicitly reviewed panorama and matching isolated PC data, then record Quest VR/AR observations on that exact package. Exclude credentials and private room imagery from public artifacts.
