# Matrix roadmap

Matrix Loading Operator provides the shared world, presentation and creation tools. School and Civilization are independent experiences that use them. [VISION.md](VISION.md) defines the direction; [ARCHITECTURE.md](ARCHITECTURE.md) defines ownership. This file selects work. Detailed requirements stay in owning issues, evidence in Validation, and research in [RESOURCES.md](RESOURCES.md).

## Product ownership

| Product | Owns | Current home |
| --- | --- | --- |
| **Matrix Loading Operator** | World execution, Operator, assets and creation, interaction/physics, saves, desktop/VR and generic room AR. | This repository. |
| **School of the Ancients** | Conversations with historical minds, mentor identity/presentation choices, teaching, sources and learner records. Uses Matrix to load and manipulate presentation material. | [School repository](https://github.com/School-of-the-Ancients/school-of-the-ancients); [School #7](https://github.com/School-of-the-Ancients/school-of-the-ancients/issues/7) owns the current learning integration. |
| **Civilization** | AI citizens, persistent society, Boulder reconstruction, geographic registration and the AR overlay connecting the simulated city to real places. | Existing Citizens code and issues remain here; [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) owns this logical module. A separate package or repository has not been established by this change. |

A School historical guide can have a Matrix avatar without running the Citizens simulation. Civilization may later include teachers, but its needs, schedules, social memory and population clock are not School prerequisites. Generic room tracking and rendering belong to Matrix; the meaning and geographic data of a Boulder overlay belong to Civilization.

## Current work

**Delivery:** [#201](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/201) and [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24) own the October 27 Playground demonstration. Follow the [existing runbook](Docs/Matrix-Playground-Demo-2026-10-27.md): enter, create/edit, interact, revise, save and reopen. The demo does not require the School or Civilization expansion. [Course contributions](Docs/Semester-Convergence-2026.md) have separate outcomes and evidence.

**Baseline acceptance:** [#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173) retains the remaining matched-latency and exact-artifact wearer checks for the implemented v1.2 stack. Preserve the published checkpoint source, tag and assets at 858d486e9ee8507af36e2a05d78f1d34fc9ca2b0. The [checkpoint guide](Docs/V1.2-Checkpoint.md) and [single acceptance record](Validation/V1.2-Headset-Acceptance.md) own scope and results. Release metadata or a merged PR does not pass pending checks. Fit to room remains explicitly deferred from v1.2; ordinary edits keep the fast free-placement path and explicit measured tools keep their guards. The acceptance-process task #174 is completed; its process remains in use.

**Next integration:** [#187](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/187) tracks a reference School–Matrix presentation loop. The existing Galileo/Block Scale Lab is a small way to prove the connection, not the definition of School's whole product:

1. A School conversation requests a supported exhibit through #31.
2. The human owner reviews/Applies the request in Matrix; #32 exposes the shared interactive exhibit and observations.
3. The learner changes something; School responds to the confirmed result.
4. Save and return, reconciling the Matrix world and School session without replaying an old request.

Follow the [reference integration plan](Docs/V1.3-Implementation-Plan.md) for current compatibility, failure and recovery checks. Pull only the #203 interface and #186 testing work needed for that slice. Existing School pairing and generic exhibit code are foundations to verify, not promises that the whole live WebXR experience already works. A full integrated release still needs the applicable #173 and integration evidence.

School's broader goal is open exploration with historical minds who can request suitable images, models, environments or interactive demonstrations as Matrix gains those capabilities. Civilization chooses its own agent/geographic slices under #29; it is not the automatic next stage of a School lesson.

## Open work by owner

This routing covers the 30 open issues reviewed on October 17, 2026. It assigns responsibility, not a new deadline, release or claim of completion.

| Owner / workstream | Existing issues | Scope |
| --- | --- | --- |
| Matrix creation and UI | #9, #154, #158, #163, #171, #172, #185, #203 | Content connectors, refinement, locks, Operator, latency, spatial controls and image-guided worlds. |
| Matrix spatial and presentation capabilities | #22, #31, #32, #195 | Room alignment/physics, client-neutral tools and reusable exhibits. #22A is generic room access; #22B's resident behavior belongs to Civilization. #31 also carries School connection acceptance. |
| Matrix baseline acceptance | #173 | Existing fast-creation release evidence. |
| School–Matrix integration | #187 | School owns conversation/teaching; Matrix supplies presentation tools. Pair with School #7. |
| Civilization | #20, #29, #148, #179, #180 | Resident state and hosting, agent behavior, Operator integration with the persistent world, geographic research and the bounded Boulder block. |
| Optional client integration | #181, #182, #183, #184 | ChatGPT adapter, pairing/hosting and UI over the existing Matrix capabilities. |
| Access and development tooling | #186, #188 | Rendered/input testing and phased wireless/deployment access. |
| Research | #177, #189 | Optional reconstruction and remote/hybrid glasses compute. Civilization's location research stays in #179. |
| Delivery and backlog routing | #24, #201, #156 | Reproducible submissions/demo; #156 routes longer-term ideas to these owners. |

Image-world and progressive-refinement requirements remain in #185/#154. Their artistic trail example is distinct from #180's geographically registered Boulder street. #188 retains its own phased LAN, migration, off-site and optional streaming scope. The read-only hosted Citizens fixture does not acquire general Operator access through a documentation change; #148 owns that integration.

## Selecting and organizing work

Use one active implementation slice per owner, with an observable finish condition and only the dependencies it needs. Keep shared Matrix changes in Matrix issues; keep School experience work in School; route Civilization work through #29 while its code remains here. A module does not automatically need a service, repository or top-level UI tab.

Update this roadmap and the owning issue when priorities change. Replace superseded instructions instead of stacking dated execution plans. Keep unique design detail in its existing document and link it; preserve old proposals in Git history. The [Operator UX design](Docs/Matrix-Modular-UX-Plan.md) owns the interface inventory and migration details, not a competing work queue.

Review the existing implementation and issue comments before opening another task. Reuse completed #122/#132/#109 foundations, retaining their actual limits. Do not close a broad issue because one slice passed. Keep automated, desktop, emulated XR and wearer evidence distinct; unrelated documentation changes do not trigger another headset session.
