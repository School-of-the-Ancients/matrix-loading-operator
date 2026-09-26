# Matrix: small, programmable world — PRD

Requirements snapshot: September 25, 2026, with a September 26 priority update.
The desktop foundation and selected Quest VR and AR checks subsequently merged
through #98. The wearer confirmed panel recall in both modes and an AR Agent
creation/revision/save journey; reviewed approval/Stop and room-origin recovery
are still open. The current next Matrix slice is a small desktop AI Citizens
simulation under [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29);
it does not close the independent M4 headset checks. The
[implementation plan](IMPLEMENTATION_PLAN.md#progress-at-the-merged-web-stack)
and [Quest acceptance matrix](WebRuntime/QUEST3_ACCEPTANCE.md) carry the dated
implementation status. Requirements here are not claims of device acceptance.

[Build steps](IMPLEMENTATION_PLAN.md) · [Existing project tracks](PROJECTS.md) · [Agent instructions](AGENTS.md)

## Product

Open Matrix in the desktop browser, talk to the real Codex running on the PC, and create, change, interact with, and save a small world. Keep the same conversation while working. Blender can make richer assets; ordinary HTML and Three.js code can make richer experiences. School of the Ancients is a separate learning application that can use these capabilities. The same Matrix experience will receive an improved VR/AR presentation after the desktop loop works reliably.

The long-term vision remains a persistent world with content libraries, AI residents, lessons, and real-world overlays. The merged desktop creation foundation supports the current next slice: a small, restartable resident simulation. That slice does not establish a full city, economy, or autonomous society.

## Delivery decision: desktop first

The initial decision was to finish the existing `/web/` application in ordinary desktop mode with mouse/keyboard and usable HTML controls before redesigning immersive UI. M0–M3 did not require immersive session entry or a headset. Voice remained optional for desktop acceptance.

M4 now adapts that same working flow for VR controls/layout and separately validates AR room placement/recovery. This is one Three.js/WebXR application with different input/presentation modes, not a second desktop engine. Do not wait for all future Matrix features before returning to headset work.

The September 26 priority change started Citizens development at `/web/citizens.html`, an isolated page that reuses WebRuntime/MatrixWorld code but keeps its world and browser storage separate from the main `/web/` Agent Portal. Unfinished M4 wearer checks stay open and can be resumed separately; they are not prerequisites for a desktop simulation. A browser result does not count as Quest acceptance.

Stacked PR #101 adds an opt-in Citizens panel to the ordinary `/web/` desktop virtual room. It starts only on an empty floor, reuses the same Matrix world execution and view, and saves versioned simulation state with the existing browser/manual/PC world checkpoints. Version 2 scene/game worlds still load. The current #19 candidates strengthen fair shared-object reservations and add one bilateral social session with explicit outcomes and a local MatrixWorld receipt before relationship benefit. Binding selected existing furniture, general multi-resource execution, and Quest budgets remain open. See the [shared-world runbook](Docs/Citizens-Shared-World.md).

## Keep the architecture we already have

| Part | Existing home | Responsibility |
| --- | --- | --- |
| Web experience | `WebRuntime/` | HTML, Three.js, WebXR, input, rendering, and current runtime state |
| PC gateway and tools | `ControlService/` | Existing Codex session backend, Matrix MCP, validation, catalogs, commands, and receipts |
| Asset authoring | PC Blender and configured tools | Create/revise source assets; export through the existing GLB validator/catalog |
| School | Separate `school-of-the-ancients` repository | Mentors, lessons, learner records, and the optional limited Matrix client |

These are responsibilities, not four new services. Preserve the existing state owners; do not move all browser/runtime state to a new server just to match an architecture diagram. The broader [module catalog](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/MODULES.md) remains the ownership reference.

AI Citizens owns resident needs, goals and decisions. The isolated desktop fixture uses MatrixWorld's bounded action validation and receipts and a separate browser-local checkpoint. The opt-in main `/web/` panel shares that page's MatrixWorld and browser/PC checkpoints while preserving Core's authority over world execution. A resident cannot inherit the Operator's shell credentials or real-world fleet permissions. School retains teaching and learner records in its separate product.

`/web/` is the current Matrix experience. `/` and the Unity builds remain the supported native/legacy path. Do not merge their interfaces or rewrite them for this release.

## Desktop creation journey

1. Open `/web/` in desktop mode, connect to the configured PC agent, and select or point at a place/object with the mouse.
2. Ask for an object or experience. Reuse a suitable asset first; create one when needed.
3. Review consequential operations on the PC. Broad Blender/code operations may require a clear detailed review handoff; do not weaken approval to simplify the UI.
4. See the result only after the runtime confirms it. Ask for a follow-up change in the same conversation.
5. Interact, stop, undo where supported, save, close, and return to the same supported world state.

Use the existing dragon/skiff or a simpler object for acceptance. A new spectacular asset is not a prerequisite.

## Current AI Citizens journey

1. Open a small desktop Three.js world with one visible resident and simple existing props. Observe changing needs, available activities, selected goal, movement, interaction and the resulting state change.
2. Read the resident's current activity, needs and decision/action log. Pause and resume the simulation; repeat a seeded scenario to diagnose the same decisions and outcomes.
3. Add a second resident sharing the world and objects. Show different choices and one capacity-limited interaction, such as competing for a seat. A failed, cancelled or occupied action must not grant an unobserved benefit.
4. Save and reopen the supported simulation. Restore resident identities, needs, relevant world objects and valid intent without replaying a stale success. Report missing or incompatible dependencies without overwriting the current world.

Use [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) and its linked issues for the detailed acceptance. Build only missing prerequisites needed by this example. Basic activity continues without an LLM request per frame. Richer character authoring and ComfyUI-to-Blender assets are optional follow-ups.

## Requirements and evidence

| ID | Requirement | Done when… |
| --- | --- | --- |
| R1 | One useful agent session | Text/follow-up, refresh/reconnect, native approval/denial, and Stop work without silently starting another conversation. Outage/quota errors preserve the existing world. |
| R2 | Spatially grounded edits | Selection and pointing remain distinct; an edit targets the intended object. Stale state is rejected, and queued/unconfirmed is never reported as executed. |
| R3 | Real creation and revision | One scratch Blender job creates an asset, revises it in the same agent conversation, exports, registers, and places it. Preserve editable source and report whether MCP or local scripting actually performed authoring. |
| R4 | Reusable interaction | Demonstrate existing clip selection and numeric components. Add a small ordinary code module only when a concrete experience needs more; do not add one endpoint for every imagined object. |
| R5 | Honest saving | Browser reopen retains the supported scene/game/configuration. The PC whole-world checkpoint preserves the supported experience, while the in-world PC backup remains labeled scene-only. Missing assets or room tracking must not silently replace/recenter the world. |
| R6 | One shared experiment | Desktop HTML controls, a Three.js view, and an agent operation use one tested scale-experiment state/measurement implementation. Immersive presentation is deferred to M4; simultaneous multi-device synchronization is not required. |
| R7 | Independent School | A text-only lesson works without Matrix. Its optional connector uses reviewed, scoped world actions and observed results, not Codex shell credentials. |
| R8 | Small autonomous Citizens simulation | At least two visible desktop residents make need-driven choices, move and interact through validated world actions, contend for one shared object, show readable activity/needs/decision logs, and pause/save/reopen from a seeded scenario. Actual browser behavior and observed outcomes are recorded; failed or uncertain actions do not silently change resident state. |

R1–R7 retain the earlier creation and School requirements. R8 is the current Matrix implementation priority, not an assertion of completion. M4 validates the supported creation flow on VR/AR hardware separately. Desktop evidence and actual Quest wearer evidence remain distinct; desktop completion does not close headset acceptance criteria. Consult the linked status records before declaring any row complete.

## Two creation paths, not a new mini-engine

**Use what exists:** registered GLBs, named clips, current numeric components, transforms, and existing game mechanics can use the current live runtime contracts.

**Develop something new:** Codex edits normal repository HTML/JavaScript/Three.js files, runs the existing tests/build, and publishes a reviewed version. Loading new assets does not imply arbitrary downloaded JavaScript is safe to execute. Do not invent a universal scripting language, plugin marketplace, or general sandbox platform before a real example needs it.

## Access, data, and resources

Keep Codex, GitHub, Blender, and provider credentials on the PC. Continue the existing native approvals and owner-configured workspace policy; a browser request cannot escalate access. Use a scratch Blender scene and explicit overwrite/replacement decisions. Keep private room images and personal context out of public evidence.

Continue local Codex sign-in and the existing `AgentSessionBackend`. The app-server transport is not the Matrix MCP interface. OpenAI's current [migration notice](https://learn.chatgpt.com/docs/mcp-server) says `codex mcp-server` was removed and directs integrations to [app-server](https://learn.chatgpt.com/docs/app-server); it also warns that this command is experimental and not supported for production workloads. Record the installed/tested CLI version and keep the adapter replaceable. [Plan access](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) is subject to account limits; do not promise unlimited inference or general API credits.

Blender, the existing GLB catalog, and local speech are sufficient to test the first loop. Scenario, image-to-3dlab, other catalogs, realtime models, and fleet workers remain optional providers. Verify their current API, access, cost, and license before choosing an integration.

## Outside the current slice

No new microservices, orchestration framework, database migration, distributed queue, event-sourcing system, broad provider abstraction, or mass repository move. No mandatory physics/navmesh engine, full city/economy simulator, Boulder port, global mapping, multiplayer, hosted-to-local relay, WebMCP dependency, or new headset purchase. Immersive UI redesign, new controller/hand interaction work and new AR camera/alignment features remain M4 work; preserve existing support and guards meanwhile.

Preserve these future directions in their existing issues. Add a dependency only when the next demonstrated user task requires it.
