# Instructions for coding agents

Read:

1. [VISION.md](VISION.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [ROADMAP.md](ROADMAP.md)
4. the issue currently being implemented

## Product

> **A persistent Three.js/WebXR world where AI citizens can live independently and humans can enter from desktop/VR or visit through AR. Humans and authorized AI citizens can ask Operator to create and change the world. Save it and return.**

The forward runtime is the existing `WebRuntime/` + `ControlService/`. Unity is read-only history under `Archive/Unity/`.

Do **not** rebuild the engine, create another Matrix repository, introduce a second authoritative world state or reset existing worlds because planning/docs changed.

## Core invariants

- Desktop, VR and AR are views/access modes for the same digital world.
- AR does not create another citizen simulation.
- Persistent citizens should converge on one world/simulation owner rather than one clock per visitor.
- Matrix executes world actions; Citizens chooses resident intentions.
- Humans and citizens may use bounded creation capabilities with different authority.
- Citizens never receive Codex, GitHub, Blender, MCP or owner credentials directly.
- Preserve stable IDs, compatible state, validation, approvals and runtime receipts.

## Current work

Use the **Now** section of [ROADMAP.md](ROADMAP.md):

- #122 creator loop;
- #20/#29 persistent AI Citizens world;
- #22 AR visit/alignment into the same world;
- #116 live Operator capability grounding.

Continue compatible merged work; do not restart earlier milestones.

## Creation

Treat these as complementary backends behind Operator:

- procedural generation;
- reusable assets/capabilities;
- Blender MCP + validated import;
- optional image mockup before procedural/Blender creation.

Prefer the fastest suitable path. Do not require Blender when procedural generation is enough. Do not claim an image mockup is a functioning world.

## Boundaries

- Matrix owns world execution, Operator, creation, WebXR, persistence and AI Citizens.
- School owns teaching/curriculum/learner records.
- Manfred owns private human/wearable context.
- Privileged credentials stay on the PC side.

## Evidence

Keep implementation detail and test evidence in issues, PRs, `Docs/` and `Validation/`. Distinguish source changes, automated tests, desktop observation and actual VR/AR wearer validation.

New research links go to [RESOURCES.md](RESOURCES.md) unless they create a concrete implementation task.
