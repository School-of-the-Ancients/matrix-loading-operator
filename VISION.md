# Matrix vision

> **A persistent Three.js/WebXR world where AI citizens can live independently and humans can enter from desktop/VR or visit through AR. Humans and authorized AI citizens can ask Operator to create and change the world. Save it and return.**

The goal is a persistent editable digital world inspired by **The Matrix** and **Ready Player One**. The world and its citizens do not depend on a human browser being open. Desktop and VR enter that world directly; AR registers a view of the same world against the physical environment.

The Matrix-inspired **White Room** is the blank-canvas idea: begin with nothing and ask Operator to load or create what you want. It is not a required Unity prefab or a separate editing room.

## Core experience

```text
Start blank OR load an existing world
    -> ask Operator to load/create/change something
    -> Operator creates or imports it
    -> interact with it
    -> revise the same world
    -> save
    -> return later
```

The same world can be used from desktop, VR or AR.

## Operator

Operator is available to authorized humans and, eventually, authorized AI citizens.

A request such as **"Operator, load a spaceship"** can be fulfilled through whichever creation method fits best:

1. **Procedural generation** — fastest for structures, layouts, experiments and parameterized objects.
2. **Blender MCP + import** — richer custom geometry, authored models and animation.
3. **Reusable assets/capabilities** — load something that already exists instead of recreating it.
4. **Optional image mockup first** — generate/revise a concept image, select it, then use it as art direction for procedural or Blender creation.

These are different paths into the same world, not separate products.

## AI Citizens

Some Matrix worlds contain persistent AI citizens.

Citizens can grow toward:

- identity, memory and reflection;
- needs and schedules;
- planning and goal selection;
- navigation and object interaction;
- relationships and social behavior;
- dialogue;
- persistent state;
- world building through the same bounded creation capabilities available to humans.

Useful references include Generative Agents, SwarmWorld, Agent Office, Voyager and other agent-society work collected in [RESOURCES.md](RESOURCES.md).

Citizens do not receive unrestricted Operator or PC credentials. They request world actions through explicit capabilities and world permissions.

## Persistence

A Matrix world should survive leaving and returning.

Persistence includes the pieces required for the supported experience: world entities, authored parameters, interactions, game/experiment state and supported citizen state. Edits should preserve unrelated work and stable identity when possible.

## Product boundaries

Matrix owns:

- world execution;
- Operator creation/editing;
- procedural creation;
- Blender/asset import;
- WebXR/desktop access;
- physics and interaction;
- persistence;
- AI Citizens.

School of the Ancients can use Matrix for lessons, mentors and exhibits, but teaching/curriculum/learner records remain School concerns.

Manfred can provide human context and wearable input, but private lifelog data is not Matrix world state.

## History

The Unity implementation and its White Room/prefab work were early versions of the same idea. They are preserved under `Archive/Unity/` as history.

The forward runtime is Three.js/WebXR. Do not rebuild the engine or restart the project simply because the project description has been simplified.
