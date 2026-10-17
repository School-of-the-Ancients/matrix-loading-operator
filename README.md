# Matrix Loading Operator

> **A shared Three.js/WebXR runtime for creating, presenting and interacting with persistent digital worlds. Start blank or load a world, ask Operator to create or change it, then save and return from desktop, VR or AR.**

Matrix is inspired by **The Matrix** and **Ready Player One**: editable persistent digital worlds that people and authorized experiences can create and use. Desktop, VR and AR are views into the same world instance.

## What Matrix is

| Module | Responsibility |
| --- | --- |
| Matrix | Shared world runtime, Operator, creation/presentation, physics, persistence and generic desktop/VR/room AR access. |
| School / Cosmos Fair | Independent conversations with historical minds, teaching and learner records; figures request supported presentation material from Matrix. |
| Civilization | Independent AI residents and society, Boulder and geographic AR overlay data/meaning; it requests bounded Matrix world actions. |

Operator can create through procedural generation, Blender MCP with validated import, or reusable assets/capabilities, with an optional image mockup before a build. These paths use the same Matrix world and executor.

Current Citizens code remains nested here. A School guide can use a generic Matrix avatar/entity without the Citizens simulation; its mentor identity and teaching remain School-owned.

The original Unity Matrix/White Room implementation is preserved in [Archive/Unity](Archive/Unity/README.md) as read-only history. **New runtime work targets Three.js/WebXR.**

## Download and run

[v1.2.0 is the published checkpoint](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.2.0).
Download its PC/WebXR ZIP, manifest and checksums, then follow the bundled
`RELEASE-README.md` to start the matching PC service and open `/web/` on desktop
or Quest Browser. This is a WebXR bundle, not an APK. Python and native Codex
sign-in are separate prerequisites; local speech models and Blender are optional
external installations for their respective capabilities.

The checkpoint includes compact Operator context, persisted object locks,
browser Reviewed/Full access choices, readable XR controls and one shared Codex
speech destination. **Hold for Codex** opens that conversation from every
Operator page; **Hold to Add** and **Stop Turn** are available during a turn.
Select an object, pin a fresh point and ask Codex to move it there. Ordinary AR
creation and movement use free placement; **Fit to room** is deferred from
v1.2. Free placement does not certify physical clearance.

The [v1.2 checkpoint guide](Docs/V1.2-Checkpoint.md) records downloads, exact
source/checksums, permission choices, validation and remaining acceptance.
v1.1.0 is preserved as the earlier baseline. See [the roadmap](ROADMAP.md#current-work)
for current work and acceptance gates. Complete Quest and matched latency
acceptance stays open in [#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173);
publication or a GitHub release label is not a blanket acceptance pass.

## Fall 2026 coursework direction

Matrix polish, School presentations and Civilization research are independent workstreams that can contribute to coursework. Current priorities and dependencies are recorded in [ROADMAP.md](ROADMAP.md).

The [semester convergence plan](Docs/Semester-Convergence-2026.md) records the
October 16 delivery context: the October 27 4616 demo, the December 1/2 finals,
an optional 4622 digital-self observation interface,
and 3104 navigation/network-planning applications. Each course keeps a distinct
contribution; instructor approval and actual rubrics still govern submissions.

Start with the [October 27 rehearsal runbook](Docs/Matrix-Playground-Demo-2026-10-27.md)
under [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24).
This is a delivery plan, not implemented professor/GPS functionality or a change
to the existing release gates. Aura, Skyrim integration, and ChatGPT account-memory
access are not prerequisites for the class demos.

## Start here

- [VISION.md](VISION.md) — the product idea and boundaries.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together.
- [Operator UX](Docs/Matrix-Modular-UX-Plan.md) — interface inventory, creation journey and shared desktop/XR controls (target design).
- [Reference School–Matrix integration](Docs/V1.3-Implementation-Plan.md) — proposed presentation connection and completion checks.
- [ROADMAP.md](ROADMAP.md) — current work and acceptance gates.
- [RESOURCES.md](RESOURCES.md) — references for creation and AI citizens.
- [AGENTS.md](AGENTS.md) — rules for coding agents.
- [WebRuntime/README.md](WebRuntime/README.md#quest-controls-faq) — Quest controls and Operator screen FAQ.
- [#173 v1.2 fast simple creation](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173) — merged checkpoint and remaining acceptance.

Detailed technical runbooks and evidence live under `Docs/` and `Validation/`.
The ordinary `/web/` page is an interactive browser-owned world. The
separately started PC-owned Ada/Bo fixture is observed read-only at
`/web/hosted.html`; see [the host runbook](Docs/Persistent-World-Host.md).
To freeze a WebXR/PC preview from an exact commit, use the
[release builder](Tools/README-WebXR-Release.md).

## Runtime

- `WebRuntime/` — Three.js/WebXR Matrix client and world runtime.
- `ControlService/` — PC-local Operator/Agent Portal, tools, validation and receipts.
- `Archive/Unity/` — historical Unity source and release evidence.

Do not restart or rebuild the project because the documentation was simplified. Continue the existing implementation and preserve saved worlds, current contracts and merged work.
