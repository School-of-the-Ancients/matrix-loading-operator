# Matrix repository project map

Updated September 26, 2026. This repository contains several generations and application tracks sharing code and history; it is a **monorepo**, not one linear application.

Read [VISION.md](VISION.md) for the 2023/2024 roots, [PRD.md](PRD.md) for requirements, [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for current work, and [AGENTS.md](AGENTS.md) before coding.

## TL;DR

**The product center is voice-created interactive worlds: WebXR + a Matrix White Room / AR space, with playable experiences and fun student/educational demos.** “Ready Player Matrix” describes that direction, not another repository or renderer.

| Track | Role | Priority boundary |
| --- | --- | --- |
| Matrix Web / Current | Three.js, WebXR, PC-local Operator, procedural/reused/Blender content, interactions and displays | Default: the create → play/learn → revise → save loop under #122 |
| Matrix Unity / Original | Native Quest/desktop, original White Room, MRUK room AR and AssetBundles | Preserve supported builds and course evidence; not the new generalized runtime |
| Matrix World | Persistent/georeferenced worlds, Boulder, Earth-aligned overlays | Future application layer, not a prerequisite for local experiences |
| AI Citizens | Embodiment, needs, schedules, decisions, memory and social simulation | Preserve the existing open stack; richer autonomy is not the default demo queue |
| School of the Ancients | Independent education product consuming reusable experiences | Central learning use case; separate curriculum/learner-state ownership |
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

Procedural creation gives a fast first version where suitable. Catalog reuse avoids unnecessary authoring. Blender remains an optional rich asset/rig/animation factory. All paths must use the same identity, validation, interaction and persistence contracts. Do not require GLB export or a Blender round trip for direct procedural geometry.

The White Room remains the user-facing creation metaphor in the Web implementation. Desktop, VR and AR are presentation/input modes; Creator and Play/Test are interaction/authority modes within them. Do not create a new engine or a separate headset editor.

```text
one authoritative experience state
   |-- HTML controls / results
   |-- Three.js browser scene
   |-- WebXR in-world controls / scene
   +-- bounded agent actions / observations
```

An immersive panel must be usable in the tested headset mode; an ordinary HTML page is not automatically an XR display. Reuse an experiment's math and state rather than independently implementing the same lesson twice.

## Current implementation

The merged foundation through #98/#99 includes Agent Portal/session/tool boundaries, GLB/animation and component paths, world checkpoints and selected desktop/Quest observations. The open Citizens stack adds bounded shared-world simulation, authored station interactions and recovery. [Current checkpoints](Docs/Current-Checkpoint.md) and the [shared-world runbook](Docs/Citizens-Shared-World.md) preserve exact evidence and limits.

The product direction does not convert the earlier bounded virtual-floor drop into general rigid-body physics or declare #122 complete. Review the actual source, open stack and runtime before making support claims.

# 2. Matrix Unity / Original

**Status: supported legacy/native implementation and validated historical work.**

Homes: `Assets/`, `Packages/`, `ProjectSettings/`, `Build-WhiteRoom.ps1`, `Build-RoomAR.ps1`, `Build-Quest.ps1`, `Build-Desktop.ps1`, and Unity content-pack tooling.

This includes the original White Room, Quest virtual room, MRUK room-aware AR, voice/text proposals and reviewed Apply, stable IDs/Undo/save, compiled Rotate/Bob, prefab/AssetBundle loading and historical coursework snapshots. `/` is the original PC Operator surface; the native runtime is a separate application connected to ControlService.

Preserve matching build/runbook/release paths. Unity-specific restoration, APK or MRUK tasks may remain Unity-only. New generalized voice-created experiences, HTML, procedural content and current Blender/GLB authoring normally belong to Matrix Web. **Returning to the vision does not mean returning to Unity.**

# 3. Matrix World

**Status: future/persistent-world application layer, not a replacement renderer.**

Owners: [#38 Matrix Boulder](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38), [#41 Astral Travel](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/41), and existing `Build-MatrixBoulder.ps1` prototypes/history.

The ambition is a georeferenced virtual counterpart to real places, with persistent entities and eventual AR overlays, residents and other embodiments. Consume Matrix's shared capabilities instead of creating another authoritative scene system. Historical Unity/Cesium work is reference/evidence, not an instruction to port the whole world before a classroom demo.

# 4. AI Citizens / Character Body

**Status: existing bounded desktop candidates; preserve their stack, saves and evidence. Further autonomy is a separately selected application lane.**

Owners: [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29), #14 body/animation, #15 interaction/navigation, #16 GOAP, #17 needs/schedules, #18 identity/memory/dialogue, #19 social behavior and #20 persistence/replay. [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109) covers resident worldbuilding; [#118](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/118) covers the broader citizen-driven quest direction.

The isolated fixture and opt-in main-world simulation reuse MatrixWorld movement, interaction receipts, stable IDs and checkpoints. Residents own decisions; Matrix owns execution. Preserve bounded retries, reservations, migrations and verified outcomes when the creation work touches these contracts.

A teacher character, a creator-authored objective, or a student experiment does not require a complete needs/schedules/social simulation. Reuse a working character or interaction when useful, without making Citizens a mandatory dependency.

Resident worldbuilding can later use the same world-facing capabilities under explicit delegated scope. This is not permission to hand residents the Operator's PC credentials. Do not put School curriculum or learner records into Citizens.

# 5. Shared Matrix Core / ControlService

`ControlService/` coordinates scene identity, validation, tool boundaries, leases, receipts, catalogs, persistence, captures, Agent Portal connectivity and client integration. `WebRuntime/` retains its existing runtime state/execution responsibilities. This is an ownership seam, not a mandate to move all state to a new server.

When changing shared code, identify the consuming track, preserve existing Unity behavior, keep renderer-neutral contracts where practical and avoid parallel catalog/state/queue implementations. Prefer reusable capabilities to object-specific endpoints. Keep privileged credentials off browsers/headsets and private data out of world exports or public evidence.

# 6. School of the Ancients is a separate product

**Education is a primary use case of Matrix, not a reason to merge product ownership.**

School owns curriculum, mentor pedagogy, learner records, assessment and lesson orchestration. Matrix owns reusable interactive/spatial execution, world/experiment state, assets and observed actions/results. School should remain useful as an independent text/web learning product; its optional Matrix integration uses a limited API, not Codex credentials.

A reusable physics playground, scale lab, science exhibit or playful demonstration can live in Matrix. Put its controls, state transitions and observations in reusable modules; a demo adapter does not move a learner database into this repo. A guided lesson or historical mentor belongs to School, consuming those modules through the existing boundary.

Use ordinary HTML, Three.js and immersive WebXR views over the same experience. Simultaneous multi-device synchronization remains separate work. Label emulated historical figures and check educational models/sources rather than treating roleplay as historical evidence.

# 7. How to classify a new task

| Task | Home |
| --- | --- |
| “Operator, create/load this world”; procedural layout; creator/play controls | Matrix Web / #122 / #44 / #59 |
| Live world discovery or truthful context in Operator prompts | Matrix Web / #116 with #59 |
| Reusable interaction, collider, display, experiment or objective | Matrix runtime under #122 and the existing #13/#15/#31/#32/#118 owners as applicable |
| Blender/GLB asset, rig, animation or compatible replacement | Existing authoring/catalog path / #28; no second registry |
| Lesson sequence, teaching strategy, historical mentor or learner assessment | School, with a Matrix adapter only as needed |
| Existing APK, MRUK path or AssetBundle | Original Unity track |
| Resident planning, needs, memory or social behavior | AI Citizens / #29 and its subissues |
| Geospatial persistence or Earth-aligned entities | Matrix World / #38 |
| Autonomous review, overnight asset/layout/interaction improvement | Deferred dynamic upgrader; see VISION.md |

Classification does not automatically select priority or close an umbrella issue. Use the active implementation plan and the owner's current task.

# 8. Repository cleanup policy

Organize by documentation and ownership before moving code. Preserve validated scripts, active worktrees, open PR dependency chains, historical snapshots and save compatibility. Avoid mass directory moves and cosmetic rewrites.

Keep the active PRD and implementation plan readable. Detailed chronological observations belong in `Docs/Current-Checkpoint.md`, feature runbooks and `Validation/`; their old “next step” suggestions do not override the active queue. Keep an exact source/PR link when summarizing history.

The dynamic upgrader, a full society, global mapping and multiplayer remain future work unless explicitly selected. The next default result is a usable, voice-created interactive experience that someone can play with and learn from.
