# Matrix Loading Operator

Matrix is a shared Three.js/WebXR runtime for creating, presenting and interacting with persistent digital worlds. Start blank or load a world, ask Operator to create or change it, interact, save and return from desktop, VR or AR.

## v1.2 is frozen

Use the published [v1.2.0 checkpoint](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.2.0) at source `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0`. Download its PC/WebXR ZIP, manifest and checksums, then follow the bundled `RELEASE-README.md`. Python and native Codex configuration are separate prerequisites; speech models and Blender are optional installations for their respective capabilities.

The checkpoint includes compact Operator context, persisted object locks, Reviewed/Full access choices, readable XR controls, selected-point movement and one shared Codex speech destination. Ordinary AR edits use free placement. Fit to room remains deferred.

The implementation and checkpoint packaging are complete. **Matched latency and the remaining physical acceptance are still open in [#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173).** Later changes on `main`, including #207, are subsequent work and are not in the published ZIP. Keep the published source, tag and assets fixed.

## Start here

| Need | Read |
| --- | --- |
| Run, reproduce or understand v1.2 requirements | [v1.2 checkpoint guide](Docs/V1.2-Checkpoint.md) |
| See what remains to finish | [Current roadmap](ROADMAP.md#current-work) and [one acceptance checklist](Validation/V1.2-Headset-Acceptance.md) |
| Understand the product and module boundaries | [Vision](VISION.md) and [architecture](ARCHITECTURE.md) |
| Use the desktop or Quest controls | [Runtime guide](WebRuntime/README.md) |
| Work on this repository | [Agent instructions](AGENTS.md) |
| Find an old plan, build log or screenshot | [Archive index](Archive/README.md) |

## Modules

| Module | Responsibility |
| --- | --- |
| **Matrix** | Shared world execution, Operator, creation and presentation, physics, saves and desktop/VR/room AR access. |
| **School / Cosmos Fair** | Conversations with historical minds, mentor identity, teaching and learner records. Uses Matrix to present supported images, objects, environments and experiments. |
| **Civilization** | AI residents and society, Boulder and geographic AR overlays. Uses bounded Matrix world actions. |

These boundaries organize responsibilities and issues. Current Citizens code remains nested here. A School mentor can use a generic Matrix avatar without the Citizens simulation. Future work is grouped by module in the roadmap; v1.2 acceptance and delivery are the selected work.

## Runtime and operating references

- `WebRuntime/` — the Three.js/WebXR world and client.
- `ControlService/` — the PC-local Operator, tools, validation and receipts. Privileged credentials stay on the PC.
- [Release builder](Tools/README-WebXR-Release.md) — build and verify a package from an exact committed revision.
- [World checkpoints](ControlService/WORLD_CHECKPOINTS.md) — save and recovery contracts.
- [Persistent host](Docs/Persistent-World-Host.md) — the separately started, PC-owned Citizens fixture and read-only viewer. The ordinary `/web/` world remains browser-owned.
- [Unity archive](Archive/Unity/README.md) — preserved early implementation.

Operator can use procedural creation, reusable assets or Blender with validated import; an image mockup can guide a build. All use the same Matrix world and executor. Preserve existing worlds and stable identities when continuing the implementation.
