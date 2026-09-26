# PC world checkpoints

`/api/web/world/save` and `/api/web/world/load` store and retrieve one supported
Matrix WebRuntime world: scene objects, game specification, object bindings,
earned progress, and, in version 3, bounded AI Citizens simulation state. They
are separate from the older `/api/save` and `/api/load` scene-only routes, which
keep their existing file format and behavior.

The browser sends its existing `storedWorld(world)` value after a successful
`/api/exchange` of the same scene:

```http
POST /api/web/world/save
{"name":"Demo","world":{"version":2,"scene":{"schemaVersion":1,"roomId":"web-virtual-room-v1","objects":[]},"game":null}}
```

Version 2 retains exactly `version`, `scene`, and `game` and loads as a world
without Citizens. Version 3 requires exactly those fields plus a non-null
`citizens` section. That section holds schema-1 resident and station IDs, needs,
current finite activities, reservations, clock, seed/random state, and a bounded
event log. The service validates residents and stations against stable object
IDs and built-in orb/chair/table assets in the same scene. It rejects malformed
state, duplicate or missing bindings, and stale reservations before writing or
returning a checkpoint. Adding `citizens` to a version-2 file is invalid.

`GET /api/web/worlds` lists checkpoint names. `POST /api/web/world/load` with
`{"name":"Demo"}` returns `{name, schemaVersion, world, dependencies, expectedRevision}`. The load
call validates and returns the world; it does not issue a runtime command or
replace the browser's active scene. The browser must run its existing
`restoreStoredWorld(world, response.world)` validation before rendering and
exchanging the new snapshot. A failed load leaves the current world untouched.
The browser finishes any in-flight exchange and pauses periodic exchanges before
staging the saved world. The restore exchange sends `expectedRevision` as `worldRestoreExpectedRevision`.
The service accepts the staged world only if the same browser still holds the
lease, the scene revision is unchanged, and no command has been queued. A
conflict keeps the previous browser world and pending command for a retry.

Files live under the configured `--scenes` directory in
`world_checkpoints/<name>.json`. The file has schema version 1, the browser's
version 2 or 3 world envelope, an external-asset dependency list containing
full SHA-256 digests and rendering scale/bounds/clip metadata, and a SHA-256 payload checksum. The write is bounded to
1 MiB and uses a flushed, synced temporary file plus atomic replacement. This
checksum detects accidental file changes; it is not a signature or encryption.

Saving requires an online, synced desktop virtual room with no pending commands.
AR session plane objects and an unavailable room origin are rejected. The PC
validates scene schema, component packages, clip bindings, game rules, object
bindings, score, objective progress, and version-3 Citizens state. It verifies
each referenced GLB against
the PC catalog and its content hash on both save and load. Keep the same
`--web-assets` catalog when restarting the service. A missing or changed asset
returns an error with a recovery instruction; it does not replace the saved file
or active world. Component packages are embedded in the scene, so their catalog
is not required to read an existing attachment. Running components restart
their elapsed-time phase on load; object IDs, package, target and status remain.
GLB mixer playback phase and device streams are not checkpoint data.

The desktop `/web/` sidebar has named **Save world** and **Restore world** controls
for these routes. Restore requires a second click within ten seconds. The
browser validates the returned world, exchanges it with the PC service, and
then writes its local recovery copy. If the exchange fails, it keeps the
previous browser world. The in-world **Save World** button still creates a
browser checkpoint and a labeled scene-only PC backup.

The JSON file under `--scenes/world_checkpoints/` is the PC export. Keep it
with the matching `--web-assets` catalog to restore its registered GLBs after
a PC move or reinstall. The checkpoint is not a portable bundle of asset
bytes, editable Blender sources, Agent Portal chat, or School records.
