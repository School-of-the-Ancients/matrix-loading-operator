# Matrix repository project map

Updated September 26, 2026. This repository contains an active WebXR application, shared PC services and historical Unity source. The map also distinguishes Matrix World and Citizens work from the separately owned School product.

Start with [VISION.md](VISION.md) for the central product idea, [PRD.md](PRD.md) for requirements, [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for current work, [AGENTS.md](AGENTS.md) for working rules, and [RESOURCES.md](RESOURCES.md) for creation references. This map organizes existing work; it is not a second implementation queue.

## TL;DR

> **A Three.js/WebXR sandbox. Start blank or load an existing world. Ask Operator to create and change things around you. Save it and return. Some worlds have AI citizens.**

White Room is the Matrix-inspired blank-canvas/loading idea, **not an actual Unity prefab or mandatory scene**. Creating does not require a separate room. Continue the existing #122 implementation. The owner selected Three.js/WebXR for future runtime and coursework work; the Unity project and releases are read-only history. This repository reorganization does not require a live service restart.

| Track | Role | Priority boundary |
| --- | --- | --- |
| Matrix Web / Current | Three.js, WebXR, PC-local Operator, procedural/reused/Blender content, interactions and displays | Current create → play/learn → revise → save loop under #122 |
| Matrix Unity / Archive | Historical native Quest/desktop, White Room application, MRUK room AR and AssetBundles | Preserve source, releases and dated evidence for reference; no new native builds or coursework APKs |
| Matrix World | Persistent inhabited worlds, towns and offices; optional georeferenced/Earth-aligned views | Broader world composition, not a prerequisite for a local experience; #125 portals are speculative |
| AI Citizens | Embodiment, needs, schedules, decisions, memory and social simulation | Preserve bounded merged capabilities; optional inhabitants, not required in every world |
| School of the Ancients | Independent education product consuming reusable experiences | Important learning use case; separate curriculum/learner-state ownership |
| Dynamic world upgrader | Later inspection and improvement of worlds/assets/interactions | Deferred; no automatic overnight worker in the current slice |

Matrix Web uses the shared PC-side ControlService boundary. The archived Unity clients also used that service; their history is not a reason to remove routes or change the current Web exchange protocol without a separate migration. The opt-in `/web/` Citizens panel uses the same `MatrixWorld`, renderer and browser/PC checkpoints; `/web/citizens.html` is an isolated fixture. Track ownership does not establish deployed or device support. Consult [checkpoints](Docs/Current-Checkpoint.md), the relevant PR and [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md).

# 1. Matrix Web / Current active platform

**Status: default for new generalized Matrix runtime work and the current immersive creation/learning demo.**

Primary homes: `WebRuntime/`, `ControlService/`, and `Start-CodexControlService.ps1`.

Feature owners: [#122 Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122), [#44 Web runtime](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44), [#59 Agent Portal](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/59), and [#116 runtime-aware prompts](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/116).

```text
Desktop browser / Quest WebXR
              |
Three.js Matrix — blank or loaded world / AR view
              |
ControlService / persistent Agent Portal
              |
PC-local Codex + configured tools
              +-- Matrix world tools
              +-- Blender / asset authoring
              +-- reviewed repository development
```

The browser/headset is a spatial and interactive client, not a privileged Codex host. Selection, pointing, current world state and observed outcomes ground requests. The PC retains credentials and authority.

## Current creation direction

Create complete usable experiences, not just meshes. A world may combine procedural layouts and geometry, imported assets, reusable behaviors, physics, controls, displays, audio, executable objectives and supported persistent state. Build only missing capabilities required by the selected example; these are product requirements, not a claim that all loaders/mechanics exist.

| Creation path | Existing home / meaning |
| --- | --- |
| Load existing content | #9/#28 catalogs and current Web GLB path; #21 records the archived native pack work |
| Generate directly in code | #122/#44 ordinary procedural modules, sharing Matrix identity and lifecycle |
| Author or refine assets | #28 Blender/source → validated catalog → ordinary world object |
| Mockup/reference first | #91 concept versions and explicit selection; optional input to Blender or #122's procedural authoring, not a new runtime |

Procedural creation can provide a first version where suitable. Catalog reuse avoids unnecessary authoring. Blender remains an optional rich asset/rig/animation factory. All paths use the same identity, validation, interaction and persistence contracts. Do not require GLB export or a Blender round trip for direct procedural geometry. [Sakuragaoka Station](RESOURCES.md#sakuragaoka-station--procedural-world-construction) is a reference, not a replacement engine or required port.

Start blank or load an existing world, then create there through Operator under appropriate permissions. White Room describes the inspiration, not a required prefab, room asset or separate editor. Desktop, VR and AR are presentation/input modes; Creator and Play/Test are interaction/authority modes. Neither distinction requires another engine.

```text
one authoritative experience state
   |-- HTML controls / results
   |-- Three.js browser scene
   |-- WebXR in-world controls / scene
   +-- bounded agent actions / observations
```

An immersive panel must be usable in the tested headset mode; an ordinary HTML page is not automatically an XR display. Reuse an experiment's math and state rather than implementing the same lesson twice.

## Current implementation

The merged source through #130 includes Agent Portal/session/tool boundaries, GLB/animation and component paths, world checkpoints, bounded Citizens shared-world simulation, and Creator Mode. [Current checkpoints](Docs/Current-Checkpoint.md), the [Citizens runbook](Docs/Citizens-Shared-World.md), and the [Creator Mode runbook](Docs/Procedural-Creation.md) preserve dated evidence and limits; inspect the running build before making support claims.

The older bounded virtual-floor drop is distinct from the merged Creator Mode's scoped Rapier physics, and neither declares #122 complete. Review actual source, open work and the running build before making support claims. A docs branch does not reveal another session's local or unpushed implementation.

The merged [Immersive Creator Mode implementation](Docs/Procedural-Creation.md) continues that same `/web/` world with versioned procedural editing, Creator/Play controls, Rapier rigid bodies and virtual colliders, objective state, world displays and explicit browser/PC world saves. Its [isolated desktop evidence](Validation/Immersive-Creator-Desktop-2026-09-26.md) includes a connected PC-local Codex Agent creating and revising a separate Gravity Lab. Source tests and desktop observations remain distinct from the user's deployed service and VR/AR wearer evidence.

# 2. Matrix Unity / Historical archive

**Status: read-only historical source and releases. No forward native build support.**

Home: [`Archive/Unity/`](Archive/Unity/README.md), containing `Assets/`, `Packages/`, `ProjectSettings/`, native build/install/connect scripts and native content-pack tooling. Historical APKs and matching PC-service bundles remain in [GitHub Releases](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases).

This includes the historical White Room application, Quest virtual room, MRUK room-aware AR, voice/text proposals and reviewed Apply, stable IDs/Undo/save, compiled Rotate/Bob, prefab/AssetBundle loading and coursework snapshots. The original PC Operator is retained on loopback at `/legacy/operator`; `/` now opens `/web/`. The native runtime is a separate application connected to ControlService. See the [route and consumer map](Docs/Control-Page-Routes.md).

Preserve matching source/runbook/release provenance and the original names. This archive is not the acceptance path for new features or coursework. Generalized voice-created experiences, HTML, procedural content and Blender/GLB authoring belong to Matrix Web. No Unity room prefab or scene needs to be ported to realize the blank-start idea.

# 3. Matrix World

**Status: persistent inhabited-world application direction, not a replacement renderer or new immediate task.**

Matrix World covers persistent settings where AI citizens can live and where humans can load an existing environment to explore, interact and continue creating. Towns, offices and other settings use the same sandbox capabilities as a world started blank. An existing world can also be uninhabited or purely a game/experiment. No outer city or separate creation room is required.

Specific owners: [#38 Matrix Boulder](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38) for georeferenced worlds/Earth registration, [#41 Astral Travel](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/41) for later detached presence, and [#125](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/125) for speculative portal-linked public offices. The native Boulder prototype script is preserved under `Archive/Unity/`; future geography work belongs to WebXR. Geography is one specialization, not a requirement for every inhabited world.

World composition consumes shared runtime, content, spatial and Citizens capabilities. Do not create another authoritative scene system. Keep world-instance ownership explicit: reset/load/replacement must not silently erase unrelated worlds, visitor identity or compatible resident/game progress. Public URLs do not establish shared identity, trust or seamless cross-site XR. #125 remains theory/backlog only.

# 4. AI Citizens / Character Body

**Status: bounded Citizens source merged through #126; preserve its saves and dated desktop evidence. Further autonomy is separately selected.**

Owners: [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29), #14 body/animation, #15 interaction/navigation, #16 GOAP, #17 needs/schedules, #18 identity/memory/dialogue, #19 social behavior and #20 persistence/replay. [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109) covers resident worldbuilding; [#118](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/118) covers broader citizen-driven quests.

The isolated fixture and opt-in main-world implementation reuse MatrixWorld movement, interaction receipts, stable IDs and checkpoints. Residents own decisions; Matrix owns execution. Preserve bounded retries, reservations, migrations and verified outcomes when creation work touches these contracts.

A teacher character, creator-authored objective or student experiment does not require a complete needs/schedules/social simulation. Reuse working capabilities without making all Citizens work mandatory.

Resident worldbuilding can use shared world-facing capabilities under delegated scope. A simulated citizen, animated character and avatar showing a real coding/research session are different things. Neither a character nor public visitor automatically gets Operator credentials or authority to run fleet jobs. Keep School curriculum and learner records outside Citizens.

# 5. Shared Matrix Core / ControlService

`ControlService/` coordinates scene identity, validation, tool boundaries, leases, receipts, catalogs, persistence, captures, Agent Portal connectivity and client integration. `WebRuntime/` retains its existing runtime state/execution responsibilities. This is an ownership seam, not a mandate to move all state to a new server.

When changing shared code, identify its Web consumers, keep renderer-neutral contracts where practical and avoid parallel catalog/state/queue implementations. Archived native dependencies still exist in history; retire a shared route only after verifying Web usage and release provenance. Prefer reusable capabilities to object-specific endpoints. Keep credentials off browsers/headsets and private data out of world exports or public evidence.

# 6. School of the Ancients is a separate product

**Education is an important use case, not a reason to merge product ownership.**

School owns curriculum, mentor pedagogy, learner records, assessment and lesson orchestration. Matrix owns reusable interactive/spatial execution, world/experiment state, assets and observed actions/results. School remains independently useful; its optional Matrix integration uses a limited API, not Codex credentials.

A physics playground, scale lab, science exhibit or playful demonstration can live in Matrix. Put controls, transitions and observations in reusable modules; a demo adapter does not move a learner database into this repo. Guided lessons and historical mentors belong to School, consuming those capabilities through the existing boundary.

Use HTML, Three.js and WebXR views over the same experience. Simultaneous multi-device synchronization remains separate work. Label historical emulation and check educational models/sources rather than treating roleplay as historical evidence.

# 7. How to classify a new task

A new resource is normally a reference for an existing owner. A creation method is not automatically a new product. Capability additions need a concrete journey; changing the selected deliverable needs an explicit scope decision.

## Issue and roadmap map

This indexes existing owners; it is **not a dependency chain or a claim that open issues are wholly unimplemented**. Detailed acceptance stays in the linked issues. Numbers refer to this Matrix repository unless labeled otherwise.

| Area | Existing issues | Boundary |
| --- | --- | --- |
| Platform and current creator experience | [#12](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/12), [#44](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44), [#122](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122) | Foundation ownership, Web runtime and current feature; not three engines |
| Operator, context and observed repair | [#59](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/59), [#116](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/116), [#8](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/8), [#25](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/25) | Persistent agent, current capabilities, visual context and receipt-backed recovery |
| Creation inputs and assets | [#9](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/9), [#28](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28), [#91](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/91) | Catalogs, direct authoring and optional image iteration; procedural authoring uses #122's runtime |
| Runtime behaviors and experiments | [#13](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/13), [#31](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/31), [#32](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/32) | Execution/ownership, scoped action/observation access and experiment state |
| Bodies and resident simulation | [#14](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/14), [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15), [#16](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/16), [#17](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/17), [#18](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/18), [#19](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/19), [#20](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/20), [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) | Body/animation/navigation versus resident policy, memory, coordination and persistence |
| Resident creation and dynamic quests | [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109), [#118](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/118) | Scoped builders and citizen-driven offers; creator-authored objectives need not wait for a society |
| Spatial presence and physical observations | [#22](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/22), [#26](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/26), [#38](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38), [#41](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/41) | Room geometry, camera context, geography and later presence; distinct evidence gates |
| Independent School integration | [#23](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/23), #31/#32 and the linked School roadmap | Matrix execution versus School teaching/private learner data |
| Archived native content and WebXR submissions | [#21](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/21), [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24) | #21 records unfinished native pack work; #24 now tracks new WebXR coursework deliverables. Historical APKs remain release evidence, not new acceptance. |
| Optional providers and future worlds | [#62](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/62), [#125](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/125), [upgrader](VISION.md#later-dynamic-world-improvement) | None selected automatically |

## Cross-repository references

The organization [MODULES.md](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/MODULES.md) remains the canonical cross-product responsibility map. Modules are not automatically separate services or repositories. This document navigates those owners, not replaces their contracts.

The [School BUILD_PLAN](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/BUILD_PLAN.md) and [ROADMAP](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/ROADMAP.md) cover School delivery and cross-product integration. S0–S5 and Citizens research C0–C3 are not global prerequisites for Creator Mode. Matrix's active queue stays in its implementation plan.

The organization [research index](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/RESOURCES.md) owns Citizens/motion/community references. [Matrix resources](RESOURCES.md) owns creation references and links back rather than duplicating that catalog. Manfred/private context and external compute remain separately owned integrations, not mandatory demo backends.

# 8. Repository cleanup policy

Keep the existing project and code. The authorized move places the complete Unity project and native scripts in `Archive/Unity/` while leaving WebRuntime and ControlService in place. Preserve active worktrees, PR dependencies, history and save compatibility. Further moves need a concrete dependency review.

Keep one active slice in `IMPLEMENTATION_PLAN.md`: goal, actual base, in-scope outcome, exclusions, acceptance/evidence and blockers. Record and continue an already-selected compatible slice rather than replacing it. New references do not silently change scope or #122 acceptance.

Detailed observations belong in checkpoints, runbooks and `Validation/`; historical “next” suggestions do not override the active queue. Keep exact source/PR links. Open PR, merged source, running service and wearer-tested build are distinct states.

The documentation review is not blanket code approval or new runtime evidence. Refresh refs before integration. Do not infer unpushed work, merge unrelated runtime PRs or close umbrella issues merely to shrink a board. Use merged-source links for current behavior and pinned commit links for dated evidence.

Portals, the upgrader, full society, global mapping and multiplayer remain future work unless selected. The existing Creator Mode goal remains active. **Do not rebuild or restart the project.**
