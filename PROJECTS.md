# Matrix repository project map

This repository contains several generations and application tracks that share code and history. It is a **monorepo**, not one linear application.

If you are an AI coding agent, read this file before choosing an implementation path. Also read [AGENTS.md](AGENTS.md).

## TL;DR

There are four important tracks:

1. **Matrix Unity / Original** — the original Unity Quest/desktop Matrix, White Room, room-aware AR, content packs and historical coursework builds.
2. **Matrix Web / Current** — the current active platform direction: Three.js + WebXR + the PC-local Codex Agent Portal + Blender + runtime components + interactive web surfaces.
3. **Matrix World** — persistent/georeferenced world work such as Matrix Boulder, Earth registration and future AR overlays.
4. **AI Citizens** — characters, animation/embodiment, needs, schedules, GOAP, memory and social simulation.

Matrix Web and Matrix Unity currently use the PC-side **ControlService / Matrix Core** layer. Matrix World and AI Citizens have separate prototype paths and may adopt that shared layer later. These tracks are not interchangeable implementations.

---

# 1. Matrix Web / Current active platform

**Status: current default for new generalized Matrix runtime work.**

Primary paths:

- `WebRuntime/` — Three.js browser runtime and WebXR AR/VR client.
- `ControlService/` — shared PC service, Agent Portal, validation, receipts, asset/component catalogs and Matrix tools.
- `Start-CodexControlService.ps1` — PC-local Codex-enabled service.
- Issue [#44](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44) — Three.js/WebXR runtime umbrella.
- Issue [#59](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/59) — spatial Codex Agent Portal.

Conceptually:

```text
Quest / desktop browser
        |
        v
Three.js / WebXR Matrix
        |
        v
Matrix Agent Portal / ControlService
        |
        v
PC-local persistent Codex
        |
        +-- repository / shell / GitHub
        +-- Blender MCP
        +-- Matrix MCP/tools
        +-- other configured tools
```

The browser is a **thin spatial client**. Codex remains on the PC with its normal development environment and privileged tools.

The important addition over ordinary remote desktop is Matrix context: selected object, pointing target, room/scene state, viewer context, captures and typed world capabilities.

## Current creation direction

The end goal is not a catalog of one-off commands such as “rotate”, “bob”, “wave”, “open door”, etc.

The intended model is:

- Codex creates or modifies experiences.
- Blender is an optional rich 3D asset/rig/animation factory.
- Three.js/WebXR is the programmable spatial runtime.
- HTML/CSS/JS can provide ordinary interactive application surfaces.
- Matrix validates, owns authoritative state and exposes bounded execution/capability boundaries.

A Matrix experience may eventually contain:

- HTML UI, notebooks, controls, charts and diagrams;
- Three.js scenes;
- WebXR AR/VR presentation;
- GLB assets;
- rigs and animation clips;
- materials, shaders and particles;
- audio;
- reusable runtime components/behaviors;
- simulation state;
- agent-callable tools;
- persistence/version metadata.

One experience may expose several surfaces over the **same authoritative state**:

```text
shared experience state
   |        |        |
   |        |        +--> WebXR immersive scene
   |        +-----------> Three.js browser scene
   +--------------------> HTML application / notebook
```

Do not create independent HTML and XR simulations when they represent the same experiment.

## Current implementation stack

The Agent Portal PR chain beginning with #60 establishes:

- PC-local Codex app-server transport;
- durable Matrix session mapping;
- thin browser/in-world Agent Portal UI;
- spatial context;
- Matrix MCP/tool exposure;
- native approvals;
- runtime receipts;
- GLB registration/spawn;
- generic bounded WebXR components.

Check the latest open PRs before assuming a capability is already on `main`.

---

# 2. Matrix Unity / Original

**Status: supported legacy/native implementation and validated historical work. Do not treat it as the default architecture for new generalized features.**

This is the original Matrix Loader / Operator implementation.

Primary paths include:

- `Assets/`
- `Packages/`
- `ProjectSettings/`
- `Build-WhiteRoom.ps1`
- `Build-RoomAR.ps1`
- `Build-Quest.ps1`
- `Build-Desktop.ps1`
- Unity-specific content-pack/export tooling and historical validation.

Major features include:

- Matrix White Room;
- Quest virtual room;
- room-aware Quest AR / MRUK work;
- original voice/text Operator;
- scene proposal / Apply workflow;
- stable IDs, Undo, save/restore;
- Rotate/Bob compiled behaviors;
- Unity prefab/AssetBundle content loading;
- Poly Haven and other content-catalog experiments;
- historical coursework release snapshots.

Routes:

- `/` is the original PC Operator/control surface associated with the Unity-era workflow.
- The Unity runtime itself is a separate desktop/Quest application connected to ControlService.

Keep this implementation working where practical because it contains useful validated device behavior and course evidence.

However, **do not add new generalized Matrix capabilities to Unity just because older code already exists there**. If the task is about arbitrary AI-generated experiences, runtime components, browser UI, HTML, general Blender output or the current Agent Portal, it normally belongs to Matrix Web.

Unity-specific issues such as AssetBundle restore or old coursework validation may intentionally remain Unity-only.

---

# 3. Matrix World

**Status: future/persistent-world application layer; not a replacement renderer.**

Primary umbrella:

- Issue [#38 Matrix Boulder](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38).
- Issue [#41 Astral Travel](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/41).
- `Build-MatrixBoulder.ps1` and existing prototype/history.

Goal:

Create a persistent georeferenced virtual world aligned with the physical world.

Examples:

- virtual Boulder / eventually larger Earth-scale registration;
- geospatial entity persistence;
- humans entering through web/VR/AR;
- AR overlay of virtual entities at physical locations;
- AI Citizens inhabiting the persistent virtual world;
- later robotics/physical-world embodiments;
- detached/“Astral” virtual presence.

Future work should increasingly consume the **Matrix Web / shared Matrix Core** architecture rather than creating another isolated engine-specific Matrix implementation.

Historical Unity/Cesium prototypes are references and evidence, not necessarily the final runtime architecture.

---

# 4. AI Citizens / Character Body

**Status: separate simulation/application modules built on Matrix capabilities.**

Primary issues:

- [#29 AI Citizens roadmap](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29)
- #14 character body / animation
- #15 interactions/navigation
- #16 GOAP
- #17 needs/schedules/utility
- #18 identity/memory/dialogue
- #19 multi-agent/social behavior
- #20 persistence/replay

Conceptual layers:

```text
Character Body
- mesh / rig
- animation
- navigation
- finite interactions

AI Citizens
- identity
- needs
- schedules
- utility
- GOAP
- memory
- dialogue
- social behavior
```

Citizens should use Matrix world/runtime capabilities rather than becoming another renderer or another authoritative scene system.

Do not block generic Matrix creation work on Citizens.

Do not put School curriculum or learner records into Citizens.

---

# 5. Shared Matrix Core / ControlService

`ControlService/` is currently the shared seam between several generations.

It owns or coordinates concepts such as:

- scene/object identity;
- validation;
- command/tool boundaries;
- runtime leases;
- receipts and observed outcomes;
- asset/component catalogs;
- persistence;
- captures;
- Agent Portal connectivity;
- client integration.

This directory contains historical and current paths. **Shared location does not mean every subsystem is part of the same product generation.**

When modifying ControlService:

1. Identify which track consumes the change.
2. Avoid introducing a renderer-specific assumption into a renderer-neutral contract.
3. Preserve existing Unity behavior unless the task explicitly retires it.
4. Prefer new generic Matrix Web capabilities to be expressed as reusable state/tool/component contracts rather than one-off endpoints.
5. Keep privileged credentials and PC tools off browser/headset storage.

---

# 6. School of the Ancients is a separate product

School lives in the separate organization roadmap/repositories.

School may consume Matrix through:

- ordinary interactive HTML lessons;
- HTML + Three.js labs;
- immersive Three.js/WebXR lessons;
- synchronized multi-surface experiences.

School owns:

- curriculum;
- mentor pedagogy;
- learner records;
- assessment;
- lesson orchestration.

Matrix owns:

- reusable interactive/spatial runtime capabilities;
- world state;
- observed actions/outcomes;
- asset/component execution.

Do not implement School-specific curriculum directly inside Matrix unless an issue explicitly calls for a compatibility/demo adapter.

---

# 7. How to classify a new task

Use this decision order.

### Is it about Codex creating/changing an interactive experience?

Use **Matrix Web / #44 / #59**.

Examples:

- generated Three.js behavior;
- HTML interactive UI;
- WebMCP-style tools;
- Blender → GLB → Matrix;
- shaders/particles/audio;
- generic runtime components;
- WebXR interaction;
- spatial Agent Portal context.

### Is it specifically about an existing Unity build, APK, MRUK path or AssetBundle?

Use **Matrix Unity / Original**.

### Is it about persistent geospatial Boulder/Earth state?

Use **Matrix World / #38**.

### Is it about autonomous residents, character needs/planning/memory/social life?

Use **AI Citizens / #29**.

### Is it about lessons, teaching or learner state?

It probably belongs in **School of the Ancients**, consuming Matrix through an API.

---

# 8. Repository cleanup policy

For now, organize by **documentation and ownership before moving code**.

Do not perform a mass directory move merely to make the tree prettier. The repository contains validated scripts, historical release paths and open stacked PRs; gratuitous moves create merge conflicts and break runbooks.

Preferred cleanup order:

1. maintain this project map;
2. label/document issue ownership;
3. make new code follow current track boundaries;
4. gradually isolate shared contracts;
5. move legacy code only when there is a concrete maintenance benefit and tests cover the move.

The goal is that a human or AI agent can enter the repository and understand the architecture without reverse-engineering its historical iterations.
