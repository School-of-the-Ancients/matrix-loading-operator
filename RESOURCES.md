# Matrix resources

References are inputs and examples, not automatic dependencies or new roadmap items.

## World and procedural generation

- **Sakuragaoka Station** — procedural Three.js world construction: https://github.com/Kenton-GMI/sakuragaoka-station
- **Three.js** — current Web runtime foundation: https://threejs.org/
- **WebXR** — immersive browser runtime: https://immersiveweb.dev/

Use these references to improve fast, parameterized creation behind **"Operator, load/create XYZ."**

## Physics and simulation

- **three-avbd** — Three.js/WebGPU rigid-body physics using Augmented Vertex Block Descent; supports large GPU-simulated worlds with contacts, friction, joints, raycasts and interaction: https://github.com/sbobyn/three-avbd

Use as a reference/candidate for scalable browser-native physics rather than automatically replacing the current Matrix physics path.

## Operator creation pipeline

Matrix supports complementary creation paths:

- procedural generation;
- reusable validated assets/capabilities;
- Blender MCP -> export/import;
- optional image mockup -> revise/select -> procedural or Blender build.

Image generation is art direction, not proof of geometry, interaction or physics.

Existing implementation owners include:

- [#122 Immersive Creator Mode](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122)
- [#91 concept-image iteration](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/91)
- [#28 asset discovery/creation/delivery](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28)
- [#9 content-source adapters](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/9)

## AI Citizens and agent societies

### Core references

- **Generative Agents: Interactive Simulacra of Human Behavior** — memory, reflection, retrieval, planning and believable interactions: https://arxiv.org/abs/2304.03442
- **SwarmWorld** — societies of language-model agents, shared artifacts, stigmergic evolution and culture:
  - paper: https://arxiv.org/abs/2608.26081
  - code: https://github.com/lamm-mit/SwarmWorld
  - architecture: https://github.com/lamm-mit/SwarmWorld/blob/main/docs/ARCHITECTURE.md
- **Agent Office** — concrete multi-agent office/world example: https://github.com/AgentSystemLabs/agent-office
- **Voyager** — open-ended embodied agent, curriculum and reusable skill ideas: https://github.com/MineDojo/Voyager
- **MiroFish** — open-source multi-agent simulation: https://github.com/666ghj/MiroFish
- **Social Simulacra** — large-scale social simulation reference: https://arxiv.org/abs/2208.04024
- **Generative Agent Simulations of 1,000 People** — behavioral simulation reference: https://arxiv.org/abs/2411.10109

### Emergence World: persistent societies and external data

- **Emergence World (Emergence AI, 2026)** — persistent model-driven residents, needs/resources, memory, governance and trace-based comparison:
  - repository: https://github.com/EmergenceAI/Emergence-World
  - Season 1 paper: https://arxiv.org/abs/2606.08367
  - Season 2 paper: https://arxiv.org/abs/2609.17320
  - architecture: https://github.com/EmergenceAI/Emergence-World/blob/main/docs/ARCHITECTURE.md
  - memory: https://github.com/EmergenceAI/Emergence-World/blob/main/docs/MEMORY.md
  - replay website: https://world.emergence.ai/
- **Release boundary, checked October 11, 2026:** profiles, world/tool descriptions, prompts and datasets are public; no runnable frontend/backend or custom agent-framework implementation was identified. Treat this as a blueprint/data reference, not a clone-and-run dependency.
- **Data boundary:** NYC time/weather and external information ground a simplified world; they do not establish a street-accurate NYC digital twin.
- **Reuse boundary:** upstream material is CC BY-NC 4.0 for noncommercial research/education with attribution; preserve its license/provenance before adapting it.

See [the Matrix research note](Docs/Research/Emergence-World.md) for Citizens (#29), hosting (#20/#148), School experiments and public-data/geospatial research (#179/#180). These connections do not select implementation or expand the current sprint.

### School professor and 3D-world authoring references

- **Matt Shumer: How to Build 3D Worlds with Astra** — reference/assets/assembly/critique workflow and existing-engine authoring: https://somethingbig.ai/3d-worlds
- **Matt Shumer: Astra review** — reported AI-resident world experiments and separate development-agent orchestration: https://somethingbig.ai/astra-review
- **Generative Agents code** — research implementation of the paper's memory/planning ideas; not a replacement for Matrix's runtime: https://github.com/joonspk-research/generative_agents
- **Quaternius Universal Base Characters** — candidate rigged human assets; verify the selected asset's license and Matrix GLB/animation contract before import: https://quaternius.com/packs/universalbasecharacters.html

The [School professor implementation plan](Docs/School-Generative-Agents-Plan.md) selects a small proposed teaching slice. The reported nested-computer and NYC examples are inspiration with unverified implementation details; they are not current Matrix capabilities or a new city scope.

### Skyrim VR: embodied AI NPCs

- **Mantella** — conversation/memory plus configurable NPC actions: https://art-from-the-machine.github.io/Mantella/
- **CHIM** — broader gameplay actions and background resident activity: https://dwemerdynamics.com/chim/index.html
  - Background Life: https://dwemerdynamics.com/chim/background-life.html
- **SkyrimNet** — native in-game AI plugin with semantic memory and supported actions: https://fateless.ai/
- **Mantella movement source** — concrete model-intention → native-AI-package → observed-distance pattern:
  - action schema: https://github.com/art-from-the-machine/Mantella/blob/main/data/actions/functions/move_npc.json
  - executor: https://github.com/art-from-the-machine/Mantella-Spell/blob/main/Scripts/Source/MantellaAdvancedAction_MoveTo.psc

See [Skyrim VR research](Docs/Research/Skyrim-VR-AI-NPCs.md) for the Creation Engine platform, XYZ/context distinction and Matrix transfer questions.

### Interactive platforms, clocks and predictive-model research

- **AI Town** — deployable generative-agent town: https://github.com/a16z-infra/ai-town
- **Mindcraft / MineCollab** — Minecraft embodied-agent collaboration:
  - platform: https://github.com/mindcraft-bots/mindcraft
  - paper: https://arxiv.org/abs/2504.17950
- **World Models** — learned dynamics: https://worldmodels.github.io/
- **DreamerV3** — learning through imagined trajectories: https://danijar.com/project/dreamerv3/

See [simulation clocks and world-model research](Docs/Research/Simulation-Clocks-and-World-Models.md) for human participation, simulation/replay speed and Matt's cross-simulation training idea. Emergence World's documented clock is 1:1 with no fast-forward; an accelerated interactive visitor mode is a separate proposal.

### Decision/action references

- **Jev / TypeSafe AI** — candidate bounded fast action selector: https://typesafe.ai/
- **Halo AI** — authored, readable state-machine behavior baseline: https://halo.bungie.org/misc/gdc.2002.haloai/talk.html

### Character/animation references

- **Quaternius Universal Animation Library** — reusable animation source candidate: https://quaternius.com/packs/universalanimationlibrary.html

Matrix implementation owner: [#29 AI Citizens roadmap](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29).

## Inhabited-world comparisons

- **Odyssey / Agora** — learned/shared-world comparator: https://odyssey.systems/
- **Fortnite LLM conversations** — conversational NPC product reference: https://www.fortnite.com/news/publish-islands-with-llm-conversations-starting-july-30
- **Ubisoft NEO NPC** — generative NPC prototype reference: https://news.ubisoft.com/en-gb/article/5qXdxhshJBXoanFZApdG3L/how-ubisofts-new-generative-ai-prototype-changes-the-narrative-for-npcs

## Resource rule

A useful link normally belongs here first. Only turn it into an issue when there is a concrete Matrix capability to build or evaluate.
