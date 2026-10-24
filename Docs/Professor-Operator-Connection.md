# Professor -> existing Matrix Operator: local candidate

The full Professor page now sends bounded, explicit educational media requests to
the existing Matrix concept store. There is no second generator or loader.

## Semantics and controls

- **Load/show a thing:** School emits an `artifact`; Request exhibit image creates
  a normal Matrix concept image. The actual preview is displayed in Professor.
- **Go to a place/lab:** School emits `location` or `lab`; Request setting image
  creates a normal panorama preview. It does not apply a background automatically.
- **Optional spatial layer:** Review / select / build in Matrix opens the existing
  Images or Backgrounds controls. Choose the exact version there. Image-to-Blender
  uses the existing selected-concept/version/creation-mode guards, GLB registration
  and loader. Background apply keeps the existing room/revision/receipt guards;
  AR retains passthrough. An illustration does not require a 3D build.

The professor proposes structured requests but has no shell, file, code, image,
Blender or owner-credential tools. Submission is an explicit learner action. There
is no automatic submission of old requests merely because a lesson was reopened.
Initial request preparation remains text-only. Teaching receives only bounded
verified status summaries; Operator updates also appear in the conversation UI.

## Correlation and authority

`POST /api/professor/actions` accepts exactly the typed lesson/request/version,
Operator session, kind, prompt, objective, intent and interaction fields. It calls
the same `ConceptStore.create` used by the web UI, with `codex-native` explicitly
selected. No ComfyUI or paid API fallback is used by this adapter. Native account
and image capability are checked by the existing app-server provider.

An external request key is atomically stored in the existing concept record
before submission. It binds School session UUID + request UUID + prompt version.
Retries return that job, including failed/uncertain outcomes; restart never
silently generates another version. Changed payload without a new version and a
different Operator session are rejected. Explicit prompt edits create a new
version; they do not automatically generate it. Existing selection is untouched.

The parent and full child page exchange only allowlisted messages after a random
per-load channel handshake. Both directions check exact source window and local
origin. No credentials or executable model output cross the frame boundary.
Returned browser IDs are not accepted as evidence: School fetches the actual
`GET /api/professor/actions?sessionId=...&actionId=...` receipt from the fixed
loopback ControlService and checks the current lesson/request/prompt version.

Statuses distinguish queued/generating, image ready, failed/cancelled, current
observed object loaded and background applied. Completed build receipts must
match concept version, current runtime generation, room and observed object IDs.
Background application requires the existing successful observed environment
receipt. No status establishes interaction, simulation validity or learner mastery.
Saved status includes its verification time; stale edits cannot be overwritten.

## Running without touching the current learner demo

Current candidate: `http://127.0.0.1:8765/web/` -> **Professor**.
Standalone candidate: `http://127.0.0.1:3110/`.

The original 3107/3108 processes and archives, including the active Leonardo
lesson, were not restarted, migrated or overwritten. The candidate uses the
private `sota-professor/.school-data` archive; it does not silently import or
share the current Leonardo archive. Continue that existing lesson at 3108.

Build `WebRuntime` normally, then in `sota-professor` run `npm run build` and
`npm run build:matrix`. From this Matrix worktree run:

```powershell
node Tools/start_professor_local.mjs C:/Users/theto/Documents/Codex/2026-10-20/task/sota-professor
```

The launcher refuses occupied ports, checks the existing native ChatGPT login and
verified CLI version, excludes API-key overrides only in its child environment,
and starts the normal reviewed local service without changing persistent auth or
permissions. Test runtime/assets/logs are isolated under `.utmp/professor-local`.

The optional `--professor-ui <dist-matrix>` mount serves the existing build at
`/professor/` and forwards `/api/school` only to fixed loopback port 3108 or 3110.
It requires a loopback-bound service, loopback caller, existing Matrix auth and
same-origin/fetch-site checks before forwarding. No CORS exception is added.
Only the child page permits same-origin framing; normal Matrix CSP is unchanged.
The existing learner cookie is forwarded without exposing it to scripts or the
teacher. If an owner bearer token is configured, this candidate fails closed;
it does not borrow credentials or invent an iframe authentication grant.

This is PC-local. No USB routes, LAN bindings, firewall/Serve settings or remote
access were enabled. The consolidated headset checks remain pending.

## Exact evidence

- 820 WebRuntime tests passed (includes three new parent-bridge regressions).
- 47 focused Python tests passed: new adapter/auth/mount checks plus existing
  concept store/HTTP and Agent Portal HTTP regressions.
- Professor: 47 server tests, 22 frontend tests, strict typecheck and both builds
  passed. Existing teaching persona, quiz, assessment and tool restrictions pass.
- Desktop Chromium 155.0.8059.85: production pages and real HTTP adapters with
  mock teaching/native-image providers passed ten checks, including generating ->
  ready -> preview, existing version selection, a structured setting request,
  edit/stale status handling and reload without duplicate generation. Two fixture
  images, zero world commands, no automatic background apply or Blender turn.
- Real local read-only desktop: complete mounted app, all eleven teachers,
  configured subscription provider, handshake and retained draft passed; zero
  School POSTs or existing-lesson accesses.
- One real native ChatGPT-auth image request completed through this adapter.
  The fetched PNG was 900,349 bytes with SHA-256
  `543872b4b4f89768a151639be5abc0a0c8419cc9738659733cea0add92ea4825`.
  It is a synthetic three-card illustration, not a chosen learner topic.
  No real Blender build, panorama apply, scene load or headset test occurred.

Local receipts/screenshots/native artifact stay ignored under `.utmp`. Mock and
actual evidence are separate. No deployment, remote push or merge was attempted.


## October 21 retry/error correction

A live educational image request exposed a failed-attempt/successful-retry bug.
The native transport now permits failed attempts followed by one valid image,
retains that image if a later attempt fails, and still rejects two valid images
as ambiguous. Ambiguity remains terminal. Known native failure causes are
translated to safe, actionable messages; arbitrary backend text is not exposed.
Professor keeps the bounded reason in its verified result summary and teaching
context instead of showing only a generic failed status.

Validation: 97 Python tests across the native transport, concept store, Agent
Portal, Professor adapters and permission handoff; 48 Professor server tests;
22 frontend tests; and the School typecheck passed. Regression cases cover
failed -> ready, ready -> failed, multiple valid images, retained ambiguity,
known failure reasons and unknown/private backend details.

The current lesson's original two native events were replayed offline through
the corrected validator. The existing successful PNG was checksum-validated and
copied into the existing concept record, retaining its ID/version/request and
all unrelated jobs, selection and build state. Only the candidate services on
8765 and 3110 were restarted. A normal Professor status refresh saved the ready
receipt and displayed the image in the current lesson. Archive comparison
confirmed only the request's Operator result and presentation revision changed;
conversation, answers and other lesson content were preserved. No new image
request, world action, background application or headset test was performed.
Private backups, receipts and screenshots remain outside tracked source.


## One-click 3D exhibit from a Professor image

A ready artifact card offers **Create 3D in Blender**. The click submits only
its saved lesson/request version, original Matrix session/action ID and exact
concept version/checksum. The PC rechecks those identities, selects that image,
composes a Blender instruction from its saved educational intent, and starts
the existing selected-image Operator turn. The verified image bytes and original
art prompt enter that turn through the existing attachment path. No separate
model, paid API, teacher tool or arbitrary browser-supplied build prompt is added.
The instructions request an editable .blend and textured GLB, preserve unrelated
world content and use current Matrix placement/receipt checks.

The internal typed entry bypasses only free-text selection-intent parsing;
expected concept/version, image checksum, current runtime, permissions,
submission lock, build provenance and receipt checks remain active. Browser
inputs cannot enable the internal typed entry flag. A repeat click or reopened
page returns the existing build, including uncertain or failed outcomes, instead
of silently starting another turn. Normal Operator controls remain available
for reviewing errors or requesting a deliberate later change.

The card distinguishes building, failed build, image ready and observed object
loaded. It does not equate a completed image or a finished model response with
an object currently loaded in Matrix, nor with working interactions or AR
acceptance. The chosen product flow starts immediately from the button; there
is no separate prompt-copy/edit step. Original lessons and image prompts are
preserved.

Validation includes full WebRuntime and Professor suites/builds plus focused
Python tests for the real selected-image handoff and local HTTP route,
idempotency, stale image/lesson identities, offline and busy runtime,
non-artifact rejection and existing selection/receipt regressions. Native
Blender creation and physical AR remain separate from this automated coverage.


Local activation evidence: WebRuntime 821 tests; Professor 49 server and 24
frontend tests; School typecheck; all three production builds; 98 focused Python
tests plus the selected-concept handoff/HTTP coverage passed. The final card
label adjustment passed its three focused UI tests and both Professor builds.
The existing manually initiated Blender turn was allowed to complete before
restarting; its one-object world received a named checkpoint. Image/build records
were unchanged by activation, and saved lesson differences were limited to
verified Operator status/presentation revision. Existing Full access selection
was retained. Browser inspection confirmed the current lesson and recorded-build
control. No new native Blender turn was submitted by this feature validation;
its automatic admission path was exercised with the real local HTTP handler
and a recording backend. AR remains untested.
