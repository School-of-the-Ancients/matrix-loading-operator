# Skyrim VR AI NPC research for Matrix

Reviewed October 11, 2026. Status: platform and execution-pattern research; no integration selected. Sources were inspected, but these mods were not installed or benchmarked.

## Platform and comparators

Skyrim uses Bethesda's Creation Engine. The Creation Kit is its mod editor; Papyrus scripts and native plugins expose game behavior. The engine already supplies NPC bodies, positions, navigation, animation and interactions. An LLM mod adds a decision/conversation layer to that existing world.

| Project | Useful reference | Evidence inspected |
| --- | --- | --- |
| [Mantella](https://art-from-the-machine.github.io/Mantella/) | Spoken conversations, NPC memory, contextual observations and configurable actions in Skyrim VR/SE/AE | Official docs plus action definitions and Papyrus movement executors |
| [CHIM](https://dwemerdynamics.com/chim/index.html) | Broader gameplay actions, character context, configurable action permissions and [Background Life](https://dwemerdynamics.com/chim/background-life.html) | Official docs; detailed movement internals not audited |
| [SkyrimNet](https://fateless.ai/) | In-game native plugin, speech/text, semantic memory, supported character actions and optional visual context | Official product documentation; detailed movement internals not audited |

CHIM's Background Life is particularly relevant to residents with their own activities: selected NPCs can think, exchange letters/rumors and pursue travel/work/rest/trade outside a direct conversation. This does not establish an independently hosted society that continues while Skyrim is closed.

## What actually steers a body?

Mantella provides a concrete inspected example:

1. The model chooses a supported action and target.
2. The mod resolves actual actors or a named map marker.
3. The executor assigns native AI packages and calls `EvaluatePackage()`.
4. Skyrim runs movement. The executor polls actual `GetDistance(target)` and ends or cleans up the action.

See [move_npc action schema](https://github.com/art-from-the-machine/Mantella/blob/main/data/actions/functions/move_npc.json), [MoveTo executor](https://github.com/art-from-the-machine/Mantella-Spell/blob/main/Scripts/Source/MantellaAdvancedAction_MoveTo.psc) and [TravelTo executor](https://github.com/art-from-the-machine/Mantella-Spell/blob/main/Scripts/Source/MantellaAdvancedAction_TravelTo.psc). These are executable actions, beyond an NPC merely saying it moved. Advanced actions must be enabled/configured; supported destinations and behaviors constrain what the model can request.

The engine has XYZ positions: [ObjectReference script API](https://github.com/ianpatt/skse64/blob/master/scripts/vanilla/ObjectReference.psc) exposes `GetPositionX/Y/Z`. The inspected movement action uses NPC names, target IDs and distances rather than a continuous XYZ motor command. [Conversation context](https://github.com/art-from-the-machine/Mantella/blob/main/src/conversation/context.py) supplies selected location and nearby-actor information. Engine coordinates, a bounded model observation, a full spatial map and a learned world model are different things.

Platform sources: [Bethesda on Creation Engine](https://bethesda.net/en-US/news/the-graphics-technology-of-fallout-4), [Creation Kit editor](https://store.steampowered.com/app/1946180/Skyrim_Special_Edition_Creation_Kit/), [Mantella source](https://github.com/art-from-the-machine/Mantella), [game-side scripts](https://github.com/art-from-the-machine/Mantella-Spell).

## Transfer to Matrix — research proposal

Preserve the existing split: Citizens chooses intentions; Matrix executes. Use stable entity/target IDs and current world revision; let a bounded executor own route feasibility, collision, animation and interaction. Feed observed progress and success/failure receipts back into agent memory. Model narrative alone cannot confirm arrival.

A later bounded comparison could ask one resident to approach an existing object, then move or delete that object during travel. Inspect blocked/stale-target recovery and honest outcomes before adding richer social behavior. This is an evaluation question under [Citizens #29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29), not a new implementation task.

Skyrim VR supplies an inhabited virtual world. Physical-room registration through AR remains a separate Matrix requirement. Desktop, VR and AR should present the same authoritative world and clock; presentation transforms must not create a second society or position authority.

Related: [resources](../../RESOURCES.md), [Citizens](../Citizens-Shared-World.md), [platform clocks and world models](Simulation-Clocks-and-World-Models.md), [School plan](../School-Generative-Agents-Plan.md).
