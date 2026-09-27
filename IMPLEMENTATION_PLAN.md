# Matrix implementation plan

Updated September 27, 2026. Agreed product description:

> **A Three.js/WebXR sandbox. Start blank or load an existing world. Ask Operator to create and change things around you. Save it and return. Some worlds have AI citizens.**

[Vision and original roots](VISION.md) · [PRD](PRD.md) · [Project map](PROJECTS.md) · [Agent instructions](AGENTS.md) · [#122 detailed feature acceptance](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122)

**Continue the existing Three.js/WebXR Creator Mode implementation. Do not rebuild the engine, restart the project, create a replacement repository or discard ongoing work.** “White Room” is the Matrix-inspired blank-canvas/loading idea, not a Unity prefab, mandatory scene or separate place the user must enter to edit. Blank and existing-world entry use the same sandbox. Native Unity source is read-only history; the archive move does not restart a service or reset a world.

This is the single Matrix work-selection queue. Preserve the merged PR history and all remaining acceptance. The September 27 owner direction selects the persistent AI Citizens world, an AR visit into it, and shared human/resident creation as the next integration path. Keep #122's compatible Creator work and remaining acceptance; its dated “next” text does not override this selection.

## Selected parallel-world integration

The digital world and its citizens exist independently of a human viewer. Desktop and VR can enter that world; AR registers an overlay from the physical world into the **same** digital scene and citizen identities. [Matrix Boulder PRD](Docs/Matrix-Boulder-PRD.md) already states this model. The current browser Citizens timer stops when the tab is hidden and entering AR pauses activity, so browser checkpoints alone do not yet prove independent life.

1. Make an eligible virtual Citizens world visitable in AR without cloning its canonical scene or cancelling ongoing citizen actions. Keep physical planes and origin recovery as presentation state. Preserve existing non-Citizens AR placement/recovery, and never call an unverified overlay physically aligned.
2. Give one isolated PC-hosted world a single simulation owner and durable versioned checkpoint. Reuse the current `MatrixWorld`/Citizens policy and finite receipts. Desktop/VR/AR visitors observe the same world and never run a second citizen clock. Prove progression with all browsers closed, then rejoin with stable IDs and advanced state; service restart and downtime behavior need explicit tests. Do not displace a user's existing runtime lease.
3. Use the Agent Portal's existing catalog, procedural, Blender, registration and spawn paths for human creation. For [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109), let a citizen submit a bounded, attributable creation request to a separately authorized broker. Begin with one reviewed procedural rest station, exact Matrix receipts and checkpoint provenance; Blender remains a separate validated authoring/registration/placement path. Citizens do not receive Operator credentials or send free-form instructions into the owner's conversation.

These are staged capabilities, not completed claims. Keep #20/#29 simulation acceptance and #22 physical-room evidence open, with Quest 3 wearer validation after the source-side route works.

## What to deliver next

Continue the next missing portion of **“Operator, load XYZ” → create → play/experiment → revise → save/resume** in the existing application. Use #122's physics playground/classroom and a different interactive exhibit/experiment to prove reuse and extensibility. Education is a near-term proving ground, not a restriction to classroom templates.

Starting blank or loading a supported existing world are entry paths, not a new launcher, nested-room or multiworld-service project. After loading, Operator can inspect and make authorized edits in that world. Preserve compatible citizen/game state where present; citizens are not required in every world.

Procedural generation, compatible catalog reuse and Blender authoring are complementary. Optional concept imagery under #91 can guide either authoring path but is not a new prerequisite. **The dynamic world-improvement worker and #125 portal network remain later work.**

### Current compatible #122 slice

The merged Creator Mode stack through [PR #130](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/130) builds on the same `/web/` world and merged Citizens stack through [PR #126](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/126). It includes versioned bridge, curved-bench and staircase generators, Creator/Play controls, Rapier rigid bodies and virtual colliders, a bound challenge with deduplicated progress and exit unlock, world-space displays, and browser/PC saves. [The creation runbook](Docs/Procedural-Creation.md) records the reusable contracts; [isolated desktop evidence](Validation/Immersive-Creator-Desktop-2026-09-26.md) separates actual browser/Agent observations from tests and headset checks.

The desktop browser completed and restored the seven-object playground with three cargo objects. The connected PC-local Codex Agent then discovered live Matrix tools, built a distinct seven-entity Gravity Lab from a typed request, played its two-object challenge to score 20 and unlock the exit, and revised the same curved bench, gravity and display while retaining progress. Named checkpoint and world archive actions restored both experiences with their identities and game state. Automated desktop canvas input also selected, dragged, released and re-grabbed one dynamic orb without duplicate credit. A further desktop Dimensions Exhibit used generic reviewed object scale and a wall board bound to that object's live transform. The same block was scaled `(1, 1, 1) → (2, 3, 4)`, saved in a named PC world checkpoint, returned to `(1, 1, 1)` after reload, then restored to `(2, 3, 4)` through the PC UI without changing its ID. This provides a separate non-physics desktop reuse demonstration; the static 24× ratio instruction is not a live computed lesson. At a 1055 px desktop viewport, the sidebar could be hidden to expose both display walls and restored without changing world state; board text was still small from the default camera. The earlier integrated desktop source passed WebRuntime **443/443** and ControlService **738/738**, with a Vite build; the later #130 generator-development PR reported WebRuntime **453/453**, ControlService **739/739**, and another build. These are dated validation results, not tests rerun by this documentation update. Board readability has since received a larger live headline in merged source; it still needs wearer review. Spoken headset input, tracked controller use, physical-room collision and device performance remain unverified.

## Select and integrate the right base

1. Refresh `main`, open PRs, base/head refs, reviews and active worktrees before integration. The PR #124 documentation snapshot recorded `main` at `0cb8c23` after #99 and the Citizens stack through #123 at `25cde859676b7d752e4ae4118c7f68e67998bfe6`. Citizens through #126 and Creator Mode through #130 are merged on `main`; use the current ref and deployed-state evidence rather than that historical snapshot as the implementation base.
2. Preserve the compatible Creator Mode work already underway. Reuse relevant world/interaction/checkpoint code and keep review fixes and isolated demos intact. Inspect the station-replacement concern linked from #122 before relying on that seam; unrelated appointment/social refinements do not gate Creator Mode.
3. Record the chosen implementation base, running service/build and actual supported capabilities separately. Do not describe an open PR's reported results as tests rerun here or as live headset support. GitHub does not reveal another session's unpushed work.
4. Review/consolidate open work only with the requested authority. Leave PRs open unless merging is explicitly authorized; a merge is not permission to reset a live world or pull unrelated branches.

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

The source checkpoint extension now records bounded dynamic-body pose, velocity,
and sleep state in browser and PC whole-world saves. Automated moving, settled,
legacy-baseline, malformed-state, and failed-restore checks pass. This remains
source and desktop evidence; the create → play → save/reopen route on Quest VR
and AR still needs wearer validation under step 4.

Demonstrate a second interactive exhibit or experiment using the same state/tool/view path; inspect [Scale Experiment](Docs/Scale-Experiment.md) and #31/#32 before adding modules. Show that a missing capability can be developed, tested, deployed and discovered through normal reviewed code, rather than a fixed preset menu. Provide checked units/models and meaningful feedback. Keep School curriculum and learner records in School; a reusable Matrix demo requires no new School backend.

**Outcome:** the saved world survives return and further editing, one concrete concept is taught through interaction, and creation supports a different experience without a second engine or duplicated simulation.

### 4. Rehearse the actual student/demo journey

Run the full create → interact/learn → revise → save/reopen flow on the intended build and device. Record VR and AR separately: voice, readability, selection/grab, displays, approvals/Stop, return-to-creator, world restore, tracking/alignment and recovery. Reuse the existing M4 checklist; do not hide remaining gates behind a new demo name.

Provide a reproducible demonstration script, saved starting point and clearly labeled fallback for a provider outage. A fallback is not evidence that live generation passed. Measure time to first usable result, regeneration cost and rendering budgets on the tested surface. Keep private room imagery/learner data out of public evidence.

**Outcome:** another person can run the demonstration and distinguish working behavior from limitations. Do not wait for universal catalogs, a full society, multiplayer, global mapping, future glasses, portals or the dynamic upgrader.

## Progress at the merged Web stack

This is a reference snapshot, not fresh validation performed by the documentation change.

The Web capability stack through #98 was at `2f6554c`; #99 added checkpoint docs at `0cb8c23`. The separately inspected Citizens tip #123 was `25cde85`. These are pinned historical states; the merged source now includes Citizens through #126 and Creator Mode through #130. See [Current Checkpoint](Docs/Current-Checkpoint.md), the [current Citizens runbook](Docs/Citizens-Shared-World.md), [Creator Mode runbook](Docs/Procedural-Creation.md), [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md), and the exact deployed build being used.

| Foundation | Preserve/reuse | Remaining distinction |
| --- | --- | --- |
| M0 agent loop | Persistent session, spatial context, tools, approvals and receipts | An old or new capability still needs its own runtime/mode acceptance |
| M1 Blender | [Copper Astrolabe creation/revision trace](Validation/WebRuntime-Blender-MCP-M1-2026-09-25.md), GLB registration and placement | One trace does not prove general identity-preserving replacement or Quest authoring |
| M2 persistence | [PC whole-world checkpoints](ControlService/WORLD_CHECKPOINTS.md), browser state and compatibility guards | Scene-only backup, whole-world save and AR relocalization are distinct |
| M3 experiment | [Block Scale Lab](Docs/Scale-Experiment.md) shared state/math and observations | School integration and usable immersive controls remain separately evidenced |
| M4 immersive | Selected Quest creation/revision/save, paging and panel-recall observations | Approval/Stop, readability, origin recovery and physical-surface criteria must remain explicit |
| Existing floor mechanics | [Bounded GLB drops](Docs/Web-Floor-Physics.md), transforms and animation | Not general rigid-body or object-to-object collision acceptance |
| Merged Citizens work | World identity, finite interactions, authored stations, reservations, route recovery and versioned saves | Merged source is not proof of deployment or Quest behavior |

The Citizens chronology remains in the [pinned pre-refocus plan](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/IMPLEMENTATION_PLAN.md), [prior PRD](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/PRD.md) and [candidate checkpoint](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/25cde859676b7d752e4ae4118c7f68e67998bfe6/Docs/Current-Checkpoint.md). Their dated “next” language is historical. The Unity source move removes no saved worlds or hardware records; source history and native releases remain recoverable.

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
| Current persistent-world integration | #20/#29/#22/#109 with #122/#59/#116 | Advance one canonical Citizens world, visit it through AR, then mediate resident creation through existing Operator paths |
| Compatible creation/learning demo | #122 with #44/#59/#116 | Retain the small immersive create/play/revise/save loop and its remaining wearer acceptance |
| Reusable physics, interactions, displays and objectives | #13/#15/#31/#32/#118 as applicable | Build only the pieces required by that loop; retain each umbrella's remaining criteria |
| Blender, asset reuse and visual feedback | #28/#9/#8; concept imagery #91 | Complement procedural generation; not mandatory authoring stages |
| Independent School | #31/#32/#23 and [School build plan](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/BUILD_PLAN.md) | Independently selected teaching work; do not move curriculum/learner records into Matrix |
| AI Citizens and resident building | #29/#14–#20/#109 | Current selected integration above; preserve the existing deterministic simulation and receipts |
| Dynamic world improvement | [VISION.md](VISION.md#later-dynamic-world-improvement) | Later, opt-in bounded review/improve/verify/revert; no worker or overnight scheduling now |
| Portals, multiplayer, persistent geography and wider society | #125, #38/#41 and #29 | Future extensions, not local-demo prerequisites |
| Alternative agents/providers/devices/fleet | #62 and existing resource references | Add only for a concrete unmet need; no new mandatory infrastructure/hardware |
| Unity historical archive | #21 and native portions of #12/#22 | Preserve source, historical APK releases and dated evidence; no new Unity builds or Web AssetBundle dependency |
| Coursework releases | #24 | Prepare and validate distinct Three.js/WebXR deliverables; preserve older APK milestones as history |

The upgrader eventually needs identity-preserving replacement, manual-edit protection, stale-work rejection, rollback, permissions, budgets and asset provenance. Those are compatibility considerations, not instructions to implement autonomous improvement now.

## Resource inputs retained

Use [creation resources](RESOURCES.md), [content catalogs](Docs/Content-Catalogs.md), [WebXR runtime packages](Docs/WebXR-Runtime-Packages.md), [Boulder PRD](Docs/Matrix-Boulder-PRD.md) and the [School resource index](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/RESOURCES.md). The pinned previous plan retains the original resource list.

Retained leads include Three.js/WebXR, Sakuragaoka procedural modules, HTML, local Codex, Matrix/Blender tools, Poly Haven/Sketchfab/Openverse, Scenario/Blockade/Substance, image-to-3dlab/ComfyUI, interactive HTML labs, voice providers, LLMR/Voice2Action, GOAP/Project Sid and other NPC research, geospatial sources, and Manfred/Demerzel/fleet/device inputs. They are references, not newly verified vendor capabilities or required dependencies. Check API/access/license/cost/version before integration.

## Working rules and next Codex task

Continue one active Matrix implementation slice at a time. Inspect/reuse open work before starting another branch; preserve review history and dependencies. Record the current slice's goal, actual compatible base, completed behavior, remaining acceptance and explicit exclusions. Do not reset its progress because the product wording was clarified.

Run relevant ControlService Python tests and WebRuntime `npm test` / `npm run build` when implementing code; cross-product edits also need existing School checks. An archive/documentation change needs link and packaging checks, without a live service restart. Record tests actually run, browser interaction and separate pending wearer checks.

Each PR states the user-visible result, reused contracts, scope exclusions, evidence and next smallest step. Keep detailed evidence in checkpoint/runbook/validation files, not an ever-growing PRD diary. Change the queue for an explicit owner decision or verified blocker, not because another subfeature is imaginable. Leave PRs open unless authorized to merge.

**Continuation prompt:** “Read AGENTS.md, VISION.md, PROJECTS.md, PRD.md, IMPLEMENTATION_PLAN.md, the Matrix Boulder PRD, and #20/#29/#22/#109/#122. Keep one persistent digital Matrix world with AI citizens; desktop/VR enter it and AR visits it as a view aligned only when tracking proves alignment. Reuse existing MatrixWorld, Citizens, Agent Portal, procedural/Blender and checkpoint contracts. First prove live AR visit without pausing citizens, then one isolated service-owned citizen clock with no browser present, then an owner-authorized resident creation request through existing world tools and exact receipts. Preserve #122 Creator work and Unity archive. Validate source, running service and Quest wearer separately; protect live worlds and credentials. Do not add a second engine or treat research resources as implemented features.”
