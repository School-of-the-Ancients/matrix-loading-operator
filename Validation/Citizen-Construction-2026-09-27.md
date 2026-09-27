# Bounded Citizen construction: isolated runtime evidence

This is the first bounded construction slice toward issue #109. It extends the
persistent hosted Ada/Bo world after PRs #140 and #142. The existing human
Operator creation route remains available when Citizen construction is off.

## Reproduce

From the repository root, run:

```powershell
python Validation/citizen_construction_live_probe.py
```

The probe starts an isolated `ControlService` on a temporary loopback port,
with separate owner and read-only visitor tokens, then starts the real Node
host with `--citizen-construction`. It uses a temporary scene directory and
does not edit the usual service or world. It checks the saved checkpoint,
typed procedural status, Matrix receipts, read-only observation route, and a
host restart before removing the temporary world.

## Observed result, 2026-09-27

| Boundary | Exact observation |
| --- | --- |
| Existing world | The hosted checkpoint existed at tick 0 with Ada, Bo, chair, and table before the construction request. |
| Need and identity | At tick 1, Bo (`residentId: bo`) waited for the Ada-held chair and saved intent `citizens-29-construction-2`. |
| Policy | The owner-only Citizen endpoint accepted that scoped intent and queued one typed procedural request. The separate visitor token was denied owner routes. |
| Matrix creation | Request `132996b2185b4ef89c79f3a9bb2ebfdd` produced object `c30750bcb45b45cc983621e05697f35c`. The typed status succeeded only after the saved object and matching Matrix creation receipt were observed. |
| Interaction | Reviewed interaction request `132996b2185b4ef89c79f3a9bb2ebfdd-interaction` made that object a usable rest station through Matrix's existing interaction command. |
| Citizen outcome | Bo observed the saved creation and interaction receipts, reached the new bench, and completed checked interaction `citizens-29-action-2-15` at tick 12. |
| Visitor and restart | The read-only visitor returned the same five-object world. Restart restored Ada and Bo IDs, original core object IDs, created bench, and construction provenance at tick 13. No second autonomous request was issued. |

The probe's final machine-readable assertions were:

```json
{
  "worldAlreadyHostedAtTick": 0,
  "needTick": 1,
  "createdTick": 1,
  "usedTick": 12,
  "restartTick": 13,
  "residentId": "bo",
  "intentId": "citizens-29-construction-2",
  "requestId": "132996b2185b4ef89c79f3a9bb2ebfdd",
  "interactionRequestId": "132996b2185b4ef89c79f3a9bb2ebfdd-interaction",
  "objectId": "c30750bcb45b45cc983621e05697f35c",
  "useRequestId": "citizens-29-action-2-15",
  "matrixCreationReceiptOk": true,
  "sameResidentIds": true,
  "sameCoreIds": true,
  "visitorReadOnlySameWorld": true,
  "viewTokenDeniedOwnerRoutes": true,
  "checkpointAndRestartPreservedProvenance": true,
  "autonomousRequestsAfterRestart": 0
}
```

In desktop Chrome, `/web/hosted.html` connected with the view token and
displayed the curved bench in the same room as Ada, Bo, chair, and table. The
page showed the advancing saved tick and read-only state. This establishes a
desktop browser view of the hosted scene. Quest 3 wearer visibility and
physical alignment have not been verified.

## Tests and refusal

- `npm.cmd test` in `WebRuntime`: 523 passed, 0 failed.
- `npm.cmd run build` in `WebRuntime`: production build passed.
- `python -m unittest discover -s ControlService -p test_*.py`: 777 passed.
- `test_hosted_world.py` covers a zero construction budget and denial without
  queuing a procedural action. Citizen and host tests cover rejected/failed
  construction without a false completed state, exact receipt matching,
  one-shot behavior, checkpoint migration, and the existing Operator route.

The resident's intent is data in the hosted checkpoint. Only the owner host
holds the service token, only `ControlService` approves the scoped request,
and only `MatrixWorld` mutates the scene. The resident never receives those
credentials or a direct procedural tool.
