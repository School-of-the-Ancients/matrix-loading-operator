# Instructions for coding agents

Read [VISION.md](VISION.md), [PROJECTS.md](PROJECTS.md), [PRD.md](PRD.md), and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) before making architectural or work-selection decisions. The vision explains why, the PRD defines the product, the implementation plan selects the next small slice, and the controlling issue retains detailed acceptance. [Current checkpoints](Docs/Current-Checkpoint.md) and `Validation/` record evidence, not an independent work queue. [RESOURCES.md](RESOURCES.md) records references and reuse hypotheses, not additional assigned tasks.

## Product direction — September 26, 2026

**The stable idea is an inhabited Matrix containing White Rooms/holodecks, where “Operator, load XYZ” creates a usable experience.** WebXR is the current generalized runtime direction. Playable experiences and fun interactive student demos are the near-term proving ground; everyday AR glasses are a long-term delivery aspiration, not a new-device dependency.

The selected feature remains [#122 — Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122), supported by #44/#59, #116, and the relevant runtime/experiment contracts. Use `IMPLEMENTATION_PLAN.md` for its active slice. Do not revert to an older Citizens-first or indefinitely desktop-only queue because a dated checkpoint or earlier prompt says “next.” Preserve that work and its acceptance; do not erase it or claim it is merged.

Procedural generation, reusable catalog assets and Blender are complementary creation methods. Concept images are an optional input to those methods, not another engine or automatic world conversion. Prefer a fast usable result over mandatory modeling of every object. **Dynamic world upgrading and public-office portals are later roadmap work**: do not start their autonomous reviewer, overnight scheduler or networking as part of the current demo slice.

## Scope stability and documentation ownership

- A new link, image, model, demo or brainstorming conversation does not automatically change the selected milestone. Add a reference to `RESOURCES.md` or the existing owning issue; use the [issue map](PROJECTS.md#issue-and-roadmap-map) before creating a duplicate epic.
- Keep one Matrix work-selection queue in `IMPLEMENTATION_PLAN.md`. Record the current slice's goal, actual base, explicit inclusions/exclusions, acceptance and blockers. Do not create another master-plan file or copy the entire backlog into the active prompt.
- Retain the active compatible slice and local work. Before changing its goals or acceptance, obtain an explicit owner decision and record what changes and what stays deferred. Fix concrete blockers within scope; do not let a reference example become a new required world/engine/provider.
- #122's full acceptance remains in its issue. Completing one slice does not close the feature, and this documentation consolidation does not reduce it to a mesh, image mockup or desktop-only demonstration.
- The organization module map defines cross-product ownership; School delivery/research plans are not a second Matrix priority queue. Historical “next” language and a newer timestamp alone do not override the current owner-selected task. Report genuine conflicts rather than silently choosing a different project.
- Keep detailed evidence in runbooks/checkpoints. Distinguish planning review, source inspection, automated checks, deployed behavior and actual headset observation.

## Default target

Unless the task or issue explicitly says otherwise, **new generalized Matrix runtime work targets the Three.js/WebXR Matrix in `WebRuntime/` and the shared PC-side capability boundary in `ControlService/`.**

```text
Web / Quest WebXR
      |
Three.js Matrix — White Room / AR experience
      |
ControlService / Agent Portal
      |
PC-local Codex + tools/MCPs
```

The White Room is the UX starting point, not a direction to rebuild in Unity. Codex remains on the PC. Browser/headset code is a bounded client and must not receive Codex, GitHub, Blender, MCP or other privileged credentials.

## Do not confuse these tracks

- **Current Web Matrix:** `WebRuntime/`, Agent Portal, Matrix tools, procedural creation, Blender/GLB, reusable behaviors, HTML/Three.js/WebXR experiences and demonstrations.
- **Unity/original Matrix:** `Assets/`, `Packages/`, `ProjectSettings/`, Unity build scripts, original White Room, Room AR and content packs. Preserve the supported native/legacy client.
- **Matrix World:** the persistent inhabited setting and world compositions; Boulder/Earth registration is a specialization. Holodecks belong within that wider vision, but a city is not needed for a local classroom or game. #125 portals are speculative.
- **AI Citizens:** embodiment, navigation, needs, schedules, GOAP, memory and social simulation; preserve the open stack, but do not require a society to create a world or teach a concept. Real tool-using workers and animated/simulated citizens are not interchangeable evidence.
- **School of the Ancients:** independent education product. Matrix may host a reusable demonstration/adapter; School owns curriculum, mentor pedagogy, learner records and assessment.
- **Dynamic upgrader:** later use of shared world/asset tools, not a new default service or replacement runtime.

## Current design rules

1. Preserve working Unity/native paths and release evidence. Do not make Unity the default for new generalized creation.
2. Do not reproduce Codex inside WebXR or add another agent gateway, scene-state owner, catalog, framework, database or universal DSL without a concrete requirement.
3. Use reusable capabilities/components, not hundreds of object-specific semantic endpoints. A new mechanic follows the ordinary reviewed code/test/build/deploy path; imported assets do not authorize arbitrary downloaded code.
4. Use one authoritative experience state across HTML, Three.js and WebXR views. Human controls and agent actions should share transitions/observations, though their authority may differ.
5. Keep Creator versus Play/Test authority separate from desktop versus VR versus AR presentation. A client-side mode toggle cannot grant PC or owner privileges.
6. Keep voice, contextual selection, readable immersive feedback, in-world controls, Stop/Pause and return-to-creator in the current product loop. Desktop is a regression/development surface and text is a fallback, not a substitute for headset acceptance.
7. Preserve existing validation, approvals, runtime receipts and truthful status. Generated, queued, rendered, applied and observed are different states. Query the connected runtime rather than reciting obsolete Unity/white-room capability prompts; coordinate with #116.
8. Preserve stable entity IDs, manual edits, compatible interactions and supported play/lesson/resident state on revision. Handle stale jobs, unavailable assets, transform ownership and save migration. Never silently replace the live world.
9. Real rigid-body/collider behavior is in scope for #122. A bounded drop animation or measured bounding box is not proof of general collision. Keep virtual-floor and physically aligned AR claims distinct.
10. An educational display must reflect real tested state with units/assumptions where relevant. Label historical-character emulation and distinguish sourced material from invented dialogue; never treat persuasive presentation as validation.
11. Keep shared ControlService contracts renderer-neutral where practical. Keep credentials and private room/learner data out of clients, world exports and public evidence.
12. Keep desktop tests, browser observations, VR wearer evidence and AR wearer evidence separate. Do not mark a requirement complete because its priority changed.

## Before coding

- Read the controlling issue and dependencies; select one user-visible slice from the implementation plan.
- Inspect `main`, current open PRs, their base/head refs and active worktrees. The latest implementation may be stacked and not on `main`; a running service may be older again.
- Preserve stacked history, review fixes, state migrations and existing demos. Do not force-push, mass-move code, close umbrella issues or auto-merge as part of a documentation/priority change.
- Identify the track from PROJECTS.md and reuse existing world, validation, receipt, asset, component and checkpoint contracts.
- Verify existing behavior before building. Fix prerequisites that block the chosen demo; do not continue unrelated resident refinements merely because they were the previous task.
- Use an isolated service/scene/profile for validation. Do not clear the user's live worlds, anchors, authoring source or checkpoints.
- Measure generation/rendering cost on the tested surface. Do not promise instant arbitrary mechanics, unlimited worlds, unlimited inference or unverified headset/provider support.

## Pull requests

Prefer small reviewable slices with a concrete user-visible result, reused contracts, exact tests actually run, explicit pending device checks and deliberately excluded scope. Update the active plan for a new owner decision or evidence-backed queue change; keep the detailed chronological evidence in checkpoints/runbooks rather than expanding the PRD into a test diary.

Unless explicitly instructed to merge, **leave PRs open for review**. Reading updated documentation does not itself update an already-running Codex session, service or headset build.
