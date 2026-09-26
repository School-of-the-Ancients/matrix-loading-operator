# Matrix creation resources

Reviewed September 26, 2026. Start with [VISION.md](VISION.md) for the stable product idea and [PROJECTS.md](PROJECTS.md#issue-and-roadmap-map) for existing owners. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) selects work; **a resource entry does not change that queue, authorize an integration, or establish deployed support**.

## Sakuragaoka Station — procedural world construction

[Kenton-GMI/sakuragaoka-station](https://github.com/Kenton-GMI/sakuragaoka-station) is the user-supplied reference for a coherent, explorable world authored in ordinary Three.js code. Source reviewed at [`4112f57208b7e29998344ca71fef74202c2b2bdd`](https://github.com/Kenton-GMI/sakuragaoka-station/tree/4112f57208b7e29998344ca71fef74202c2b2bdd). The repository includes an [MIT license](https://github.com/Kenton-GMI/sakuragaoka-station/blob/4112f57208b7e29998344ca71fef74202c2b2bdd/LICENSE); retain its required notices for reused code.

Its [README](https://github.com/Kenton-GMI/sakuragaoka-station/blob/4112f57208b7e29998344ca71fef74202c2b2bdd/README.md) describes a walkable cel-shaded station town with furnished interiors, trains, cherry trees, signs, generated textures and synthesized sound. No external 3D models are needed, but Three.js and fonts are fetched externally. This review inspected documentation and selected source; it did not run the application or reproduce its desktop performance claims.

| Source | Pattern worth studying | Matrix adaptation / limitation |
| --- | --- | --- |
| [Builder guide](https://github.com/Kenton-GMI/sakuragaoka-station/blob/4112f57208b7e29998344ca71fef74202c2b2bdd/docs/DESIGN.md) and `src/world/layout.js` | Shared coordinates, lots, landmarks, style rules and module ownership | Plan a coherent world before separate builders author its parts. These are example contracts, not a new mandatory Matrix DSL or town template. |
| [Context implementation](https://github.com/Kenton-GMI/sakuragaoka-station/blob/4112f57208b7e29998344ca71fef74202c2b2bdd/src/core/ctx.js) | `build(ctx)`, shared geometry/material/texture helpers, seeded randomness and update hooks | Adapt ordinary modules to the existing Matrix lifecycle and validation. Add disposal, cancellation and version/identity handling where needed; do not load arbitrary unreviewed scene code. |
| [Main application](https://github.com/Kenton-GMI/sakuragaoka-station/blob/4112f57208b7e29998344ca71fef74202c2b2bdd/src/main.js) | Separate environment, shops, railway, vegetation and character builders; per-module diagnostics and static batching | Study the composition, not a replacement bootstrap. Keep Matrix's renderer, world state, input, update owner and persistence. Preserve semantic IDs and editability even when rendering is batched. |
| [Walking physics](https://github.com/Kenton-GMI/sakuragaoka-station/blob/4112f57208b7e29998344ca71fef74202c2b2bdd/src/core/physics.js) | Boxes/cylinders, ramps, stairs and walkable tops | This is player collision/traversal, not a general rigid-body solver. It does not satisfy #122's dynamic contact and repeated grab/release acceptance by itself. |
| [Characters](https://github.com/Kenton-GMI/sakuragaoka-station/blob/4112f57208b7e29998344ca71fef74202c2b2bdd/src/world/characters.js) | Procedural character presentation and time-driven animation | Appearance/animation is not autonomous Citizens reasoning, memory or real tool work. Keep those owners separate. |
| Builder guide services and development tools | Structured train/door/bench data, repeatable screenshots, module checks and audio tests | Useful inputs to inspection and regression tests. Local `ctx.services` is not an authenticated agent API; expose selected state/actions through Matrix's existing boundary. |

**Fit:** a creation-method reference for [#122](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122), the [#44 runtime](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44) and [#28 content authoring](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28). It is not a request to port the whole town, adopt its exact dependency versions, replace Matrix, require zero downloaded assets, or claim Quest readiness. Measure the selected Matrix adaptation on its actual target device.

## Optional concept image → procedural world

The user-proposed workflow is:

```text
Operator request
    → optional concept image / user-provided reference
    → explicit selection of a visual direction
    → scene plan: layout, scale assumptions, style, meaningful objects
    → procedural modules and/or reused/Blender content
    → Matrix validation, agent discovery, interaction and save/resume
```

The image supplies composition and art direction, not hidden geometry, trustworthy dimensions, physics, quest rules or exact reconstruction. The world builder must choose and validate those explicitly. A mockup-only request stops at the image; selecting it does not automatically authorize 3D creation or replacement of an existing world.

**Reuse existing owners:** [#91](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/91) owns concept generation, iteration, selection and provenance. Its original Blender/animation handoff remains valid. A selected image could also inform #122's procedural authoring path; do not create a second image-artifact store, Operator or competing epic. This is a candidate extension, not a new completion gate for the active Creator Mode slice.

Local ComfyUI is the proposed provider already tracked in #91. Do not assume the configured worker is running, that the selected agent has an image-generation tool, or that a subscription includes a particular image API. Check actual capabilities before choosing an adapter.

The user also supplied [Andrei Provkin's procedural-world experiment](https://x.com/AndreiProvkin/status/2103919236653428985) and quoted a later prompt-plus-reference-image experiment. Retain these as visual/workflow inspiration. The quoted model, cost and timing figures were not reproduced here and are not Matrix performance estimates; a public source for the second experiment was not independently established in this review.

## Agent Office — a useful place inside Matrix

[AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office), reviewed at [`810c90dfd656ca73d5ca878717906417b10b8db6`](https://github.com/AgentSystemLabs/agent-office/tree/810c90dfd656ca73d5ca878717906417b10b8db6), is a reference for procedural office scenery, avatars tied to actual coding sessions, terminal displays, issue/PR boards and task/worktree visibility. See its [README](https://github.com/AgentSystemLabs/agent-office/blob/810c90dfd656ca73d5ca878717906417b10b8db6/README.md) and [office builder](https://github.com/AgentSystemLabs/agent-office/blob/810c90dfd656ca73d5ca878717906417b10b8db6/src/client/world/office.ts).

Borrow interaction/presentation ideas, not its host-command access model. A public visitor or Citizen must not acquire privileged terminal access by entering an office. Its documented human-to-human voice and authored office do not establish Matrix's voice-to-world generation or headset acceptance. An agent workshop is one possible Matrix experience, not a replacement product. Public office portals remain the speculative [#125](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/125) direction.

## Existing resource owners — link rather than duplicate

| Resource area | Existing home |
| --- | --- |
| Content sources, formats and provider preparation | [Content catalogs](Docs/Content-Catalogs.md), [#9](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/9), [#28](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28) |
| Web content/runtime contracts and Blender tiers | [Runtime packages](Docs/WebXR-Runtime-Packages.md), [Blender authoring tiers](WebRuntime/BLENDER_AUTHORING_TIERS.md) |
| Shared controls, displays and experiments | [Scale Experiment](Docs/Scale-Experiment.md), [#31](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/31), [#32](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/32) |
| Citizens, motion and agent-society research | [Existing organization research index](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/RESOURCES.md), [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) |
| Persistent/geospatial world | [Boulder PRD](Docs/Matrix-Boulder-PRD.md), [#38](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38); URL-linked worlds remain #125 |
| Evidence and compatibility | [Current Checkpoint](Docs/Current-Checkpoint.md), [PC whole-world checkpoints](ControlService/WORLD_CHECKPOINTS.md), [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md) |

For a new reference, record what it demonstrates, what was actually inspected/tested, its reuse hypothesis, limitations and existing owning issue. Promote it into active work only through an explicit milestone decision. **More creation options do not mean a new product direction.**
