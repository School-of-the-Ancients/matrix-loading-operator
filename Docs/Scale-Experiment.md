# Static block-scale experiment, version 1

This is a bounded, client-neutral part of [issue #32](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/32). A paired local client can configure independent X/Y/Z factors on one existing built-in `block`, review the resulting `set_transform` command in Matrix, and inspect a mathematical volume ratio after the runtime acknowledges the exact object and transform. School is not required. This capability does not implement physics, animation, physical measurements, room-AR interaction, or assessment.

The existing Operator already provides transform fields and uniform text scaling. This module supplies a typed baseline/factor/result contract over the same planner validation, proposal revision, human Apply, command queue, runtime receipt, and Undo paths. It adds no Unity source, second executor, general script engine, content catalog, or learning database.

## Discover and prepare

`GET /api/v1/discovery` advertises `capabilities["experiment.block-scale.v1"]`. Its version is `1`; supported room mode is `white-room`. Older clients may ignore this optional capability and continue using existing text intents. A capability advertisement describes the service recipe, not readiness of a particular object.

Place an existing built-in **Terracotta block** (`assetId: "block"`) in a virtual room using the usual Operator, then read `/api/v1/scene`. Choose its stable object ID. The service rejects missing/replaced blocks, imported content occupying the built-in ID, unavailable anchors, AR/MRUK targets, read-only rooms, and enabled decorative behaviors. There is no immutable built-in build version/digest in the current runtime contract; asset identity has that explicit limitation.

## Configure and inspect

Use the existing `POST /api/v1/requests` envelope and current paired runtime identity/revision:

```json
{
  "requestId": "scale-first",
  "expected": {"runtimeSessionId": "the-paired-runtime", "revision": 7},
  "intent": {
    "kind": "block-scale",
    "version": 1,
    "action": "configure",
    "objectId": "the-existing-block-id",
    "factors": {"x": 2, "y": 3, "z": 4}
  }
}
```

Each factor must be a finite number from `0.25` through `4`; booleans and numeric strings are rejected. Final transform scale components must remain within the existing runtime range `0.01` through `20`. The service captures the object's baseline from that exact scene snapshot. Clients cannot submit a fabricated baseline or arbitrary commands. The initial proposal changes no scene state. Matrix's owner reviews and Applies it on `/clients`; a paired client cannot Apply.

The proposal and request expose `experiment.baseline`, `factors`, and `expectedTransform`. They are configuration, not execution evidence. Poll the original request. Only `experiment.observationState: "confirmed"` with a non-null `observation` establishes the experiment result. It requires exactly one successful receipt for the request's command and object, plus the matching room, asset, anchor, position, rotation and scale in the snapshot from that acknowledging exchange. A successful generic request receipt can still have an **unconfirmed experiment observation** when those facts do not match.

The observation contains `source: "acknowledged-runtime-transform"`, its scene revision, `relativeFactors`, `mathematicalVolumeRatio`, `units: "dimensionless ratio"`, and `physicalMeasurement: false`. Ratios are calculated from the reported final scale divided by the captured baseline scale. For factors `2, 3, 4`, the mathematical volume ratio is `24`; factors `2, 2, 2` give `8`. This is geometry reasoning about transform scale, not measured physical volume, mesh mass, collision behavior, or validated physics. The observed snapshot is historical evidence and does not prove the object remains unchanged now.

## Continue, cancel, or reset

For a later configuration, provide `baselineRequestId` referencing a **confirmed experiment request in this same pairing**, normally the latest result, with new factors. Each request carries the original baseline through the chain; factors never compound accidentally. The current target must still match the referenced result's full transform, room, asset and anchor. If another edit changed it, reconcile that change or begin a new configuration without a baseline reference to intentionally capture a new baseline.

Reset is another reviewed request:

```json
{
  "requestId": "scale-reset",
  "expected": {"runtimeSessionId": "the-paired-runtime", "revision": 9},
  "intent": {
    "kind": "block-scale",
    "version": 1,
    "action": "reset",
    "objectId": "the-existing-block-id",
    "baselineRequestId": "scale-first"
  }
}
```

Reset proposes the original captured transform with factors `1, 1, 1`; it does not run without owner Apply. A cancelled, failed, unapplied, foreign-pairing, or unconfirmed request cannot supply a baseline. Cancel uses the existing request cancellation endpoint **before Apply only**. There is no running simulation to stop, no removal of possibly dispatched work, and no rollback claim after disconnection. Undo remains the runtime's existing scene-history operation.

An intervening delete, load, Undo, room change, or other scene revision invalidates a waiting proposal before Apply. Static scene restore that returns the exact same stable object identity and transform may intentionally be used for a new reviewed request; this slice has no hidden experiment object lifetime or background action. The before/after snapshot comparison remains authoritative. It does not introduce the separate authored-versus-simulation ownership model planned in #13A.

Request/baseline metadata is bounded by the existing in-memory pairing ledger and does not survive PC service restart. Saved scenes retain their normal transforms, but do not restore an experiment request chain. Re-pair, inspect the scene and explicitly capture a fresh baseline; do not replay uncertain work automatically.

## Independent sample and validation

`Examples/block_scale_client.py` uses the local pairing API and existing request polling, independently of School. It requires a selected existing block and prompts for human review. Its optional reset is a separate reviewed request. See `--help` for parameters. The sample never receives the owner token or applies a proposal itself.

With a virtual-room block selected and a pairing code available on the service's `/clients` page:

```powershell
python Examples/block_scale_client.py --url http://127.0.0.1:8765 --factors 2 2 2 --reset
```

Use the actual local service port. Enter the temporary pairing code at the hidden prompt, then review and Apply the configure proposal in Matrix. The sample prints an acknowledged mathematical ratio of `8` when the evidence matches. With `--reset`, it then requests a separate reset; review and Apply that proposal to restore the captured baseline and inspect ratio `1`. Omit `--reset` to leave the confirmed configuration in place. `--object-id` can select an explicit existing block instead of the current selection. The sample prints each request ID before dispatch, makes no automatic mutation retries, and stops polling on Ctrl+C without claiming cancellation or rollback.

Automated coverage is in `ControlService/test_scale_experiment.py` and `test_scale_adversarial.py`, alongside the existing client API, planner, Operator and runtime regression checks. Fixtures cover independent arithmetic, invalid parameter shapes/ranges, captured-baseline chains, reset/cancel, changed objects and stale Apply, wrong receipts/observed transforms, and legacy text compatibility. Fixtures do not prove real player, Quest interaction or device performance; report those runs separately.

The separate [actual Windows acceptance](Scale-Windows-Validation.md) records 36 passed checks with real Unity receipts and snapshots: uniform and chained nonuniform scaling, reviewed reset, no change before Apply, and rejection after an intervening runtime edit. It used a headless isolated player and authenticated owner API calls; no human UI click, rendering, Quest or AR validation is implied. [The sanitized record](../Validation/block-scale-windows.json) pins the tested service files and runtime assembly.

Validation on September 22, 2026:

| Check | Result |
| --- | --- |
| `python -m unittest discover -s ControlService -p 'test_*.py' -q` | 475 passed, including 23 experiment and 17 sample-client checks |
| `node --test ControlService/test_client_panel.js ControlService/test_operator_panel.js ControlService/test_content_panel.js` | 3 panel suites passed |
| Actual isolated Windows player | 36 assertions passed; service byte hashes matched all 13 frozen modules |
| `git diff --check` | Passed |

Issue #32 remains partial: room AR, actual Quest acceptance/performance, broader experiments, and any future finite-action stop/lifecycle semantics are outstanding. No future simulation capability is implied by this static recipe.
