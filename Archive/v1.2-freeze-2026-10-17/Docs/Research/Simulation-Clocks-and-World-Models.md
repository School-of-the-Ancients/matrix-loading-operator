# Simulation clocks, human participation and learned world models

Reviewed October 11, 2026. Status: research framing from Matt's discussion; no feature, dependency or roadmap expansion selected.

## Choose references by the question

| Reference | Useful dimension | Boundary |
| --- | --- | --- |
| [Emergence World](Emergence-World.md) | Persistent agent society, memory, needs and recorded actions | Public release inspected as documentation/data, not a runnable full engine |
| [AI Town](https://github.com/a16z-infra/ai-town) | Deployable town where agents live, converse and socialize; inspired by Generative Agents | Its 2D town presentation is not an AR/VR physical registration system |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | Memory, reflection and planning; interactive small-town research | Believable behavior does not establish calibrated prediction of real people |
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) / [MineCollab paper](https://arxiv.org/abs/2504.17950) | LLM-controlled Minecraft characters and embodied collaboration | A game-control research platform, not Matrix's runtime |
| [Skyrim VR AI mods](Skyrim-VR-AI-NPCs.md) | Human participation with embodied conversational NPCs and native action execution | No physical-room AR overlay established by these references |

A 2D visual view, a simulation's spatial state and a model's observations are separate design choices. Matt's *Flatland* analogy describes the dimension/presentation question; it should not be used to infer that every society simulator lacks a Z coordinate.

## Clock experiment — Matt's idea and a conditional interpretation

Matt proposed a human entering an agent world while the simulation could accelerate or decelerate. If human input/avatar motion remains tied to wall time while agent dynamics use scaled simulation time, slowing the simulated world could make the human appear fast relative to residents; accelerating it could make the human appear slow. This effect depends on the control mapping. If both avatar and residents advance on the same scaled clock, the relative-speed effect does not automatically follow.

Distinguish wall time, authoritative simulation time, input/presentation cadence, model inference latency and replay speed. Faster video playback is not faster live inference. Pending model actions need an explicit policy when simulation time advances; deterministic physics ticks alone cannot make external LLM calls finish faster.

[Emergence World's architecture](https://github.com/EmergenceAI/Emergence-World/blob/main/docs/ARCHITECTURE.md) documents 1:1 NYC-synchronized real time and no fast-forward. Its [orchestration](https://github.com/EmergenceAI/Emergence-World/blob/main/docs/ORCHESTRATION.md) describes one acting agent at a time. These are current reference constraints, not proof of selectable live speed or parallel turns. No publicly documented playable human avatar was identified; a replay viewer does not establish a visitor action interface.

For Matrix, retain one world owner and clock per world. Any future speed control would be a world-level contract, not a separate visitor clock. A bounded School child experiment may have its own explicitly separate experiment timestep; it does not become an authority for outer-world objects.

An agent observing a visitor's avatar may receive the same type of entity/action evidence it receives for other actors. Whether it knows the actor is human depends on identity/context supplied by the platform; it would not necessarily regard every human as an NPC.

## Simulation traces as training experience — Matt's proposed extension

Matt proposed training a new world model on inputs and outputs from different emergent-world simulations. Preserve intermediate trajectories: initial conditions, world/agent configuration, seed/version, state, actions/interventions, elapsed simulated time and observed next state/outcomes. A transition model can then estimate possible consequences under varied conditions; a person-specific next-action predictor is a separate actor-policy component.

[World Models](https://worldmodels.github.io/) and [DreamerV3](https://danijar.com/project/dreamerv3/) provide learned-dynamics and imagined-trajectory precedents. They do not validate social forecasting from LLM-generated societies. Hold out trajectories and configurations, compare simple baselines and test calibration. A model initially learns its simulators' dynamics; transfer to reality remains a separate research question.

Counterfactual checkpoint replays could explore consequential choices and inflection points without enumerating every possible timeline. Branch probabilities depend on the model, assumptions and evidence. No world-model training system, literal branching universes or real-person prediction capability is claimed here.

Related: [resources](../../RESOURCES.md), [architecture](../../ARCHITECTURE.md), [persistent host](../Persistent-World-Host.md), [School experiments](../School-Generative-Agents-Plan.md).
