# Matrix control pages after the WebXR entry change

The PC ControlService serves the current Matrix at `/web/`. This route inventory
records the page consumers and compatibility decision for [issue #132](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/132).
It does not change the service's APIs, authentication, saved scenes, paired-client
records, browser worlds, or the [Unity source archive](../Archive/Unity/README.md).

| Page or bookmark | Observed consumer | Decision and next path |
| --- | --- | --- |
| `/web/` | Desktop browser and Quest Browser WebXR; current Creator Mode, Agent Portal, assets, and worlds | Canonical Matrix entry. `/web` redirects here. Build `WebRuntime/dist` before opening a fresh local service. |
| `/` | Former PC bookmark for the Unity Operator | Redirect to `/web/` on loopback. An old `/?prefab=<id>` selection redirects to `/legacy/operator?prefab=<id>` so it still opens the native proposal flow. Other query strings are not forwarded. |
| `/legacy/operator` | Existing Unity clients, older scene/proposal/reconnect controls, and selected-prefab bookmarks | Retain on loopback with an archive notice and a link to `/web/`. It controls a connected native client, not the current Web world. |
| `/content` | Native prefab/AssetBundle catalog, pack installation, preparation records, and old prefab selection links | Retain on loopback for existing pack inspection and recovery. Its selected-prefab link now targets `/legacy/operator`; the old `/?prefab=...` bookmark still works. New Web assets use the reviewed GLB and authoring paths described in [WebRuntime](../WebRuntime/README.md). |
| `/learning` and `/learning-ui.js` | Older Unity AR lesson with the local School learning adapter and recovery state | Retain on loopback with an archive notice. New coursework uses a Three.js/WebXR deliverable; the lesson's existing records are not migrated or deleted by this route change. |
| `/clients` | [Matrix client API v1](Client-API-v1.md), local sample companions, [Web Block Scale Lab](Scale-Experiment.md), and Matrix scale tools | Keep active on loopback for one-use pairing, owner review and Apply, cancellation, receipts, and revocation. It is not a native-only page. |

The Web app also serves `/web/citizens.html` as an isolated desktop demo and
`/web/assets/*` as built assets. The page change does not alter their routes.

## Compatibility and access

- `/`, `/legacy/operator`, `/content`, `/learning`, `/learning-ui.js`, and
  `/clients` retain the PC loopback page restriction. `/web/` retains its
  existing service access policy; this change does not expose a PC-only control
  page over a non-loopback connection. API authentication, same-origin mutation
  checks, and the Web Agent Portal approval boundary are unchanged.
- The archived native Operator and lesson pages include their last observed
  client ID on scene and lesson actions. The service checks it under the active
  lease lock and rejects a stale client or a Web runtime, including older Web
  snapshots with recognizable room IDs. This prevents an accidental old-page
  edit after a lease switch; it is a compatibility guard inside the existing
  API authentication and review model, not a separate authorization boundary.
- The native `/api/exchange`, scene/proposal/content/learning APIs, versioned
  `/api/v1/*` client API, and `/api/web/*` routes stay available. `/clients`
  remains the owner review surface for Block Scale Lab and local companions.
- Existing native saves and preparation records remain on disk. The redirect
  does not convert them into Web worlds. Existing Web browser checkpoints keep
  the same origin and world keys; no local storage is cleared or migrated.
- To roll back the entry behavior, revert the route and page changes while
  leaving data directories untouched. The former `/` control page would be
  served there again; the API and saved-state formats do not change in this
  slice.

Check the [ControlService guide](../ControlService/README.md) for local startup
and [WebRuntime guide](../WebRuntime/README.md) for the current experience.
Automated page and API checks do not establish Quest wearer behavior.
