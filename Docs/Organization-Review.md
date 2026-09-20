# Organization review and the next learning layer

Reviewed 20 September 2026. This document separates the public repositories' inspected baseline from the implementation added during this continuation. Source inspection establishes code and document contents; it does not establish a running deployment, educational efficacy, live model access or headset behavior.

## Repository roles

The organization API listed nine public repositories: seven application/site/Operator repositories, the research repository and the organization profile. All reported `archived: false`; the role descriptions below are architectural judgments, not GitHub archive flags.

| Repository and inspected commit | Role supported by its contents |
| --- | --- |
| [sota-v2](https://github.com/School-of-the-Ancients/sota-v2/tree/77b070d0f421746447a800580ada1cd44e32ec28) | Canonical text-first learning engine. Owns goals, quests, lesson state, assessment and progress. VR/Operator is a client over this engine. |
| [matrix-loading-operator](https://github.com/School-of-the-Ancients/matrix-loading-operator/tree/7eeb9b3be23fc0ed48a987d898d92fff1caae1b2) | Unity/MRUK room and bundled-prefab runtime, with a Python PC command/save service. The baseline proves a desktop scene-editing loop, but has no educational session. |
| [sota-beta](https://github.com/School-of-the-Ancients/sota-beta/tree/5bf4ba01c794b398b3121081c06dd3b6bf6684f4) | Earlier mentor/quest application, useful for conversation identity, saved transcripts and assessment record shapes. A reference for v2, not a second canonical engine. |
| [sota-v2-feature-creeped](https://github.com/School-of-the-Ancients/sota-v2-feature-creeped/tree/abd23ece86907e861481d719b8758afaa0a9e789) | Broad multimodal prototype with mock-first visual/Study Oracle features. Useful presentation vocabulary; its scope and provider patterns should not be imported wholesale. |
| [sota-alpha](https://github.com/School-of-the-Ancients/sota-alpha/tree/22a30b89dd32ecdf664a5b4a4c8a800cca6b51b6) | Small historical-persona chat with Vercel handlers and compact lesson nodes. Its older endpoint is not an existing v2 API or a vetted source service. |
| [school-of-the-ancients-vr](https://github.com/School-of-the-Ancients/school-of-the-ancients-vr/tree/8c4808e366f04a314e690ee16c91f3581687c1f5) | Horizon Worlds museum/NPC prototype. Prop-to-NPC interaction patterns are relevant; Horizon runtime APIs and unexported world assets are not Unity/MRUK components. |
| [School-of-the-Ancients.github.io](https://github.com/School-of-the-Ancients/School-of-the-Ancients.github.io/tree/cc7cc7b9d2d0a232ee7d16df54d9350bfe97e797) | Static public landing page. Its title says In Development and its links point to alpha, beta and VR alpha. These links are not evidence that those deployments or a learning backend work. |
| [research](https://github.com/School-of-the-Ancients/research/tree/34339194752555c7b5bb840cd3ac972349f9116f) | Educational rationale and successive product/technical specifications. Planning/reference material rather than executable product infrastructure. |
| [.github](https://github.com/School-of-the-Ancients/.github/tree/69b1d304a17976acd1c6549ab6feaa48049579e6) | Public organization profile describing the AI faculty, VR classroom and Operator vision. Aspirational positioning, not an implementation inventory. |

The canonical ownership decision is explicit in [v2 README lines 3-45 and 87-101](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/README.md#L3-L101) and [architecture lines 133-148](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/docs/ARCHITECTURE.md#L133-L148). The [site source](https://github.com/School-of-the-Ancients/School-of-the-Ancients.github.io/blob/cc7cc7b9d2d0a232ee7d16df54d9350bfe97e797/index.html#L6-L43) and [profile](https://github.com/School-of-the-Ancients/.github/blob/69b1d304a17976acd1c6549ab6feaa48049579e6/profile/README.md#L1-L13) remain separate public surfaces.

## Findings that determine the next step

### High priority: the baseline lacks a durable network boundary for lessons

v2 already has a real lesson state machine and services, but its inspected HTTP server exposes goal/curriculum forms and rendered routes, not lesson start/action/checkpoint/restore endpoints. Its default completed-session repository is an in-memory `Map`, so process restart loses those records. A Unity client cannot become a reliable learning client merely by pointing at an assumed API. Evidence: [server.ts lines 13-122](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/src/app/server.ts#L13-L122), [sessionsRepo.ts lines 8-65](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/src/lib/db/repositories/sessionsRepo.ts#L8-L65).

The baseline lesson route displays a fixed Big-O example and saved-session preview; its save link navigates to progress. That UI is not proof of an interactive, durable lesson backend. Evidence: [LessonRoute.ts lines 3-54](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/src/app/routes/LessonRoute.ts#L3-L54).

### High priority: preserve the assessment work that already exists

Assessment is not absent. v2 has quiz generation, structured rubric grading, targeted review and quest mastery logic. In particular, low-confidence grading is recorded for manual review and cannot pass the assessment. The missing integration/durability layer should not be described as a missing assessment engine, nor replaced with a Unity completion score. Evidence: [assessmentService.ts lines 58-217](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/src/features/assessment/assessmentService.ts#L58-L217) and [grading tests](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/tests/assessmentGradingService.test.ts).

The new authored activity records participation, reflection and a transform postcondition. It does not exercise live rubric grading, certify understanding or update mastery simply because the learner advances.

### High priority: restore learning and scene state together

The Operator baseline saves room/object/anchor/transform state, but not a lesson version, cursor, learner response or canonical checkpoint. Scene-only restore cannot recover what the learner was doing. The established protections remain valuable: settled saves, atomic file replacement, stable object IDs, strict room/anchor validation and reviewed command proposals. Evidence: [server.py](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/7eeb9b3be23fc0ed48a987d898d92fff1caae1b2/ControlService/server.py#L245-L335) and [SandboxWorld.cs](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/7eeb9b3be23fc0ed48a987d898d92fff1caae1b2/Assets/Sandbox/Runtime/SandboxWorld.cs#L243-L306).

The scene adapter must await acknowledgement and verify the captured object state before accepting practice or restoring a lesson checkpoint. A timeout after delivery has an uncertain outcome: it does not prove the runtime never executed the command. Retry receipts, revisions and reconciliation are therefore part of the integration contract, not merely UI details.

### High priority: maintain truthful mode and validation labels

The default v2 gateway is an echo/provider seam, not a configured live tutor. The Operator's offline language parser is not an AI model. A scripted lesson is not adaptive model-generated dialogue. A linked research source is not automatically a verified factual claim. Evidence: [serverGateway.ts](https://github.com/School-of-the-Ancients/sota-v2/blob/77b070d0f421746447a800580ada1cd44e32ec28/src/lib/ai/serverGateway.ts#L1-L12) and [Operator AI documentation](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/7eeb9b3be23fc0ed48a987d898d92fff1caae1b2/Docs/AI-Integration.md).

Native Quest delivery remains blocked by the documented Meta assembly quarantine, and no headset was connected during the review. A new lesson displayed in a desktop simulation does not validate MRUK, passthrough, controller use, tracking, headset readability or persistence across room recapture. See [Security-Block.md](Security-Block.md).

## Research grounding and provenance

The user-supplied *Ancient Educational Philosophies and a Modern AI-Era Framework* is byte-identical to the [research repository PDF at the pinned commit](https://github.com/School-of-the-Ancients/research/blob/34339194752555c7b5bb840cd3ac972349f9116f/Ancient%20Educational%20Philosophies%20and%20a%20Modern%20AI-Era%20Framework.pdf). Both SHA-256 hashes are `6F5F689883270D36178D5A00645B4BCA3BE729FA7B8A9BC120AAD0866B3F6F9A`. The PDF is linked as a reference, not copied into this software repository.

- Pages 9-10 motivate hints, application and hands-on observation.
- Pages 11-12 motivate evidence, reflection, source critique and iterative portfolios.
- Page 13 maps practical activities and resource-allocation scenarios to reflection.
- [Research README lines 83-110](https://github.com/School-of-the-Ancients/research/blob/34339194752555c7b5bb840cd3ac972349f9116f/readme.md#L83-L110) summarizes the question/action/reflection/evidence loop.

The newer canonical v2 pedagogy specifies **Explain + Example -> Guided Practice -> Socratic Check**, avoiding question-only teaching before a beginner has useful scaffolding. The new activity follows this sequence, then recap and end. This reconciles the research's inquiry principle with the current product direction instead of treating older planning documents as architectural instructions.

The PDF is a research synthesis/proposal, not a study validating this implementation. Its bibliography mixes primary works and secondary summaries. This review read the 16-page synthesis and visually checked the relevant pedagogical/assessment pages; it did not verify every historical statement, quotation or external citation, or audit every page of the much larger technical specifications. No claim of historical authenticity, educational efficacy or content relicensing follows from the review.

## Implemented layer in this continuation

The chosen slice places educational authority in **sota-v2** and keeps **Python/Unity as a thin guided-lesson adapter**:

1. v2 provides a versioned local Operator API and durable sessions, checkpoints, revision checks and mutation receipts, reusing its lesson runtime. It owns the authored lesson and mentor/prompt versions.
2. Python binds a lesson to an explicitly selected current room/anchor/prop, forwards learner actions to v2, and couples settled scene saves/restores to canonical checkpoints. It does not create a competing curriculum, mastery or learner-wiki authority.
3. Unity retains scene authority and receives bounded read-only lesson presentation for desktop and Quest HUDs. Lesson text does not authorize executable scripts or new assets.
4. The bundled **Observation and Scale** activity asks for a prediction, demonstrates scaling, requires doubling all three starting scale values, requests evidence and reflection, and preserves the record. The rectangular-block volume comparison is an authored derivation, `2 x 2 x 2 = 8`, with an explicit geometry-only scope. No historical character or model access is invented.

This is a local single-operator integration, not the full school platform or a new cloud deployment. Voice, multiplayer, RAG ingestion, historical avatars, downloaded catalogs, LMS integrations and learner-wiki expansion remain outside the slice.

## Validation boundary

The new API/adapter/HUD integration now has separate [learning-layer validation](../Validation/Learning-Validation.md): 99 core tests, 76 PC tests, 80 Unity core checks, 7 guide checks, a fresh isolated Windows build, and 25 real Node/Python/Unity loop checks including service restart. Existing prototype results remain identified as baseline evidence.

Acceptance for the new slice requires the canonical API, Python bridge and actual Unity desktop player to complete prediction -> practice -> evidence -> reflection -> save -> clear -> restore, preserving object/session/lesson IDs and the next prompt. Failure cases include stale revisions, repeated mutations, pending commands, unavailable runtime, incompatible rooms and corrupt checkpoints. Native headset and live-model validation remain separate. Consult the current runbook, progress log and validation report for the subsequently executed results.
