# Matrix vision

> **A shared Three.js/WebXR runtime for creating, presenting and interacting with persistent digital worlds. Start blank or load a world, ask Operator to create or change it, then save and return from desktop, VR or AR.**

The goal is a persistent editable digital world inspired by **The Matrix** and **Ready Player One**. Matrix provides the shared creation and presentation runtime for independent experiences such as School and Civilization. Desktop and VR enter a Matrix world directly; AR registers a view of that world against the physical environment.

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

Operator serves humans and authorized requests from experiences such as School and Civilization, within the capabilities each integration supports.

A request such as **"Operator, load a spaceship"** can be fulfilled through whichever creation method fits best:

1. **Procedural generation** — fastest for structures, layouts, experiments and parameterized objects.
2. **Blender MCP + import** — richer custom geometry, authored models and animation.
3. **Reusable assets/capabilities** — load something that already exists instead of recreating it.
4. **Optional image mockup first** — generate/revise a concept image, select it, then use it as art direction for procedural or Blender creation.

These are different paths into the same world, not separate products.

## Civilization / AI Citizens

Civilization is an independent logical module for AI residents, society, Boulder and geographic AR overlays. It uses Matrix to present and run its world. Its long-term residents should continue even when no human browser is open; this remains a persistence goal rather than a property of every current Matrix world.

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

## School of the Ancients / Cosmos Fair experience

School is an independent experience centered on conversations with historical minds. A figure can explain an idea and request any supported presentation material through Operator. School owns the mentor's identity, conversation, teaching and learner records; Matrix creates, presents and runs the requested material. A visible guide can use an ordinary Matrix avatar/entity without requiring a resident simulation.

The [reference integration plan](Docs/V1.3-Implementation-Plan.md) uses an existing School lesson to prove that connection. School and Civilization are independent workstreams; current delivery choices belong in [ROADMAP.md](ROADMAP.md).

## Persistence

A Matrix world should survive leaving and returning.

Persistence includes the pieces required for the supported experience: world entities, authored parameters, interactions, game/experiment state and supported citizen state. Edits should preserve unrelated work and stable identity when possible.

## Product boundaries

Matrix owns:

- world execution;
- Operator creation/editing;
- procedural creation;
- Blender/asset import;
- WebXR/desktop access and generic room AR;
- physics and interaction;
- world persistence.

School owns historical-figure conversations, mentor identities, teaching/curriculum and learner records. It uses Matrix as a creation and presentation tool.

Civilization owns resident behavior, society and the meaning/data of Boulder and geographic AR overlays. The current Citizens implementation remains nested in this repository; logical ownership does not require a new repository or runtime.

Manfred can provide human context and wearable input, but private lifelog data is not Matrix world state.

## History

The Unity implementation and its White Room/prefab work were early versions of the same idea. They are preserved under `Archive/Unity/` as history.

The forward runtime is Three.js/WebXR. Do not rebuild the engine or restart the project simply because the project description has been simplified.
