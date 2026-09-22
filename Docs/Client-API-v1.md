# Matrix client API v1

This initial slice lets an independent **local companion** read a paired Matrix
runtime and submit a text request for human review. It reuses the existing
planner, proposal checks, command queue, runtime acknowledgements, and saved
scenes. There is no second scene executor or School-specific data model.

This foundation requires an updated PC service. Hosted School connectivity and
real headset acceptance remain pending.
An HTTPS website cannot assume it can call this HTTP localhost service. This
slice deliberately enables no CORS or public relay; a local process is the
supported client transport. A future authenticated outbound connector can wrap
this API after its actual deployment path is demonstrated.

## Compatibility and authority

| Interface | Supported in this slice |
| --- | --- |
| Protocol | `1`, under `/api/v1/`; unsupported versions return HTTP 426 |
| Discovery | Loopback only; no pairing required; contains no scene or images |
| Client authentication | One-use pairing code exchanged for a scoped bearer token |
| Runtime binding | One exact runtime lease generation; even the same app returning after lease expiry requires a new pairing |
| Proposal input | `offline-rules` text grammar; optional owner-configured `codex-cli` AI text planning; optional typed `experiment.block-scale.v1` intent |
| Apply | Human owner in Matrix's `/clients` page with the Operator service token |
| Capture and content installation | Not exposed to clients; remain available through the existing Operator |
| Measurement | Runtime-reported snapshots/transforms; no claim of measured physical dimensions or volume |
| Events | Poll per-request status; increasing `sequence`; no stream or durable event replay |
| Storage | Bounded in-memory session/request ledgers, lost at service restart |

Configure `SANDBOX_TOKEN` with at least 24 unpredictable characters before
starting the PC service. That owner token authenticates the runtime and existing
Operator as before. The default standalone Operator can still run without a
token, but client pairing is disabled until owner authentication is configured.
Do not give the owner token to a companion. Client tokens cannot call legacy
command, Apply, capture, content, or pairing-management endpoints.

All v1 routes require a loopback peer, valid Host, and absent or same-origin
Origin. Requests use JSON with a 16 KiB limit; credentials stay in headers or
POST bodies, never URLs. Cross-origin browser use is rejected. Do not bind this
feature as a public control endpoint or put the service token into a hosted site.

## Walkthrough

1. Start an updated service with its configured token and connect a runtime using
   that same existing service authentication configuration. No APK update is
   needed for this API.
2. Open `http://127.0.0.1:<port>/clients` on the service PC. Enter the owner token,
   name the companion, and choose **Create pairing code**. This explicitly grants
   scene-read and proposal permissions to the client receiving the code.
3. Run `python Examples/matrix_client.py --url http://127.0.0.1:<port>` and enter
   the code at its hidden prompt. The sample keeps its client token in memory.
4. The sample requests “Place a block here.” Select a valid placement point in
   the runtime first, and ensure `block` exists in its installed catalog. Use
   `--text` to choose another supported offline command.
   For an AI scene request, add `--mode codex-cli --text "Arrange a small demonstration using the installed props."`.
   The sample first checks that the service advertises that mode. The Operator
   configures Codex and chooses its model and reasoning effort; the companion
   cannot override those settings.
5. Review the actual commands in `/clients` and choose **Apply reviewed
   proposal**. No client request applies itself. The sample polls until a result
   or its bounded waiting period ends.
6. Revoke the client on `/clients` when finished. Revocation cancels unapplied
   proposals; already dispatched work is not rolled back.

The local sample is not evidence of a hosted School connection or a Quest test.
An authenticated synthetic runtime test exercises the HTTP round trip without
claiming physical placement or headset acceptance.

## Routes

Every success envelope has `protocolVersion: "1"`. Every v1 failure has
`{protocolVersion:"1", code:"...", error:"human-readable explanation"}` and an
appropriate non-2xx status. A successful HTTP response is not execution success.
IDs use 1–96 ASCII letters, digits, `.`, `_`, `:`, or `-`, starting alphanumeric.

| Method / path | Authority | Input / output |
| --- | --- | --- |
| `GET /api/v1/discovery` | Local, unpaired | Implemented capabilities, limits, transport and pairing availability |
| `POST /api/v1/pairings` | Owner bearer | `{clientName}` → `{pairingCode,expiresInSeconds:120,runtimeSessionId}` |
| `POST /api/v1/sessions` | Pairing code | `{pairingCode}` → `{sessionId,clientToken,runtimeSessionId,expiresInSeconds:3600}` |
| `GET /api/v1/scene` | Client bearer | `{sessionId,runtimeSessionId,revision,snapshot,runtime}` |
| `POST /api/v1/requests` | Client bearer | Version 1 request below → request envelope |
| `GET /api/v1/requests/{requestId}` | Owning client bearer | Current request envelope |
| `POST /api/v1/requests/{requestId}/cancel` | Owning client bearer | `{}`; cancellation before Apply only |
| `GET /api/v1/operator` | Owner bearer | Paired sessions and their requests, without credentials |
| `POST /api/v1/operator/requests/{sessionId}/{requestId}/apply` | Owner bearer | `{}`; delegates to existing `State.apply_plan` |
| `POST /api/v1/operator/requests/{sessionId}/{requestId}/cancel` | Owner bearer | `{}`; cancellation before Apply only |
| `POST /api/v1/operator/sessions/{sessionId}/revoke` | Owner bearer | `{}`; revokes access and cancels unapplied proposals |

Owner and client bearer tokens are different credentials. The one-use code is
valid for 120 seconds and its claimed session for one hour; only token digests
are retained by this adapter. Secret values are never included in status results.

## Request and result

Read `/scene`, then submit the exact revision and runtime identity you reviewed:

```json
{
  "requestId": "demo-001",
  "correlationId": "opaque-turn-001",
  "expected": {"runtimeSessionId": "service-instance.1", "revision": 2},
  "intent": {"text": "Place a block here.", "mode": "offline-rules"}
}
```

`correlationId` is optional and opaque. Do not send learner records, credentials,
conversation history, or curriculum schemas. Matrix owns scene state; clients
interpret their own conversations and use the correlation ID to connect results.

### Optional AI text planning

`capabilities["scene.propose_text"]` has this shape when the owner's Codex
executable, configuration and selected preferences validate locally:

```json
{"modes":["offline-rules","codex-cli"],"requiresOperatorApply":true}
```

Otherwise `modes` contains only `offline-rules`. Discovery never runs inference
or exposes executable paths, model settings, credentials, room data or images.
Advertisement establishes local configuration, not login, quota, network or
provider health; actual inference can still fail. The owner configures the
existing planner as described in [AI Integration](AI-Integration.md).

An AI request uses the same envelope with the exact intent
`{"text":"Arrange a small demonstration using the installed props.","mode":"codex-cli"}`.
Only `text` (1–4000 characters, not blank) and `mode` are accepted. There are no
client overrides for models, reasoning, executable paths, credentials, image
attachments or raw commands. `openai-compatible` is not exposed by this adapter.
The existing planner receives the current scene, installed catalog, room and
selection metadata and validates its result through the normal command schema.
An AI request may propose several existing supported commands; this does not
enable asset downloads, arbitrary tools, generated scripts or executable code.

The AI POST returns HTTP 200 with `status:"planning"` promptly. Poll the retained
request until it reaches `ready`, `needs_clarification`, `error`, `stale` or
`cancelled`. Planning and HTTP success are not runtime success. The Operator
must review the actual commands and Apply; runtime command receipts and the
acknowledging snapshot remain the only execution evidence.
Submitting this mode invokes the owner's configured provider with the request
and structured scene context. Pairing therefore permits that client to consume
AI inference; Apply authorizes the resulting scene edits after inference.

Only one client AI request can run inference at a time. A new request while it
is occupied returns HTTP 409 `planner_busy` without creating a ledger entry;
an unavailable configuration returns 503 `planner_unavailable`. Identical
same-ID retries return their existing outcome even if the planner later becomes
busy or unavailable. There is no automatic offline fallback, inference retry or
replay. Existing per-session active and retained request limits still apply.

Cancellation and revocation prevent any late proposal from becoming reviewable;
they do not interrupt the already running, time-bounded CLI process. The slot
remains busy until it finishes. Runtime lease, scene or selection changes also
discard stale results. Offline parsing and typed scale intents keep their
existing synchronous behavior and do not consume this AI slot. Operator and
voice planning retain their existing workflows.

The [AI request test record](../Validation/client-ai-scene-requests.json) covers
real local HTTP with mocked inference and synthetic runtime/AR fixtures. It does
not establish live model reasoning, Windows visual behavior or headset acceptance.

```json
{
  "protocolVersion": "1",
  "sessionId": "paired-session-id",
  "requestId": "demo-001",
  "correlationId": "opaque-turn-001",
  "runtimeSessionId": "service-instance.1",
  "sequence": 2,
  "status": "ready",
  "requiresApply": true,
  "proposal": {
    "planId": "existing-matrix-plan-id",
    "requiresApply": true,
    "commands": [{"op": "spawn", "assetId": "block", "anchorId": "floor", "transform": {
      "position": {"x": 1, "y": 0, "z": 2},
      "rotation": {"x": 0, "y": 0, "z": 0},
      "scale": {"x": 0.2, "y": 0.2, "z": 0.2}
    }}],
    "summary": "Review the proposed placement."
  },
  "commandIds": [],
  "receipts": [],
  "observed": null,
  "error": null
}
```

An executable proposal always has at least one validated command. Full
deterministic HTTP fixtures are in `Validation/client-api-v1-fixtures.json`.

The optional `experiment.block-scale.v1` discovery capability adds a typed
`block-scale` configure/reset intent to this same request envelope. It scales one
existing built-in block relative to a service-captured baseline in a virtual
room. Requests retain the same revision, pairing, Apply and cancellation rules.
The additional `experiment.observationState` and `experiment.observation` fields
distinguish verified mathematical scale ratios from merely successful command
receipts. See [the exact experiment contract](Scale-Experiment.md) before using
this optional capability; text requests and their result envelopes are unchanged.

Offline spawn requests on a measured MRUK support include `placement:"surface"`.
The selected point is a support-plane point, not the prefab pivot. Existing
validation requires a ready/aligned room, a support target, known prefab bounds
and nonnegative clearance. Unity's existing placement resolver then adjusts the
pivot so the prefab bottom rests above that point, and checks the full footprint
against the real surface. For an unrotated prop, the resulting anchor-local Y is
`requestedY - (bounds.center.y - bounds.size.y / 2) * scale.y`. Virtual-room
placement keeps its direct transform and does not acquire a surface hint.
This PC planner correction reuses the existing runtime implementation and needs
no APK change; actual headset fit and alignment still require device acceptance.

After Apply, `commandIds` identify the existing Matrix command acknowledgements.
The `queued`/`running` states mean accepted for dispatch / offered to the runtime,
not success. Each receipt contains its original `requestId`, `ok`, `error`, and
`objectId`. A completed request has `observed: {revision,snapshot}`, captured with
the acknowledging runtime exchange. A successful PC `save_scene` instead has
`observed: {revision,savedScene}` and no runtime command receipts.

`succeeded` requires all receipts to report success; `failed` means all reported
failure; `partial` preserves mixed results. These are execution acknowledgements,
not proof of a desired educational outcome. For example, doubling transform
scale alone is not proof of measured volume.

Other states are `planning`, `ready`, `needs_clarification`, `review_only`,
`cancelled`, `stale`, `unconfirmed`, and `error`. Reject/clarification never queues
commands. Snapshot or selection changes invalidate an unapplied proposal using
Matrix's existing revision checks. This slice does not implement the future
authored-state versus simulation-observation contract from issue #13A.

## Retry, cancellation, and session replacement

- Use the same `requestId` and identical JSON content to retry a request. The
  retained result is returned, including during planning; no second proposal is
  created. Changing content under the same ID returns 409. Apply is also
  idempotent once commands were dispatched or a synchronous save completed.
- Poll the original request after a timeout. Ignore older `sequence` values
  arriving out of order. Never infer that a lost HTTP response means no action
  occurred. The sample does not retry mutations automatically.
- Cancellation only succeeds before Apply. A dispatch-time cancellation returns
  409; it does not remove commands that the runtime may already have received.
  Revocation similarly cannot prove rollback. Owner status retains records.
- Lease loss marks dispatched requests `unconfirmed`; it does not mark them
  failed. A returning/replacement runtime cannot execute that session's new
  proposals or send receipts into its old request identity. The client can
  still read old outcomes until its token expires or is revoked, but must pair
  again to read/control a new runtime generation.
- Room loss while the runtime remains online also marks retired work
  `unconfirmed`; `/scene` returns `room_unavailable` (409). If acknowledgements
  arrive without a room snapshot, their real receipts are preserved but the
  outcome stays `unconfirmed` with `observed:null`. A later snapshot is never
  relabeled as the observation from that acknowledgement. Inspect the current
  room and make a new reviewed request if further work is needed.
- Two clients can propose against the same revision. Once one is applied, the
  existing revision and pending-command checks prevent the second from applying
  a stale proposal. Per-session active-work and retained-ledger limits return
  HTTP 429 rather than silently evicting idempotency records.
- Pairings, tokens, outcomes, and idempotency are process-local. Service restart
  invalidates all pairings and loses their records. It does not authorize replay
  of an uncertain action under a new pairing. Reconcile in the Operator first.

## Acceptance still outstanding

- Demonstrate the actual School deployment's authenticated local-companion or
  outbound transport. No browser-origin/CORS workaround is implemented here.
- Demonstrate a real runtime and then a Quest round trip with human Apply and
  observed state. Synthetic tests do not satisfy hardware acceptance.
- Extend separately for consented capture, content preparation, durable events,
  and finite simulation actions after their ownership contracts are established.
