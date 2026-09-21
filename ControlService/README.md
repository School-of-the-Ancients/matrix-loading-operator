# PC control and scene service

Rendered image feedback is documented in [Visual Feedback](../Docs/Visual-Feedback.md). The Operator's explicit capture/preview controls attach one bounded JPEG to a typed request or the next voice request. `POST /api/capture` requests it, `GET /api/capture` retrieves the authenticated preview, and `/api/plan` accepts its `captureId`. `POST /api/capture/voice` selects or clears a one-shot voice attachment. Images stay outside saved scenes and normal state polling. Codex requires an explicitly known image-capable model; compatible HTTP providers require the explicit `SANDBOX_AI_SUPPORTS_IMAGES=true` capability setting. Unsupported images produce an error, never a text-only fallback.

Requires Python 3.10 or later. Uses only the standard library; no packages need installing. Run from this directory:

```powershell
python server.py
```

Open <http://127.0.0.1:8765/> on this PC. The default listener accepts loopback connections only. The Unity client polls the service; the service never executes arbitrary code in Unity. The control page shows connection state, asset and target catalogs, object deletion, scene save/load, and optional AI proposals. Placement creates a small object 10 cm above the chosen target origin; fine positioning can be performed through the Unity runtime or `set_transform` commands.

When the headset reports a selected point, **Place at headset selection** places the bundled prefab base at that exact point. The panel shows the anchor and local coordinates so “here” is visible before a command is applied.

## Connect a native Quest client

For a headset on the same trusted private network, generate a token in the PowerShell session used to start the service:

```powershell
$sandboxTokenBytes = New-Object byte[] 32
$sandboxRng = [Security.Cryptography.RandomNumberGenerator]::Create()
$sandboxRng.GetBytes($sandboxTokenBytes)
$sandboxRng.Dispose()
$env:SANDBOX_TOKEN = [Convert]::ToBase64String($sandboxTokenBytes)
python server.py --host 0.0.0.0 --port 8765
```

Set the Unity client's service URL to `http://YOUR-PC-LAN-IP:8765` and configure its bearer token to this session's `SANDBOX_TOKEN`. Enter the same token in the PC control page. The token is held in page memory, not browser local storage. LAN binding is refused unless the token has at least 24 characters. Choose the same token again when reconnecting an already configured client; changing the token requires updating that client.

This minimal service uses HTTP, so use a trusted private LAN and do not expose its port to the internet. It does not install firewall rules, forwarding, TLS, or a background service. Static control HTML is served without authentication only to loopback peers. All API endpoints, including health, require the bearer token when configured. No CORS permission is sent; browser mutations must have an Origin matching the Host. Loopback binding also rejects non-loopback Host names.

## API contract

All request and response bodies use JSON, with a 1 MiB request/save limit. Invalid requests return an HTTP error with `{"error":"message"}`. Vectors use numeric x/y/z. Positions are meters in the anchor's local frame, rotations are Euler degrees, and scale is dimensionless. Components must be finite: position is between -100 and 100, rotation between -36000 and 36000, and scale between 0.01 and 20, inclusive. The Unity runtime independently validates asset, anchor and object existence and placement semantics.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/exchange` | Unity sends `{clientId,snapshot,results}` and receives `{commands:[...]}`. |
| `POST /api/command` | Queue a command object, or `{commands:[...]}` containing 1–20 commands atomically. Server generates request IDs. |
| `GET /api/state` | `{online,snapshot,pendingCount,results}`; up to 100 recent result records. |
| `POST /api/save` | `{name}` saves the latest snapshot only while the headset is online and all commands have been acknowledged. |
| `POST /api/load` | `{name}` validates a saved snapshot and queues a `load` command containing its scene document. |
| `GET /api/scenes` | `{scenes:["name",...]}`. |
| `GET /api/health` | `{ok:true}`. |
| `GET /api/planner` | Mode/configuration status without keys or endpoint secrets. |
| `POST /api/plan` | `{text,mode?}` creates a state-bound proposal; mode is `offline-rules`, `openai-compatible`, or `codex-cli`. |
| `POST /api/apply_plan` | `{planId}` applies a reviewed proposal once, only if the runtime session and scene/selection revision still match. |

Snapshot shape:

```json
{
  "scene": {
    "schemaVersion": 1,
    "roomId": "my-room",
    "objects": [
      {
        "objectId": "unique-instance-id",
        "assetId": "cube",
        "anchorId": "floor",
        "transform": {
          "position": {"x": 0, "y": 0.5, "z": 0},
          "rotation": {"x": 0, "y": 0, "z": 0},
          "scale": {"x": 1, "y": 1, "z": 1}
        }
      }
    ]
  },
  "assets": [{"assetId": "cube", "displayName": "Cube"}],
  "anchors": [{"anchorId": "floor", "displayName": "Floor"}]
}
```

A snapshot can additionally contain `selection: {anchorId,objectId,position:{x,y,z}}`. This is transient headset UI context: `anchorId` identifies the chosen placement frame, `position` is the selected point in that anchor's local coordinates, and `objectId` identifies the selected existing object. IDs can be absent/null/empty when unavailable; nonempty IDs must exist in the snapshot's anchors/objects. Position follows the same finite ±100 m bounds as object position. Selection may be included in the saved snapshot wrapper, but it is outside `scene` and is not applied during scene loading.

Supported command operations:

- `spawn`: requires `assetId`, `anchorId` and a full `transform`.
- `set_transform`: requires `objectId` and `transform`; accepts optional `anchorId`.
- `delete`: requires `objectId`.
- `clear`, `get_scene`, `list_assets`, `list_targets`: no additional arguments.
- `load`: requires `scene`, the document with schemaVersion/roomId/objects, not the full snapshot.

Each command delivered to Unity has a `requestId`. A result is `{requestId,ok,error,objectId}`. Empty strings, absent fields and null are accepted for unused `error`/`objectId`. The next exchange must include the authoritative snapshot after these results. The service retains and redelivers commands until acknowledged, so **the Unity client must deduplicate request IDs** and replay cached results after response loss. Use a new random `clientId` every runtime session.

Only one client can hold the lease. A different client receives HTTP 409 while a lease is live. The lease expires after 15 seconds without a valid exchange. Expiration cancels outstanding commands and prevents delivery to a replacement client. A command may have run before its acknowledgement was lost; the next snapshot is authoritative. Queue and latest snapshot are in memory; restarting this service clears them. Saved scene files persist. Bounds: 64 outstanding commands, 20 commands per batch/proposal, 100 scene objects, 512 assets, and 128 targets.

Saves default to `ControlService/scenes`, or choose `--scenes PATH`. Save names are 1–64 characters, begin with a letter/digit, and then contain only letters, digits, spaces, hyphens or underscores. Windows device names and symbolic-link files are rejected. The service writes a temporary file, flushes it, then atomically replaces the named JSON file. Reusing a name replaces its save. Loading changes the headset only after Unity accepts and acknowledges that command. Scene JSON stores room-local state, not a persistent XR anchor map.

## Natural-language commands and optional AI

Without a configured model, the panel defaults to **offline-rules**, a constrained English parser, not AI. It supports `Put a block here`, `Make it twice as big`, `Move it 20 cm left`, `Rotate it 45 degrees`, `Delete it`, `Save as Demo`, `Clear the scene`, and `Load Demo`. See [AI-Integration.md](../Docs/AI-Integration.md) for the supported vocabulary. Unknown or ambiguous requests are rejected. Directions use the selected surface axes; “it” uses the selected object ID. The native device or desktop player supplies this selection.

For the selected ChatGPT/Codex subscription, run `../Start-CodexControlService.ps1` instead of the ordinary server command. It checks the native CLI's saved ChatGPT login and selects `codex-cli`; use `-CodexExe` when the executable is not on PATH. The project never reads or copies authentication files. Each bounded, structured model response is validated before Apply. The complete five-request Codex loop now passed **61 checks** on the actual Quest Pro: spawn, same-ID double scale, PC save, clear and exact restore, followed by original-scene and selection recovery. The wearer also confirmed the visible changes and restoration. The first interrupted attempt is retained separately; see [the session report](../Validation/Quest-Pro-Session.md).

Refresh a page opened before the Codex integration was installed, then confirm **Language mode → Codex (ChatGPT subscription)**. Enter a request, choose **Create proposal**, review the commands and choose **Apply reviewed proposal**. Leave controller and other browser edits idle during inference. The current scene and selection must still match when the proposal is applied.

To use an alternative OpenAI-compatible provider, set `SANDBOX_AI_MODE=openai-compatible`, `SANDBOX_AI_BASE_URL`, `SANDBOX_AI_MODEL`, and `SANDBOX_AI_KEY` in the PC service environment. Remote providers require HTTPS and a key; localhost providers can omit a key. Existing explicit OpenAI/OpenRouter key+model settings are also recognized. A key alone does not select a model. Restart the service after changing its environment. This route has mock-provider coverage; it was not used for the live Codex test.

The compatible API provider must support `/chat/completions` with JSON output. It receives the instruction, current objects, bundled assets, room targets, and selection. Credentials remain server-side, outside prompts, snapshots, Unity, and browser status. Redirects are refused. Provider output is bounded and validated against known IDs, operation types, and transform limits. Mock HTTP tests cover the protocol and error handling; they do not establish real model interpretation quality.

`POST /api/plan` never changes the scene. It returns `{commands,planId,requiresApply,mode,provider,summary}`; Codex responses also contain a sanitized `inference` receipt with observed completion and token usage. The panel displays this and sends only `{planId}` to `/api/apply_plan` when Apply is clicked. Proposals expire after 120 seconds and cannot cross sessions, replay, or apply after the latest scene/selection changes. Planning/applying is blocked while commands are pending. Create a fresh proposal after such a rejection.

`save_scene` and `load_scene` are PC service intents, each in a separate single-intent proposal. They never go to Unity directly. Save writes acknowledged authoritative state; load reads an existing named save and sends the standard runtime `load` operation. Do not bypass `/api/apply_plan` by replaying a displayed proposal through `/api/command`; that raw developer endpoint does not enforce proposal freshness.

## Tests

```powershell
python -m unittest -v
```

The tests run real HTTP requests against temporary local servers and temporary save directories. They cover retry/acknowledgement behavior, lease isolation, settled snapshot saves, loads, malformed/path-traversal inputs, atomic batch validation, queue limits, authentication/origin/host guards and optional AI proposal validation. They do not launch Unity or access the VaM installation.
