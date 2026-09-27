# Matrix architecture

Matrix is one persistent digital world with several ways to enter it, create inside it and inhabit it.

```text
                         Matrix world
                  persistent canonical state
             physics / interactions / persistence
                       /              \
                      /                \
             human visitors          AI Citizens
          desktop / VR / AR      memory / needs / plans
                  \                 /
                   \               /
                    bounded world actions
                           |
                        Operator
                           |
             +-------------+-------------+
             |             |             |
        procedural     Blender MCP     asset reuse
        generation       + import      / catalogs
             \             |             /
              +-------- world changes ---+
```

AR is a registration/presentation layer into the same digital world. It does not create a second citizen scene or second simulation clock.

An optional image-mockup step can sit before procedural generation or Blender:

```text
request -> image mockup -> revise/select -> scene/object plan -> procedural or Blender -> Matrix
```

## World and simulation

The target is one authoritative Matrix world state for a world instance. Visitors observe and act on that state; they do not each own a competing copy of the citizen simulation.

Persistent Citizens should continue through a world owner even when no browser is open, then reappear with the same identities/state when a human rejoins. Current implementation work is converging on that model; do not claim it is complete until the relevant persistence/replay acceptance passes.

## `WebRuntime/`

Owns the Three.js/WebXR client and world presentation:

- rendering;
- desktop/VR/AR views;
- interaction;
- physics presentation and runtime behaviors;
- world/entity views;
- browser-side controls and compatible persistence.

## `ControlService/`

Owns the PC-local privileged boundary:

- persistent Agent Portal;
- capability/tool discovery;
- reviewed commands;
- procedural/asset/Blender workflows;
- runtime receipts and validation;
- PC-side checkpoints and persistent-world coordination as implemented.

Privileged Codex, GitHub, Blender or MCP credentials stay on the PC side.

## Operator and creation

Operator is the user-facing creation capability, not a separate world.

A request can resolve through:

1. **Procedural generation** for fast parameterized structures, layouts, experiments and objects.
2. **Blender MCP + validated import** for richer custom geometry/animation.
3. **Reusable assets/capabilities** when suitable content already exists.
4. **Optional image mockup** for art direction before procedural/Blender creation.

All paths converge on ordinary Matrix entities/capabilities with identity, permissions, receipts and persistence.

## AI Citizens

Citizens choose intentions; Matrix executes world actions.

Citizens can grow toward memory, reflection, needs, schedules, planning, navigation, social behavior and persistent relationships. They may request creation through the same bounded Matrix capabilities humans use, but they do **not** receive Operator/PC credentials.

Do not create a resident-only scene graph, executor, physics system or hidden second world.

## Persistence

Save enough versioned state to reconstruct the supported experience without silently resetting unrelated work. Preserve stable entity/citizen IDs and authored parameters where practical.

## Repository boundaries

- **Matrix:** world runtime, Operator, creation pipelines, WebXR, persistence and AI Citizens.
- **School:** teaching, mentors, curriculum, assessment and learner records.
- **Manfred:** private human/wearable context.
- **school-of-the-ancients-roadmap:** cross-project coordination/research only.
- **Unity archive:** historical implementation only.

## Design rule

Before adding a service/framework/repository, ask whether the existing `WebRuntime/` + `ControlService/` + Citizens boundaries can do the job. Prefer extending the current system.
