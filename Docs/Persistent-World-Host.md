# Persistent Matrix Citizens world host

This slice gives the digital White Room an owner independent of any browser or
Quest visitor. One Node process runs the existing `MatrixWorld` and
`CitizensSimulation` for the built-in Ada and Bo demo. It exchanges each
virtual tick with the PC `ControlService`, then saves the version 3 world
checkpoint atomically. The scene starts with two orb resident markers, one
chair, and one table. The owner can add one reviewed procedural construction
through the existing Agent Portal and typed Matrix tool. There is no renderer
in this process.

## Run an isolated local world

From a separate checkout, install the WebRuntime dependencies with `npm ci` and
build the browser pages with `npm run build`. Give this service its own port,
scene directory, asset directory, owner token, and distinct observation token.
The host CLI requires a loopback URL with an
explicit port other than the usual `8765` service port. It also rejects a
service that has an active runtime, pending commands, or an unrelated prior
snapshot.

PowerShell example from the repository root:

```powershell
$env:SANDBOX_TOKEN='replace-with-a-random-owner-token-at-least-24-characters'
$env:SANDBOX_WORLD_VIEW_TOKEN='replace-with-a-different-view-token-at-least-24-characters'
python ControlService/server.py --host 127.0.0.1 --port 18876 `
  --scenes .\work\world-host\scenes --web-assets .\work\world-host\web_assets
```

In another terminal, from `WebRuntime`:

```powershell
$env:SANDBOX_TOKEN='the-same-owner-token'
node src/host_world.js --url http://127.0.0.1:18876 --name AdaBo
```

For a TLS service, start the same isolated server with `--tls-cert` and
`--tls-key`, then use a loopback HTTPS URL such as
`--url https://127.0.0.1:18876`. The certificate must be trusted by Node and
cover the chosen loopback IP or hostname. If the local CA is not in Node's
trust store, set `NODE_EXTRA_CA_CERTS` to that CA's PEM file for the host
process. The owner still connects only to an explicit loopback port; Node's
normal certificate and hostname verification remain enabled. Keep the
`SANDBOX_TOKEN` and `SANDBOX_WORLD_VIEW_TOKEN` values distinct.

`--ticks 3` performs exactly three virtual ticks and exits for a bounded run.
The default continues at one tick after each 500 ms interval. Slow service
requests do not trigger catch-up ticks. If exchange or checkpoint save fails,
the process stops; restart it after the service is healthy. A new process
restores the last atomic checkpoint and continues from that tick, without
advancing through downtime. A paused checkpoint requires inspection and an
explicit `--resume-paused` on restart.

Each world has one named PC checkpoint under the chosen scene directory. A
hosted exchange publishes a headless runtime descriptor
`matrix-world-host/none/host`. The service accepts the four built-in Citizens
objects and at most one floor-aligned `matrix:procedural` object under that
descriptor. It checks the versioned recipe against the host generator registry
on restore. The host executes only one `create_procedural` command after its
first checkpoint; other Operator commands receive explicit failure receipts.
A second creation, revision, or deletion is outside this prototype's hosted
edit contract.

## PC Operator creation

Configure the existing PC Agent Portal with a native Codex CLI and the optional
`ControlService/requirements-agent-mcp.txt` dependency. An owner-authenticated
human can call `/api/agent/session`, then `/api/agent/turn` with a request such
as “Operator, create one curved bench in the hosted AdaBo world at x=-2, y=0,
z=-4.” The per-turn prompt identifies the connected headless Matrix Web owner.
Codex reads the live scene and generator list, then uses
`matrix_create_procedural` through the private loopback MCP bridge. Reviewed
mode presents the bounded creation for approval. The view token cannot open an
Agent session, queue an edit, or call the owner API.

The service accepts hosted procedural writes only through that typed Agent
path. It rejects a new request while an exchange is awaiting its atomic
checkpoint and rejects another creation once the object exists. The host uses
the existing `MatrixWorld.execute` generator path. The typed status reports
`succeeded` only after the matching object, runtime receipt, and saved
checkpoint all agree. The visitor then receives the five-object observation;
there is no second world-state owner. The ordinary browser-owned `/web/`
Creator Mode remains available for its existing broader create/revise/save
flow.

## Read-only observation contract

`GET /api/web/hosted/observe` accepts only the separate
`SANDBOX_WORLD_VIEW_TOKEN` bearer token. It returns an envelope with
`schemaVersion`, `worldId`, `instanceId`, monotonically increasing `sequence`
within that instance, `clockTick`, `online`, `readOnly`, and a version 3
`world` containing `scene`, `game: null`, and `citizens`. The endpoint returns
409 while the host is offline, bootstrapping, or between a tick exchange and
its completed checkpoint save. The view token cannot call the owner API.

Open `/web/hosted.html` on that service and enter the **view token**, never the
owner token. The page keeps the token in memory for that tab, polls only the
read-only observation endpoint, and renders the existing Matrix scene and
resident IDs through `MatrixView`. Closing every visitor does not stop the PC
host. Returning on desktop displays a later virtual clock and the same world
IDs. The visitor does not exchange as a writer, run a Citizens timer, edit the
scene, or save a competing browser checkpoint. A newly checkpointed procedural
object rebuilds the visitor's mesh; ordinary Citizen motion updates only
transforms. The ordinary `/web/` Creator world and older Citizens desktop
fixture keep their existing save contracts;
they are not silently replaced by the hosted visitor.

The same visitor can enter WebXR AR using the existing digital-world view
anchor, which places the **digital** scene for this visit. Its tracking state
and measured room planes are presentation data only. A missing pose hides the
overlay until tracking returns; it does not pause the PC clock. Source tests
and desktop observation establish the path, but Quest 3 wearer alignment,
comfort, performance, and physical collisions still require separate device
evidence. VR is likewise a view of the hosted world, not another writer.
