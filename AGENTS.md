# Instructions for coding agents

Read these before making architectural or priority decisions:

1. [VISION.md](VISION.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [ROADMAP.md](ROADMAP.md)
4. the issue currently being implemented

## Product

> **A Three.js/WebXR world where humans and AI citizens can ask Operator to create and change things around them. Start blank or load a saved world. Save it and return.**

The forward runtime is `WebRuntime/` plus the existing `ControlService/`. Unity is read-only history under `Archive/Unity/`.

Do **not** rebuild the engine, start another Matrix repository, introduce a second world-state owner or reset existing worlds because documentation changed.

## Current priority

Continue the **Now** section of [ROADMAP.md](ROADMAP.md), currently [#122 Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122).

Prefer complete user-visible slices:

```text
request -> create -> interact -> revise -> save -> reopen
```

## Creation

Treat these as complementary backends behind Operator:

- procedural generation;
- reusable assets/capabilities;
- Blender MCP + validated import;
- optional image mockup before procedural/Blender creation.

Do not require Blender when procedural generation is enough. Do not claim an image is a functioning world.

## AI Citizens

Citizens share Matrix world identity and legal world actions. They may eventually request construction through bounded capabilities, but **never receive Operator/PC credentials directly**.

Do not build a second executor, scene graph or physics system for Citizens.

## Boundaries

- Matrix executes world actions.
- Citizens chooses resident intentions.
- School owns teaching/curriculum/learner records.
- Manfred owns private human/wearable context.
- Privileged credentials stay on the PC side.

## Evidence

Keep implementation detail and test evidence in issues, PRs, `Docs/` and `Validation/`. Distinguish source changes, automated tests, desktop observation and actual VR/AR wearer validation.

New research links go to [RESOURCES.md](RESOURCES.md) unless they create a concrete implementation task.
