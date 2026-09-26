# Matrix: small, programmable world — PRD

Planning snapshot: September 25, 2026. Proposed scope, not a claim of new implementation or device testing.

[Build steps](IMPLEMENTATION_PLAN.md) · [Existing project tracks](PROJECTS.md) · [Agent instructions](AGENTS.md)

## Product

Open Matrix in the desktop browser, talk to the real Codex running on the PC, and create, change, interact with, and save a small world. Keep the same conversation while working. Blender can make richer assets; ordinary HTML and Three.js code can make richer experiences. School of the Ancients is a separate learning application that can use these capabilities. The same Matrix experience will receive an improved VR/AR presentation after the desktop loop works reliably.

The long-term vision remains a persistent world with content libraries, AI residents, lessons, and real-world overlays. The next release proves one useful creation loop, not that entire vision.

## Delivery decision: desktop first

The current AR/VR UI is a user-reported weakness, but redesigning it is not the next step. Finish the existing `/web/` application in ordinary desktop mode with mouse/keyboard and usable HTML controls. M0–M3 do not require immersive session entry or a headset. Voice is optional.

Then M4 adapts the same working flow for VR controls/layout and separately validates AR room placement/recovery. Keep existing XR paths intact without polishing or replacing them now. This is one Three.js/WebXR application with different input/presentation modes, not a second desktop engine. Do not wait for all future Matrix features before returning to headset work.

## Keep the architecture we already have

| Part | Existing home | Responsibility |
| --- | --- | --- |
| Web experience | `WebRuntime/` | HTML, Three.js, WebXR, input, rendering, and current runtime state |
| PC gateway and tools | `ControlService/` | Existing Codex session backend, Matrix MCP, validation, catalogs, commands, and receipts |
| Asset authoring | PC Blender and configured tools | Create/revise source assets; export through the existing GLB validator/catalog |
| School | Separate `school-of-the-ancients` repository | Mentors, lessons, learner records, and the optional limited Matrix client |

These are responsibilities, not four new services. Preserve the existing state owners; do not move all browser/runtime state to a new server just to match an architecture diagram. The broader [module catalog](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/MODULES.md) remains the ownership reference.

`/web/` is the current Matrix experience. `/` and the Unity builds remain the supported native/legacy path. Do not merge their interfaces or rewrite them for this release.

## First complete user journey

1. Open `/web/` in desktop mode, connect to the configured PC agent, and select or point at a place/object with the mouse.
2. Ask for an object or experience. Reuse a suitable asset first; create one when needed.
3. Review consequential operations on the PC. Broad Blender/code operations may require a clear detailed review handoff; do not weaken approval to simplify the UI.
4. See the result only after the runtime confirms it. Ask for a follow-up change in the same conversation.
5. Interact, stop, undo where supported, save, close, and return to the same supported world state.

Use the existing dragon/skiff or a simpler object for acceptance. A new spectacular asset is not a prerequisite.

## Requirements and evidence

| ID | Requirement | Done for this release when… |
| --- | --- | --- |
| R1 | One useful agent session | Text/follow-up, refresh/reconnect, native approval/denial, and Stop work without silently starting another conversation. Outage/quota errors preserve the existing world. |
| R2 | Spatially grounded edits | Selection and pointing remain distinct; an edit targets the intended object. Stale state is rejected, and queued/unconfirmed is never reported as executed. |
| R3 | Real creation and revision | One scratch Blender job creates an asset, revises it in the same agent conversation, exports, registers, and places it. Preserve editable source and report whether MCP or local scripting actually performed authoring. |
| R4 | Reusable interaction | Demonstrate existing clip selection and numeric components. Add a small ordinary code module only when a concrete experience needs more; do not add one endpoint for every imagined object. |
| R5 | Honest saving | Browser reopen retains the supported scene/game/configuration. Provide a whole-experience PC checkpoint in the next persistence slice; until then, label the existing PC backup as scene-only. Missing assets or room tracking must not silently replace/recenter the world. |
| R6 | One shared experiment | Desktop HTML controls, a Three.js view, and an agent operation use one tested scale-experiment state/measurement implementation. Immersive presentation is deferred to M4; simultaneous multi-device synchronization is not required. |
| R7 | Independent School | A text-only lesson works without Matrix. Its optional connector uses reviewed, scoped world actions and observed results, not Codex shell credentials. |

The Matrix creation release is R1–R5 accepted on desktop. R6–R7 are the next desktop paired integration, not a requirement to finish every School or NPC issue first. M4 subsequently validates the same supported flow on VR/AR hardware. Desktop evidence and actual Quest wearer evidence remain separate; desktop completion does not close headset acceptance criteria.

## Two creation paths, not a new mini-engine

**Use what exists:** registered GLBs, named clips, current numeric components, transforms, and existing game mechanics can use the current live runtime contracts.

**Develop something new:** Codex edits normal repository HTML/JavaScript/Three.js files, runs the existing tests/build, and publishes a reviewed version. Loading new assets does not imply arbitrary downloaded JavaScript is safe to execute. Do not invent a universal scripting language, plugin marketplace, or general sandbox platform before a real example needs it.

## Access, data, and resources

Keep Codex, GitHub, Blender, and provider credentials on the PC. Continue the existing native approvals and owner-configured workspace policy; a browser request cannot escalate access. Use a scratch Blender scene and explicit overwrite/replacement decisions. Keep private room images and personal context out of public evidence.

Continue local Codex sign-in and the existing `AgentSessionBackend`. The app-server transport is not the Matrix MCP interface. OpenAI's current [migration notice](https://learn.chatgpt.com/docs/mcp-server) says `codex mcp-server` was removed and directs integrations to [app-server](https://learn.chatgpt.com/docs/app-server); it also warns that this command is experimental and not supported for production workloads. Record the installed/tested CLI version and keep the adapter replaceable. [Plan access](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) is subject to account limits; do not promise unlimited inference or general API credits.

Blender, the existing GLB catalog, and local speech are sufficient to test the first loop. Scenario, image-to-3dlab, other catalogs, realtime models, and fleet workers remain optional providers. Verify their current API, access, cost, and license before choosing an integration.

## Explicitly not in this release

No new microservices, orchestration framework, database migration, distributed queue, event-sourcing system, broad provider abstraction, or mass repository move. No mandatory physics/navmesh engine, autonomous society, Boulder port, global mapping, multiplayer, hosted-to-local relay, WebMCP dependency, or new headset purchase. Immersive UI redesign, new controller/hand interaction work and new AR camera/alignment features wait for M4; preserve existing support and guards meanwhile.

Preserve these future directions in their existing issues. Add a dependency only when the next demonstrated user task requires it.
