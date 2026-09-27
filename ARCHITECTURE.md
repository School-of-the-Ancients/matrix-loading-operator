# Matrix architecture

Matrix keeps one authoritative world and several ways to create or act inside it.

```text
                 Human
                   |
             voice / text / UI
                   |
                   v
              Operator
                   |
       +-----------+-----------+
       |           |           |
 procedural    Blender MCP   asset reuse
 generation       + import     / catalogs
       \           |           /
        \          |          /
         +------ world changes ------+
                      |
                      v
              Three.js / WebXR
                Matrix world
            / desktop / VR / AR \
          physics  interaction  save
                      |
                      v
                 AI Citizens
          memory / needs / plans
          social / navigation / use
                      |
          bounded world capabilities
```

An optional image-mockup step can sit before either procedural generation or Blender:

```text
request -> image mockup -> revise/select -> scene/object plan -> procedural or Blender -> Matrix
```

## Main code boundaries

### `WebRuntime/`

Owns the current Three.js/WebXR world:

- rendering;
- world/entity state;
- WebXR views;
- interaction;
- physics;
- reusable runtime capabilities;
- browser-side persistence and presentation.

### `ControlService/`

Owns the PC-local Operator boundary:

- persistent Agent Portal;
- capability/tool discovery;
- reviewed commands;
- asset generation/import workflows;
- runtime receipts and validation;
- PC-side checkpoints.

Privileged credentials stay on the PC side.

### AI Citizens

Citizens are a module using the same world state and legal action interfaces as other actors. Citizens choose intentions; Matrix executes actions.

Do not create a second scene graph, second world executor or resident-only physics system.

### Creation

Creation should converge on reusable world entities and capabilities regardless of source.

- Procedural generation is preferred when a parameterized generator can produce the requested result quickly.
- Blender is preferred when richer custom geometry/animation is useful.
- Existing compatible assets should be reused rather than recreated.
- Image generation is optional art direction, not geometry or physics proof.

### Persistence

Save enough versioned state to reconstruct the supported world experience without silently resetting unrelated work. Preserve stable entity IDs and authored parameters where practical.

## Repository boundaries

- **Matrix repo:** Matrix world, Operator, creation pipelines, WebXR, persistence and AI Citizens.
- **School repo:** teaching experience, mentors, curriculum and learner records.
- **School roadmap repo:** lightweight cross-project coordination/research only; it is not a second Matrix backlog.
- **Unity archive:** historical implementation only.

## Design rule

Before adding a service/framework/repository, ask whether the existing `WebRuntime/` + `ControlService/` + Citizens boundaries can do the job. Prefer extending the current system.
