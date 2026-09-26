# PC world checkpoints (API slice)

`/api/web/world/save` and `/api/web/world/load` store and retrieve one supported
Matrix WebRuntime world: scene objects, game specification, object bindings, and
earned progress. They are separate from the older `/api/save` and `/api/load`
scene-only routes, which keep their existing file format and behavior.

The browser sends its existing `storedWorld(world)` value after a successful
`/api/exchange` of the same scene:

```http
POST /api/web/world/save
{"name":"Demo","world":{"version":2,"scene":{"schemaVersion":1,"roomId":"web-virtual-room-v1","objects":[]},"game":null}}
```

`GET /api/web/worlds` lists checkpoint names. `POST /api/web/world/load` with
`{"name":"Demo"}` returns `{name, schemaVersion, world, dependencies}`. The load
call validates and returns the world; it does not issue a runtime command or
replace the browser's active scene. The browser must run its existing
`restoreStoredWorld(world, response.world)` validation before rendering and
exchanging the new snapshot. A failed load leaves the current world untouched.

Files live under the configured `--scenes` directory in
`world_checkpoints/<name>.json`. The file has schema version 1, the browser's
version 2 `{scene,game}` envelope, an external-asset dependency list containing
full SHA-256 digests, and a SHA-256 payload checksum. The write is bounded to
1 MiB and uses a flushed, synced temporary file plus atomic replacement. This
checksum detects accidental file changes; it is not a signature or encryption.

Saving requires an online, synced desktop virtual room with no pending commands.
AR session plane objects and an unavailable room origin are rejected. The PC
validates scene schema, component packages, clip bindings, game rules, object
bindings, score and objective progress. It verifies each referenced GLB against
the PC catalog and its content hash on both save and load. Keep the same
`--web-assets` catalog when restarting the service. A missing or changed asset
returns an error with a recovery instruction; it does not replace the saved file
or active world. Component packages are embedded in the scene, so their catalog
is not required to read an existing attachment. Running components restart
their elapsed-time phase on load; object IDs, package, target and status remain.
GLB mixer playback phase and device streams are not checkpoint data.

This slice exposes the PC API. The current in-world **Save World** button still
creates a browser checkpoint and a labeled scene-only PC backup. A later browser
slice can call these routes and provide named PC restore/export controls. The
checkpoint references registered GLBs; it is not a portable bundle of asset
bytes, editable Blender sources, Agent Portal chat, or School records.
