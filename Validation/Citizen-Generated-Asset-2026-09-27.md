# Citizen generated asset: live validation

This continues issue #109 after PR #144. The reviewed `asset.generate` profile
uses the existing PC Blender blueprint builder and Matrix asset catalog. The
hosted Ada/Bo world remains owned by one `MatrixWorld`; the resident has no PC,
Blender, Operator, or Matrix command credential.

## Reproduce

Build `WebRuntime`, then run from the repository root:

```powershell
npm.cmd --prefix WebRuntime run build
python Validation/citizen_generated_asset_live_probe.py
```

For a direct desktop visitor check, add `--browser-hold`. The probe prints a
temporary local URL and separate view token after Bo's use. Connect Chrome's
`/web/hosted.html` page with that token, press Enter in the probe to restart
the service and host, then connect to the newly printed URL with the same view
token. Press Enter again to finish and remove the temporary world.

The probe uses an isolated PC service, temporary job/catalog/checkpoint
directories, a persistent Node world host, and distinct owner and visitor
tokens. It builds a real GLB with the installed headless Blender executable,
then restarts both processes against the same temporary durable state. The
temporary data is removed when the probe exits.

## Observed real-Blender run

The final noninteractive probe exited 0. Its isolated host first saved the
four-object world at tick 0. At tick 1, Ada held the chair while Bo waited
with energy at or below the construction threshold. The complete saved
request preceded the owner policy call:

```json
{"citizenRequestId":"citizens-29-generated-2/asset.generate/1","intentId":"citizens-29-generated-2","residentId":"bo","capability":"asset","action":"generate","parameters":{"profileId":"rest-seat-v1","transform":{"position":{"x":1.5,"y":0,"z":1.5},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"checkpoint":{"roomId":"web-virtual-room-v1","clockTick":1,"objectIds":["bbeef7f83fbd47fca43ea3938b666ead","bfd327203afc4ded92f4643e0131fd22","d07b8ee886ea4d9ea0f216d419c465ca","df3ac40b94d04aa4b6da58c8587954e1"]}}
```

The owner allowed that exact request with decision
`{"allowed":true,"requestId":"6e073cdbd3324cd0b2cb92bbd0cd488b","reason":"","checkpointSequence":3}`.
The worker called the existing Blender blueprint builder **once**. The ready
job retained profile revision
`56bf52c86bfb229bcb3bef9d09ddf6160755cc7bedddf86d99945decc5170976`
and registered one 14,172-byte GLB as
`web:citizen-rest-seat:11367d57d060`, SHA-256
`11367d57d060c8bc9fccce4efab62efb7ad5c649a97923aa4c76843a1327c510`.
The probe independently hashed and inspected the catalog file. No Citizen
received the owner or view token.

The typed Matrix spawn produced this exact receipt at created tick 33:

```json
{"requestId":"aebf7861ab746156433110f988be4370","ok":true,"error":"","objectId":"f779a6db030343588ec1baa747566d73"}
```

The host fetched those SHA-matched bytes, parsed the GLB with Three.js,
measured its geometry, verified the rendered asset for that object, and attached
the reviewed rest interaction through `MatrixWorld` with this receipt:

```json
{"requestId":"aebf7861ab746156433110f988be4370-interaction","ok":true,"error":"","objectId":"f779a6db030343588ec1baa747566d73"}
```

Citizens marked success only after those receipts and the exact asset, pose,
interaction, and object were observed. Bo reached the new station and completed
rest at tick 49; its checked use request was `citizens-29-action-5-54`. The
scene had the original four IDs plus this one object, and Ada and Bo kept their
resident-object bindings. After both service and host restarted, the same
object ID, Citizen record, job ID, GLB provenance, and receipts were restored
at tick 50. The second process made **0** Blender builder calls, **0** policy
calls, and **0** Matrix spawn requests.

The separate view token returned the same saved five-object world and journal.
It could fetch only the scene-referenced GLB by SHA; owner state, capability
submission, and the general asset catalog returned 401. In a second isolated
browser inspection of the same reviewed GLB, Chrome's `/web/hosted.html`
rendered the teal-cushioned seat beside the original chair, table, Ada, and Bo
at saved tick 305. After service/host restart, Chrome rendered that same seat
and world again at saved tick 691. That browser run's generated object ID was
`3a750c503c2b4563a127c3bc09e9bfa3`, before and after restart. This is
desktop visitor evidence; no headset or physical-room claim is made.

## Failure and scope checks

`test_citizen_asset_job.py` covers durable idempotency, retained generated
bytes and registration-only retry, and interrupted Blender work becoming
unconfirmed without a second build. `test_hosted_world.py` covers zero-budget
denial, exact saved-request policy matching, boolean-as-number tampering,
typed spawn dispatch, a narrow pre-execution checkpoint, rejected unrelated
pending saves, failed spawn receipt, GLB dependency on restore, and view-token
scope. Host/Citizens/visitor tests cover generation failure, ambiguous work,
rollback, forged receipts, wrong job provenance, rejected budget, restored
identity, and actual rest use. The human Operator and procedural Citizen paths
remain in the full regression suites.

Full suite results: WebRuntime **548/548 passed**, ControlService **788/788
passed**, and the production WebRuntime build succeeded. `git diff --check`
passed.
