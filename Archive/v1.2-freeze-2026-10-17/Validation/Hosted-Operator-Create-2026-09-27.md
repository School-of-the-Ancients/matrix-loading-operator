# Hosted Operator procedural creation — 2026-09-27

## Scope

This extends the single PC owner from [PR #140](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/140) for one small connection between [#122](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122), [#20](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/20), [#22](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/22), and [#116](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/116). A PC human asks the existing Agent Portal to create one procedural object. The existing typed Matrix tool queues the reviewed recipe, the existing `MatrixWorld` owner executes it, and the ControlService reports success only after an atomic checkpoint. Visitors continue to read that one owner's saved world. Ada and Bo retain their IDs and keep advancing.

The hosted edit contract permits one `create_procedural` result and rejects another construction, updates, unrelated commands, and unreviewed scene shapes. It does not migrate or change the ordinary browser-owned Creator Mode and its broader create/revise/save loop.

## Source and test evidence

| Check | Result |
| --- | --- |
| `npm.cmd test` in `WebRuntime` | 509 passed, 0 failed |
| `npm.cmd run build` in `WebRuntime` | Passed; hosted visitor bundle emitted |
| `python -m unittest discover -s ControlService -p test_*.py` | 771 passed, 0 failed on the final queue guard |
| `python -m unittest test_hosted_world test_agent_portal test_matrix_procedural` in `ControlService` | 36 passed, 0 failed after final one-slot queue guard |
| `git diff --check` | Passed |

Host tests execute the existing generator through `MatrixWorld`, save it, advance Citizens, restore the exact checkpoint, and reject a second create or unrelated mutation. Service tests cover typed-only queue provenance, the gap between receipt exchange and fsync/replace, a saved `succeeded` status, invalid recipe/shape additions, owner/view token separation, and restart load. Visitor tests cover structural mesh rebuild, AR anchor preservation, monotonic object IDs, unchanged Citizen/station bindings, and rejection of removal or a second addition.

## Isolated live process trace

`Validation/hosted_operator_live_probe.py` started a temporary loopback `ControlService` with separate owner and view tokens, a Node `HostedWorld`, and the installed native Codex app-server in `read-only`/`on-request` mode. The Python environment used the repository-pinned `mcp==1.30.0`; the locally supported CLI model was `gpt-5.5` at low reasoning effort. No existing world directory or user service was touched.

The human text turn requested one `curved-bench` at `(-2, 0, -4)`. Operator read the live scene and generator list, then made one reviewable `matrix_create_procedural` call; the one bounded approval was accepted. Its reply included the matching request ID. The service's typed status was `succeeded` after the saved visitor observation contained five objects. An observed trace was:

```json
{"agentActivity":"completed","agentReportedRequestId":true,"approvedTools":1,"clockBefore":1,"clockCreated":80,"clockRestarted":81,"objectId":"9aa1469126194fc69ece216268fe8cab","receipt":"succeeded","requestId":"97b1d2a955fb46149f241bd156d1d889","sameCoreIds":true,"sameResidentBindings":true,"viewerOwnerRoutesDenied":true}
```

The probe stopped both processes and restarted the service and host from the same temporary checkpoint. The created object and four original scene IDs remained; Ada and Bo kept their original bindings; the resumed clock advanced from saved tick 80 to 81. Owner credentials were denied at the view route, and the view token was denied at owner and Agent routes. The temporary service and checkpoint directory are removed when the probe ends.

Desktop Chrome opened `/web/hosted.html` against the probe's restarted service using only its temporary view token. The page rendered the existing chair, table, Ada and Bo, and the added bench geometry clearly to the left of the chair. The UI displayed `AdaBo`, saved tick 248 after the restart at tick 81, and the same resident object prefixes. The token field cleared after connection. The visitor used its read-only page, not a second writer lease.

## Limits

The browser check is desktop Chrome and the source tests cover the shared WebXR view path and AR anchor state. This machine did not provide a connected Quest 3 wearer session, so VR rendering, AR physical alignment, readability, collision, and device performance are unverified. The hosted prototype permits only one creation; revising or removing it will require a separate bounded capability and acceptance. It does not complete every criterion in #122, #20, #22, or #116.
