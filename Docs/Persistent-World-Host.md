# Persistent Matrix Citizens world host

This slice gives the digital White Room an owner independent of any browser or
Quest visitor. One Node process runs the existing `MatrixWorld` and
`CitizensSimulation` for the built-in Ada and Bo demo. It exchanges each
virtual tick with the PC `ControlService`, then saves the version 3 world
checkpoint atomically. The scene contains exactly two orb resident markers,
one chair, and one table. There is no renderer in this process.

## Run an isolated local world

From a separate checkout, install the WebRuntime dependencies with `npm ci`.
Give this service its own port, scene directory, asset directory, owner token,
and optional observation token. The host CLI requires a loopback URL with an
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

`--ticks 3` performs exactly three virtual ticks and exits for a bounded run.
The default continues at one tick after each 500 ms interval. Slow service
requests do not trigger catch-up ticks. If exchange or checkpoint save fails,
the process stops; restart it after the service is healthy. A new process
restores the last atomic checkpoint and continues from that tick, without
advancing through downtime. A paused checkpoint requires inspection and an
explicit `--resume-paused` on restart.

Each world has one named PC checkpoint under the chosen scene directory. A
hosted exchange publishes a headless runtime descriptor
`matrix-world-host/none/host`. The service accepts only the built-in static
Citizens fixture under that descriptor. Operator commands returned by the
exchange receive explicit failure receipts; the host does not run editor or
gameplay commands.

## Read-only observation contract

`GET /api/web/hosted/observe` accepts only the separate
`SANDBOX_WORLD_VIEW_TOKEN` bearer token. It returns an envelope with
`schemaVersion`, `worldId`, `instanceId`, monotonically increasing `sequence`
within that instance, `clockTick`, `online`, `readOnly`, and a version 3
`world` containing `scene`, `game: null`, and `citizens`. The endpoint returns
409 while the host is offline, bootstrapping, or between a tick exchange and
its completed checkpoint save. The view token cannot call the owner API.

This is a data contract for a future observer client. It does not yet render
the world in a browser, align it to a physical room, or enable Quest 3 AR
visiting. The service keeps the hosted world separate from the existing
browser-owned White Room and the Unity client.
