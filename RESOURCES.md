# Research reference index

The [full research catalog](Archive/v1.2-freeze-2026-10-17/RESOURCES.md) and all seven research notes remain in the repository under `Archive/v1.2-freeze-2026-10-17/`. They preserve the collected sources and context; references do not automatically become dependencies or selected work.

## Research notes

| Topic | Preserved research | Module |
| --- | --- | --- |
| Persistent societies and public data | [Emergence World](Archive/v1.2-freeze-2026-10-17/Docs/Research/Emergence-World.md) | Civilization |
| Simulation clocks and learned world models | [Clocks and world models](Archive/v1.2-freeze-2026-10-17/Docs/Research/Simulation-Clocks-and-World-Models.md) | Civilization / School experiments |
| Embodied NPC conversations and actions | [Skyrim VR AI NPCs](Archive/v1.2-freeze-2026-10-17/Docs/Research/Skyrim-VR-AI-NPCs.md) | Civilization |
| Planning and character execution | [GOAP investigation](Archive/v1.2-freeze-2026-10-17/Docs/GOAP-Next-Step.md) | Civilization / Matrix execution |
| Composable runtime behavior | [LLMR behavior runtime](Archive/v1.2-freeze-2026-10-17/Docs/LLMR-Behavior-Runtime.md) | Matrix |
| Local speech | [LLMR and voice review](Archive/v1.2-freeze-2026-10-17/Docs/LLMR-Voice-Review.md) | Matrix |
| Earlier Unity, Meta and MRUK work | [Meta Building Blocks review](Archive/v1.2-freeze-2026-10-17/Docs/Meta-Building-Blocks-Review.md) | Matrix history |

## Boulder simulation, geospatial visualization and AR registration (October 22, 2026)

**Research sources and layer boundaries** (not selected runtime dependencies):

- **Persistent agent society:** [Emergence World](https://github.com/EmergenceAI/Emergence-World), with [Matrix's preserved review](Archive/v1.2-freeze-2026-10-17/Docs/Research/Emergence-World.md). A 2026 multi-agent society reference, **not** a fully open-source runnable engine; released content is CC BY-NC 4.0, research/non-commercial use.
- **Geographic source of truth:** [Overture Maps](https://docs.overturemaps.org/) and local open geographic data for independently licensed streets, footprints, path graphs and elevation as available. Simulation identity, navigation, collisions and citizen state must be maintained independently of a photorealistic basemap.
- **Optional city visualization:** [Google Maps Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles-overview) in compatible renderers (e.g., Cesium). Keep this as an API-licensed visual layer; confirm coverage, fees, attribution, caching and restrictions. Do **not** extract, train on, or repurpose Google's visual geometry into independent simulation data.
- **Optional simulation backend:** [NVIDIA Omniverse/OpenUSD](https://docs.omniverse.nvidia.com/) for interoperable scenes / future physics or digital-twin experiments. No replacement of the current Three.js/WebXR + Blender Matrix path is selected.
- **Real-world AR registration:** [ARCore Geospatial API](https://developers.google.com/ar/develop/geospatial) (GPS + VPS / camera-inertial localization) as a candidate geospatial anchor layer. SDK/device support, outdoor coverage, precision, occlusion and live headset availability must be proven separately; GPS alone is not precise sidewalk alignment.
- **Learning vs simulation:** [Hua Wei / DaRL research](https://labs.engineering.asu.edu/hw/research) connects *learning to simulate* with *sim-to-real transfer*; these do not imply AR registration already works.

**Proposed bounded research sequence:** independently map one Boulder block, persist 3–5 residents and their actions in Matrix/Citizens, inspect the same world from desktop/VR, then add one calibrated AR registered view. Treat observations with timestamps/confidence; physical obstacles remain visible despite stylized overlays.

**Ownership:** Civilization geospatial research [#179](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/179), street-overlay acceptance [#180](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/180), AI Citizens [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29). **Scope:** research-only, no new sprint, no frozen v1.2 scope change, no adopted service or completed headset test.

## Related proposals

| Area | Preserved material | Current owner |
| --- | --- | --- |
| Creation and UI | [Modular UX inventory](Archive/v1.2-freeze-2026-10-17/Docs/Matrix-Modular-UX-Plan.md) | Matrix #9, #154, #185, #203 |
| Historical minds and presentations | [School plan](Archive/v1.2-freeze-2026-10-17/Docs/School-Generative-Agents-Plan.md) and [reference integration](Archive/v1.2-freeze-2026-10-17/Docs/V1.3-Implementation-Plan.md) | School / Matrix #187 |
| Boulder and geographic AR | [Boulder requirements](Archive/v1.2-freeze-2026-10-17/Docs/Matrix-Boulder-PRD.md) | Civilization #179, #180 |

The [roadmap](ROADMAP.md) selects work. Preserve useful research and its original context, date, sources and license; a research example does not establish an implemented Matrix capability. Keep research browsable in the repository through this index. See the [archive index](Archive/README.md) for historical plans, build evidence and the original repository snapshot.
