# Citizen capability layer: isolated live proof

This follows PR #143 and continues issue #109. The hosted Ada/Bo world remains
owned by one `MatrixWorld` process. Bo's chair contention is the regression
scenario for the shared `Citizen → Matrix` request contract. A resident holds
no owner token, Agent session, MCP bridge, or Matrix command interface.

## Reproduce

From the repository root:

```powershell
python Validation/citizen_construction_live_probe.py
```

The probe starts an isolated PC service and Node world host with temporary
checkpoint and asset directories. It uses different owner and view tokens and
removes the temporary world on exit. The default run does not print either
token. It captures every
checkpoint and the exact policy request and response, checks the typed
procedural dispatch and Matrix result, observes the visitor route, and restarts
both processes.

## Observed result, 2026-09-27

| Boundary | Exact observation |
| --- | --- |
| Persistent world | An Ada/Bo checkpoint with four original objects was saved at tick 0 before Bo requested anything. |
| Citizen intent | At tick 1, Bo waited for the chair claimed by Ada. His saved `citizenRequestId` was `citizens-29-construction-2/procedural.create/1`. The request carried Bo's resident and intent IDs, `procedural.create`, reviewed parameters, and checkpoint room, tick, and sorted object IDs. |
| Policy | The owner-only `/api/citizens/capabilities` route received exactly the saved request. It allowed the action at checkpoint sequence 3 and returned Matrix request ID `d858137ab5864d9b84561dff341c0f7e`. The view token was denied this route and other owner routes. |
| Existing capability | The policy invoked `State.agent_procedural_action`; its issued record retained the full Citizen request and identity. The existing typed command executed through `MatrixWorld.execute`. Its status was `succeeded` after the saved object and receipt agreed. |
| Matrix receipts | The creation receipt for `d858137ab5864d9b84561dff341c0f7e` created object `b2e9ee6f8e1f44b199e29d8b30570d05`. The reviewed interaction receipt was `d858137ab5864d9b84561dff341c0f7e-interaction`. Both exact receipt objects were saved in the capability journal. |
| Citizen and visitor | Bo observed the receipts, reached the bench, and completed checked use `citizens-29-action-2-15` at tick 12. The read-only visitor received the same five-object world and journal. |
| Restart | At tick 13 the same resident IDs, original object IDs, created object, construction record, and exact capability journal survived. No second capability policy call or typed procedural request was issued. |

The probe printed:

```json
{"action":"create","autonomousRequestsAfterRestart":0,"capability":"procedural","capabilityJournalPreservedAcrossRestart":true,"checkpointAndRestartPreservedProvenance":true,"checkpointSequence":3,"citizenRequestId":"citizens-29-construction-2/procedural.create/1","createdTick":1,"intentId":"citizens-29-construction-2","interactionRequestId":"d858137ab5864d9b84561dff341c0f7e-interaction","matrixCreationReceiptOk":true,"matrixInteractionReceiptOk":true,"needTick":1,"objectId":"b2e9ee6f8e1f44b199e29d8b30570d05","policyAllowed":true,"requestId":"d858137ab5864d9b84561dff341c0f7e","residentId":"bo","restartTick":13,"sameCoreIds":true,"sameResidentIds":true,"typedDispatch":"create","useRequestId":"citizens-29-action-2-15","usedTick":12,"viewTokenDeniedOwnerRoutes":true,"visitorReadOnlySameWorld":true,"worldAlreadyHostedAtTick":0}
```

The full WebRuntime suite passed 535/535 tests, the production build passed,
and the full ControlService suite passed 783/783 tests.
Focused host and visitor tests include zero-budget denial,
safe rejection of another scoped action, exact command and receipt checks,
human Operator creation, visitor journal monotonicity, and v13 to v14 migration
without inventing historical receipts. The probe is the runtime proof; tests
alone do not establish the connected sequence above.

The current policy allows only the reviewed procedural bench action. Other
capability and action pairs use the same request endpoint and receive an
explicit denial. An autonomous Blender asset request remains a separate
acceptance step for issue #109: the existing PC authoring job is asynchronous,
registers a GLB before world placement, and needs durable job provenance and
hosted visitor support for a registered asset. No Quest wearer check was part
of this isolated run.
