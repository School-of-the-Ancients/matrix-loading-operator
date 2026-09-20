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

## Architecture reference

VaM local samples demonstrated stable object lookup, typed parameter dispatch, explicit persistence, and lifecycle-safe reference resolution. No VaM code, assets, schema, or host API was copied. Detailed local installation notes are not published. No VaM code or assets are distributed here.
