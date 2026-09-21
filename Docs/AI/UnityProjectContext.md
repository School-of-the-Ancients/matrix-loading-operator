# AR Sandbox project context

Created 2026-09-20 as a separate project at the user's request. Updated target: Quest Pro with manually configured Space Setup floor/table data. Quest 3 is optional. This supersedes earlier Quest 3 decisions. See ../Progress-Log.md for the current continuation state.

## Contract

Native Android Quest app, Meta XR Core/MRUK room anchors, bundled props, validated scene commands, and a PC HTTP control/persistence service. The PC stores JSON, while the headset polls commands and reports actual state. A separate desktop fixture tests commands without pretending to be real room data.

## Environment and boundaries

- Unity 6000.6.0f1; built-in renderer for small simple props. Meta XR Core and MRUK 205.0.0 pinned from Unity's registry. OpenXR package uses the installed Editor's supported version.
- Source code: Assets/Sandbox/Runtime. Editor-only generation and validation: Assets/Sandbox/Editor. All project-owned code uses namespace ArSandbox.
- Scene and prefab assets are generated through Unity Editor APIs, preserving .meta GUIDs on repeat generation.
- The new project has no inherited scenes, code, or Git baseline. Existing Unity projects and <local-reference-installation> are reference-only and remain unmodified.
- No Unity MCP was available. Validation uses the installed Unity Editor's batch mode and native player execution.
- Commands use stable object IDs and asset IDs. Pose is local to the named room target. Scene files identify the room. Loading requires matching room/anchor identities; there is no silent world-origin fallback.
- Core targets MRUK device Scene Model V1 semantic surfaces on Quest Pro. Quest 3 depth/high-fidelity meshes are unnecessary. The native adapter never substitutes simulated room data.

## Initial evidence

The OMEN PC has an RTX 3080 and a running Meta PC runtime. Initial ADB inspection found zero devices. Unity 6 Android build modules were incomplete. Package imports, builds, and hardware validation must be reported separately. Hardware passthrough, room permission, and real anchor persistence are not yet validated.

## Current implementation context (2026-09-21)

Analyzed baseline: `80cf846` on `main` (merged runtime behaviors). The earlier initial-evidence paragraphs above describe project creation and are historical; current merged checkpoints include standalone Quest Pro room alignment, speech, behaviors, and persistence evidence in `Docs/Current-Checkpoint.md`.

- Unity 6000.6.0f1, built-in rendering, Input System 1.20.0, OpenXR 1.18.0; native AR uses Meta Core/MRUK 205.0.0. No Unity Editor MCP is connected. Batch fixtures and actual player runs provide validation.
- Runtime code under `Assets/Sandbox/Runtime` is MonoBehaviour/command oriented. `SandboxApp` owns selection and current room/viewer context; `SandboxWorld` validates commands and owns authoritative placement/history. `SandboxBehaviorVisual` animates child visuals without changing saved placement. `PcBridge` exchanges state and idempotent command receipts with the PC.
- `ControlService/server.py` owns the active session lease, revisions, proposal review/apply, voice jobs, and JSON persistence. `ai_adapter.py` builds bounded structured context and validates planner output. `codex_provider.py` owns the PC-only native CLI invocation. `index.html` is the Operator panel.
- No first-party assembly definitions or multiplayer framework. Editor generation/checks live under `Assets/Sandbox/Editor`; do not mix these with runtime dependencies. Native scene is `QuestSandbox.unity`; generated white-room/AR fixtures have separate scene/build setup and use explicitly enumerated source files.
- `Build-WhiteRoom.ps1` makes independent Desktop/Quest fixtures; `Build-RoomAR.ps1` makes the native Meta fixture. New runtime source files must be added to applicable source lists. Image encoding needs the built-in `com.unity.modules.imageconversion` module.
- Rendered captures are transient data outside `SceneData`: a separate exchange request/receipt, matched to a PC revision and contemporaneous snapshot. The optional JPEG supplements existing provider context; it never authorizes an edit or changes undo/save formats. See `Docs/Visual-Feedback.md`.
- Tests use Python `unittest`, a dependency-free Node panel harness, Unity batch-run `SandboxCoreChecks`, and real Windows-player acceptance runners. Headless runs cannot validate screenshot rendering. New screenshot hardware evidence must be collected independently of the earlier completed milestones.

### Original architecture reference

VaM local samples demonstrated stable object lookup, typed parameter dispatch, explicit persistence, and lifecycle-safe reference resolution. No VaM code, assets, schema, or host API was copied. Detailed local installation notes are not published. No VaM code or assets are distributed here.
