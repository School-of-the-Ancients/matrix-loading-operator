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

The stable baseline remains v1.1.0, source `9453ef06b1873937822c1cf985115f05f72e1e20`.
The [v1.2.0 checkpoint prerelease](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.2.0)
is published from `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0`.
Its eight implementation PRs are merged; do not rebuild the context, lock,
approval, speech or point-movement slices. Follow
[#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173)
for remaining matched-latency and physical acceptance. The wearer explicitly
deferred Fit to room controls and their measured-fitting checks from v1.2;
ordinary AR edits use free placement while explicit measured tools keep their
guards. #154/#172 and v2 #156 are outside this checkpoint. Use draft PRs.
Do not merge or release without authorization. Keep the published tag/assets
fixed; documentation updates on main do not change the frozen release source.

Read [the sprint acceptance record](Validation/V1.2-Headset-Acceptance.md)
at startup and after every goal refresh. Run automated/desktop checks during
implementation and add physical cases to that one checklist; pending hardware
checks do not stop unrelated cloud work. Bundle the normal wearer session
once the candidate is frozen, rather than after every PR. An early targeted
check is appropriate only for a hardware-dependent design blocker or suspected
major regression; record its reason. Reuse existing evidence across resumed
goals. Invalidate only affected checks with a recorded change/impact reason;
keep historical identities and unaffected results. Never convert cloud tests,
old releases or an unanswered request into a headset pass. Keep every required
release gate in #173 open until its identified candidate passes.

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
