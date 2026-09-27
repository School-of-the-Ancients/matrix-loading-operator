# Matrix roadmap

Keep this intentionally short. Detailed implementation acceptance belongs in the issue being worked and evidence belongs in `Docs/` / `Validation/`.

## Now

**Finish the current end-to-end Matrix creator loop in Three.js/WebXR.**

Current implementation focus: [#122 — Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122).

Target loop:

```text
request -> create -> interact -> revise -> save -> reopen
```

Near-term priorities:

- continue the existing procedural Creator Mode;
- make VR/AR interaction and readability solid;
- preserve real physics/interactions and objective state;
- verify save/reopen on the actual target device;
- keep Operator prompts grounded in live capabilities;
- keep Blender import and procedural creation working through the same world.

## Next

### Generalize "Operator, load XYZ"

Make creation feel like one capability with multiple backends:

- procedural world/object generation;
- Blender MCP + validated import;
- reusable asset lookup;
- optional ComfyUI/image mockup -> revision -> selected concept -> build;
- reusable animation, sounds and behaviors.

The user should care about the requested result, not which backend created it.

### Deepen AI Citizens

Build on the existing Citizens work:

- memory/reflection;
- needs and schedules;
- bounded planning/GOAP/utility choices;
- social relationships and dialogue;
- deterministic persistence/replay where practical;
- larger inhabited-world experiments;
- citizens requesting construction through bounded world-building capabilities.

## Later

Only pull these forward when a concrete experience needs them:

- multiplayer/shared worlds;
- georeferenced Boulder/Earth layers;
- richer dynamic citizen quests;
- portal-linked worlds/places;
- dynamic world improvement/upgrader agents;
- remote/astral presence;
- much larger persistent societies;
- future everyday AR glasses.

## Work-selection rule

1. Continue compatible work already underway.
2. Prefer one user-visible end-to-end slice.
3. Do not start a new engine or duplicate world state.
4. A new research link goes to [RESOURCES.md](RESOURCES.md) unless it creates a concrete implementation need.
5. GitHub issues are implementation tasks/epics, not the product definition.
