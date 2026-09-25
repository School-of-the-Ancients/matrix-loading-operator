# Blender authoring tiers for the WebXR Matrix

## Existing default

`/api/web/blender` uses Codex to return a validated, bounded JSON blueprint. A fixed headless Blender script builds up to 80 primitive parts, exports a static GLB, and registers it through the immutable web catalog. `/web/` loads the cataloged GLB; Blender does not run inside the headset. This path remains the default and must not accept executable model output.

## Candidate: guided scratch authoring

A richer Codex-to-Blender path should be a separate, explicitly selected development capability. Codex could drive Blender MCP in a **dedicated scratch Blender instance**, inspect the result, export only the authored objects, and submit the GLB to the existing `WebAssetCatalog.register` path. The current MCP exposes code execution inside Blender, so it must not be wired directly to an unattended browser request or to the user's open working scene.

The initial guided tier should keep this contract:

1. Start with an empty scratch scene owned by one authoring job. Record its Blender version and a job identifier. Leave any already open Blender scene untouched.
2. Let Codex build one static object through a reviewed, bounded authoring session. Keep intermediate `.blend`, scripts, and logs outside the runtime catalog.
3. Export selected objects to one self-contained GLB. Measure the rendered bounds after import and enforce the existing 16 MiB, mesh, vertex, embedded-resource, and scene-scale limits before registration. Reject external textures, scripts, and missing bounds.
4. Register the validated GLB under its content hash. Return only the catalog asset ID and measured bounds to the WebXR Operator. Placement, save, and restore continue through the current scene commands and receipts.
5. Preserve the default blueprint endpoint and its resource limits. Do not advertise sculpting, rigging, animation playback, or procedural behavior as supported by `/web/` without separate runtime contracts and tests.

### Bounded next experiment

In a scratch Blender instance, author one non-primitive static object (for example, a beveled arch with a custom outline), export it, run the existing GLB inspector, register it, and verify desktop `/web/` placement and reload. Record prompt-to-catalog time, final GLB size, measured bounds, mesh and vertex counts, and any failed validation. This experiment does not require changing the wearer's Quest scene.

The connected Blender MCP was inspected read-only for this spike; it was attached to an existing scene, so no live-scene edits or exports were attempted. No guided tier endpoint or automatic MCP orchestration is implemented here.
