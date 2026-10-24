# Embodied Professor and VRM catalog implementation plan

Date: October 23, 2026 (America/Denver). Status: first avatar/lesson-binding slice implemented and desktop-validated. Live voice, automatic matching and Quest acceptance remain pending. See [Professor-Avatar.md](Professor-Avatar.md) for shipped behavior and evidence.

Conversation ownership and the next implementation sequence are refined in [Professor-Conversation-Routing.md](Professor-Conversation-Routing.md): speech targets the active School professor; Matrix Loading Operator is its delegated world worker. The avatar renders that professor's output. This is a plan, not an enabled speech/tool bridge.

## Outcome

A learner enters the existing Matrix world in AR, sees one embodied professor, starts a conversation once, and learns through dialogue and a small spatial demonstration. School supplies the historical teacher and lesson. Matrix supplies the avatar, spatial state and Operator execution. A live voice provider can converse while a background worker prepares an exhibit.

Over time, a small curated VRM catalog supplies appropriate appearances. The AI may choose the closest available **representation** of a historical figure; it must not claim that an approximate avatar is an authentic likeness. The learner can preview, replace or pin the selection. Selecting a different body does not change the teacher, lesson, voice or permissions.

First complete example: choose a historical teacher or Professor Riko, place one avatar, discuss scale and volume, request two cubes, revise the same exhibit, save and return. Use an explicitly selected teaching area; do not clear the existing world.

## Inspected baseline

Implementation home:

- Matrix: `C:/Users/theto/Documents/Codex/2026-10-20/task/matrix-professor-overlay`, branch `feat/professor-dom-overlay`, HEAD `5e44e29b445a39049bc5b581eea6dfbdd5a1cf8c`, with existing uncommitted Professor/Operator work. Preserve it.
- School: `C:/Users/theto/Documents/Codex/2026-10-20/task/sota-professor`. Source inspected directly. Git status was not established because the checkout has a different Windows owner; this plan did not change global Git trust settings.
- Reference avatar runtime: `C:/Riko/client`. This is a reference for VRM display, expressions and audio analysis, not another world engine to embed.

Existing pieces to extend:

| Existing source | Current capability | Missing work |
|---|---|---|
| Matrix `WebRuntime/src/professor_overlay.js` | Full School page in an optional DOM overlay | A world-space professor; XR routing and input validation |
| Matrix `WebRuntime/src/professor_operator.js` and `ControlService/professor_actions.py` | Correlated School exhibit requests, status and exact-image build handoff | A narrow voice/task adapter and avatar binding |
| Matrix `ControlService/web_assets.py` | Immutable validated GLB registry | An explicit VRM asset profile and metadata validation |
| Matrix `WebRuntime/src/asset_animation.js`, `view.js`, `protocol.js` | Animated assets, world presentation and state validation | VRM runtime lifecycle and compatible professor component |
| School `src/school/SchoolApp.tsx`, `personas.mjs` and local teaching backend | Teacher identities, pedagogy, saved conversation, quiz and review | Presentation bindings and optional live voice context |
| School `src/school/useOperator.ts` and `ExhibitPanel.tsx` | Explicit exhibit and build controls | Voice-generated proposal integration without bypassing authority |

Current School teaching deliberately has tools disabled. Its legacy Gemini hooks are not mounted by the current School entry. A working old hook is not evidence of working current live voice. Matrix's Professor route is restricted to local HTTP loopback, and XR DOM overlay depends on device support. Existing local image/build evidence is not AR acceptance.

### Actual Riko asset audit

`C:/Riko/client/characters/riko/models/Riko1.vrm` is VRM 1.0 (`VRMC_vrm`), 19,865,732 bytes, with 3 meshes, 21 materials, 41 textures and 3 skins. SHA-256:

`e46547c9f00a1faab097f7ec99c3a28f3f33d18332b3eefab0480a2037f20080`

Its embedded metadata states `avatarPermission: everyone`, `commercialUsage: personalProfit`, `allowRedistribution: false`, and `modification: prohibited`. Record the original metadata and applicable purchase terms. Do not modify, optimize, commit, bundle or redistribute these bytes under an assumed permission. Local use and any later device delivery must be checked against the actual terms. A catalog metadata entry is not permission to distribute its model.

Matrix's current GLB inspection limit is 16 MiB and 32 textures, so this file cannot pass unchanged. Renaming `.vrm` to `.glb` does not supply VRM rendering or solve these limits. Start with a smaller approved avatar if needed. If supporting this exact file, introduce a separately bounded VRM profile after measurement; do not broadly relax all GLB limits.

## Responsibilities and boundaries

| Responsibility | Owner |
|---|---|
| Historical identity, lesson, sources, assessment and learner records | School |
| Avatar catalog, asset bytes, entity placement, transforms and world saves | Matrix |
| Conversation audio, turn-taking and interruption | Selected live voice adapter |
| Exhibit planning, approved actions, execution and receipts | Existing Matrix Operator and ControlService |
| Model/account credentials and provider sessions | Existing PC-side services |

The initial avatar is a presentation of a teacher, not a new autonomous Citizen. Do not add a separate scene graph, world owner, simulation clock, resident memory database or credential path. Future Citizens can reuse the avatar component and select a different conversation controller.

## VRM catalog design

Begin with a versioned JSON manifest managed by ControlService, rather than adding a database server or vector database. Expose a bounded public catalog view and resolve private local sources only on the PC. Assets enter Matrix's existing immutable asset registry once validated. Add SQLite/search infrastructure later only if catalog size or editing workflows justify it.

Each entry needs:

- Stable catalog ID, record version, display name, description and thumbnail reference.
- Registry asset ID, exact asset hash, format and VRM specification version.
- Curated visual descriptors: style, apparent age range, hair, facial hair, clothing and costume/period tags. These describe the model, not an inferred identity or personality.
- Optional explicitly curated teacher matches, with a source and `exact`, `approximate` or `generic` representation label.
- Measured height, bounds, orientation, floor offset, allowed display scale range and a named performance profile.
- Actual available expressions and humanoid bones; idle/gesture capabilities validated separately from the VRM file.
- Byte size, materials, textures, draw-call/triangle measurements when available, supported runtime versions and device validation status.
- Original license metadata, provenance, attribution, modification/redistribution restrictions and reviewed use scope.
- Availability (`ready`, `missing`, `invalid`, `restricted`) and whether automatic selection is enabled.

An illustrative public entry, not an already registered asset:

```json
{
  "catalogId": "generic-scholar-01",
  "recordVersion": 1,
  "displayName": "Stylized scholar",
  "assetId": "<validated Matrix asset ID>",
  "assetSha256": "<validated SHA-256>",
  "vrmVersion": "1.0",
  "visualTags": ["stylized", "older-adult", "robe", "beard"],
  "teacherMatches": [],
  "representation": "generic",
  "capabilities": {"expressions": ["happy", "neutral"], "lipSync": true},
  "performanceProfile": "quest-single-professor-v1",
  "availability": "ready",
  "automaticSelection": true
}
```

Never treat an unmeasured model as Quest-approved. Initial capacity is one visible professor; choose additional-avatar budgets from device measurements, not file size alone.

### How AI selection works

1. Preserve an explicit learner-pinned avatar if it is still usable.
2. Prefer a curated matching teacher entry where one exists.
3. Build a shortlist from approved, available, compatible models using explicit visual/costume/style descriptors. Unknown historical appearance remains unknown; use a generic representation rather than inventing evidence from a name.
4. If useful, ask the existing teaching model to choose one ID from that shortlist. Return a concise reason and representation category. Do not request a download URL or generated executable code.
5. Validate the ID against the exact catalog version and permitted shortlist on the server. An invalid response selects a deterministic fallback; it never becomes a filesystem path or remote fetch.
6. Show the selected thumbnail and reason. Auto-selection may be applied within the learner's existing preference; manual preview, change and pin remain available.
7. Persist the selection. Do not rerank every turn, swap bodies during speech or silently change it when the catalog updates.

For example, a Leonardo teacher could receive an older bearded scholar avatar because those curated descriptors match available portrait references. A modern anime avatar may still be selected as a learner-chosen stand-in, but its label should say so. Appearance never changes School's teacher ID or assessed expertise.

Voice is selected separately. A visually similar avatar does not provide a historical voice, accent or voice-cloning permission. Initial voice options are supported provider voices or an explicitly configured existing local voice.

## Persistent binding and proposed API

These are proposed additions, not existing routes. Keep them within existing ControlService authentication and world/session authority.

- `GET /api/professor/avatars`: bounded public catalog, thumbnails, capabilities and availability; no PC paths or secrets.
- `POST /api/professor/avatar-selection`: teacher/profile version, catalog revision and allowed selection preferences; returns validated candidate IDs and a selection reason. It has no world mutation side effect.
- `POST /api/professor/bindings`: explicit create/update of a teacher-to-entity binding. Requires current world/session identity, existing write authority and an idempotency key. Returns the existing Matrix action/receipt shape.
- `GET /api/professor/bindings`: bindings visible to the current world/session.

Reuse existing asset and task endpoints where they already fit. Do not implement these as a competing store of world transforms.

A persisted binding contains a schema version, stable professor ID, School teacher ID/profile version, avatar catalog ID/version/hash, Matrix entity ID and representation label. World position/rotation/scale remain authoritative on the Matrix entity. School owns its session ID, objective, transcript and learner data; Matrix receives only the scoped identifiers and context needed for the current session. Never put a private learner transcript into a public world save.

Old worlds without the component load unchanged. Missing models preserve the binding and display a clear fallback; loading failure must not remove the professor entity, reset the world, or regenerate the teacher. Save a compatible previous appearance until an explicit replacement succeeds.

## Implementation milestones

### P0 — verify the existing candidate and prepare assets

Preserve the current dirty working trees and existing School archives, Matrix records, images and builds. Read the current owning issues/PRs before assigning implementation commits. This plan creates no issue, PR, branch, release or schedule. Use the existing Professor worktree if it remains suitable; resolve ownership deliberately without globally trusting arbitrary directories.

Verify the exact local service routes without starting duplicate services. Inventory current assets and read their metadata. Select one approved model and a fallback. Save baseline manifests and the affected world/School checkpoint before any later runtime mutation. Do not restart the live learner session merely to validate a prototype.

Deliverable: a source/runtime baseline, approved local asset manifest and a bounded first-candidate performance profile.

### P1 — one embodied professor with text dialogue

This is the first implementation increment.

1. Add VRM-aware inspection and immutable registration beside `web_assets.py`. Verify self-contained resources, format/version, bounds, hash, required humanoid structure, permitted extensions and bounded complexity. Keep existing GLB behavior unchanged.
2. Add a VRM renderer adapter, using a compatible pinned `@pixiv/three-vrm` version and Matrix's existing Three.js instance. Load through the existing asset lifecycle; update animation once per frame; dispose resources on removal/world change. Do not embed Riko's renderer or hardcoded scene/camera configuration.
3. Extend entity/component validation and compatible persistence for the professor binding. Place at the world floor using model bounds; apply a single scale conversion. Do not duplicate headset eye height or room origin offsets.
4. Attach existing School text conversation to the selected professor. Keep UI usable without XR DOM overlay by providing a minimal supported world-space control/fallback.
5. Support a neutral idle, gaze toward the learner where supported, and manually selected safe expressions. Unsupported expressions should fall back neutrally. Advanced navigation, outfit edits and gesture retargeting are deferred.

Done when: one avatar appears correctly in desktop and AR; selecting it opens the same School teacher/session; a text exchange updates the correct conversation; save/reopen retains teacher, entity and transform; unrelated world state remains unchanged. Actual Quest observations are required for the AR claim.

### P2 — small catalog, selection and manual override

Start with three to five approved models as they become available; catalog machinery can be validated with fixtures before obtaining all the real assets. Add thumbnails, tag editing, shortlist ranking, validated AI choice and pin/override controls. Keep automatic selection optional and consistent with the user's saved preference.

Done when: two distinct teacher requests can select appropriate permitted entries; the learner can override either; weak/no matches use a labeled fallback; malicious/unknown IDs and stale catalog revisions cannot load arbitrary files; asset replacement preserves the professor's identity and transform.

### P3 — live conversation attached to the professor

Implement a provider-neutral voice session contract: start/stop, streamed incoming audio, outgoing audio, transcript updates, interruption, status, error and final usage. Add one provider first, then the other. Select the provider at implementation time based on access and a live latency/cost check.

- Custom in-Matrix GPT-Live or Gemini Live uses the supported API integration and its separately configured credentials. No unsupported reuse of subscription tokens.
- Existing desktop account-based ChatGPT Voice remains an external control option, not evidence that its audio can be embedded in the Quest page.
- Preserve current text and push-to-talk paths as fallbacks.
- One microphone owner and one active voice session per learner/session. Route changes, repeated Start clicks and reconnects must not spawn duplicate listeners or overlapping responses.
- Feed native output audio into the avatar analyser and use the same playback clock for lip sync and subtitles. Interrupting clears queued speech and prevents old audio resuming.
- Keep teacher style and confirmed lesson context in the live prompt. School remains authoritative for assessment, saved progress and substantive lesson updates; the live model cannot independently mark mastery.
- Support a mute/stop control, explicit listening state, reconnect handling, session usage display and idle-session closure. Do not promise immunity to TV speech or background voices.

Done when: a learner starts conversation once, asks two questions and interrupts one answer in actual Quest AR; the professor resumes coherently without duplicate responses; transcript and assessment state remain associated with the correct teacher.

### P4 — conversation plus background exhibit work

Add a narrow application-owned task adapter, rather than granting unrestricted tools to the current School teaching process. A requested action creates a typed proposal containing task ID, teacher/session, lesson/objective, request revision and supported operation. ControlService resolves caller authority independently of model text.

Reuse current Professor/Operator image/build paths for their supported operations. Extend a separate typed path for the initial scale-exhibit recipe if needed. Keep current explicit execution controls as the default; voice confirmation can become an equivalent explicit action only when it is tested against existing permissions. A learner's “show me two cubes” can submit a bounded task when that action is already authorized.

Return a task handle immediately. Conversation can continue while the worker operates. Send concise progress and verified results back asynchronously; do not hold the live voice turn waiting for Blender or a full Operator completion. Track task revisions and ignore obsolete results. Stop speaking and cancel world work are distinct controls; confirm task cancellation before claiming it succeeded.

The voice model may say work has started after acceptance, but says an object exists only after the matching Matrix receipt and current observation. A demo/weather stub is never presented as verified external data. Repeated or reconnected requests must not create duplicate exhibits or builds.

Done when: the professor discusses a lesson while an exhibit task runs, reports its real result, revises the same exhibit and handles cancellation/failure honestly.

### P5 — persistence and reusable historical roster

Complete compatible save/restore of bindings and catalog selections. Reconnect School only after the correct world restore is acknowledged. Add more permitted models, teacher-specific curated matches and optional licensed outfit variants. Multiple independent professors, navigation, autonomous schedules and custom voice training remain later increments with their own budgets.

## Validation and measurements

Use focused tests for actual boundaries, not snapshot-only or implementation-mirroring tests:

- Asset inspection: valid VRM, unsupported version, external resources, malformed data, excessive complexity, missing bones and hash mismatch; original GLB regressions.
- Catalog selection: empty catalog, pinned model, exact curated match, weak match, invalid AI output, unavailable/restricted model and stale catalog revision.
- World lifecycle: stable IDs, compatible old saves, one avatar update per frame, replacement/removal disposal, retained transforms and no duplicate entity after retries.
- School binding: wrong teacher/session rejection, no progress changes from appearance updates, no stale transcript or result crossing sessions.
- Voice: one active session, permission denial, silent/noisy input, interrupted audio, disconnect/reconnect, provider failure and late callbacks after Stop.
- Background tasks: idempotent submission, concurrent conversation, failure, cancellation, result revision and matching observed receipt.

Run the existing affected WebRuntime/ControlService/School suites, School typecheck and production builds after each implementation slice. An unchanged planning document does not require runtime tests.

Record both software and headset evidence. Measure microphone end-to-first-audible speech, first useful answer, tool submission-to-first-visible world result, interruption-to-silence, frame time, draw calls, memory and reconnect behavior. Compare the same prompts and scene with/without the avatar. Do not use response-completion timestamps as speech-start measurements.

Targets for exploration, not acceptance promises: under one second from end of speech to initial voice response for a simple greeting; interruption playback stops within a perceptually short interval; the existing chosen Quest refresh rate remains stable. Establish numerical tolerances from baseline device tests before declaring them passed.

Use the existing `Validation/V1.2-Headset-Acceptance.md` for affected H05/H07/H08/H10 observations and exact candidate identities. Do not reset older findings or claim AR acceptance from desktop screenshots.

## Immediate handoff

Implement **P1 with the P2 manifest shape**, one approved avatar and a deterministic fallback. Keep School text conversation working first so asset, teacher binding and AR placement can be validated without a new paid provider. Then add live voice and asynchronous exhibit delegation as separate reviewable increments.

Before runtime implementation, refresh service ownership, current saves and owning issue status. Do not launch a second conversation process. No changes to existing worlds, running services, credentials or model/provider settings were performed while preparing this plan.

## Sources

- Current Matrix `AGENTS.md`, `VISION.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `Docs/Professor-Operator-Connection.md` and consolidated headset acceptance record.
- Current School `execplan.md`, `docs/MATRIX_INTEGRATION_RECOMMENDATION.md`, `src/school/personas.mjs` and existing School/Operator integration source. Older planning statements about missing image/build adapters are superseded by the inspected current adapter.
- [three-vrm loader documentation](https://pixiv.github.io/three-vrm/docs/modules/three-vrm).
- [VRM embedded permission metadata](https://vrm.dev/en/vrm/meta/license/).
- [GPT-Live conversation/delegation model](https://developers.openai.com/api/docs/guides/live).
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api).

These references explain capabilities and format metadata. They do not establish access to a particular API account, permission for a particular model, or a measured result on this Quest.
