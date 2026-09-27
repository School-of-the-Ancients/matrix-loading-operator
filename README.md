# Matrix Loading Operator

> **A persistent Three.js/WebXR world where AI citizens can live independently and humans can enter from desktop/VR or visit through AR. Humans and authorized AI citizens can ask Operator to create and change the world. Save it and return.**

Matrix is inspired by **The Matrix** and **Ready Player One**: one editable persistent digital world rather than a collection of separate prototypes. AR is a view into that same world, not a second citizen simulation.

## What Matrix is

```text
Human or AI citizen
        |
"Operator, load/create/change XYZ"
        |
        v
Creation pipeline
  - procedural generation
  - Blender MCP -> validated import
  - reusable assets/capabilities
  - optional image mockup -> selected concept -> build
        |
        v
Three.js / WebXR world
  - desktop
  - VR
  - AR
  - physics and interaction
  - save / load
        |
        v
AI Citizens
  - memory
  - needs / schedules
  - planning
  - relationships
  - world interaction
  - eventually world building through the same bounded capabilities
```

The original Unity Matrix/White Room implementation is preserved in [Archive/Unity](Archive/Unity/README.md) as read-only history. **New runtime work targets Three.js/WebXR.**

## Start here

- [VISION.md](VISION.md) — the product idea and boundaries.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together.
- [ROADMAP.md](ROADMAP.md) — Now / Next / Later.
- [RESOURCES.md](RESOURCES.md) — references for creation and AI citizens.
- [AGENTS.md](AGENTS.md) — rules for coding agents.
- [#122 Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122) — current implementation focus.

Detailed technical runbooks and evidence live under `Docs/` and `Validation/`.

## Runtime

- `WebRuntime/` — Three.js/WebXR Matrix client and world runtime.
- `ControlService/` — PC-local Operator/Agent Portal, tools, validation and receipts.
- `Archive/Unity/` — historical Unity source and release evidence.

Do not restart or rebuild the project because the documentation was simplified. Continue the existing implementation and preserve saved worlds, current contracts and merged work.
