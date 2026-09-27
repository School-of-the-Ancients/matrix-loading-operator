# Matrix implementation plan

Updated September 26, 2026. Agreed product description:

> **A Three.js/WebXR sandbox. Start blank or load an existing world. Ask Operator to create and change things around you. Save it and return. Some worlds have AI citizens.**

[Vision and original roots](VISION.md) · [PRD](PRD.md) · [Project map](PROJECTS.md) · [Agent instructions](AGENTS.md) · [#122 detailed feature acceptance](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122)

**Continue the existing Creator Mode implementation. Do not rebuild the engine, restart the project, create a replacement repository or discard ongoing work.** “White Room” is the Matrix-inspired blank-canvas/loading idea, not a Unity prefab, mandatory scene or separate place the user must enter to edit. Blank and existing-world entry use the same sandbox. This clarification requests no runtime build, service restart or world reset.

This is the single Matrix work-selection queue. Preserve completed work, the open PR stack and all remaining acceptance. Historical checkpoint “next” text does not override the selected #122 goal. The wording update does not change its acceptance or replace the compatible slice already underway.

## What to deliver next

Continue the next missing portion of **“Operator, load XYZ” → create → play/experiment → revise → save/resume** in the existing application. Use #122's physics playground/classroom and a different interactive exhibit/experiment to prove reuse and extensibility. Education is a near-term proving ground, not a restriction to classroom templates.

Starting blank or loading a supported existing world are entry paths, not a new launcher, nested-room or multiworld-service project. After loading, Operator can inspect and make authorized edits in that world. Preserve compatible citizen/game state where present; citizens are not required in every world.

Procedural generation, compatible catalog reuse and Blender authoring are complementary. Optional concept imagery under #91 can guide either authoring path but is not a new prerequisite. **The dynamic world-improvement worker and #125 portal network remain later work.**

## Select and integrate the right base

1. Refresh `main`, open PRs, base/head refs, reviews and active worktrees before integration. Before this documentation-only merge, `main` was `0cb8c23` after #99 and the inspected Citizens stack reached #123 at `25cde859676b7d752e4ae4118c7f68e67998bfe6`. This docs change does not merge that implementation. Check current refs rather than treating this snapshot as current runtime state.
2. Preserve the compatible Creator Mode work already underway. Reuse relevant world/interaction/checkpoint code and keep review fixes and isolated demos intact. Inspect the station-replacement concern linked from #122 before relying on that seam; unrelated appointment/social refinements do not gate Creator Mode.
3. Record the chosen implementation base, running service/build and actual supported capabilities separately. Do not describe an open PR's reported results as tests rerun here or as live headset support. GitHub does not reveal another session's unpushed work.
4. Review/consolidate open work only with the requested authority. Leave PRs open unless merging is explicitly authorized; a docs merge is not permission to merge the entire Citizens stack or reset the live world.

## Thin end-to-end delivery sequence

The detailed requirements, regression cases and implementation slices remain owned by #122. The sequence below selects user-visible outcomes, not competing acceptance. Record what is already complete and continue from it; do not restart at step one.

### 1. A creator can summon, inspect, test and revise a small world

Reuse `/web/`, current Operator voice/input, Agent Portal, selection/pointing and Matrix tools. Establish explicit Creator and Play/Test authority in the same world; keep Stop/Pause and the return-to-creator control usable. These are modes, not separate rooms. A paused-by-default editing policy is acceptable when clearly shown.

Generate or extend a small layout with owned, inspectable entities, one meaningful interaction and a display. Include a genuinely parameterized shaped/curved element, not only scaled baked meshes. Preserve seed/parameters/generator version and manual edits on revision. Bind displays and agent operations to real shared state.

Wire the same controls into VR/AR as this slice develops. Use desktop as a regression harness, not the final immersive result. Record actual wearer evidence or an explicit hardware gap. Existing capability configuration should work in-headset; broader executable-code approval can retain its explicit PC handoff.

**Outcome:** a voice request creates something usable, the user tries it, Operator inspects the actual result and a follow-up changes the same experience without a silent reset. Passing a build or generating a file is not this outcome.

### 2. Make the physics playground and its objective real

Inspect/reuse current physics work, then extend or integrate only the maintained runtime functionality needed by #122. Do not hand-write a general solver or create a physics service. Verify the selected implementation/version/license during coding.

Prove static colliders, dynamic objects, held/kinematic handoff, gravity and contact with the world and other objects. Required regression: drop → settle → grab/move → release → simulate again, including repeat grabs, rotation, shape/scale changes and deletion. Coordinate animation, dragging and physics ownership; regenerated geometry must update affected collider/interaction readiness.

Add one executable objective, such as delivering three distinct objects to a receptacle to unlock an exit. Progress and consequences come from verified actor/object events, not narration or an LLM's assertion. Prevent duplicate credit across repeated contacts, re-grabs, reconnect and completion. Show live progress/results in a usable in-world display.

**Outcome:** a learner/player can solve the challenge, see why an attempt worked or failed, and ask Operator to revise the setup. Broader citizen-driven quests remain #118; autonomous quest-givers are not prerequisites.

### 3. Preserve the experience and prove educational reuse

Extend existing browser and PC whole-world checkpoints only where the current contracts lack the supported recipe, dependencies, physics/play state or display/objective bindings. Keep validators/migrations aligned. Preserve stable IDs and compatible state on edits; incompatible rules require explicit migration or reset.

Test settled and moving-body save/reopen, missing/corrupt dependencies, stale/cancelled/duplicate commands and rollback on failed revisions. Label unsupported continuation state and tolerances. Do not turn authoring undo into an undocumented rewind of unrelated simulation state.

Demonstrate a second interactive exhibit or experiment using the same state/tool/view path; inspect [Scale Experiment](Docs/Scale-Experiment.md) and #31/#32 before adding modules. Show that a missing capability can be developed, tested, deployed and discovered through normal reviewed code, rather than a fixed preset menu. Provide checked units/models and meaningful feedback. Keep School curriculum and learner records in School; a reusable Matrix demo requires no new School backend.

**Outcome:** the saved world survives return and further editing, one concrete concept is taught through interaction, and creation supports a different experience without a second engine or duplicated simulation.

### 4. Rehearse the actual student/demo journey

Run the full create → interact/learn → revise → save/reopen flow on the intended build and device. Record VR and AR separately: voice, readability, selection/grab, displays, approvals/Stop, return-to-creator, world restore, tracking/alignment and recovery. Reuse the existing M4 checklist; do not hide remaining gates behind a new demo name.

Provide a reproducible demonstration script, saved starting point and clearly labeled fallback for a provider outage. A fallback is not evidence that live generation passed. Measure time to first usable result, regeneration cost and rendering budgets on the tested surface. Keep private room imagery/learner data out of public evidence.

**Outcome:** another person can run the demonstration and distinguish working behavior from limitations. Do not wait for universal catalogs, a full society, multiplayer, global mapping, future glasses, portals or the dynamic upgrader.

## Progress at the merged Web stack

This is a reference snapshot, not fresh validation performed by the documentation change.

The merged Web capability stack through #98 was at `2f6554c`; #99 added checkpoint docs at `0cb8c23`. The separately inspected open Citizens tip #123 was `25cde85`. See [Current Checkpoint](Docs/Current-Checkpoint.md), the [pinned Citizens candidate runbook](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/Docs/Citizens-Shared-World.md), [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md), and the exact PR/source being used. Publishing these documents does not publish the candidate code.

| Foundation | Preserve/reuse | Remaining distinction |
| --- | --- | --- |
| M0 agent loop | Persistent session, spatial context, tools, approvals and receipts | An old or new capability still needs its own runtime/mode acceptance |
| M1 Blender | [Copper Astrolabe creation/revision trace](Validation/WebRuntime-Blender-MCP-M1-2026-09-25.md), GLB registration and placement | One trace does not prove general identity-preserving replacement or Quest authoring |
| M2 persistence | [PC whole-world checkpoints](ControlService/WORLD_CHECKPOINTS.md), browser state and compatibility guards | Scene-only backup, whole-world save and AR relocalization are distinct |
| M3 experiment | [Block Scale Lab](Docs/Scale-Experiment.md) shared state/math and observations | School integration and usable immersive controls remain separately evidenced |
| M4 immersive | Selected Quest creation/revision/save, paging and panel-recall observations | Approval/Stop, readability, origin recovery and physical-surface criteria must remain explicit |
| Existing floor mechanics | [Bounded GLB drops](Docs/Web-Floor-Physics.md), transforms and animation | Not general rigid-body or object-to-object collision acceptance |
| Open Citizens work | World identity, finite interactions, authored stations, reservations, route recovery and versioned saves | Candidate state is not merged/live state; desktop evidence is not Quest evidence |

The Citizens chronology remains in the [pinned pre-refocus plan](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/IMPLEMENTATION_PLAN.md), [prior PRD](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/PRD.md) and [candidate checkpoint](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/Docs/Current-Checkpoint.md). Their dated “next” language is historical. No tests, source, saves or hardware records are removed by this documentation change.

## Earlier M0–M4 acceptance references

Keep these labels/links for existing issues. They are foundation/evidence categories, **not a requirement to postpone every immersive step until all desktop work or Citizens development is finished**.

### M0 — Validate the desktop browser workflow, fix observed blockers

Owners #44/#59/#24. Preserve persistent conversation, selection/edit targeting, visible approval/denial/Stop, actual runtime receipts and save/reopen. Test on an isolated service/profile; provider failure preserves the world. Desktop remains useful but is not the full product acceptance surface.

### M1 — Finish one real Blender-to-Matrix conversation on desktop

Owners #59/#28. Preserve the existing scratch-scene create/revise/export/validate/register/place trace and editable source. Compatible replacement/identity and headset authoring need their own evidence. Direct procedural generation must not require this authoring path.

### M2 — Save and restore the whole supported experience

Owners #44/#24. Keep browser and PC whole-world state, dependency validation and compatibility paths. Keep scene-only backup clearly labeled. Extend for #122's recipe/physics/objective state as needed; preserve old worlds. Physical-room relocalization remains a separate check.

### M3 — One reusable HTML + Three.js experiment

Owners #31/#32 and [School roadmap #8](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/issues/8). Reuse one calculation/transition implementation and observations across controls, world and agent. The existing desktop baseline is useful; #122 also needs usable immersive views, not an unrelated HTML simulation. School keeps learner ownership.

### M4 — Adapt the working experience for VR, then AR

Owners #44/#59/#22/#24; School integration #23 remains separately scoped. Keep [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md) authoritative for recorded mode-specific checks. Wire/rehearse the selected creation experience with separately recorded voice/input/approval/Stop, readability, origin recovery and physical alignment limitations. Do not call a desktop result wearer validation.

## Current and later — keep the existing backlog

| Lane | Existing owner/reference | Selection rule |
| --- | --- | --- |
| Current creation/learning demo | #122 with #44/#59/#116 | Continue the small immersive create/play/revise/save loop |
| Reusable physics, interactions, displays and objectives | #13/#15/#31/#32/#118 as applicable | Build only the pieces required by that loop; retain each umbrella's remaining criteria |
| Blender, asset reuse and visual feedback | #28/#9/#8; concept imagery #91 | Complement procedural generation; not mandatory authoring stages |
| Independent School | #31/#32/#23 and [School build plan](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/BUILD_PLAN.md) | Independently selected teaching work; do not move curriculum/learner records into Matrix |
| AI Citizens and resident building | #29/#14–#20/#109 | Preserve/review existing stack; expand when explicitly selected or needed by a demonstrated interaction |
| Dynamic world improvement | [VISION.md](VISION.md#later-dynamic-world-improvement) | Later, opt-in bounded review/improve/verify/revert; no worker or overnight scheduling now |
| Portals, multiplayer, persistent geography and wider society | #125, #38/#41 and #29 | Future extensions, not local-demo prerequisites |
| Alternative agents/providers/devices/fleet | #62 and existing resource references | Add only for a concrete unmet need; no new mandatory infrastructure/hardware |
| Unity/native | #21 and Unity portions of #12/#22/#24 | Maintain supported builds, content packs and historical evidence; no required White Room prefab for Web |

The upgrader eventually needs identity-preserving replacement, manual-edit protection, stale-work rejection, rollback, permissions, budgets and asset provenance. Those are compatibility considerations, not instructions to implement autonomous improvement now.

## Resource inputs retained

Use [creation resources](RESOURCES.md), [content catalogs](Docs/Content-Catalogs.md), [WebXR runtime packages](Docs/WebXR-Runtime-Packages.md), [Boulder PRD](Docs/Matrix-Boulder-PRD.md) and the [School resource index](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/RESOURCES.md). The pinned previous plan retains the original resource list.

Retained leads include Three.js/WebXR, Sakuragaoka procedural modules, HTML, local Codex, Matrix/Blender tools, Poly Haven/Sketchfab/Openverse, Scenario/Blockade/Substance, image-to-3dlab/ComfyUI, interactive HTML labs, voice providers, LLMR/Voice2Action, GOAP/Project Sid and other NPC research, geospatial sources, and Manfred/Demerzel/fleet/device inputs. They are references, not newly verified vendor capabilities or required dependencies. Check API/access/license/cost/version before integration.

## Working rules and next Codex task

Continue one active Matrix implementation slice at a time. Inspect/reuse open work before starting another branch; preserve review history and dependencies. Record the current slice's goal, actual compatible base, completed behavior, remaining acceptance and explicit exclusions. Do not reset its progress because the product wording was clarified.

Run relevant ControlService Python tests and WebRuntime `npm test` / `npm run build` when implementing code; cross-product edits also need existing School checks. This docs-only update itself requires no application rebuild or service restart. Record tests actually run, browser interaction and separate pending wearer checks.

Each PR states the user-visible result, reused contracts, scope exclusions, evidence and next smallest step. Keep detailed evidence in checkpoint/runbook/validation files, not an ever-growing PRD diary. Change the queue for an explicit owner decision or verified blocker, not because another subfeature is imaginable. Leave PRs open unless authorized to merge.

**Continuation prompt:** “Read the updated AGENTS.md, VISION.md, PROJECTS.md, PRD.md, IMPLEMENTATION_PLAN.md and #122. Continue compatible Creator Mode work already underway; do not rebuild or restart the project. The product is a Three.js/WebXR sandbox: start blank or load an existing world, create/change through Operator, save and return; some worlds have AI citizens. White Room is inspiration, not a Unity prefab or separate editing room. Identify the actual source/running state, preserve Citizens/world/checkpoint work and continue the next missing portion of #122. Keep its physics, objective/display, agent access, save and extensibility acceptance intact. Coordinate current capability context with #116. Validate actual runtime outcomes and separate desktop from VR/AR wearer evidence. Protect live worlds, services, approvals and native Unity. Do not implement deferred portals or the upgrader, or merge unrelated PRs without authorization.”
