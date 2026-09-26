# Matrix vision — one world idea, several creation methods

Owner's vision consolidated September 26, 2026. This is the central product idea, not a claim that the entire vision is implemented or a new work queue.

> **Matrix is a Matrix-inspired Three.js/WebXR sandbox. Start in the White Room or load a pre-existing world—including a persistent Matrix world where AI citizens live—then say “Operator, load XYZ” to create, explore, interact with, revise and save the experience.**

The inspiration is **Ready Player One + The Matrix**: worlds to enter and inhabit, with an Operator that helps turn requests into usable things around you. The White Room is the blank-start inspiration, not a mandatory room nested inside another world or the only place creation is allowed.

The enduring user promise is **“Operator, load XYZ” → a usable result appears in the world**. The methods have evolved from Unity prefabs to Web assets, Blender and procedural code; discovering another method does not change that promise.

[Project and issue map](PROJECTS.md) · [Requirements](PRD.md) · [Active implementation plan](IMPLEMENTATION_PLAN.md) · [Creation references](RESOURCES.md) · [Agent instructions](AGENTS.md)

## Two ways to begin, the same sandbox

| Starting point | Intended experience |
| --- | --- |
| **Start blank: White Room** | Begin with an empty environment and ask Operator to load objects, create a scene or build an experience. The room can become the world; it need not stay white or remain a separate editor. |
| **Load an existing world: Matrix World** | Enter a prepared or saved environment, including one inhabited by AI citizens, and explore, interact, continue projects or make authorized changes there. No visit to a separate creation room is required. |

**Matrix World** names the persistent inhabited-world direction: places, projects, citizens, relationships and shared activities. Offices, schools, workshops, neighborhoods and fantasy environments can all be such worlds or places within them. Georeferenced Boulder and real-world overlays are particular extensions, not the entire definition of Matrix World.

Creation is a capability of the sandbox, not a location. Operator can be available in either starting path; edits follow the world's permissions and preserve unrelated entities, manual work and supported resident/game state. A special holodeck could be something a user creates, but it is not required architecture. Resetting or replacing a world is an explicit operation, not a side effect of asking for another object.

For example, start blank and ask for a forest, then add inhabitants; or load yesterday's town, meet its existing residents and ask Operator to add a workshop. These are target journeys, not claims of completed general world loading, resident creation or transition support.

Desktop, VR and AR are ways to access the sandbox. AR brings digital content alongside the physical world; it does not by itself establish measured room geometry or shared identity across independently hosted worlds. Everyday AR glasses remain a longer-term delivery aspiration, not a new-device requirement.

## The defining experience

```text
Start in the White Room OR load a pre-existing Matrix world
    → “Operator, load / create / change XYZ”
    → load, compose or build the environment and its usable capabilities
    → inspect, play, experiment, learn and observe consequences
    → revise conversationally in that world without losing unrelated work
    → save, leave and return
```

Creator Mode describes authorized editing; Play/Test describes using the experience. Neither is a synonym for VR, AR, desktop or a separate physical place. The same person can move between creating and playing in one world. A disruptive revision may need a pause, preview or explicit reset; availability of Operator does not imply unannounced changes to active gameplay.

“Load XYZ” may involve objects, layouts, materials, sound, characters, physics, controls, displays or gameplay rules. A visible mesh is not automatically usable; a display must reflect actual state; an objective must run from real events. The agent should discover and operate meaningful entities through current capabilities, not reconstruct the world only from its chat history.

“Anything is possible” expresses the **open-ended creative ambition**, not a promise of infinite resources, instant arbitrary generation or mechanics that have not been implemented. Configure existing capabilities live; build and test genuinely missing reusable capabilities through the normal development path. Classrooms, spaceships, workshops, station towns and games are examples, not a fixed template menu. Education is an important near-term proving ground for the broader sandbox, not a restriction on what Matrix is.

## Creation methods are not competing products

| Question | Stable distinction |
| --- | --- |
| What does the user ask? | “Operator, load/create/change XYZ.” |
| Where does it happen? | In the current authorized world, whether it began blank or was loaded; desktop, VR and AR provide access. |
| How is content prepared? | Reuse a compatible asset; compose a procedural generator; author/refine in Blender; or combine them. |
| What is an image for? | An optional concept/reference that guides composition and style. It does not itself establish geometry, interaction, physics or truth. |
| What makes it work? | Tested runtime capabilities: rendering, input, physics, interactions, state, observations and persistence. |
| Who can use it? | Humans and appropriately scoped agents; world access is not unrestricted PC/tool access. |

The original prefab idea remains useful: compatible content should load without rebuilding the application every time. Existing generators can accept new parameters live. Genuinely new executable capabilities may require reviewed code, tests, a build and a controlled reload; do not promise otherwise.

The proposed **mockup → selected image → scene plan → procedural/reused/Blender world** path belongs alongside these methods. [#91](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/91) already owns image iteration/selection; [#122](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122) owns the current interactive creation feature. [Sakuragaoka and other references](RESOURCES.md) inform implementation without becoming new mandatory integrations or release gates.

## Roots: the 2023 and 2024 ideas

These are dates of the owner's concept notes, restated here—not implementation dates or priority resets.

- **July 16, 2023 — School of the Ancients:** engaging conversations with clearly emulated historical figures, inspired by asking people such as Shakespeare or Plato questions.
- **May 15, 2024 — prompt-created games, environments and characters:** an AI connects reusable environments, objects, games, characters, voices, animations and sounds, retrieving or generating content for the user's virtual experience.
- **October 16, 2024 — digital and real worlds / simulated societies:** AI researchers, workers, organizations and worlds form the broader inhabited-world and simulation vision.

Unity prefab loading, the move to Three.js/WebXR, Blender authoring, Citizens and procedural generation support different parts of that idea. The White Room is the starting inspiration, not an instruction to return generalized development to Unity.

## Now: one small complete experience

The selected feature remains **[#122 — Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122)**. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) selects its next bounded slice; the issue retains its physics, objective, display, agent-access, persistence, extensibility and mode-specific acceptance. This clarification neither widens nor weakens those requirements and does not add a separate holodeck, launcher or portal implementation task.

Desktop is an access/development/regression surface for the same application. VR and AR remain first-class targets with separate actual-device evidence. Hardware gaps must stay explicit without stopping independent implementation or postponing headset integration indefinitely.

Preserve the ongoing Citizens implementation and any compatible Creator Mode work. A full society, global map, public-office network or image-generation provider is not a prerequisite for the selected local experience. New references go into the resource/backlog map, not automatically into today's task.

## Keep the architecture small

Use `WebRuntime/`, the existing `ControlService/`, persistent PC-local Codex Operator and current identity, capability, asset, receipt and checkpoint contracts. Do not build a second engine, agent harness, authoritative scene graph or universal world language to restate this vision.

Matrix executes world actions. Citizens chooses resident intentions. Real coding/research workers perform external jobs only when separately authorized; an office avatar does not turn simulated activity into real work. School owns pedagogy, curriculum, assessment and learner records. Manfred and other human-interface integrations keep personal capture/context separately owned. These are responsibilities, not a demand for new services or repositories.

Preserve native Unity workflows, open PR history, user worlds and existing evidence. All views of one experiment should share its state; separate world instances should retain explicit ownership and reset boundaries.

## Later: dynamic world improvement

**The dynamic upgrader is deferred, not the active implementation goal.** An owner-enabled worker could inspect appearance, layout, interactions, accessibility, learning usefulness and performance, select a bounded improvement, test it, and keep or revert it.

```text
Fast initial procedural / reused world
    → optional idle-time or overnight review
    → inspect state, visual evidence and observed use/failures
    → improve within the owner's intent, permissions and budget
    → validate → keep a versioned improvement or revert
```

Preserve IDs, manual edits and compatible play/lesson/resident state. Reject stale work; check resources and asset provenance; require appropriate authorization for structural/rule changes and a working rollback. A prettier screenshot alone does not prove a better interaction or lesson. No scheduler or autonomous review process is enabled by this document.

Portal-linked public offices and a virtual city of agents remain the speculative [#125](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/125) direction. Resident construction and dynamic quests remain [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109) and [#118](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/118). Their existence does not reprioritize #122.

## Success and scope discipline

One durable idea should not require one ever-growing instruction prompt. Use the existing documents for distinct purposes:

| Home | Purpose |
| --- | --- |
| `VISION.md` | The enduring sandbox idea, blank/existing-world entry and how creation methods fit. |
| `PROJECTS.md` + linked organization `MODULES.md` | Code/issue navigation and module ownership. |
| `PRD.md` + controlling feature issue | Product requirements and detailed acceptance. |
| `IMPLEMENTATION_PLAN.md` | The single Matrix work-selection queue and the selected bounded slice. |
| `AGENTS.md` | Working rules, safety and how to resolve scope changes. |
| `RESOURCES.md` | References and reuse hypotheses—not instructions to implement them all. |
| Checkpoints, runbooks and `Validation/` | Dated evidence and reproduction; historical “next” text is not today's queue. |

Keep the selected milestone stable until demonstrated or explicitly changed by the owner. A new link, image, model or builder is normally another option behind “Operator, load XYZ,” not a new product direction. Preserve broader ideas without making every one a prerequisite.
