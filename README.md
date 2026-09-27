# Matrix Loading Operator

> **A Three.js/WebXR sandbox. Start blank or load an existing world. Ask Operator to create and change things around you. Save it and return. Some worlds have AI citizens.**

Ready Player One and The Matrix are the inspiration. **“White Room” is the blank-canvas/loading idea—not the original Unity prefab, scene or application, and not a separate room required for editing.** Start fresh or enter a compatible existing world, then use “Operator, load XYZ” in that world under its permissions.

> **Start here:** [VISION.md](VISION.md) records the agreed idea and its roots. [PRD.md](PRD.md) defines requirements, [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) selects current work, [PROJECTS.md](PROJECTS.md) maps ownership, [RESOURCES.md](RESOURCES.md) collects references, and [AGENTS.md](AGENTS.md) guides coding agents. The current feature remains [#122 — Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122). Product targets are not claims that every feature is implemented or headset-validated.

**Continue the existing implementation. Do not rebuild the engine, restart the project, create a replacement repository or discard work.** The Unity archive changes repository organization; it does not reset a live world or restart the user's service. The setup commands below are for normal installation and development.

The current generalized client is **[Matrix Web](WebRuntime/README.md)**: Three.js on desktop and WebXR for VR/AR access. A PC-local [ControlService](ControlService/README.md) connects it to the persistent Codex Agent Portal, asset/component catalogs, validated scene commands and runtime receipts. The original Unity source, prefab builds and release evidence are preserved as [read-only history](Archive/Unity/README.md). New work and coursework submissions target Matrix Web; the historical White Room names do not make a Unity asset part of the Web sandbox's requirements.

**Now:** continue the create → play/learn → revise → save loop in the existing application. Procedural generation, reusable assets, Blender and optional image mockups are complementary creation methods. Education is an important proving ground, not a restriction to classroom templates. Desktop is an access/development surface; immersive voice, controls and separate VR/AR acceptance remain in #122.

Merged [Creator Mode work in PR #127](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/127) adds procedural recipes, Creator/Play controls, Rapier rigid bodies and virtual colliders, an objective bound to existing object IDs, live world displays and browser/PC world archives. [Isolated desktop evidence](Validation/Immersive-Creator-Desktop-2026-09-26.md) covers a physics playground with restored progress, a distinct Gravity Lab created and revised through a connected PC-local Codex Agent from typed requests, and a non-physics Dimensions Exhibit using the same object IDs through scale revision and checkpoint restore. Spoken headset input and VR/AR wearer acceptance for these additions remain unverified; the user's live service and saved worlds were not used for those tests.

**Later:** richer inhabited worlds, resident construction, portals and an optional [dynamic world-improvement agent](VISION.md#later-dynamic-world-improvement). Citizens work through [#123](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/123) and [#126](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/126) has merged into `/web/`; further autonomy and Quest wearer acceptance remain separate work. A full society, special creation room, portal network or overnight worker is not a prerequisite.

| Track | Use it for | Entry point |
| --- | --- | --- |
| **Matrix Web — current default** | Voice/text creation, interactive experiences, Blender/GLB, reusable components and browser/Quest AR/VR; see #122 for procedural/physics/demo targets | [`/web/`](WebRuntime/README.md) |
| **Matrix Unity — archive** | Historical native Quest/desktop source, MRUK room AR, prefabs, AssetBundles and prior release evidence | [Read-only archive](Archive/Unity/README.md) |
| **Matrix World** | Persistent inhabited worlds, including AI citizens; optional geospatial worlds such as Boulder and Earth-aligned overlays | [Project map](PROJECTS.md#3-matrix-world) |
| **AI Citizens** | Bounded resident simulation in `/web/`; further autonomy is separately selected | [Project map](PROJECTS.md#4-ai-citizens--character-body) |

Matrix is an independent spatial runtime. [School of the Ancients](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap) remains a separate product: mentors, curriculum, lessons and learner records belong to School; reusable demonstrations and world/experiment execution belong to Matrix. A Matrix demo does not require a new School backend. See [PROJECTS.md](PROJECTS.md#6-school-of-the-ancients-is-a-separate-product).

**[Releases](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases)** · **[Current checkpoint and evidence](Docs/Current-Checkpoint.md)** · **[Product requirements](PRD.md)** · **[Implementation plan](IMPLEMENTATION_PLAN.md)** · **[Issues](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues)**

## Start Matrix Web

Requirements: Python 3.10+, Node.js `^20.19.0 || >=22.12.0` with npm (the supported Vite ranges), and a PC-local Codex CLI signed in with ChatGPT for the Agent Portal. Install the optional Matrix MCP Python dependency in the same Python environment as the service. From a fresh checkout on Windows:

```powershell
git clone https://github.com/School-of-the-Ancients/matrix-loading-operator.git
Set-Location matrix-loading-operator
python -m pip install -r ControlService/requirements-agent-mcp.txt
Set-Location WebRuntime
npm.cmd ci
npm.cmd run build
Set-Location ..
.\Start-CodexControlService.ps1
```

Open **http://127.0.0.1:8765/web/** on the PC. Select **CODEX** and connect to start or resume the PC Agent conversation. The launcher defaults to workspace-write access with reviewed approvals; the PC owner can choose `-AgentSandbox danger-full-access -AgentApprovals automatic` before launching. The headset displays the effective mode but cannot raise its own access. For local headset voice input, run `./Setup-LocalSpeech.ps1` once before starting the service. [Agent and runtime details](WebRuntime/README.md#operator-in-ar-or-vr) explain selection, review, receipts and limits.

For Quest Browser over an authorized USB debugging connection, run `adb reverse tcp:8765 tcp:8765` on the PC, then open **http://127.0.0.1:8765/web/** in the headset. Enter VR for a fully virtual view or AR for passthrough. These are views of the current world, not separate creation rooms. Quest Browser data at that exact origin holds a browser world checkpoint. **WORLD → SAVE WORLD** saves there and makes a scene-only PC backup. Merged Creator Mode also provides separately labeled named PC whole-world save/restore and browser world archive/new/restore controls; see the [runbook](Docs/Procedural-Creation.md) and [Web save and restore](WebRuntime/README.md#save-and-restore). Their Quest operation still needs wearer validation.

The merged Web stack includes validated Blender/GLB registration and import, Flight/selection animation clips, bounded numeric components, [bounded vertical drops for eligible imported GLBs](Docs/Web-Floor-Physics.md), typed position/rotation changes and Creator Mode's Rapier physics in the virtual world. These use scene revisions and browser runtime receipts. The older bounded drop path alone does not prove rigid-body or object-to-object collisions; the Creator Mode desktop tests and trace cover those scoped behaviors. Physical AR surface placement still requires room alignment. [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md) separates wearer observations from desktop checks; the [typed rotation validation](Validation/WebRuntime-Typed-Rotation-2026-09-26.md) includes an earlier Quest VR voice follow-up and receipt, with AR still untested for that tool.

## Find the right guide

| I want to… | Start here |
| --- | --- |
| Use the current desktop or Quest browser client | [Matrix Web runtime](WebRuntime/README.md) |
| Create and animate a GLB, or use Blender MCP through the PC Agent | [Blender authoring tiers](WebRuntime/BLENDER_AUTHORING_TIERS.md), [asset workflow](WebRuntime/README.md#blender-assets) |
| Save a Web scene and game | [Web save and restore](WebRuntime/README.md#save-and-restore), [PC checkpoints](ControlService/WORLD_CHECKPOINTS.md) |
| Inspect current Web headset evidence and open gaps | [Quest acceptance](WebRuntime/QUEST3_ACCEPTANCE.md), [current checkpoint](Docs/Current-Checkpoint.md) |
| Inspect historical Unity source or release evidence | [Read-only Unity archive](Archive/Unity/README.md), [content packs](Docs/Content-Packs.md) |
| Connect an independent local application | [Client API v1](Docs/Client-API-v1.md) |
| Choose a project track or implementation owner | [Project map](PROJECTS.md), [agent instructions](AGENTS.md) |

## Archived Unity project

The original Unity project and native build scripts are preserved under [Archive/Unity](Archive/Unity/README.md). They are read-only historical source. Earlier Unity APKs and PC bundles remain in [releases](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases). They are not current WebXR acceptance evidence.

## Development

| Location | Purpose |
| --- | --- |
| `WebRuntime/` | Current Three.js/WebXR client, HTML surfaces, world persistence, interactions and Node tests |
| `ControlService/` | Shared PC service, Agent Portal, Matrix tools, validation, catalogs and Python tests |
| `Archive/Unity/` | Read-only native source, project settings and historical build scripts |
| `Docs/` | User guides, architecture and milestone notes |
| `Validation/` | Validation runners and sanitized evidence |

Builds, local scenes, caches, credentials and raw room captures are excluded from Git. The native scripts and original build procedure are preserved in the [Unity archive](Archive/Unity/README.md).

Run PC checks from the repository root:

```powershell
python -m unittest discover -s ControlService -v
Set-Location WebRuntime
npm test
npm run build
Set-Location ..
```

PC tests and compilation do not establish headset alignment, input or rendering. See the [Web Quest acceptance matrix](WebRuntime/QUEST3_ACCEPTANCE.md) and [current checkpoint](Docs/Current-Checkpoint.md) for mode-specific evidence. [Spatial/content validation](Validation/Spatial-Content-Validation.md) and the [Quest prefab walkthrough](Validation/content-headset-walkthrough.json) record earlier native work only. Validation runners offering `--run` can invoke AI or edit a scene; read their guide before using that mode.

Further reading: [project map](PROJECTS.md), [Web runtime](WebRuntime/README.md), [Agent Portal](ControlService/AGENT_PORTAL.md), [implementation plan](IMPLEMENTATION_PLAN.md), [Unity source archive](Archive/Unity/README.md), [progress history](Docs/Progress-Log.md) and [submission release checklist](Docs/Versions-And-Submissions.md#preserve-a-new-webxr-submission).

Authored code uses the [MIT license](LICENSE). Unity, Meta and imported content retain their respective licenses; preserve asset attribution and distribution terms when publishing packs.
