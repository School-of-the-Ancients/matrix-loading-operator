# Blender authoring tiers for the WebXR Matrix

## Current bounded path

`/api/web/blender` uses Codex to return a validated, bounded JSON blueprint. A fixed headless Blender script builds up to 80 primitive parts, exports a static GLB, and registers it through the immutable web catalog. `/web/` loads the cataloged GLB; Blender does not run inside the headset. This path remains a fast, bounded fallback and must not accept executable model output.

## Next tier: Agent Portal authoring

The persistent Agent Portal now works for PC conversation and typed Matrix MCP tools. The next guided tier is to use its configured Blender MCP in the same conversation as the wearer to build, inspect, revise after a follow-up, and export an asset. The exported GLB still enters through `WebAssetCatalog.register`; Codex does not bypass catalog validation. This is a portal capability, not another Blender-specific browser endpoint. Concept images remain optional at Codex's discretion.

For the first experiment, use a **dedicated scratch Blender instance**. The current MCP exposes code execution inside Blender, so an unattended browser request must not gain direct access to the user's open working scene. A later explicitly selected working scene needs its own approval and recovery design.

The initial guided tier should keep this contract:

1. Start with an empty scratch scene owned by one authoring job. Record its Blender version and a job identifier. Leave any already open Blender scene untouched.
2. Let Codex build one static object through a reviewed Agent Portal session, then revise that same object on a follow-up turn. Keep intermediate `.blend`, scripts, and logs outside the runtime catalog.
3. Export selected objects to one self-contained GLB. Measure the rendered bounds after import and enforce the existing 16 MiB, mesh, vertex, embedded-resource, and scene-scale limits before registration. Reject external textures, scripts, and missing bounds.
4. Register the validated GLB under its content hash. Return the catalog asset ID, measured bounds, and a preview to the Agent Portal. Placement, save, and restore continue through the current scene commands and receipts.
5. Preserve the bounded blueprint endpoint and its resource limits. Do not advertise sculpting, rigging, animation playback, or procedural behavior as supported by `/web/` without separate runtime contracts and tests.

### Bounded next experiment

Use the same Codex conversation to author one non-primitive object in a scratch Blender instance, revise it on a follow-up, export it, run the existing GLB inspector, register it, and verify desktop `/web/` placement and reload. Record prompt-to-catalog time, final GLB size, measured bounds, mesh and vertex counts, and any failed validation. This experiment does not require changing the wearer's Quest scene.

The [Clockwork Firefly desktop trace](../Validation/WebRuntime-Desktop-2026-09-25.md) proves a new Blender-scripted animated GLB can pass validation, enter the catalog, spawn through Matrix MCP, and render in `/web/`. The first attempt to author it inside Agent Portal stopped at an unreviewable generic command approval; an interactive PC terminal now offers a one-time command review handoff. The Blender MCP add-on was not connected during this run, and full Blender MCP authoring plus follow-up revision remain unverified.
