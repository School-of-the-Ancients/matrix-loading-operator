# Matrix vision — one sandbox, several creation methods

Owner's agreed description, September 26, 2026:

> **A Three.js/WebXR sandbox. Start blank or load an existing world. Ask Operator to create and change things around you. Save it and return. Some worlds have AI citizens.**

Ready Player One and The Matrix are the inspiration. **“White Room” means the blank-canvas, request-to-creation idea—not a particular Unity prefab, scene, application, or required room.** Starting fresh does not require loading the original Unity White Room. Creating in an existing world does not require entering a separate holodeck.

This clarifies the existing project. **Continue the current Three.js/WebXR implementation; do not rebuild the engine, restart the project, create a replacement repository, or discard ongoing work.** The Unity source and native releases are now read-only history.

[Project and issue map](PROJECTS.md) · [Requirements](PRD.md) · [Active implementation plan](IMPLEMENTATION_PLAN.md) · [Creation references](RESOURCES.md) · [Agent instructions](AGENTS.md)

## Two ways to begin, the same sandbox

| Starting point | Intended experience |
| --- | --- |
| **Start blank** | Begin with an empty world and ask Operator to load objects or create an experience. White Room is the inspiration; the world need not remain white, enclosed, or a separate editor. |
| **Load an existing world** | Enter a prepared or saved environment, explore it, continue projects and make authorized changes there. Some worlds already contain AI citizens; others are games, exhibits or uninhabited environments. |

**Matrix World** names the persistent inhabited-world direction: places, projects, citizens, relationships and shared activities. Offices, schools, workshops, neighborhoods and fantasy environments can all be such worlds or places within them. Georeferenced Boulder and real-world overlays are particular extensions, not the definition of every Matrix world.

Creation is a capability of the sandbox, not a location. Operator can help in either starting path, under the world's permissions. Preserve unrelated entities, manual work and supported resident/game state. Resetting or replacing a world is an explicit operation, not a side effect of asking for another object.

For example, start blank and ask for a forest, then add inhabitants; or load yesterday's town, meet its existing residents and ask Operator to add a workshop. These are target journeys, not claims that every world-loading, resident-creation or transition capability is already complete.

Desktop, VR and AR are ways to access the sandbox. AR brings digital content alongside the physical world; it does not by itself establish measured room geometry or shared identity across independently hosted worlds. Everyday AR glasses remain a longer-term delivery aspiration, not a new-device requirement.

## The defining experience

```text
Start blank OR load an existing world
    → “Operator, load / create / change XYZ”
    → load, compose or build the environment and its usable capabilities
    → inspect, play, experiment, learn and observe consequences
    → revise in that world without losing unrelated work
    → save, leave and return
```

Creator Mode describes authorized editing; Play/Test describes using the experience. Neither is a separate physical place or a synonym for VR, AR or desktop. A disruptive revision may need a pause, preview or explicit reset; availability of Operator does not imply unannounced changes to active gameplay.

“Load XYZ” may involve objects, layouts, materials, sound, characters, physics, controls, displays or gameplay rules. A visible mesh is not automatically usable; a display must reflect actual state; an objective must run from real events. The agent should discover and operate meaningful entities through current capabilities, not reconstruct the world only from chat history.

“Anything is possible” expresses the open-ended creative ambition, not infinite resources or instantly supported arbitrary mechanics. Configure existing capabilities live; build and test genuinely missing reusable capabilities through the normal development path. Classrooms, spaceships, workshops, station towns and games are examples, not a fixed template menu. Education is an important near-term proving ground, not a restriction on the sandbox.

## Creation methods are not competing products

| Question | Stable distinction |
| --- | --- |
| What does the user ask? | “Operator, load/create/change XYZ.” |
| Where does it happen? | In the current authorized world, whether it began blank or was loaded. |
| How is content prepared? | Reuse a compatible asset; compose a procedural generator; author/refine in Blender; or combine them. |
| What is an image for? | Optional composition and art direction, not guaranteed geometry, physics or exact reconstruction. |
| What makes it work? | Tested runtime capabilities: rendering, input, physics, interactions, state, observations and persistence. |
| Who can use it? | Humans and appropriately scoped agents; world access is not unrestricted PC/tool access. |

The original prefab-loading motivation remains useful: compatible content should load without rebuilding the application every time. Existing generators can accept new parameters live. Genuinely new executable capabilities may require reviewed code, tests, a build and a controlled reload. That ordinary WebRuntime development path is not a project restart; archiving Unity does not require a live service restart.

The proposed **mockup → selected image → scene plan → procedural/reused/Blender world** path belongs alongside these methods. [#91](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/91) already owns image iteration/selection; [#122](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122) owns the current interactive creation feature. [Sakuragaoka and other references](RESOURCES.md) inform implementation without becoming mandatory integrations or release gates.

## Roots: the 2023 and 2024 ideas

These are dates of the owner's concept notes, not implementation dates or priority resets.

- **July 16, 2023 — School of the Ancients:** engaging conversations with clearly emulated historical figures, inspired by asking people such as Shakespeare or Plato questions.
- **May 15, 2024 — prompt-created games, environments and characters:** an AI connects reusable environments, objects, games, characters, voices, animations and sounds, retrieving or generating content for the user's virtual experience.
- **October 16, 2024 — digital and real worlds / simulated societies:** AI researchers, workers, organizations and worlds form the broader inhabited-world and simulation vision.

Unity prefab loading was an early implementation of that idea. Three.js/WebXR, Blender authoring, Citizens and procedural generation support the forward product. The [Unity archive](Archive/Unity/README.md) and native releases retain their names and evidence; those names do not define the current product or require porting a prefab.

## Now: one small complete experience

The selected feature remains **[#122 — Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122)**. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) selects its next bounded slice; the issue retains its physics, objective, display, agent-access, persistence, extensibility and mode-specific acceptance. The agreed wording neither widens nor weakens those requirements and adds no separate-room, launcher or portal implementation task.

Preserve and continue compatible Creator Mode and Citizens work already underway. Desktop is an access/development/regression surface for the same application. VR and AR remain first-class targets with separate device evidence. Hardware gaps stay explicit without stopping independent work or postponing headset integration indefinitely.

A full society, global map, public-office network or image-generation provider is not a prerequisite for the selected local experience. New references go into resources or the backlog, not automatically into today's task.

## Keep the architecture small

Use `WebRuntime/`, the existing `ControlService/`, persistent PC-local Codex Operator and current identity, capability, asset, receipt and checkpoint contracts. Do not build another engine, agent harness, authoritative scene graph or universal world language to restate this vision.

Matrix executes world actions. Citizens chooses resident intentions. Real coding/research workers perform external jobs only when separately authorized; an office avatar does not turn simulated activity into real work. School owns pedagogy, curriculum, assessment and learner records. Manfred and other human-interface integrations keep personal capture/context separately owned. These are responsibilities, not new services or repositories.

Preserve archived Unity source and release provenance, open PR history, user worlds and existing evidence. New runtime work and coursework demonstrations use Three.js/WebXR. All views of one experiment share its state; distinct worlds retain explicit ownership and reset boundaries.

## Later: dynamic world improvement

**The dynamic upgrader is deferred.** An owner-enabled worker could inspect appearance, layout, interactions, accessibility, learning usefulness and performance, select a bounded improvement, test it, and keep or revert it.

```text
Initial procedural / reused world
    → optional idle-time or overnight review
    → inspect state, visual evidence and observed use/failures
    → improve within the owner's intent, permissions and budget
    → validate → keep a versioned improvement or revert
```

Preserve IDs, manual edits and compatible play/lesson/resident state. Reject stale work; check resources and asset provenance; require appropriate authority for structural/rule changes and a working rollback. A prettier screenshot alone does not prove a better interaction or lesson. No scheduler or autonomous review process is enabled by this document.

Portal-linked public offices remain speculative [#125](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/125). Resident construction and dynamic quests remain [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109) and [#118](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/118). Their existence does not reprioritize #122.

## Success and scope discipline

| Home | Purpose |
| --- | --- |
| `VISION.md` | The enduring sandbox idea and blank/existing-world entry. |
| `PROJECTS.md` + linked organization `MODULES.md` | Code/issue navigation and module ownership. |
| `PRD.md` + controlling feature issue | Product requirements and detailed acceptance. |
| `IMPLEMENTATION_PLAN.md` | The single Matrix work-selection queue. |
| `AGENTS.md` | Working rules, safety and scope decisions. |
| `RESOURCES.md` | References and reuse hypotheses, not assigned integrations. |
| Checkpoints, runbooks and `Validation/` | Dated evidence and reproduction; historical “next” text is not today's queue. |

Keep the selected milestone stable until demonstrated or explicitly changed by the owner. A new link, image, model or builder is normally another option behind “Operator, load XYZ,” not a new product direction.
