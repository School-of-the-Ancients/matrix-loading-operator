# Instructions for coding agents

Read [VISION.md](VISION.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md), the [v1.2 checkpoint guide](Docs/V1.2-Checkpoint.md), the [single acceptance record](Validation/V1.2-Headset-Acceptance.md), and the issue being worked. Re-read the current scope and acceptance after a goal refresh.

## Product and boundaries

Matrix is the shared Three.js/WebXR runtime for creating, presenting and interacting with persistent digital worlds. The forward implementation is `WebRuntime/` + `ControlService/`; Unity is read-only history under `Archive/Unity/`.

- Matrix owns shared world execution, Operator, creation/presentation, generic desktop/VR/room AR, physics and world persistence.
- School owns historical-figure conversations, mentor identity, teaching and learner records. A mentor may use an ordinary Matrix avatar without `CitizensSimulation`.
- Civilization owns resident/society simulation, Boulder and geographic AR data/meaning. Current Citizens code remains nested here; logical ownership alone does not authorize extraction or a new renderer/service.
- Manfred owns private human/wearable context. Privileged Codex, GitHub, Blender and MCP credentials stay on the PC; mentors and residents never receive them directly.

Desktop, VR and AR are views of a world. Matrix executes bounded world actions; School chooses presentation intent and Civilization chooses resident intentions. Persistent residents should converge on one simulation owner. Preserve stable IDs, compatible state, approvals, validation and truthful receipts. Do not rebuild the engine, add a second authoritative world, or reset user worlds because documentation changed.

## Current release and documentation

The owner selected and built the paired Professor candidate `v1.3.0-rc.1`.
Read Docs/V1.3-Checkpoint.md and ROADMAP.md for its current source/package identity
and implementation status. Keep the single existing acceptance record; preserve
its distinction between development-build wearer observations and an extracted
release test. Older v1.2 selection text below retains those outstanding checks,
not a prohibition on owner-selected Professor work.

## Frozen v1.2 work

The published `v1.2.0` source is `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0`. Its eight implementation PRs are merged. Preserve that tag and its assets. Current `main`, including #207, is later work; documentation on main does not change release identity. v1.1.0 at `9453ef06b1873937822c1cf985115f05f72e1e20` remains the matched-comparison baseline.

The selected issues are **#173, #171, #163, #158, #24 and #201**, labeled `scope: v1.2`. Finish their remaining acceptance and bounded delivery work. Do not rebuild compact context, locks, approvals, speech or selected-point movement. Other module issues are unscheduled backlog unless the owner selects a new slice. Existing runtime dependencies and save/test fixtures remain in place even when their future product owner is School or Civilization.

Fit-to-room controls and their measured-fitting checks are deferred. Ordinary AR edits use free placement; explicit measured tools keep their guards. General editing Undo/Redo remains required; lock-policy Undo/Redo is excluded. Preserve the published checkpoint; later runtime changes require a new candidate identity.

Use draft PRs. Do not merge or release without authorization.

## Acceptance and evidence

Use the existing H01–H10 record. Keep source, package, model/settings and device identities with results. Run relevant automated/desktop checks during implementation; batch outstanding physical cases into the consolidated wearer session once the candidate is frozen. Pending hardware checks do not stop unrelated cloud work. An early targeted wearer check needs a hardware-dependent design blocker or suspected major regression, with the reason recorded.

Reuse unaffected observations across resumed goals and documentation changes. Invalidate only affected checks with a recorded change/impact reason. Keep historical failures and partial results. Never turn cloud tests, an older candidate or an unanswered request into a headset pass. #173 stays open until its required acceptance is evidenced.

## Creation and documentation

For Professor avatar authoring, follow [Docs/Professor-Avatar-Authoring.md](Docs/Professor-Avatar-Authoring.md).
Use the job's private editable-seed catalog when provided; verify source hashes,
save a working copy, and keep native rig/expression validation separate from
visual quality and Quest acceptance. Cast-specific local scripts are recorded
examples, not a general unattended creator.

Operator may use procedural generation, reusable assets/capabilities, Blender MCP with validated import, or an optional image mockup as art direction. Choose the fastest suitable existing path. An image is not a functioning world.

Keep current requirements in the owning issue, operational contracts in retained runbooks, implementation/test details in the PR, and release status in the single acceptance record. Update those records instead of adding dated build/progress artifacts to the source tree. Keep executable tools and actual test fixtures distinguishable from their output.

Keep historical files in the repository under `Archive/` when retiring them from active documentation; Git history alone is not the archive. The [archive index](Archive/README.md) links the preserved plans, evidence, research notes and full original resource catalog. Archived instructions and research are background, not an active queue. Preserve useful research with its sources and context, and keep it discoverable through [RESOURCES.md](RESOURCES.md). Link it to a module issue when it informs a concrete task; a useful reference does not expand the v1.2 scope.
