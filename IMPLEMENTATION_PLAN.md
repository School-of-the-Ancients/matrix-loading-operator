# Matrix implementation plan

Updated September 26, 2026. **Continue the small, persistent AI Citizens simulation in the existing Three.js/MatrixWorld world.** The isolated desktop fixture, opt-in `/web/` shared world, bounded route recovery and up to two reviewed static GLB interactions are the current stacked candidates. This supersedes the earlier M4-first work queue. Keep every unfinished mode-specific M4 headset check open; wearer-dependent acceptance does not block independent simulation work. Complete a tested slice before expanding scope.

[PRD](PRD.md) · [Project map](PROJECTS.md) · [School build plan](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/BUILD_PLAN.md)

This is the current work-selection guide, not a replacement for detailed issue acceptance. Existing issue histories, source links, and validation remain intact. A step can finish without closing its broader umbrella issue. No GitHub board statuses are changed by this document.

## Progress at the merged Web stack

The original baseline below describes `main` at `509a72a` before these slices.
The source through [PR #98](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/98)
merged at `2f6554c`; [PR #99](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/99)
then merged checkpoint documentation at `0cb8c23`. Use the [project map](PROJECTS.md) to choose the
current Web track versus the original Unity, Matrix World, or AI Citizens
work. Post-merge validation passed 643 ControlService Python tests, 141
WebRuntime Node tests, and the Vite build. At this snapshot,
[`v0.7.0-preview.1`](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.7.0-preview.1)
tags that `0cb8c23` checkpoint; it predates the Citizens candidate.

| Step | Merged evidence | Remaining distinction |
| --- | --- | --- |
| M0 desktop loop | Persistent Agent Portal, selected-object context, typed Matrix tools and runtime receipts were exercised in desktop and later Quest runs. | An umbrella issue may retain broader acceptance. |
| M1 Blender | [Copper Astrolabe desktop MCP trace](Validation/WebRuntime-Blender-MCP-M1-2026-09-25.md) with revision, GLB registration, placement receipt and browser rendering (#87). | Quest authoring and placed-asset replacement identity were not established by that trace. |
| M2 world | [PC whole-world checkpoint](ControlService/WORLD_CHECKPOINTS.md) (#88) and [physics/checkpoint integration](Validation/WebRuntime-Physics-Checkpoint-Integration-2026-09-25.md) (#94). | Browser room-origin recovery and physical-plane state need separate Quest checks. |
| M3 shared experiment | [Reviewed Block Scale Lab](Docs/Scale-Experiment.md) (#92) and desktop equivalence tests. | School bridge consumption and complete multi-surface acceptance remain separate. |
| M4 immersive | Quest VR Agent voice, spawn, animation, revision, save/reopen, same-thread continuation, CODEX paging and WORLD save feedback have wearer evidence. The [AR Agent journey](Validation/WebRuntime-AR-World-Transition-2026-09-26.md) exercised voice creation/revision, grab and save/reopen on merged main. [Panel recall](Validation/WebRuntime-M4-Panel-Recall-2026-09-26.md) (#97) worked for the wearer in VR and AR; the initial [VR-to-AR preview fix](Validation/WebRuntime-AR-World-Transition-2026-09-26.md#candidate-fix-vr-world-previews-in-ar) (#98) showed the same animated Dragon in both modes. | Reviewed approval/denial, Stop, panel text readability and active-turn/page survival, saved-origin recovery and physical-surface checks remain open in the [Quest acceptance matrix](WebRuntime/QUEST3_ACCEPTANCE.md). The final #98 provenance refinements have automated coverage but no wearer retest. |
| Follow-up capabilities | [Virtual-floor GLB drop](Docs/Web-Floor-Physics.md) (#93) and [typed existing-object rotation](Validation/WebRuntime-Typed-Rotation-2026-09-26.md) (#95), including a Quest VR Agent voice/rotation receipt. | These are bounded mechanics, not general rigid-body physics; AR rotation and broader interaction remain separate checks. |

The current implementation priority is the [AI Citizens roadmap #29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29).
[PR #100](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/100)
adds a seeded two-resident fixture at `/web/citizens.html`.
Stacked [PR #101](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/101)
adds the explicit **Start here** control to the ordinary `/web/` desktop virtual
room and persists Citizens with its existing browser and PC world checkpoints.
Both PRs remain open. The [shared-world runbook](Docs/Citizens-Shared-World.md)
records real browser evidence for need changes, observed rest/eat outcomes,
chair contention, pause/step, save/reopen, PC restore, and service restart.
The original **Start here** path remains a fixed two-resident scenario on an
empty virtual floor; the isolated page remains useful for reproducible debugging.
The current [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15)
candidate adds an explicit selected built-in chair/table path in `/web/` that
keeps existing scene objects and spawns only the two orb residents in open
[PR #104](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/104).

The current [#19](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/19)
candidate strengthens capacity-one reservation lifecycles with execution identities,
bounded leases, deterministic fair waiting, and cleanup after actor or resource
removal. Surviving residents continue in Chrome after live deletion, and
versioned browser/PC saves restore the same event order. Stacked
[PR #103](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/103)
adds a bounded two-resident invitation, seeded accept/decline/timeout
outcomes, and a relationship change only after a checked MatrixWorld receipt.
The selected-furniture candidate binds one existing chair or table as a
capacity-one station, checks bounded virtual-floor paths and refuses unsupported
or blocked geometry. An active game must finish or be removed first. Citizens
selects intentions; Matrix validates finite world actions and reports receipts.
The stacked [PR #106](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/106)
candidate on `codex/citizens-glb-readiness` adds actual renderer
verification before catalog bounds of a registered GLB can enter that bounded
route check, and pauses Citizens if the verification becomes unavailable.
Its [desktop browser record](Validation/citizens-glb-readiness-browser.json)
includes a mismatched catalog refusal and a saved two-resident chair queue
that replays after reload and PC restore. The current
`codex/citizens-route-recovery` branch then tracks changed navigation geometry,
replans active individual travel from the observed pose, and permits three blocked-route
retry ticks before failing the execution and releasing its claim. A cleared
route can finish the same execution. Its [isolated `/web/` browser record](Validation/citizens-route-recovery-browser.json)
shows Ada's detour around a moved wall, Bo's temporary blocked route and
completion after the wall moved away, and a restored checkpoint that fails
without a rest benefit when the wall stays. Nested Citizens v5 saves the retry
count and geometry identity; valid v4 browser states migrate, while older PC
checkpoint files are read without rewriting. WebRuntime passed **257/257**
tests, ControlService **674/674**, and Vite built for that route-recovery candidate.
The following `codex/citizens-affordances` candidate binds one reviewed registered
static GLB as a capacity-one rest/eat station in the same `/web/` world. The
descriptor records its asset hash, local approach/use poses, finite duration
and bounded need effect. The PC validates/queues typed set or remove commands;
the renderer, MatrixWorld receipt and Citizens reservation/benefit path remain
separate. A seed-29 browser run with an original static chair showed Ada and Bo
using the same seat, restart readiness gating and named PC checkpoint replay.
See [browser evidence](Validation/citizens-authored-seat-browser.json) and the
[runbook](Docs/Citizens-Shared-World.md). Nested Citizens v6 saves the station
definition while the outer world envelope remains v3. This candidate passed
WebRuntime **276/276**, ControlService **681/681**, and the Vite build.
The next `codex/citizens-dual-stations` candidate lets the user pause that same
world and bind one complementary reviewed static station without resetting the
two residents, clock, needs, claims or social history. An original registered
food-table GLB advertises `hunger +32` beside the chair's `energy +22`.
An [isolated desktop browser trace](Validation/citizens-dual-stations-browser.json)
observed both eat and rest decisions, a completed social session at minute 96,
and a named minute-123 checkpoint with both GLB dependencies. Restoring the
minute-1 checkpoint and stepping replayed the same social end. The
[runbook](Docs/Citizens-Shared-World.md) gives the exact asset hashes and
paused add flow. The selected built-in station retains its approach when a
second station is attached, while the old fixed fixture keeps its route rule.
This candidate passed WebRuntime **282/282**, ControlService **682/682**,
Python compilation and the Vite build. A chair route failed after its bounded
retries during the browser run; later observed need and social outcomes still
completed. Simultaneous multi-resource acquisition, animated or moving
interactions, social-session route recovery, full #15 acceptance, and Quest
wear checks remain open.

The `codex/citizens-catalog-recovery` candidate addresses a restart gap
for those authored GLBs. If the browser's newest saved world references a
`web:` asset absent from the current catalog, `/web/` keeps that save pending,
reports the missing IDs, and waits for the matching catalog before ordinary
scene/game/Citizens validation. It does not substitute an older or empty world
or rewrite the saved copy while waiting. It also rejects old queued commands
on the first exchange after recovery so an uncertain pre-reload effect cannot
be applied twice. [An isolated browser catalog-outage/recovery run](Validation/citizens-catalog-recovery-browser.json)
restored the two rendered GLBs, exact four object IDs, minute-123 Citizens
state, chair claim and relationship 55 after the catalog returned; a further
browser reload kept them. Focused scene-store tests passed **34/34**, the full
WebRuntime suite **288/288**, ControlService **682/682**, and Vite built.
Neither browser nor PC checkpoints contain GLB bytes. A bounded
rejected-station browser edit and the minute-82 occupied-approach handoff
remain useful #15/#19 follow-ups; [#17](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/17)
virtual-day schedules are the next resident-autonomy layer after these
runtime handoffs are stable.

No simulated resident gets the Operator's shell credentials
or permission to run fleet jobs. Richer rigs, ComfyUI/Blender authoring, GOAP,
general behavior programs, and an LLM call per frame are not prerequisites.

M4 remains an independent acceptance track. Its next device slice still uses
an isolated Quest service/scene for reviewed approval/denial or Stop, followed
by room-origin recovery on a disposable AR world. The AR Agent creation loop
and panel recall already have wearer evidence, but recovery, readability,
physical-surface checks, and the final #98 provenance refinements do not.
Record desktop simulation evidence and Quest wearer evidence separately; a
desktop Citizens pass does not close an M4 check.

## Delivery decision — desktop first, immersive UI later

The user reports that Matrix partly works but its current AR/VR UI is poor. The chosen response is **not** to redesign the headset UI first: finish the core workflow in the ordinary desktop browser, then adapt its controls and presentation for VR/AR.

M0–M3 use the existing `/web/` Three.js application with mouse/keyboard and normal HTML controls, without entering an immersive session. Keep the same world, agent, assets, validation and persistence; do not build a separate desktop engine. Fix desktop usability where it blocks the workflow. Voice is optional for desktop acceptance.

The earlier “get everything working” target meant a reliable create → revise → interact → save/reopen loop and one reusable experiment, rather than every catalog, citizen, city or future feature. The Citizens fixture reuses desktop runtime code on a separate page, and PR #101 also integrates its bounded simulation into the main `/web/` desktop world. Existing XR paths and safety checks stay intact; immersive UI and wearer acceptance remain tracked in M4. Desktop passes do not close outstanding headset criteria in the parent issues.

## Reviewed baseline — do not rebuild it

Snapshot: Matrix main [`509a72a`](https://github.com/School-of-the-Ancients/matrix-loading-operator/commit/509a72a344faa8e2cc63c12b67a6b08d140c43ce), after PR #80.

| Already present | Source and remaining distinction |
| --- | --- |
| Three.js/WebXR, GLB loading, input, local speech, room origin and browser persistence | PRs #45–#49. Earlier Quest AR/primitive-robot and same-position reopen evidence exists; that does not establish every later feature. |
| Game/scene saves, storage and room recovery, footprint checks, optional camera probe | PRs #51–#58. Later hardware checks remain; camera and virtual images are not a calibrated composite. |
| PC Codex transport, replaceable session backend, durable mapping, portal, spatial context, MCP and approvals | PRs #60–#69 and #76. Extend these instead of building another agent or gateway. |
| Numeric components, GLB animation and selection bindings | PRs #70–#73 and #75. These are specific bounded capabilities, not arbitrary scripting or complete NPC behavior. |
| Dragon/skiff assets and ready-AR virtual-floor tool support | PRs #77–#79. The dragon has desktop evidence; richer Blender MCP and final Quest creation acceptance are still incomplete. |
| Client pairing, reviewed placement/scale and model proposals | PRs #34, #36, #37. Reuse for School; previous Unity/fixture evidence is not WebXR acceptance. |

PR descriptions and [WebRuntime documentation](WebRuntime/README.md) are evidence references, not tests rerun during this planning review. Refresh main/open PRs before coding.

## M0 — Validate the desktop browser workflow, fix observed blockers

**Owners:** [#44](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44), [#59](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/59), release evidence [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24).

Use an isolated service port and disposable desktop browser profile/origin. Do not clear the user's live scene or anchors. Run the current automated suites, then test `/web/` without an immersive session: same agent conversation through a follow-up and reopen; mouse selection and object move; readable activity and Approve/Deny/Stop; registered asset spawn and clip selection; browser world/game restore. Text input must be sufficient.

Fix only demonstrated browser workflow or runtime blockers. Do not redesign in-world panels, controller mappings, passthrough or room setup here. A provider outage can block live-agent acceptance while deterministic/runtime tests continue; record the blocker rather than faking completion.

**Exit:** exact source/CLI/browser versions, actual desktop interaction and receipts are recorded for the tested path. No headset is required. Preserve existing automated XR regressions; new wearer observations and immersive usability acceptance belong to M4, not this gate.

## M1 — Finish one real Blender-to-Matrix conversation on desktop

**Owners:** #59 and [#28](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28). Depends on the relevant M0 desktop portal/receipt checks, not headset or camera acceptance.

Reuse configured Blender tools, a dedicated scratch scene, the existing authoring/catalog path and Matrix MCP. Start with one non-primitive static asset; named animations can use the current contract afterward. Demonstrate create → follow-up revision → export → validate → register → place in the same agent conversation. Preserve `.blend`/authoring source outside the runtime catalog. Replacing an already placed asset must explicitly preserve or replace its object identity; do not silently duplicate it.

Make approval handling usable on the PC with the smallest change: exact review for understood operations, or a visible PC handoff for broad code execution. Do not summarize arbitrary Python as a harmless one-click action, bypass native approval, or build a general policy engine. XR-specific approval presentation waits for M4. Keep the primitive blueprint fallback. Local Blender scripting is a valid separate path; only an actual tool trace establishes Blender MCP acceptance.

**Exit:** one real end-to-end desktop trace, revision, registered asset, acknowledged placement, and final browser visual check. A generated file or an interrupted authoring turn alone is not done. See [authoring tiers](WebRuntime/BLENDER_AUTHORING_TIERS.md).

The [Copper Astrolabe desktop trace](Validation/WebRuntime-Blender-MCP-M1-2026-09-25.md) meets this one-asset M1 exit on merged `main`: a connected scratch Blender MCP scene, creation and follow-up revision in one Agent Portal conversation, validated registration, receipt-acknowledged placement, browser rendering and reload. It does not close Quest authoring or replacement-identity acceptance.

## M2 — Save and restore the whole supported experience

**Owners:** #44 and #24. Reuse existing state and files; no new database. Desktop browser and PC-service restart are the acceptance target.

First inventory the current browser world envelope, manual checkpoint, PC scene save, asset references and component/animation bindings. Browser scene/game restore already exists; PC scene-only backups do not preserve game progress. Add only the missing versioned whole-experience PC checkpoint/export and matching restore, using existing validation and atomic-file patterns.

Keep world data separate from agent chat and School records. Save configuration, not animation playback phase or transient device streams. Preserve existing saves with an explicit compatibility path. Missing content, an interrupted write, or unavailable room origin must preserve the old state and report recovery options. Physical-plane objects keep their honest session-local restriction until separately supported; do not remove these guards to simplify desktop work.

**Exit:** save a supported object/game/component configuration, restart browser and PC service, restore exact IDs and progress, and reject a missing/corrupt dependency without silently replacing the world. This is one local recovery path, not multi-user synchronization. Physical-room relocalization is separately tested in M4.

## M3 — One reusable HTML + Three.js experiment

**Owners:** [#31](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/31), [#32](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/32), School roadmap [#8](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/issues/8).

Use the existing scale experiment as the first case. Inspect both existing implementations before choosing the owner of its state and math. Keep one tested calculation/operation implementation; HTML, the Three.js view, and agent actions consume it. A short configuration object and ordinary code module are enough. Do not build a universal experience-package standard or require WebMCP.

Prove set dimensions → observe exact volume/ratio → reset in the desktop browser, with normalized observed events. HTML/3D view switching retains identity/state; simultaneous separate devices are out of scope. Reuse the limited client API for School; do not expose the privileged coding agent to the lesson application. M3 can start independently of rich Blender authoring using built-in blocks. Immersive presentation is M4, not an M3 acceptance requirement.

**Exit:** equivalent HTML/3D/tool inputs yield equivalent results, one save/resume works, and School can consume observations through its existing bridge. Scale mathematics is not measured physical volume or a physics simulation.

## M4 — Adapt the working experience for VR, then AR

**Owners:** #44/#59 for immersive UI, [#22](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/22) for room behavior and #24 for evidence. School headset integration remains #23.

After the desktop loop is reliable, improve the existing headset presentation rather than rebuilding the backend. Start with the same virtual scene in VR: readable conversation/status, reliable controller selection, discoverable input, usable approvals/Stop, and a panel that can be brought into view, moved or hidden. Then test AR-specific placement, contrast against the room, tracking/origin recovery and avoiding unnecessary obstruction. Do not assume one successful mode proves the other.

Use [the existing Quest checklist](WebRuntime/QUEST3_ACCEPTANCE.md) and record observed usability problems before choosing a larger UI library or redesign. Preserve meaningful approvals: operations requiring detailed PC review stay an explicit handoff, not an automatic approval. No new agent session, asset pipeline or world state owner.

**Exit:** the wearer can complete the same supported select → request → review → revise → interact → save/reopen flow with readable controls and predictable targeting. Record actual VR and AR evidence separately, including failures/unavailable features and source/browser/device versions. Camera capture remains optional. Desktop screenshots or tests alone cannot establish immersive comfort or usability.

## Current and later — keep the existing backlog

| Lane | Existing owners | Small next outcome, when selected |
| --- | --- | --- |
| AI Citizens — current priority | #29 with the needed slices of #13–#20 | The two-resident, seeded contention fixture has an opt-in path in the main `/web/` world, versioned browser/PC checkpoints, reservation recovery, and a finite social session candidate. The #15 candidates bind a selected existing built-in chair/table or reviewed static GLB, then add one complementary station while paused. They check rendered geometry and recover a changed static route for at most three retry ticks without replacing the scene. Animated/moving affordances, simultaneous multi-resource acquisition, and the rest of #15 remain open. Do not claim headset budgets from desktop checks. |
| Current Matrix | #44, #59, #28, #24 | Keep remaining M4 mode-specific checks and concrete M3 bridge gaps tracked independently; no second implementation stack. |
| Shared lesson | #31, #32, #23 | Desktop M3 plus the School build plan; headset presentation follows in M4. No Citizens/Boulder prerequisite. |
| Reusable runtime | #13, #25 | Extend only for a demonstrated missing interaction; reuse numeric components and existing receipts. |
| Content and visual feedback | #9, #8 | One additional provider or same-session capture loop after the basic creation path works. |
| Immersive UI and spatial/device work | #44, #59, #22, #26 | M4 is in progress; finish VR and AR wearer checks separately. Physical-camera support remains optional. |
| Later Citizens extensions | #14–#20, #29 | Add richer body, GOAP prerequisites, grounded memory, and social dialogue only after the small individual/shared-object loop is reliable. |
| Persistent geography | #38 | Reuse Boulder prototype findings; evaluate one small Web world view and coordinate mapping before a port or city expansion. |
| Alternative realtime agent | #62 | Reuse the existing session backend; add one provider only for a concrete unmet need. |
| Legacy/native | #21 and Unity-specific portions of #12/#22/#24 | Maintain existing packs/builds; do not route Web GLBs through AssetBundles. |
| Late/research | #41; roadmap #14/#15/#18 | Astral presence, community models, Jev/CLM benchmarks. Not first-release gates. |

These are planning lanes, not assertions that entire issues are unimplemented or completed. #12 remains the foundation umbrella. School, Citizens and geography are independently useful tracks, not a mandatory global waterfall.

## Resource inputs retained

Use the existing [catalog guide](Docs/Content-Catalogs.md), [runtime package notes](Docs/WebXR-Runtime-Packages.md), [Boulder PRD](Docs/Matrix-Boulder-PRD.md), and [NPC resource index](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/RESOURCES.md) instead of inventing another registry design.

| Input group | Role and disposition |
| --- | --- |
| Three.js/WebXR, HTML, Blender, local Codex, Matrix/Blender MCP | Current runtime/authoring path. Keep working versions and existing adapters. |
| Poly Haven, Sketchfab, Openverse; Scenario, Blockade/Skybox, Adobe Substance | Existing discovery work plus the original asset-library vision. Discovery, acquisition, conversion and runtime readiness are different states. Select one concrete integration at a time under #9/#28. |
| [image-to-3dlab](https://github.com/Bingeljell/image-to-3dlab), local ComfyUI and other generators | Optional asset producers. Verify output, provenance, hardware and licensing before enabling; not required for M1. |
| [Aula Inteligente interactive labs](https://aula-inteligente.guillermo23.chatgpt.site/#inicio) and interactive HTML | Interaction inspiration for M3 and future School presentation, not a required framework or a promise of arbitrary browser code execution. Matrix supplies reusable actions and observations; School owns guided lessons and learner work. |
| ElevenLabs and [Gemini Live/Avatar input](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-live-with-live-avatar/) | Optional voice/presentation/provider leads under #62 and School #7. No new paid dependency for the first lesson. |
| LLMR, Voice2Action, Project Sid/PIANO, Sims/GOAP, [CLM](https://contrastive-lm.notion.site/), [Brood War agent report](https://bw.swerdlow.dev/report) | Research/design inputs to finite actions and Citizens; not a required combined agent stack. Existing roadmap research retains SwarmWorld, Voyager, Jev, Odyssey and motion sources. |
| Cesium/Google tiles, open GIS; generated-world leads | Optional visual/data providers for #38. Keep Matrix-owned entities separate from streamed imagery; confirm rights and actual APIs before integration. |
| Manfred/Omi/phone, Quest/Aura, Demerzel/fleet, NOMAD | Separate input/device/infrastructure tracks. No lifelog, cluster deployment, or new hardware is required to finish this plan. |

The original planning review used available September 20–25 conversation summaries, 26 Matrix issue bodies, 16 roadmap issue bodies, recent organization PR descriptions/evidence, and the linked repository documents. The September 26 progress note above uses the merged PR and validation records. Neither is an exhaustive export of every conversation or a fresh check of every hardware claim. External resource mentions are retained leads, not newly verified vendor capability claims.

## Working rules and next Codex task

One active Matrix implementation slice at a time. One independent School slice may proceed separately. Prefer a small PR against current main; inspect existing open work first. Keep tests next to the changed code. Use the current Python suite and WebRuntime `npm test` / `npm run build`; cross-product changes also run the existing School tests/typecheck with the documented Matrix checkout.

Each PR states: user-visible result, reused files/contracts, excluded scope, tests actually run, device checks still pending, and the next step. Update this plan only when evidence changes the queue. Leave PRs open unless the user authorizes merging; do not close umbrella issues from a partial milestone.

**Start prompt:** “Read AGENTS.md, PROJECTS.md, PRD.md, IMPLEMENTATION_PLAN.md and AI Citizens issues #29, #15, #19 and #20. Check current `main`, open stacked PRs, the shared-world Citizens runbook, the `codex/citizens-dual-stations` branch and its browser evidence, existing simulation code, and the Quest acceptance matrix. Select the next useful #15 contract after two reviewed static stations; verify which prerequisites already exist before coding. A rejected second-station browser edit with unchanged saved-world state is one bounded follow-up. Preserve the selected built-in and registered-GLB paths, observed MatrixWorld receipts, scene/Citizens checkpoint migration, seeded replay, and isolated fixtures. Exercise the actual browser and run relevant tests/builds. Preserve live scenes, PC credentials, the Unity client and release checkpoints. Keep unfinished M4 wearer checks open and independent; do not expand into School, Matrix World, a new engine, or a full city/economy.”
