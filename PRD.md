# Matrix — Three.js/WebXR sandbox

Product description agreed September 26, 2026. [Vision and 2023/2024 roots](VISION.md) · [Implementation plan](IMPLEMENTATION_PLAN.md) · [Project map](PROJECTS.md) · [Agent instructions](AGENTS.md)

> **A Three.js/WebXR sandbox. Start blank or load an existing world. Ask Operator to create and change things around you. Save it and return. Some worlds have AI citizens.**

The Matrix-inspired **White Room is the blank-canvas/loading idea, not a required Unity prefab, scene or separate editing location**. Both starting paths use the same sandbox. Operator can edit an existing world under its permissions; creation does not require entering a holodeck. Ready Player One and The Matrix are inspiration, not additional runtime dependencies.

**Continue the existing implementation. No engine rebuild, project restart, replacement repository, live-world reset or service restart is requested by this clarification.**

The current controlling feature is [#122 — Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122). Its detailed acceptance is not weakened by this summary. The selected Creator Mode queue supersedes earlier Citizens-first or indefinite desktop-first directions without discarding code, invalidating evidence or claiming new features are complete.

## Product and audience

Creators ask Operator to make or change their surroundings; players explore and use the results. Some worlds are persistent inhabited environments, while others are games, exhibits, experiments or uninhabited scenes. AI citizens are supported inhabitants where that capability is enabled, not a requirement for every world.

For a student/demonstrator, a request should become something visible and usable rather than only an explanation, static slide or attractive mesh. For a creator, the same world remains editable through conversation. For a learner/player, interactions have observable consequences and understandable feedback.

Classrooms, exhibits, workshops, games and imagined environments are examples, not a fixed list of templates. Education is an important near-term proving ground for the broader sandbox. Everyday AR glasses are a long-term target as suitable devices become available. Develop with existing hardware and retain browser/text access; do not make new hardware, a global world or an autonomous society prerequisites.

## Defining user journey

1. Enter the existing `/web/` application through desktop, VR or AR. Start with a blank world or load a compatible existing world. Invoke Operator and enter authorized Creator Mode in that world; no Unity asset or separate creation room is required. AR alignment/readiness remains explicit.
2. Say “load/create …” with selection/pointing context. The PC agent composes a usable environment or changes the loaded one, reusing capabilities/assets or generating them procedurally. Use Blender when richer authoring is useful, not as a mandatory path for every object.
3. Inspect the result and the available controls/actions. Review consequential changes through the existing authority/approval flow. Report pending, rejected, applied and observed outcomes distinctly.
4. Enter Play/Test in the same world. Grab/use objects, operate an experiment, test a prediction or complete a concrete objective. Displays and feedback reflect the actual shared state.
5. Return to Creator Mode and request a change. Preserve compatible object identities, manual edits and progress, including supported citizen state. Explicit reset is a separate action; do not quietly reconstruct the world from chat.
6. Save, reopen and resume the declared supported experience state. Missing dependencies, interrupted generation or lost AR tracking must preserve saved data and offer recovery.

Natural voice is part of immersive acceptance. Text is a fallback and desktop is both an access surface and the development/regression harness. Normal supported configuration should not require removing the headset; broad executable-code approval may still require the existing explicit PC handoff. Do not weaken approvals to hide that limitation.

## First complete demonstration

Use #122's small **physics playground/classroom**: a ramp or shaped surface, movable objects, usable controls, a live results/progress display and one executable objective. Prove repeated grab → release → resumed physics, object/world and object/object contact, real progress and a real consequence. A falling animation or narrated quest is not sufficient.

Also demonstrate a different interactive exhibit/experiment using the same world/state/tool path, reusing the [Scale Experiment](Docs/Scale-Experiment.md) where suitable. At least one parameter revision must genuinely regenerate shaped geometry rather than only scale a baked mesh. A second experience should demonstrate that new reusable capabilities can be added through ordinary reviewed development, not just selected from a fixed menu.

The learner should be able to change an input, observe a result and ask about it. Show units, assumptions and simplifications; check equations/models independently. An engaging explanation alone does not establish scientific accuracy. A historical mentor is a labeled simulation, with sourced facts separated from invented dialogue. Mentor pedagogy and learner records remain School responsibilities.

The September 26 priority change started Citizens development at `/web/citizens.html`, an isolated page that reuses WebRuntime/MatrixWorld code but keeps its world and browser storage separate from the main `/web/` Agent Portal. Unfinished M4 wearer checks stay open and can be resumed separately; they are not prerequisites for a desktop simulation. A browser result does not count as Quest acceptance.

Stacked PR #101 adds an opt-in Citizens panel to the ordinary `/web/` desktop virtual room. Its original **Start here** fixture starts only on an empty floor, reuses the same Matrix world execution and view, and saves versioned simulation state with the existing browser/manual/PC world checkpoints. Version 2 scene/game worlds still load. The #19 candidates strengthen fair shared-object reservations and add one bilateral social session with explicit outcomes and a local MatrixWorld receipt before relationship benefit. The #15 candidates add a separate opt-in path for one selected, existing built-in chair or table in a nonempty scene: it preserves scene objects, adds two orb residents, and uses bounded movement and observed interaction outcomes. They refuse unsupported or blocked geometry, active games, and incompatible selection. The `codex/citizens-route-recovery` branch adds changed static-geometry replanning for individual activity travel with at most three blocked-route retry ticks, preserving the execution and any station claim until recovery or explicit failure. A built `/web/` browser trace verified a moved-wall detour, temporary recovery, persistent failure, and checkpoint/reload with nested Citizens v5 state; see the [evidence](Validation/citizens-route-recovery-browser.json). The `codex/citizens-affordances` candidate extends that same selected-object path to one reviewed static GLB with a versioned descriptor, measured approach/use poses, a bounded need effect and nested Citizens v6 checkpoint. The [browser record](Validation/citizens-authored-seat-browser.json) shows two residents sharing that GLB through save/reload/PC restore. Animated or moving interactions, social-session route recovery, full #15 acceptance, multi-resource execution, and Quest budgets remain open. See the [shared-world runbook](Docs/Citizens-Shared-World.md).

The following `codex/citizens-dual-stations` candidate adds a complementary reviewed rest or eat station to an already paused Citizens world. A second original static GLB food table uses the same registration, object-level descriptor, Matrix receipt, and world checkpoint contracts; no second simulation is created. A seed-29 [desktop browser run](Validation/citizens-dual-stations-browser.json) observed both need effects and a completed social outcome in one saved four-object world, then replayed that outcome from a named PC checkpoint. This does not add simultaneous multi-resource acquisition, moving or animated interaction ownership, or Quest wearer evidence.

The current `codex/citizens-social-choice` candidate makes conversation a need-driven option in that same world. Social deficit, conversation preference and travel compete with a resident's legal individual activity, while a reachable critical-hunger food choice still wins. An invitation or response alone grants no benefit: only a matching Matrix converse receipt raises both social needs and the relationship. Nested Citizens v9 persists this choice and migrates valid v1–v8 states; the outer world envelope stays v3. The [desktop replay](Validation/citizens-social-need-browser.json) used both reviewed GLBs, named PC offered/ended checkpoints, browser reload and exact minute-78 to minute-91 Step replay with one observed converse receipt. This advances R8 and [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) without completing broader appointments, moving interactions, a city simulation, or independent M4 Quest wearer acceptance.

The `codex/citizens-routine-editor` candidate adds paused-only editing of an existing resident's daily window and priority to the same `/web/` world. Current activities, reservations, FIFO waits, social sessions, resident IDs and Matrix object IDs remain in place; the change affects the next idle choice. Browser save and named PC checkpoints retain the edited v9 routines without a new schema or service. The [seed-29 desktop replay](Validation/citizens-routine-editor-browser.json) kept Ada's chair claim and Bo's wait through the edit, then showed Ada select the edited meal at minute 19 and complete its observed food interaction at minute 36. Browser reload and exact named-checkpoint replay verified persistence. That routine-only slice predates the bounded appointment contract below; broader interruptible schedules remain open under #17.

The `codex/citizens-appointments` candidate adds one-shot `rest`/`eat` appointments to the existing two-resident Matrix world. Paused desktop authoring uses absolute simulated start and inclusive completion-deadline ticks, an existing bound station, and a maximum of three saved appointments per resident. At the next idle choice, due appointments take earliest-deadline order ahead of optional routines; reachable critical hunger can override a rest appointment. No in-flight travel, station use/egress, FIFO wait or social session is preempted. The inspector distinguishes pending, queued, started, receipt-backed completed and deadline-missed outcomes. An appointment misses at deadline+1 without an earned appointment result; any underlying action continues under normal Matrix receipt rules, and a late need effect cannot retroactively complete it. Step and 1×/4×/16× speeds advance sequential ticks. Nested Citizens v10 migrates valid v9 worlds with empty appointment lists and persists through the unchanged outer v3 browser/PC world envelope. [The built-browser replay](Validation/citizens-appointments-browser.json) observed Bo miss an eat deadline while queued for the chair and Ada complete a later food appointment with an exact Matrix receipt, then reproduced the minute-36 world payload from a named PC checkpoint. This first nonpreemptive deadline policy does not finish the larger [#17](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/17) scheduling vision or M4 Quest wearer acceptance. See the [shared-world runbook](Docs/Citizens-Shared-World.md).

The `codex/citizens-appointment-revision` candidate adds paused, stale-checked revision and cancellation of still-pending appointments in that same world. Overlapping windows are shown as advisories for the same resident or a shared station; earliest-deadline selection, FIFO contention, and nonpreemption remain the execution policy. Nested Citizens v11 retains three open and three recent terminal appointments per resident, prunes older terminal history deterministically, and increments resident-local IDs so repeated scheduling can continue. Existing valid v10 worlds migrate while the outer v3 save and receipt authority stay in place. [The desktop replay](Validation/citizens-appointment-revision-browser.json) observed a revised deadline, advisory overlap, missed and receipt-backed outcomes, cancellation, repeated booking after three outcomes, and exact named-checkpoint replay. More general interruptible planning and Quest wearer acceptance remain open.

## Keep the architecture we already have

| Part | Existing home | Responsibility |
| --- | --- | --- |
| Web experience | `WebRuntime/` | HTML/Three.js/WebXR input and views, current world execution/state and reusable experience modules |
| PC gateway/tools | `ControlService/` | Existing Agent Portal/session backend, Matrix tools, validation, catalogs, commands and receipts |
| Asset authoring | Procedural modules, current catalog, PC Blender/configured tools | Create/reuse/revise content through existing validation and identity contracts; preserve editable source |
| School | Separate School repositories | Curriculum, mentors, assessment, learner records and optional scoped Matrix integration |
| Citizens | Existing simulation candidates and fixtures | Resident decisions and supported simulation state, not a second world executor or privileged Operator |

These are responsibilities, not new services. Preserve the existing state owners, API boundaries and [module ownership reference](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/MODULES.md). `/web/` remains the current client; `/` and native Unity builds remain supported for their own workflows. Referenced Citizens candidates have separate review/merge status.

**White Room is inspiration, not an engine dependency, prefab identity or required place.** Keep shared HTML/Three.js/WebXR views and agent operations on the same tested state transitions. Creator/Play authority is independent of desktop/VR/AR presentation.

## Current AI Citizens journey

1. Open a small desktop Three.js world with one visible resident and simple existing props. Observe changing needs, available activities, selected goal, movement, interaction and the resulting state change.
2. Read the resident's current activity, needs and decision/action log. Pause and resume the simulation; repeat a seeded scenario to diagnose the same decisions and outcomes.
3. Add a second resident sharing the world and objects. Show different choices and one capacity-limited interaction, such as competing for a seat. A failed, cancelled or occupied action must not grant an unobserved benefit.
4. On the ordinary `/web/` desktop virtual floor, optionally select an existing built-in chair/table or a registered static GLB with a reviewed rest/eat definition and start Citizens without replacing the user's scene. Pause and add a complementary reviewed station to the same world when available. Add only the two resident orbs, show blocked or unsupported choices, and grant a need benefit only after an observed MatrixWorld outcome. When static geometry changes during travel, replan from the observed pose; let a brief blockage clear within a bounded retry window or fail and release the claim explicitly.
5. Save and reopen the supported simulation. Restore resident identities, needs, relevant world objects and valid intent without replaying a stale success. Report missing or incompatible dependencies without overwriting the current world.
6. While paused on the desktop floor, edit one resident's existing daily window and priority. Show the active activity continuing, the edited window in the inspector, and the changed next idle choice. Save, reload and restore the edit with existing browser and PC world checkpoints.

Use [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) and its linked issues for the detailed acceptance. Build only missing prerequisites needed by this example. Basic activity continues without an LLM request per frame. Richer character authoring and ComfyUI-to-Blender assets are optional follow-ups.

## Requirements and evidence

Existing R1–R8 identifiers are retained; R8 is a preserved application lane, not the default work priority. The additional requirements summarize #122 without replacing its detailed cases.

| ID | Requirement | Acceptance |
| --- | --- | --- |
| R1 | One useful agent session | Voice/text follow-up, reconnect, approvals/denial and Stop preserve the intended conversation and world. Provider errors do not silently reset either. |
| R2 | Grounded world edits | Select/point at the intended entity, inspect current capabilities, reject stale state and verify runtime receipt/result before claiming completion. |
| R3 | Real creation and revision | Preserve the existing scratch Blender create/revise/export/register/place path and editable source. Procedural and reused content are equally valid complementary paths; explicit replacement preserves or intentionally migrates identity. |
| R4 | Reusable interactions | Human input and agent actions use the same supported behaviors and observed outcomes. Missing capabilities are ordinary reviewed modules, not invented one-off commands. |
| R5 | Honest saving | Preserve versioned authored recipes/dependencies and supported world/game/component state through browser and PC restore. Label scene-only backups separately. Missing assets/tracking preserve data rather than silently replacing the world. |
| R6 | Shared interactive experiment | HTML, Three.js, agent controls and the tested immersive display bind one state/math implementation; controls change real state and results are checked. A separate HTML-only view does not complete immersive acceptance. |
| R7 | Independent School | A School lesson remains useful without Matrix; integration uses scoped actions and observations. Curriculum and private learner records are not moved into Matrix. |
| R8 | Preserved small Citizens simulation | Keep the existing two-resident choices, finite interactions, contention, logs, pause/save/reopen and seeded replay contracts. Failed/uncertain actions do not earn benefits. Broader autonomy is separately selected. |
| R9 | Immersive Creator ↔ Play/Test | Usable voice, contextual selection, feedback, in-world controls, explicit authority, Stop/Pause and return-to-creator work in the same world. Record VR and AR observations independently. |
| R10 | Fast, editable world composition | Compose procedural geometry, reused/Blender assets and supported behaviors without a mandatory Blender round trip. Preserve source/version/parameters/seed and identity, expose inspectable entities/actions, and measure time to a usable result. |
| R11 | Real physics and objective execution | Implement the scoped bodies/colliders/held-object policy and repeated-release regression in #122. An objective progresses from verified events, has a real consequence, and cannot double-count contact/reconnect or silently change accepted rules. |
| R12 | Demonstrated extensibility and safe revision | Build/test/expose a missing reusable capability for a second experience. Keep deployment explicit, guard budgets and stale/duplicate work, preserve unrelated entities/manual edits/progress, and roll back failed changes. |

#122 also retains its settled and moving-body checkpoint cases, resource budgets, mode-specific display/controls, agent discovery, geometry regeneration and revision compatibility. Do not mark the whole feature complete from one happy-path room. Start/load are product entry paths, not an instruction to add a separate launcher or world-service architecture during this documentation change.

## Creation paths, not another engine

**Configure what is available:** use existing validated runtime modules, direct procedural generators, registered assets, components, named clips, physics adapters and game/experiment actions that are actually supported on the connected runtime.

**Build what is missing:** Codex edits normal repository modules, runs tests/builds and uses the existing approval/deployment path. A controlled reload/reconnect is acceptable initially with preserved state and honest feedback. This is ordinary feature development, not a project restart, a promise of instant arbitrary mechanics, or permission for prompt/asset-supplied `eval` or unreviewed executable code.

**Refine content when useful:** catalogs and Blender can supply richer models, materials, rigs and animation. Check licensing, scale, bounds, performance and compatibility; visual detail must not silently break colliders, interactions or save references. Do not finish a universal catalog before demonstrating the first loop.

Optional concept imagery under #91 supplies visual direction to existing authoring methods. It is not required for loading or creating a world. Keep those resource inputs distinct from current milestone requirements.

## World revision, physics and persistence

Use stable experience/entity IDs and one owner for each changing transform. Coordinate authored changes, animation, grabbing and physics. Preserve compatible bindings and progress; use an explicit migration or clear reset when a rule/shape change is incompatible. Generation must not silently clear a live world or overwrite manual edits.

Save a consistent supported snapshot of generator inputs/versions, assets, poses, physics configuration and declared motion state, interactions, displays and objective progress. Record unsupported solver/playback state and restore tolerance; do not promise cross-platform bit-identical physics. Keep browser/PC validators and old-save compatibility aligned. Authoring undo is not a rewind of unrelated gameplay or Citizens time.

In AR, virtual-floor content is not automatically aligned to a physical floor or table. Use existing tracking/alignment/recovery guards and disclose unsupported physical placement. Pausing affected activity on origin loss is preferable to silently recentering the scene.

## Access, data, and resources

Keep Codex/GitHub/Blender/provider credentials and privileged execution on the PC. Retain owner-configured approvals, sandbox/workspace policy and scoped caller authority; browser Creator Mode, a learner, resident or future upgrader cannot self-escalate. Preserve private room imagery and learner data outside public evidence and world exports.

Keep local Codex sign-in, the existing `AgentSessionBackend` and tested transport. Matrix MCP and the agent transport are distinct interfaces. Record actual installed/tested versions; verify current API/access/cost/license before changing a provider. Do not promise unlimited inference or API credits. Use scratch authoring sources and explicit overwrite/replacement decisions.

Existing [creation resources](RESOURCES.md), [content catalogs](Docs/Content-Catalogs.md), [runtime package notes](Docs/WebXR-Runtime-Packages.md) and [Blender tiers](WebRuntime/BLENDER_AUTHORING_TIERS.md) remain references. Additional providers, ComfyUI mockups, voices, fleet workers and device integrations are optional inputs, not prerequisites for every demo.

## Later roadmap — dynamic world improvement and larger worlds

The [dynamic upgrader](VISION.md#later-dynamic-world-improvement) is **deferred**. A future owner-enabled agent may review visuals and actual world use, improve assets/layout/interactions/performance via Blender or catalogs, then verify and keep/revert changes. It must preserve identity, user intent, manual edits and play/lesson/resident state; reject stale work; respect permissions, resource/license budgets and rollback. It is not just automatic mesh beautification, and no overnight scheduler is requested for the current slice.

Richer residents, citizen-authored worlds/quests, multiplayer, persistent geography, larger societies, #125 portals and everyday AR deployment remain independent extensions. Preserve their issues and working foundations without making them prerequisites for a local creation-and-learning demo.

No new microservices, distributed job system, broad orchestration framework, universal scripting language, plugin marketplace, mass repository move or new headset purchase is required. **Scoped physics and immersive interaction remain in scope under #122**; their actual acceptance remains evidence-based.

## Implementation status is separate from this PRD

Before this documentation merge, the reviewed `main` was `0cb8c23` after #99; the separately reviewed open Citizens stack reached #123 at `25cde85`. This documentation-only change does not merge that runtime stack or reveal unpushed Creator Mode work. Neither source state identifies the running service. Existing desktop and selected Quest evidence remains in [Current Checkpoint](Docs/Current-Checkpoint.md), [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md), feature runbooks and `Validation/`.

The Citizens candidate evidence remains in the [pinned checkpoint](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/Docs/Current-Checkpoint.md), [prior PRD](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/PRD.md) and [prior plan](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/IMPLEMENTATION_PLAN.md). Historical “current priority” or “next” language there is not the active queue. This documentation update changes no runtime, test result or device-acceptance record.
