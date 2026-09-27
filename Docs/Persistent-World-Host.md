# Persistent Matrix Citizens world host

This slice gives the digital White Room an owner independent of any browser or
Quest visitor. One Node process runs the existing `MatrixWorld` and
`CitizensSimulation` for the built-in Ada and Bo demo. It exchanges each
virtual tick with the PC `ControlService`, then saves the version 3 world
checkpoint atomically. The scene starts with two orb resident markers, one
chair, and one table. The owner can add one reviewed procedural construction
through the existing Agent Portal and typed Matrix tool. In separate optional
Citizen modes, Bo can request either a procedural bench or one
Blender-generated rest seat after encountering chair contention. The host has
no browser renderer; for a generated GLB it loads the registered bytes and
measures the mesh with Three.js before authoring an interaction.

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

Pass `--citizen-capabilities` for the procedural Citizen case, or
`--citizen-generated-asset` for the reviewed Blender-generated rest seat.
These modes are mutually exclusive and use the same one-addition slot. The
earlier `--citizen-construction` flag remains an alias for the procedural
case. A fresh generated-asset demonstration needs a fresh isolated world
checkpoint and a PC Blender installation (`MATRIX_BLENDER_EXE` can select it).
For example, after starting the isolated service above, run the host with
`--name AdaBoGenerated --citizen-generated-asset`. The reviewed Citizen
profile contains a fixed blueprint, so this path does not give Bo arbitrary
prompt-to-Blender access. Without either Citizen flag, the existing human
Operator creation slot remains available.
`--interval-ms` can set the tick interval for an isolated demonstration.

Each world has one named PC checkpoint under the chosen scene directory. A
hosted exchange publishes a headless runtime descriptor
`matrix-world-host/none/host`. The service accepts the four built-in Citizens
objects and at most one floor-aligned addition: a `matrix:procedural` object
or the registered `web:` GLB from the approved Citizen job. It checks the
versioned procedural recipe or the GLB catalog identity against the saved
world on restore. The host executes one approved `create_procedural` or
`spawn` command after its first checkpoint; unsupported Operator commands
receive explicit failure receipts. A second creation, revision, or deletion
is outside this prototype's hosted edit contract.

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

The service accepts hosted procedural writes through that typed Agent path or
the scoped Citizen request path below. It rejects a new request while an
exchange is awaiting its atomic checkpoint and rejects another creation once
the object exists. The host uses
the existing `MatrixWorld.execute` generator path. The typed status reports
`succeeded` only after the matching object, runtime receipt, and saved
checkpoint all agree. The visitor then receives the five-object observation;
there is no second world-state owner. The ordinary browser-owned `/web/`
Creator Mode remains available for its existing broader create/revise/save
flow.

## Optional Citizen capability requests

With either Citizen mode, the existing seed-29 Ada/Bo schedule creates a chair
reservation conflict: Ada holds the chair while Bo waits to rest. Bo records
one construction intent and a version 15 capability request in the
hosted checkpoint. The owner host submits the exact saved request to the
owner-only `POST /api/citizens/capabilities` endpoint. The request names the
resident, intent, capability and action, bounded
parameters, and the room, tick, and object IDs from the checkpoint where Bo
made the request. Neither resident receives an owner token, Agent session,
MCP bridge, or tool credentials.

The service matches the entire request to the durable checkpoint, then applies
the policy for its capability and action. Both modes enforce the exact reviewed
parameters, chair contention at request time, pending-work checks, and a
one-request budget. A rejection records its reason and creates nothing.

For `procedural.create`, the approved parameters fix the bench recipe, pose,
and rest interaction. The policy response names the exact Matrix request ID;
the existing typed procedural service capability queues the command, and the
host executes it through `MatrixWorld.execute`. The host matches the creation
receipt and attaches the reviewed interaction through Matrix's existing
interaction command. Only after both receipts match the object does Bo observe
the new station. His checked rest-use receipt marks the construction used.

For `asset.generate`, the saved request fixes `rest-seat-v1` and the world
pose. The service reserves a durable Blender job ID before invoking its
existing `BlenderAuthoringJobs` worker with the reviewed blueprint. The job
ledger records queued, building, generated, registered, ready, error, or
unconfirmed outcomes; generated GLB bytes and the content-addressed asset
catalog are checked by SHA-256. Citizens records the policy's job ID as
`generating`, then the registered asset ID and SHA as `registered`. Job
submission alone is never success. The owner calls
`POST /api/citizens/capabilities/dispatch`,
which checks the saved request, job, asset catalog, and one-object budget before
queuing the existing typed Matrix spawn capability. The spawn request ID is
checkpointed as `spawning` before the host executes it.

After an exact spawn receipt, the headless host loads the immutable GLB bytes,
checks their digest and measured geometry, then asks `MatrixWorld` to attach
the fixed SHA-bound rest interaction. The two exact Matrix receipts and the
observed object, asset ID, SHA, pose, and interaction must agree before
Citizens marks the capability `succeeded`. Bo later reaches the created
station and uses it through the normal Matrix interaction; its use request ID
is saved. An interaction failure needs a confirmed Matrix rollback before a
failed state is saved. Ambiguous Blender or spawn outcomes are retained as
unconfirmed for inspection, without an automatic duplicate generation or
spawn.

The version 15 Citizens checkpoint retains the full request, policy decision,
generated work IDs and SHA where applicable, exact Matrix receipts, and the
construction/use record. Existing version 13/14 worlds migrate without
inventing historical receipts. Restart restores the same Ada and Bo identities,
world object, catalog dependency, and read-only visitor scene. A generated
request still at `requested`, `generating`, or `registered` can resume against
its durable job and saved request. A queued Matrix mutation or unconfirmed
outcome stops startup for inspection rather than issuing it again.

The shared endpoint dispatches by `capability` and `action` to explicitly
reviewed policy adapters. This demonstration permits one of the two bounded
creations; other actions remain denied. The generated path extends the
existing capability journal and Blender, GLB registration, Matrix spawn, and
interaction machinery. The human Operator procedural path remains available
in a world with no autonomous addition. See
`Validation/Citizen-Capabilities-2026-09-27.md` for the procedural proof and
`Validation/Citizen-Generated-Asset-2026-09-27.md` for generated-asset evidence.

## Read-only observation contract

`GET /api/web/hosted/observe` accepts only the separate
`SANDBOX_WORLD_VIEW_TOKEN` bearer token. It returns an envelope with
`schemaVersion`, `worldId`, `instanceId`, monotonically increasing `sequence`
within that instance, `clockTick`, `online`, `readOnly`, and a version 3
`world` containing `scene`, `game: null`, and `citizens`, plus `assets` for
registered GLBs referenced by the saved hosted scene. The endpoint returns
409 while the host is offline, bootstrapping, or between a tick exchange and
its completed checkpoint save. The view token cannot call the owner API.

Open `/web/hosted.html` on that service and enter the **view token**, never the
owner token. The page keeps the token in memory for that tab, polls only the
read-only observation endpoint, and renders the existing Matrix scene and
resident IDs through `MatrixView`. The view token may fetch only GLB bytes
whose digest belongs to an asset referenced by the saved hosted world; it
cannot list the general catalog, open an Agent session, or call owner mutation
routes. Closing every visitor does not stop the PC host. Returning on desktop
displays a later virtual clock and the same world
IDs. The visitor does not exchange as a writer, run a Citizens timer, edit the
scene, or save a competing browser checkpoint. A newly checkpointed procedural
or generated GLB object rebuilds the visitor's mesh; ordinary Citizen motion
updates only transforms. The ordinary `/web/` Creator world and older Citizens desktop
fixture keep their existing save contracts;
they are not silently replaced by the hosted visitor.

The same visitor can enter WebXR AR using the existing digital-world view
anchor, which places the **digital** scene for this visit. Its tracking state
and measured room planes are presentation data only. A missing pose hides the
overlay until tracking returns; it does not pause the PC clock. Source tests
and desktop observation establish the path, but Quest 3 wearer alignment,
comfort, performance, and physical collisions still require separate device
evidence. VR is likewise a view of the hosted world, not another writer.
