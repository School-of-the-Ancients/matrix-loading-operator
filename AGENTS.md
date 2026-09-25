# Instructions for coding agents

Read [PROJECTS.md](PROJECTS.md) before making architectural decisions.

This repository contains multiple generations of Matrix. Do not assume every existing subsystem belongs to the current implementation direction.

## Default target

Unless the task or issue explicitly says otherwise, **new generalized Matrix runtime work targets the Three.js/WebXR Matrix in `WebRuntime/` and the shared PC-side capability boundary in `ControlService/`.**

The current architecture is:

```text
Web / Quest WebXR
      |
Three.js Matrix
      |
ControlService / Agent Portal
      |
PC-local Codex + tools/MCPs
```

Codex remains on the PC. Browser/headset code is a bounded client and must not receive Codex, GitHub, Blender, MCP or other privileged credentials.

## Do not confuse these tracks

- **Unity/original Matrix:** `Assets/`, `Packages/`, `ProjectSettings/`, Unity build scripts, White Room, Room AR, old content packs.
- **Current Web Matrix:** `WebRuntime/`, Agent Portal, Matrix MCP/tools, Blender/GLB, runtime components, HTML/Three.js/WebXR experiences.
- **Matrix World:** geospatial persistent world / Matrix Boulder / Earth registration.
- **AI Citizens:** character embodiment, navigation, needs, schedules, GOAP, memory and social simulation.
- **School of the Ancients:** separate product. Do not place curriculum/learner-state ownership in Matrix.

## Current design rules

1. Preserve Unity as a supported legacy/native client unless a task explicitly retires something.
2. Do not make Unity the default target for new generalized creation capabilities.
3. Do not reproduce Codex inside WebXR. Matrix is a thin spatial/interactive client to the PC-local Codex agent.
4. Do not build hundreds of one-off semantic actions when a reusable component/capability can express the behavior.
5. Blender is an optional asset/rig/animation factory; Three.js/WebXR is the current programmable spatial runtime.
6. Interactive experiences may have HTML, Three.js browser and WebXR surfaces over the same authoritative state.
7. Shared ControlService changes should remain renderer-neutral when practical.
8. World mutations require validation and observed runtime receipts; never claim success from intent alone.
9. Keep desktop/browser fixture evidence separate from real Quest wearer evidence.
10. Do not silently broaden an issue into Matrix Boulder, Citizens, School or multiplayer work.

## Before coding

- Read the controlling GitHub issue and its dependencies.
- Check current open PRs: the newest capability may be stacked and not on `main`.
- Identify the project track from PROJECTS.md.
- Reuse existing state, validation, receipt, asset and component contracts instead of creating parallel systems.
- Preserve open stacked PR history and resolved review fixes.

## Pull requests

Prefer small reviewable slices with exact validation and explicit remaining hardware checks.

Unless explicitly instructed to merge, **leave PRs open for review**.

Do not claim a hardware capability based only on desktop/unit tests.
