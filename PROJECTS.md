# Matrix repository project map

Updated September 26, 2026. This repository contains several generations and application tracks sharing code and history; it is a **monorepo**, not one linear application.

Start with [VISION.md](VISION.md) for the central product idea, [PRD.md](PRD.md) for requirements, [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for current work, [AGENTS.md](AGENTS.md) for working rules, and [RESOURCES.md](RESOURCES.md) for creation references. This map organizes existing work; it is not a second implementation queue.

## TL;DR

**One vision: an inhabited Matrix containing White Rooms/holodecks. One defining command: “Operator, load XYZ.” Several creation methods can fulfill it.** The current deliverable remains the voice-created interactive experience under #122, with playable and educational demonstrations.

| Track | Role | Priority boundary |
| --- | --- | --- |
| Matrix Web / Current | Three.js, WebXR, PC-local Operator, procedural/reused/Blender content, interactions and displays | Current create → play/learn → revise → save loop under #122 |
| Matrix Unity / Original | Native Quest/desktop, original White Room, MRUK room AR and AssetBundles | Preserve supported builds and course evidence; not the new generalized runtime |
| Matrix World | Persistent inhabited places, offices and holodecks; optional georeferenced/Earth-aligned views | Broader world composition, not a prerequisite for a local experience; #125 portals are speculative |
| AI Citizens | Embodiment, needs, schedules, decisions, memory and social simulation | Preserve the existing open stack; richer autonomy is not the default demo queue |
| School of the Ancients | Independent education product consuming reusable experiences | Important learning use case; separate curriculum/learner-state ownership |
| Dynamic world upgrader | Later inspection and improvement of worlds/assets/interactions | Deferred; no automatic overnight worker in the current slice |

Matrix Web and Matrix Unity use the shared PC-side ControlService boundary. On the inspected Citizens stack, the opt-in `/web/` panel uses the same `MatrixWorld`, renderer and browser/PC checkpoints; `/web/citizens.html` remains an isolated fixture. Track ownership does not establish merged status or device support. Consult [checkpoints](Docs/Current-Checkpoint.md), the relevant PR and [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md).

# 1. Matrix Web / Current active platform

**Status: default for new generalized Matrix runtime work and the current immersive creation/learning demo.**

Primary homes: `WebRuntime/`, `ControlService/`, and `Start-CodexControlService.ps1`.

Feature owners: [#122 Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122), [#44 Web runtime](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44), [#59 Agent Portal](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/59), and [#116 runtime-aware prompts](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/116).

```text
Desktop browser / Quest WebXR
              |
Three.js Matrix — White Room or AR presentation
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

Create complete usable experiences, not just meshes. A world may combine procedural layouts and geometry, imported assets, reusable behaviors, physics, controls, displays, audio, executable objectives and supported persistent state. Build only the missing capabilities required by the selected example; these are product requirements, not a claim that all loaders/mechanics exist.

| Creation path | Existing home / meaning |
| --- | --- |
| Load existing content | #9/#28 catalogs and current Web GLB path; #21 only for native Unity packs |
| Generate directly in code | #122/#44 ordinary procedural modules, sharing Matrix identity and lifecycle |
| Author or refine assets | #28 Blender/source → validated catalog → ordinary world object |
| Mockup/reference first | #91 concept versions and explicit selection; optional input to Blender or #122's procedural authoring, not a new runtime |

Procedural creation can provide a first version where suitable. Catalog reuse avoids unnecessary authoring. Blender remains an optional rich asset/rig/animation factory. All paths use the same identity, validation, interaction and persistence contracts. Do not require GLB export or a Blender round trip for direct procedural geometry. [Sakuragaoka Station](RESOURCES.md#sakuragaoka-station--procedural-world-construction) is a reference for this path, not a replacement engine or required port.

The White Room is the creation space/metaphor. Desktop, VR and AR are presentation/input modes; Creator and Play/Test are interaction/authority modes. Neither distinction requires a second engine or a separate headset editor.

```text
one authoritative experience state
   |-- HTML controls / results
   |-- Three.js browser scene
   |-- WebXR in-world controls / scene
   +-- bounded agent actions / observations
```

An immersive panel must be usable in the tested headset mode; an ordinary HTML page is not automatically an XR display. Reuse an experiment's math and state rather than independently implementing the same lesson twice.

## Current implementation

The merged foundation through #98/#99 includes Agent Portal/session/tool boundaries, GLB/animation and component paths, world checkpoints and selected desktop/Quest observations. The open Citizens stack adds bounded shared-world simulation, authored station interactions and recovery. [Current checkpoints](Docs/Current-Checkpoint.md) and the [shared-world runbook](Docs/Citizens-Shared-World.md) preserve exact evidence and limits; inspect current refs before using them as a baseline.

The product direction does not convert the earlier bounded virtual-floor drop into general rigid-body physics or declare #122 complete. Review actual source, open work and the running build before making support claims. A documentation branch does not reveal another session's local or unpushed implementation.

# 2. Matrix Unity / Original

**Status: supported legacy/native implementation and validated historical work.**

Homes: `Assets/`, `Packages/`, `ProjectSettings/`, `Build-WhiteRoom.ps1`, `Build-RoomAR.ps1`, `Build-Quest.ps1`, `Build-Desktop.ps1`, and Unity content-pack tooling.

This includes the original White Room, Quest virtual room, MRUK room-aware AR, voice/text proposals and reviewed Apply, stable IDs/Undo/save, compiled Rotate/Bob, prefab/AssetBundle loading and historical coursework snapshots. `/` is the original PC Operator surface; the native runtime is a separate application connected to ControlService.

Preserve matching build/runbook/release paths. Unity-specific restoration, APK or MRUK tasks may remain Unity-only. New generalized voice-created experiences, HTML, procedural content and current Blender/GLB authoring normally belong to Matrix Web. **Returning to the vision does not mean returning to Unity.**

# 3. Matrix World

**Status: persistent inhabited-world application direction, not a replacement renderer or a new immediate task.**

The wider Matrix contains places where humans and AI citizens live, work and meet, with White Rooms/holodecks inside it. An agent office is one type of place, not the entire product. A local holodeck remains independently useful before a city or society is implemented.

Existing specific owners: [#38 Matrix Boulder](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38) for georeferenced worlds/Earth registration, [#41 Astral Travel](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/41) for later detached presence, and [#125](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/125) for speculative portal-linked public offices. Preserve `Build-MatrixBoulder.ps1` prototypes/history. Geography is one specialization, not a requirement for every inhabited world.

World composition consumes shared runtime, content, spatial and Citizens capabilities. Do not create another authoritative scene system. Keep world-instance ownership explicit: a holodeck reset must not erase the surrounding world, a visitor's identity or unrelated progress. Public URLs do not establish common identity, trust or seamless cross-site XR. #125 remains theory/backlog only.

# 4. AI Citizens / Character Body

**Status: existing bounded desktop candidates; preserve their stack, saves and evidence. Further autonomy is a separately selected application lane.**

Owners: [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29), #14 body/animation, #15 interaction/navigation, #16 GOAP, #17 needs/schedules, #18 identity/memory/dialogue, #19 social behavior and #20 persistence/replay. [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109) covers resident worldbuilding; [#118](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/118) covers broader citizen-driven quests.

The isolated fixture and opt-in main-world simulation reuse MatrixWorld movement, interaction receipts, stable IDs and checkpoints. Residents own decisions; Matrix owns execution. Preserve bounded retries, reservations, migrations and verified outcomes when creation work touches these contracts.

A teacher character, creator-authored objective or student experiment does not require a complete needs/schedules/social simulation. Reuse a working character or interaction when useful without making all Citizens capabilities mandatory.

Resident worldbuilding can use shared world-facing capabilities under explicit delegated scope. A simulated citizen, an animated character and an avatar showing a real coding/research session are different things. Neither a character nor a public visitor automatically gets the Operator's PC credentials or authority to run fleet jobs. Keep School curriculum and learner records outside Citizens.

# 5. Shared Matrix Core / ControlService

`ControlService/` coordinates scene identity, validation, tool boundaries, leases, receipts, catalogs, persistence, captures, Agent Portal connectivity and client integration. `WebRuntime/` retains its existing runtime state/execution responsibilities. This is an ownership seam, not a mandate to move all state to a new server.

When changing shared code, identify the consuming track, preserve existing Unity behavior, keep renderer-neutral contracts where practical and avoid parallel catalog/state/queue implementations. Prefer reusable capabilities to object-specific endpoints. Keep privileged credentials off browsers/headsets and private data out of world exports or public evidence.

# 6. School of the Ancients is a separate product

**Education is a primary use case of Matrix, not a reason to merge product ownership.**

School owns curriculum, mentor pedagogy, learner records, assessment and lesson orchestration. Matrix owns reusable interactive/spatial execution, world/experiment state, assets and observed actions/results. School should remain useful as an independent text/web learning product; its optional Matrix integration uses a limited API, not Codex credentials.

A reusable physics playground, scale lab, science exhibit or playful demonstration can live in Matrix. Put its controls, state transitions and observations in reusable modules; a demo adapter does not move a learner database into this repo. A guided lesson or historical mentor belongs to School, consuming those modules through the existing boundary.

Use HTML, Three.js and immersive WebXR views over the same experience. Simultaneous multi-device synchronization remains separate work. Label emulated historical figures and check educational models/sources rather than treating roleplay as historical evidence.

# 7. How to classify a new task

A new resource is normally a reference for an existing owner. A new creation method is not automatically a new product. A capability addition needs a concrete user journey; a change to the selected deliverable needs an explicit scope decision.

## Issue and roadmap map

This is an index of existing owners, **not a dependency chain or assertion that open issues are wholly unimplemented**. Issue acceptance stays in the linked issues. Numbers refer to this Matrix repository unless explicitly labeled otherwise.

| Area | Existing issues | Boundary |
| --- | --- | --- |
| Platform and current creator experience | [#12](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/12), [#44](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44), [#122](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122) | Foundation ownership, Web runtime and current end-to-end feature; not three independent engines |
| Operator, context and observed repair | [#59](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/59), [#116](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/116), [#8](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/8), [#25](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/25) | Persistent agent, current capabilities, visual context and receipt-backed recovery |
| Creation inputs and assets | [#9](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/9), [#28](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28), [#91](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/91) | Catalogs, direct authoring and optional image iteration; procedural authoring consumes #122's shared runtime |
| Runtime behaviors and reusable experiments | [#13](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/13), [#31](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/31), [#32](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/32) | Execution/ownership, scoped action/observation access and experiment state; #122 selects concrete physics/display/objective use |
| Bodies and resident simulation | [#14](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/14), [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15), [#16](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/16), [#17](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/17), [#18](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/18), [#19](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/19), [#20](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/20), [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) | Body/animation/navigation versus Citizens goals, memory, coordination and persistence |
| Resident creation and dynamic quests | [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109), [#118](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/118) | Scoped builders and citizen-driven offers; a simple creator-authored objective need not wait for the whole society |
| Spatial presence and physical observations | [#22](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/22), [#26](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/26), [#38](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38), [#41](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/41) | Room geometry, physical-camera context, geography and later detached presence; distinct evidence gates |
| Independent School integration | [#23](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/23), #31/#32 and the linked School roadmap | Matrix execution/experiments versus School teaching and private learner data |
| Native content and reproducibility | [#21](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/21), [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24) | Legacy Unity pack acceptance and matching releases/evidence; no Web AssetBundle dependency |
| Optional provider and future worlds | [#62](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/62), [#125](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/125), [deferred upgrader](VISION.md#later-dynamic-world-improvement) | Alternate agent inputs, portal theory and later improvement; none selected automatically |

## Cross-repository references

The organization [MODULES.md](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/MODULES.md) remains the canonical cross-product responsibility map. Modules are not automatically separate services or repositories. This Matrix document navigates those owners; it does not replace their contracts.

The [School BUILD_PLAN](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/BUILD_PLAN.md) and [extended ROADMAP](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/ROADMAP.md) cover School delivery and cross-product integration. Their S0–S5 and Citizens research C0–C3 sequences are not a global prerequisite list for Matrix Creator Mode. Matrix's active queue stays in this repository's implementation plan.

The organization [research index](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/RESOURCES.md) owns Citizens/motion/community research. [This repository's resource index](RESOURCES.md) owns creation references and links back instead of duplicating that catalog. Manfred/private human context and external compute remain separately owned integrations, not mandatory new backends for the local demo.

# 8. Repository cleanup policy

Organize by documentation and ownership before moving code. Preserve validated scripts, active worktrees, open PR dependency chains, historical snapshots and save compatibility. Avoid mass directory moves, a third roadmap repository and cosmetic engine rewrites.

Keep one active Matrix slice recorded in `IMPLEMENTATION_PLAN.md`: goal, actual compatible base, in-scope outcome, explicit exclusions, acceptance/evidence and known blockers. If an active session already selected a compatible slice, record and continue it rather than inventing a replacement. New references do not silently change that scope or #122's acceptance.

Detailed chronological observations belong in `Docs/Current-Checkpoint.md`, feature runbooks and `Validation/`; old “next step” suggestions do not override the selected queue. Keep an exact source/PR link when summarizing history. Open PR, merged source, running service and wearer-tested build are distinct states.

The consolidation review is a planning/source inventory, not blanket code approval or new runtime evidence. Refresh refs and examine actual diffs before any authorized integration. Do not infer unpushed work from GitHub, merge the stack automatically, or close umbrella issues merely to make the board smaller.

The dynamic upgrader, portal-linked offices, full society, global mapping and multiplayer remain future work unless explicitly selected. The existing Creator Mode goal remains active; this map does not add another milestone or restart its implementation.
