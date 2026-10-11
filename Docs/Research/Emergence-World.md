# Emergence World research for Matrix

Reviewed October 11, 2026. Status: reference and feasibility notes; no runtime integration selected.

## Sources and public release

- [Emergence World repository](https://github.com/EmergenceAI/Emergence-World), by Emergence AI.
- [Season 1 paper](https://arxiv.org/abs/2606.08367): persistent agents and a 15-day comparison across model families.
- [Season 2 paper](https://arxiv.org/abs/2609.17320): long-horizon multi-agent stress testing.
- Upstream [architecture](https://github.com/EmergenceAI/Emergence-World/blob/main/docs/ARCHITECTURE.md), [orchestration](https://github.com/EmergenceAI/Emergence-World/blob/main/docs/ORCHESTRATION.md), [memory](https://github.com/EmergenceAI/Emergence-World/blob/main/docs/MEMORY.md) and [license](https://github.com/EmergenceAI/Emergence-World/blob/main/LICENSE).

The inspected public release contains agent profiles, landmark and tool catalogs, governance material, architecture notes, prompts, and tool-call datasets for two seasons. These describe the experiment and support trace analysis. No runnable frontend/backend implementation, launch instructions for a complete local simulator, or implementation of the custom `em-agent-framework` was identified in that release. Cloning the repository therefore does not establish a runnable recreation; the described React Three Fiber, Python/FastAPI and PostgreSQL stack is documentation, not included executable infrastructure.

Upstream material is released under CC BY-NC 4.0 with research/education notices and attribution requirements. Keep its provenance and licensing attached to any adapted profiles, prompts or datasets. This note summarizes sources; it imports no upstream assets, profiles or datasets. Commercial incorporation needs a separate licensing review. Recheck the release before a future reuse decision.

## What transfers to Matrix

| Research idea | Matrix home | Question to evaluate later |
| --- | --- | --- |
| Persistent resident identity, episodic memory, summaries, diaries and relationships | Citizens, #29 | Can residents remember actual events and revise intentions while preserving source-event references? |
| Needs, constrained resources and social/governance interactions | Citizens, #29 / v2 #156 | Can a tiny community coordinate one task under explicit budgets? A generated proposal must not grant permissions. |
| Long-running world with visitors entering and leaving | Persistent host, #20 / #148 | Can supported resident state resume without duplicate actions or a second owner/clock? |
| External weather, time and news influencing conditions | Geospatial research, #179; later #180 | Can one scoped public observation affect a local world condition with clear timestamps and provenance? |
| Recorded actions and cross-model comparisons | Existing receipt/checkpoint evidence | Can the same initial fixture be compared across models with matching IDs, budgets and recorded outcomes? |
| Inspectable small society as a teaching experiment | School plan P4/P6, #23 / #32 | Can a learner compare a bounded intervention while simulated outcomes remain labeled as model results? |

These are proposed evaluation questions, not claims of implementation. Extend the existing `WebRuntime/` + `ControlService/` + Citizens contracts. Matrix executes actions; Citizens chooses intentions. Reuse the current bounded capability broker, receipts and compatible saves. Residents do not receive PC, Codex, GitHub, Blender or MCP credentials.

## NYC grounding and a future local-data experiment

Emergence World's documented setting is a simplified spatial world synchronized to NYC time and weather, with external information access. It is not evidence of a street-accurate NYC reconstruction, measured buildings, citywide transport simulation or a validated digital twin. Do not conflate it with the separately reported, unverified NYC example in the School authoring references.

The useful idea is to let changing real-world inputs influence an artificial society. A future Matrix comparison could start with two residents and one weather condition in the existing bounded Boulder direction. Real-time transit and local-event inputs are possible extensions to research, not verified Emergence World capabilities or selected Matrix dependencies.

An observation should carry its provider/source, geographic coverage, observed time, fetch time, units and freshness. A declared rule may derive a simulated condition from it; retain the original observation and that rule separately. Residents can react to the resulting world condition. Store the input snapshot for repeatable comparison, disclose stale/unavailable inputs, and distinguish wall-clock timestamps from simulation ticks. External content is observation data and must not change capability grants. Private Manfred lifelog data stays outside public world state.

## Clock and visitor boundary — follow-up research

The documented simulation runs at 1:1 NYC-synchronized real time with no fast-forward; see upstream [architecture](https://github.com/EmergenceAI/Emergence-World/blob/main/docs/ARCHITECTURE.md). [Orchestration](https://github.com/EmergenceAI/Emergence-World/blob/main/docs/ORCHESTRATION.md) describes one acting agent at a time. Replay controls do not establish live simulation acceleration. No publicly documented playable human avatar was identified in the inspected release.

Matt's proposed human/agent relative-speed experiment and learning from multiple simulated worlds are recorded in [simulation clocks and world models](Simulation-Clocks-and-World-Models.md). [Skyrim VR AI mods](Skyrim-VR-AI-NPCs.md) provide a closer reference for a human sharing a 3D environment with conversational, action-capable NPCs.

## Feasibility and scope

A recreation would still need an execution engine, tool effects, state storage, resident inference/memory orchestration and a viewer. Matrix already provides relevant foundations, so evaluate selective ideas before considering a replacement framework. No build estimate or inference-cost promise is established here.

Possible later sequence: inspect a small public trace; identify one memory/planning behavior; select one bounded #29 experiment; then separately assess one public-data adapter under #179. Keep hosting generalization under #20/#148 and georeferenced street delivery under #180. Research does not add work to #173 or #187, authorize implementation/deployment, or trigger another headset acceptance session.

Related: [resources](../../RESOURCES.md), [architecture](../../ARCHITECTURE.md), [roadmap](../../ROADMAP.md), [Citizens](../Citizens-Shared-World.md), [host](../Persistent-World-Host.md), [School plan](../School-Generative-Agents-Plan.md).
