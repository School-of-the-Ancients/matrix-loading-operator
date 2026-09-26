# Matrix vision — create, play, and learn

Direction reaffirmed by the owner on September 26, 2026.

**Ready Player Matrix / Ready Player One–inspired creation: enter a Matrix White Room or an AR space, say “Operator, load XYZ,” and create an interactive world you can explore, change, play in, and learn from.**

WebXR is the current delivery path. Student demonstrations and educational material presented in a fun, hands-on way are the near-term proving ground. The longer-term aspiration is to make this natural through everyday AR glasses as suitable devices become available. That is a product vision, not a hardware-availability prediction or a requirement to buy another headset.

[Requirements](PRD.md) · [Next implementation work](IMPLEMENTATION_PLAN.md) · [Project ownership](PROJECTS.md) · [Agent instructions](AGENTS.md)

## Roots: the 2023 and 2024 ideas

These dates identify the owner's original concept notes, restated in September 2026. They are not implementation or release dates.

- **July 16, 2023 — School of the Ancients:** ask historical figures such as Shakespeare and Plato questions through AI character emulation. The underlying goal is engaging conversation and learning, not merely placing an avatar in a room.
- **May 15, 2024 — prompt-created games, environments and characters:** connect catalogs of environments, objects, games, characters, voices, animations and sound effects through a shared interface. An AI retrieves or generates what the user requests and brings it into the user's virtual experience. The original Ready Player One idea was a usable creative world, not a requirement to finish every catalog before the first demo.
- **October 16, 2024 — digital and real worlds / simulated societies:** replicated AI researchers, employees, companies and worlds belong to the broader simulation branch. Keep that ambition, but do not make a simulated civilization a prerequisite for voice-created worlds or an educational exhibit.

Returning to these roots changes the work priority, not the renderer. The **White Room is the starting experience and interaction metaphor**, not an instruction to return generalized development to the original Unity implementation.

## The defining experience

```text
Enter the White Room / AR space
    → speak or type an idea to Operator
    → create or load a usable environment and its interactions
    → inspect, play, experiment, ask questions, and see consequences
    → revise it conversationally in the same world
    → save and return
```

Examples of the intended experience, not claims that every feature is implemented:

> “Operator, load a physics playground. Give me a ramp, objects I can grab, and a display of the results.”
>
> “Turn this into a challenge. Let me test my prediction, then explain what happened.”
>
> “Show this concept as an interactive exhibit instead of another slide.”
>
> “Load a historical workshop and let a clearly labeled simulated mentor guide me through an activity.”

Classrooms, workshops, spaceships, games and exhibits are examples of the same creation capability. Do not replace it with a fixed list of classroom templates. Educational demos should show a concept through meaningful interaction and feedback; attractive scenery and fluent explanations alone do not establish learning or correctness.

## Now: one small complete experience

The current feature owner is [#122 — Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122). Prove voice-led create → play/test → revise → save/resume, with usable immersive controls, a real interaction, and a display tied to the same world state. Its physics, executable-objective and extensibility acceptance remains in that issue.

Desktop HTML and Three.js are useful access, development and regression surfaces for the same experience. VR and AR are first-class product targets, with separate device evidence. Desktop progress can continue when hardware is unavailable; it cannot close immersive acceptance or indefinitely move voice/headset interaction behind more infrastructure.

Use procedural generation for a fast initial layout or object when it fits. Reuse compatible catalog content, and use Blender for richer assets, rigs and animation when valuable. They are complementary authoring paths into the same world. A procedural preview is not automatically a working collider, interaction or lesson; a polished mesh is not automatically a usable game object. Measure actual time to a usable result rather than promising instant arbitrary generation.

## Keep the architecture small

Use `WebRuntime/`, the existing `ControlService/` and PC-local Codex Agent Portal, existing catalogs, Matrix tools, state owners and receipts. Configure supported capabilities live; implement genuinely missing capabilities as ordinary reviewed modules. Do not create another engine, gateway, universal world language or asset registry to restate this vision.

Matrix owns reusable spatial and interactive capabilities. School of the Ancients remains the independent education product and owns curriculum, mentor pedagogy, learner records and assessment. A Matrix demonstration can teach a concept without moving School's records into Matrix or waiting for a new School backend.

Preserve the original Unity builds, current Citizens work, saved worlds, release checkpoints and evidence. Neither autonomous societies nor global geography are dependencies of the first educational creation demo. A conversational teacher need not first acquire a full resident needs/schedules system.

## Later: dynamic world improvement

**The dynamic upgrader is later roadmap work, not the current implementation goal.** It is more than replacing low-detail meshes with nicer ones: an opt-in agent could inspect appearance, layout, interactions, accessibility, learning usefulness and performance, select a bounded improvement, test it, and keep or revert the result.

A future loop could be:

```text
Fast initial procedural / reused world
    → owner-enabled review during idle time or an overnight window
    → inspect world state, visual evidence and actual use/failure events
    → prioritize within the owner's intent, permissions and budget
    → reuse/import an asset, revise it in Blender, or fix an interaction/layout
    → validate and compare outcomes
    → apply a versioned improvement or leave the working world unchanged
```

Before that worker is selected for implementation, require stable entity identity, compatible asset replacement, preserved manual edits and play/lesson/resident state, stale-work rejection, resource and license checks, explicit authority for structural or rule changes, and a working rollback. Screenshots alone cannot prove better interaction or educational correctness. It may conclude that no change is needed.

Retain those compatibility requirements in today's world contracts where needed, but **do not build the scheduler, autonomous review loop or a second world-state owner now**. Nothing in this document enables background jobs.

## Success and scope discipline

The immediate success is a student or demonstrator speaking an idea, seeing a useful interactive result, trying it, asking for a revision, and returning to the saved experience. The long-term sandbox remains broader than education; education gives the next slice a concrete purpose.

Choose work by its contribution to that loop, not by how many autonomous subsystems can be added. Keep bugs, limitations, proposed behavior, merged code, open candidates and real headset evidence visibly distinct.
