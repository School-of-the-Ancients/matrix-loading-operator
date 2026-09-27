# Matrix roadmap

Keep this intentionally short. Detailed acceptance belongs in the issue being worked; evidence belongs in `Docs/` and `Validation/`.

## Now

Build the core Matrix loop as **one persistent inhabited world** rather than separate demos.

### Creation loop — #122

Finish:

```text
request -> create -> interact -> revise -> save -> reopen
```

Keep procedural creation, reusable assets and Blender import converging on the same world. Finish immersive readability/input and actual VR/AR wearer evidence without rebuilding the engine.

### Persistent AI Citizens world — #20 / #29

Move the existing Citizens implementation toward one persistent simulation owner:

- citizens keep stable identities and state;
- the world can progress without a browser running;
- durable checkpoints/replay remain bounded and versioned;
- desktop/VR/AR visitors rejoin the same world rather than starting another citizen clock.

### AR visit into the same world — #22

Let AR observe/interact with the persistent digital world without cloning it. Physical room alignment, planes and recovery are presentation/registration state; claims of physical alignment require actual device evidence.

### Operator grounding — #116

Keep Operator prompts/tool choices based on live Matrix capabilities and receipts rather than legacy Unity/White-Room assumptions.

## Next

### Generalize "Operator, load XYZ"

Make creation feel like one capability with multiple backends:

- procedural generation;
- Blender MCP + validated import;
- reusable asset lookup;
- optional ComfyUI/image mockup -> revise/select -> build;
- reusable animation, sounds and behaviors.

### Citizens build too — #109

Let authorized citizens request bounded world creation through the same capability layer humans use, with separate authority, provenance and receipts. No resident gets Operator/PC credentials.

### Deeper resident simulation

Use [RESOURCES.md](RESOURCES.md) to evolve memory/reflection, needs/schedules, planning, social behavior and larger inhabited-world experiments. Open/reopen only the specific implementation slice being worked.

## Later

Only pull these forward when a concrete experience needs them:

- multiplayer/shared worlds;
- georeferenced Boulder/Earth layers;
- richer dynamic citizen quests;
- portal-linked worlds/places;
- dynamic world improvement/upgrader agents;
- remote/astral presence;
- very large persistent societies;
- future everyday AR glasses.

## Work-selection rule

1. Continue compatible work already underway.
2. Prefer one user-visible end-to-end slice.
3. Do not start a new engine or duplicate world/simulation state.
4. A new research link goes to [RESOURCES.md](RESOURCES.md) unless it creates a concrete implementation need.
5. GitHub issues are implementation tasks/epics, not the product definition.
