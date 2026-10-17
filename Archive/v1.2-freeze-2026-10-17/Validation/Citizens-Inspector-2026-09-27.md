# Citizens inspector: hosted-world validation

Issue #20's inspector projects the existing validated Citizens checkpoint. This
probe uses the seed-29 Ada/Bo world, one persistent Node host, one PC service,
one real headless Blender build, and a separate read-only view token. No visitor
connects until Bo has used the new seat. It imports the same pure
`projectCitizensInspector` function as the owner and hosted visitor UI; the
projection is checked against saved checkpoints without changing them.
The PC owner can inspect that projection in this local probe or open the same
hosted read-only page with the separate view token. The ordinary `/web/`
Citizens panel projects its browser-owned world; it is not a second view of
the PC-hosted checkpoint.

## Reproduce

From the repository root, after building WebRuntime:

```powershell
npm.cmd --prefix WebRuntime run build
python Validation/citizen_generated_asset_live_probe.py --inspector
```

`--inspector --browser-hold` pauses with a temporary local URL and view token
before and after the service/host restart so the desktop hosted page can be
inspected. The default run is noninteractive and removes its temporary world.

## Exact noninteractive run

The command exited 0. The world existed at tick 0 and advanced headlessly.
At tick 1 Ada held the chair while Bo was first in its queue. The projected
last recorded choice selected rest, with score **56.39**. The exact saved
Citizen request was for `asset.generate` by `bo`, using `rest-seat-v1`.

| Saved stage | Tick | Projected explanation and checked state |
| --- | ---: | --- |
| requested | 1 | Bo submitted the request; policy was still absent; chair queue position 1 behind Ada. |
| generating | 1 | Policy allowed the exact request; generation was in progress. |
| registered | 31 | Registered GLB observed; Matrix placement pending; no Matrix receipts yet. |
| spawning | 31 | Typed Matrix placement in progress; no Matrix receipts yet. |
| created | 31 | Two exact Matrix receipts present and object observed; projected outcome still has no use request. Bo was using the original chair at this checkpoint. |
| active | 39 | Bo was traveling toward the generated seat object. |
| used | 49 | Bo completed rest at the generated seat; use request `citizens-29-action-5-54` is recorded. |
| restored | 50 | Same citizen provenance, receipts, use outcome, object, and Ada/Bo identities after service and host restart. |

The projected summary changed from “Bo observed Matrix creation; use has not
been recorded for a generated rest seat.” to “Bo observed Matrix creation and
used the object for a generated rest seat.” The `latestChoice` remains explicitly
a *last recorded* choice at tick 1; this is not a newly computed tick-49 score.

This run made **1** Blender build and registered a 14,172-byte GLB at
`web:citizen-rest-seat:11367d57d060`, SHA-256
`11367d57d060c8bc9fccce4efab62efb7ad5c649a97923aa4c76843a1327c510`.
The job ID was `2adf94b6b9fe4a1290c7832c11a34d8a`. Matrix spawn request
`aebf7861ab746156433110f988be4370` and its interaction receipt both had
`ok: true` for object `cb2c6dc96c414720a5251ce5659d6b2e`:

```json
{"requestId":"aebf7861ab746156433110f988be4370","ok":true,"error":"","objectId":"cb2c6dc96c414720a5251ce5659d6b2e"}
{"requestId":"aebf7861ab746156433110f988be4370-interaction","ok":true,"error":"","objectId":"cb2c6dc96c414720a5251ce5659d6b2e"}
```

The probe independently hashed and parsed the catalog GLB, matched both receipts to the
Citizen journal, and checked the actual rest use. After restart there were
**0** new Blender builds, **0** policy calls, and **0** Matrix spawn requests.

The view token returned a world exactly equal to a saved hosted checkpoint,
including the generated object and projected explanation. The same check
passed after restart. The view token could not call owner state, capability
submission, or the general asset catalog routes; it could fetch the referenced
GLB by SHA for rendering. Twenty further viewer GLB fetches succeeded while
the host continued ticking. A GLB referenced by the last verified on-disk
checkpoint remains fetchable during the next in-flight exchange/save; the
observation route still requires a fully saved matching checkpoint.

## Desktop visitor after real restart

An interactive `--inspector --browser-hold` run independently opened the
read-only `/web/hosted.html` page in the desktop in-app browser, connected
with its separate view token, and visibly rendered the generated rest seat
beside the original chair and table. The page showed Ada and Bo, their
needs, current activity and reservations, latest recorded decision scores,
the construction policy, two Matrix receipts, and Bo's completed use.
After stopping and restarting both the service and Node host, a new page
connection showed the same object `e30d2999bf094183817cf8ef410b2f07`
and the same two receipt request IDs:

```json
{"requestId":"aebf7861ab746156433110f988be4370","ok":true,"error":"","objectId":"e30d2999bf094183817cf8ef410b2f07"}
{"requestId":"aebf7861ab746156433110f988be4370-interaction","ok":true,"error":"","objectId":"e30d2999bf094183817cf8ef410b2f07"}
```

That run had one Blender build, creation at tick 30, Bo's use at tick 49,
and no new build, policy decision, or spawn request after restart. The
desktop screenshot and DOM both showed the restored seat and creation
explanation. This is browser and hosted-runtime evidence; no Quest or
physical room behavior is claimed.

The owner now saves a public-safe reason instead of copying raw Blender job
errors into new Citizen failures. A view-token observation replaces historical
failure and denial diagnostics with status-based public reasons while leaving
the PC checkpoint unchanged. Focused tests include arbitrary Windows, Unix,
and unrecognized subprocess text and check that the visitor checkpoint stays
valid. Failed Matrix receipts retain their exact world request IDs; a visitor
sees a public error string in place of an older raw error.
