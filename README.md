# Matrix Loading Operator

> **A persistent Three.js/WebXR world where AI citizens can live independently and humans can enter from desktop/VR or visit through AR. Humans and authorized AI citizens can ask Operator to create and change the world. Save it and return.**

Matrix is inspired by **The Matrix** and **Ready Player One**: one editable persistent digital world rather than a collection of separate prototypes. AR is a view into that same world, not a second citizen simulation.

## What Matrix is

```text
Human or AI citizen
        |
"Operator, load/create/change XYZ"
        |
        v
Creation pipeline
  - procedural generation
  - Blender MCP -> validated import
  - reusable assets/capabilities
  - optional image mockup -> selected concept -> build
        |
        v
Three.js / WebXR world
  - desktop
  - VR
  - AR
  - physics and interaction
  - save / load
        |
        v
AI Citizens
  - memory
  - needs / schedules
  - planning
  - relationships
  - world interaction
  - eventually world building through the same bounded capabilities
```

The original Unity Matrix/White Room implementation is preserved in [Archive/Unity](Archive/Unity/README.md) as read-only history. **New runtime work targets Three.js/WebXR.**

## Download and run

[v1.2.0 is the published checkpoint prerelease](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.2.0).
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
v1.1.0 remains the stable Latest release. Complete Quest and matched latency
acceptance stays open in [#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173);
publication of this checkpoint is not a blanket acceptance pass.

## Start here

- [VISION.md](VISION.md) — the product idea and boundaries.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together.
- [ROADMAP.md](ROADMAP.md) — Now / Next / Later.
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
