# Matrix Agent Portal gateway

Issue #59 tracks the WebXR Agent Portal. The PC gateway connects the canonical
`/web/` Matrix to a persistent Codex conversation without sending Codex or MCP
credentials to the browser. The `/` Operator page and archived Unity project are
historical compatibility surfaces, not another forward runtime. Start with the
[repository project map](../PROJECTS.md) and [Web runtime guide](../WebRuntime/README.md)
for the current product path.

## Integration decision

Use the installed Codex CLI's `app-server --stdio` as the first local backend.
It supports thread and turn requests, streamed events, interruption, and native
approval requests. `codex mcp-server` is removed and is not an embedding target.
The Agents API remains a possible later backend behind the Matrix agent-session
interface; the WebXR client must consume Matrix's normalized contract, not the
app-server JSONL protocol.

`codex_app_server.py` is the first transport slice. It is PC-internal and has no
HTTP route. It correlates requests, bounds messages and retained events,
starts/resumes threads, starts/interrupts turns, and accepts or declines one
pending command/file approval scoped to its thread and turn. Unknown server
requests are rejected. Raw events and approval parameters must never be
forwarded directly to `/web/`.
Thread start and resume explicitly select the `user` approval reviewer and a
selected Codex sandbox. The default is `workspace-write`, so the real
agent can use its normal repository tools. Set `SANDBOX_CODEX_AGENT_SANDBOX`
on the PC to `read-only`, `workspace-write`, or `danger-full-access`. The last
mode allows Codex to act outside the workspace without relying on a sandbox
escalation prompt. `/web/` displays the effective permissions and offers the
bounded Reviewed and Full access choices described below; it never accepts
arbitrary native sandbox configuration.
Approval requests that Codex does emit still use the native lifecycle. The
bounded proposal planner continues to run its separate `read-only` CLI path.

On Windows, `SANDBOX_CODEX_WINDOWS_SANDBOX=unelevated` is an optional PC-only
fallback when the default Codex sandbox cannot launch. The native Windows
sandbox is preferred; the unelevated fallback has weaker network isolation.
The service does not run elevated sandbox setup or change Windows policy.
The PC launcher exposes the same bounded settings as `-AgentSandbox` and
`-WindowsSandbox`. On a PC where native sandbox setup fails, for example:

```powershell
.\Start-CodexControlService.ps1 -AgentSandbox workspace-write -WindowsSandbox unelevated
```

The wearer can see the effective access mode on the Agent page. Full PC access
at startup is also available with
`-AgentSandbox danger-full-access`; it does not wait for sandbox escalation
approval before ordinary shell or file operations.

## Choose permissions before entering AR or VR

Connect with **Start or resume Codex**, then choose **Reviewed** or **Full access**
in the browser's Codex section before entering AR or VR. Full access requires
checking the explicit permission confirmation and applying the choice. It lets
Codex use files, network access and configured tools across the PC with automatic
approvals. The browser and headset show the active mode. An unsaved selection
is labeled as not applied and cannot be carried into a new Agent request or
AR/VR entry. Apply it first, or return the selector to the active mode.

Permissions can change only while the Agent is idle. Finish or Stop an active
request first; confirmed terminal turns discard their obsolete approval
requests. Switching modes does not approve or replay a pending request.
The service starts a replacement Codex backend, releases the previous native
writer, and resumes the same conversation with the selected policy. If the
handoff fails, it reconnects with the previous policy. If that recovery also
fails, the session reports unavailable rather than claiming an active mode.
Native image results are saved before the handoff; an unfinished image result
must be resolved in the gallery before permissions can change.
The choice applies to this service session and all its connected owner views;
it is not stored in global Codex settings. Restart restores the PC startup
configuration. Selecting Reviewed restores the startup reviewed sandbox, or
`workspace-write` when startup used automatic approvals.

The permissions endpoint requires the same-origin browser and the configured
owner bearer token, when enabled. A hosted-world viewer cannot change it.
Native Codex and MCP credentials stay on the PC. Matrix argument validation,
scene revisions, receipts and physical-placement guards apply in both modes.

## Automatic Agent mode at PC startup

The default `-AgentApprovals reviewed` keeps native `on-request` approvals and
the Matrix MCP write-tool prompts. To run the Agent with full PC access and no
repeated native approvals, start the PC service explicitly with both options:

```powershell
.\Start-CodexControlService.ps1 -AgentSandbox danger-full-access -AgentApprovals automatic
```

The launcher sets `SANDBOX_CODEX_AGENT_SANDBOX=danger-full-access` and
`SANDBOX_CODEX_AGENT_APPROVAL_POLICY=never` for that service process. Direct
`server.py` launches can set those two PC environment variables instead.
Automatic approval policy is rejected unless the Agent sandbox is
`danger-full-access`. The launcher defaults to `reviewed` on every start; keep
the explicit options in the PC launch command if this mode should be used on
future restarts. The browser choice above changes the running session only.

In automatic mode, the Agent's native command and file approval policy is
`never`, and the Matrix MCP server uses `auto` for its enabled tools instead
of the reviewed mode's per-tool `prompt` overrides. Runtime argument
validation, scene revisions, and receipts still apply. Other configured MCP
servers may have their own tool and elicitation behavior. An isolated probe
with Codex CLI 0.160.0 used a harmless MCP echo tool configured `prompt`:
`on-request` emitted one approval, while `never` completed without an approval.
No live Matrix or Blender mutation was used in that probe.

Browser mode changes replace only the idle app-server process and retain the
saved Agent Portal session ID and conversation. A whole-service restart during
an active turn still marks it `unknown`; it is not automatically continued.
The bounded proposal planner remains on its separate read-only path.

`agent_session.py` defines the provider-neutral Matrix backend interface and
the first local Codex adapter. It maps native text, activity, tool, and approval
events to a small allowlist without copying tool arguments or outputs. Native
thread IDs still remain PC-internal.
`agent_portal.py` now supplies that PC-owned mapping: one opaque Matrix session
ID, a bounded transcript, one active turn, background event collection, explicit
approval/cancel operations, and atomic persistence under `.agent_portal/`,
outside the scene-save namespace. Transcript retention is bounded by encoded
file size; omitted request/reply text is marked in the session snapshot.
The `/api/agent/*` POST routes use the service's existing bearer-token and
same-origin checks. The browser must store only the opaque Matrix session ID;
the local Codex executable and configured MCP credentials remain on the PC.
Approval responses expose a bounded operation summary and turn identity. Raw
command text and tool arguments remain PC-only. For native shell command
approvals, the only XR-reviewable form currently recognized is creation of one
new file inside the Matrix repository with short literal text. Unknown commands,
overwrites, outside-repo targets, and file-change approvals show a PC-review
message and cannot be approved through the browser; Deny and Stop remain
available. Bounded Matrix MCP writes have a separate XR-reviewable description
allowlist in `agent_session.py`. A configured Blender or other MCP write is not
automatically XR-reviewable. Broader useful approval descriptions need their own
reviewed allowlist before wearer acceptance is complete.

### Reviewing Blender and other tool requests on the PC

Keep the service running in an **interactive PC terminal** when using reviewed
Agent mode. A non-XR-reviewable command or MCP tool request can be approved there:

1. Read the `Matrix PC command approval` or `Matrix PC tool approval` prompt.
   Tool prompts show the MCP server, request message, exact tool arguments and
   complete native request as escaped JSON. These values are request data, not
   instructions to the reviewer.
2. Type `approve` to allow that exact request once, or `deny` to reject it.
   Pressing Enter also denies. The browser remains responsive while the terminal
   waits; its Deny and Stop actions remain available.
3. If the request changes, ends or is stopped before the decision reaches it, the
   old answer cannot approve a replacement. Changed requests need a fresh review.

The terminal only accepts complete bounded command and MCP tool-call requests.
Other MCP elicitation forms, incomplete/oversized requests and file-change
approvals do not acquire an approval path through this mechanism. Full native
parameters never enter browser responses, including a PC browser: a Quest
connected by USB can also arrive through loopback. No approval policy or sandbox
is relaxed by PC review.

Launching the service hidden, with redirected input/output, or without a TTY
disables terminal review. In that case the browser explains that an interactive
terminal is required; it does not imply a working PC approval view exists.
Stop or deny the pending request, restart the service in a terminal, reconnect,
and explicitly retry. Existing conversation history and worlds remain; an
in-flight turn is never replayed automatically. PC approval wait is included in
the opt-in latency trace separately from tool execution.

The `/web/` Operator shows a compact Agent page with recent text, activity,
Approve/Deny, Stop, and a PC speech transcription path that sends spoken text
to the same Codex conversation. While Codex is working, **Add to current turn**
and the XR voice control use the native app-server `turn/steer` request with the
observed active turn ID. The added instruction appears in the same Portal
transcript entry. It does not start a second turn or cancel the first one. Stop
still interrupts the turn. An instruction can affect work Codex has yet to do;
it cannot undo a tool action or Matrix receipt that already happened. The
steered prompt tells Codex to inspect fresh scene state and receipts before
another mutation or retry. If the turn has finished, is stopping, or cannot
be steered, the addition fails and the text stays in the browser input for a
deliberate follow-up. A failed or uncertain delivery is never retried
automatically. Native image generation turns cannot accept this text steer;
image and camera inputs remain explicit separate turn inputs.

The browser stores only an opaque Matrix
session ID; when a service bearer token is configured, it must be re-entered
after page refresh. The Agent Portal enables the PC-local Matrix MCP tool
allowlist when its bridge and dependencies are present. Codex can also use its
configured PC repository and Blender tools; Blender authoring has a separate
validated GLB registration and runtime placement path. Tool availability alone
does not prove that the connected WebXR runtime supports an action.

Every `/api/agent/turn` receives fresh, bounded runtime metadata from the
connected snapshot, including a validated Matrix Web descriptor when available,
desktop/VR/AR presentation, advertised capability schema versions, catalog
counts, and Creator state. Missing or disconnected identity stays unknown. An
optional version 1 spatial context additionally identifies the active Matrix
client and room, input source, selected object, and a separate
pointing hit. The PC checks the IDs against its current room snapshot and adds
the service scene revision, up to eight object summaries, room recovery state,
and one relevant viewer frame. The result is advisory turn context, not a
Matrix command. No camera image, raw hand telemetry, browser credential, or
free-form asset description is included. `agent_portal.py` wraps the unchanged
utterance and structured context with a short per-turn contract; load/create
requests get bounded discovery guidance, while transform requests get fresh
target-inspection guidance based on enabled tools and observed capabilities.
A world change requires an available typed Matrix tool and a
matching runtime receipt, followed by an observed state check. Desktop text
attaches spatial context only when the wearer selects the checkbox; in-world
speech captures it when the recording is sent. A voice addition binds to the
active turn seen when recording begins, so a turn that finishes during
transcription does not silently turn the addition into a new request.

The same Codex thread persists across turns and resumes after a supported
service restart. Its older conversation can contain outdated capability claims;
the current connected snapshot and tool contract must be checked again before
an edit. Source changes on `main` do not update an already-running service,
MCP subprocess, or headset page. See the [prompt-source audit](../Validation/Operator-Prompt-Audit-2026-09-27.md)
for the exact source boundaries and remaining verification work under #116.

## PC concept versions

The Agent Portal can generate a 2D concept before a separate creation turn.
The default source is Codex's built-in GPT Image generation on the **same
ChatGPT-authenticated Agent Portal thread**. The PC advertises it only when
the local app-server reports a ChatGPT account and `imageGeneration` capability.
It uses Codex usage, not a separately billed Images API call, and needs no
`OPENAI_API_KEY`. An image-only turn cannot call Matrix mutation tools. Its
completed native image artifact is verified and copied into the PC concept
store; the image-generation result, Codex saved path, and thread internals are
never sent to the browser.

ComfyUI remains a selectable local fallback. Configure one enabled `comfyui`
provider in the existing PC-side
`MATRIX_CONTENT_CONFIG` and one reviewed image API graph. The workflow entry
needs `promptNode`, `promptInput`, `seedNode`, and `seedInput`; it may also set
`negativePromptNode` and `negativePromptInput`. For the reviewed Krea2 image
graph, these map to text node `53`, KSampler seed node `55`, and optional
negative text node `78`; the endpoint-free
[acceptance graph](../Validation/concept-91-krea2-workflow.json) records the exact
node inputs used for the live run. Keep the worker address, configured graph,
and any credential environment variables in PC-private configuration. When
several workflows are enabled, set `MATRIX_CONCEPT_PROVIDER_ID` and
`MATRIX_CONCEPT_WORKFLOW_ID` on the PC to choose exactly one. The concept path
checks the current worker's
`/object_info` against the reviewed image-node subset before each submission;
configuration alone does not establish that generation will succeed.

The authenticated Operator API uses the existing Agent session ID:

| Action | Route | JSON body/result |
| --- | --- | --- |
| Generate | `POST /api/agent/concepts` | `{sessionId,prompt,negativePrompt?,providerId?}` → `{job}` |
| Vary | `POST /api/agent/concepts/variation` | `{sessionId,sourceConceptId,prompt?,negativePrompt?,providerId?}` → `{job}` |
| List and refresh | `GET /api/agent/concepts?sessionId=...` | `{jobs,concepts,selectedConceptId,builds,providers,defaultProviderId}` |
| Select | `POST /api/agent/concepts/select` | `{sessionId,conceptId,designNotes?}` → `{selectedConceptId,concept}` |
| Cancel queued | `POST /api/agent/concepts/cancel` | `{sessionId,conceptId}` → `{job}` |
| Preview | `GET /api/agent/concepts/<conceptId>/preview` | Authenticated image bytes |
| Build selected | `POST /api/agent/turn` | `{sessionId,text,context?,expectedConceptId?,expectedConceptVersion?,creationMode?}`; the UI sends both expected fields and a creation mode for a selected build |

### Panorama image drafts and world environment

Issue #150 uses the same image generator and Agent session, with `purpose:"panorama"` and a separate selection. These are authenticated, same-origin owner routes:

| Action | Route | JSON body/result |
| --- | --- | --- |
| Generate panorama | `POST /api/agent/concepts` | `{sessionId,prompt,purpose:"panorama",providerId?}` → `{job}` |
| Generate another version | `POST /api/agent/concepts/variation` | `{sessionId,sourceConceptId,prompt?,purpose:"panorama",providerId?}` → `{job}` |
| List and refresh | `GET /api/agent/concepts?sessionId=...` | Adds `panoramaJobs`, ready `panoramas`, `selectedPanoramaId` alongside the unchanged object-concept fields |
| Select a ready version | `POST /api/agent/concepts/select` | `{sessionId,conceptId,purpose:"panorama"}` → `{selectedPanoramaId,panorama}` |
| Register selected image | `POST /api/agent/concepts/register-panorama` | `{sessionId,conceptId,name}` → `{status:"registered",assetId,displayName,sha256,byteLength,width,height,format,url}` |
| Apply registered image | `POST /api/agent/environments/action` | `{action:"set",room_id,scene_revision,asset_id,yaw_degrees}` → queued action with `requestId` and target `environment` |
| Confirm exact action | `GET /api/agent/environments/actions/<requestId>` | `status`, target `environment`, and `outcome` only when the matching browser receipt and observed scene both succeed |

Panorama version numbers advance independently from the existing object-design concept versions. A variation can use only an image of the same purpose. Selecting a panorama never changes `selectedConceptId`, and the generic object-build flow never consumes `selectedPanoramaId`. An image finishing later does not change either selection. The user explicitly selects a ready panorama version, registers it, then applies the returned asset ID. Registration alone never edits the world. Applying remains restricted to a fresh room/revision and the existing Creator Mode and XR presentation rules.

Codex-native is the default image source when its capability is available. Its image-only turn asks for a seamless 360-degree equirectangular 2:1 PNG. The actual returned file must be a decoded, non-interlaced 2:1 RGB/RGBA PNG within the panorama catalog limits; a different aspect ratio, JPEG or WebP becomes a failed draft with a visible reason. Configured ComfyUI remains an option. Its reviewed graph must have exactly one `EmptyLatentImage` and one `SaveImage`; the latent inputs are set to 1024 × 512 before the worker's `/object_info` validation and submission. This renders at 2:1 rather than stretching a 4:3 result, but the returned file still undergoes the same decoder check. A 2:1 shape and generation prompt do not prove that the horizon or horizontal seam is visually correct, so inspect the preview and VR result.

The PC concept record keeps the source prompt, provider, configured workflow digest and submitted graph digest plus seed when applicable, generated image digest, and registered panorama asset ID. The submitted graph digest includes the effective 2:1 latent dimensions and prompt/seed values; it is a checksum, not a public copy of those values. The public panorama catalog exposes the registered image identity and display name, without the private PC image path or full prompt. Identical bytes deduplicate to the existing asset ID and name. See [Matrix Environments](../Docs/Matrix-Environments.md) for runtime persistence and receipt semantics.

`providers` contains `codex-native` and `comfyui` with availability and reason;
`defaultProviderId` is native when available. An explicit `providerId` uses
that source or returns a conflict if it is unavailable. Every job retains its
provider ID, an immutable `conceptId`, a one-based `version`, and a
`parentConceptId` for variations. ComfyUI versions also retain the exact seed,
workflow hash, and reported model names. Native versions retain the revised
prompt when Codex supplies it; the native event does not guarantee a model or
seed field. Omitting `prompt` on a variation reuses the parent's text for a new
sample; supplying it is a complete new text prompt, not an image-conditioned
edit. A ready concept has a content SHA-256 and a
private, durable PC image file; the preview route never exposes the worker URL
or local path. Jobs report `queued`, `generating`, `ready`, `failed`, or
`cancelled`. A confirmed queued ComfyUI job can be cancelled; each job's
`cancellable` field reports this. ComfyUI outages after submission leave
completion unverified for later polling. If the service restarts during a
native image turn, that job is marked failed with an uncertain outcome and is
never replayed automatically. A result finishing later never changes the selected concept.
Only explicit selection updates it, and omitting design notes preserves the
notes already stored on that version. A separate explicit build request is
required before the selected image enters the existing Codex Agent turn. If a
browser supplies expected ID and version, the server rejects a different
current selection instead of silently handing the wrong image to Codex.

The selected-image build method is a per-tab Operator preference with three
values:

| Mode | Agent behavior |
| --- | --- |
| **Auto** (`auto`, default) | Codex chooses an authorized path, including asset reuse, reviewed procedural generation, Blender, agent-authored code, or a combination. |
| **Procedural** (`procedural`) | Codex uses a suitable reviewed Matrix procedural generator and typed create/receipt path. If none fits, it reports that limitation and asks for an explicit mode change. |
| **Blender** (`blender`) | Codex uses editable Blender source, validates and registers a GLB, and places it through a typed Matrix spawn with a receipt. If the path is unavailable, it reports the blocker and asks for an explicit mode change. |

The browser sends `creationMode` only for an explicit selected-concept build;
the server validates it and retains the requested mode in build provenance.
Desktop `/web/` exposes the selector beside the concept controls. The shared
immersive WebXR navigation panel exposes the same Auto, Procedural, and Blender
controls on its **CODEX** page in VR and AR. The in-world voice route uses the
selected mode when it sends a selected-concept build. The XR controls do not
establish that concept previews, selection, or an actual build have been
operated successfully by a Quest wearer; those require separate device evidence.

Selection, versions, notes, and build provenance are persisted under the
service scene directory's `.agent_portal/concepts/`. Image files are immutable
and named by their SHA-256; build provenance records the captured concept and
request-time world context, with verified Matrix receipt and object IDs only
after a world action actually succeeds. Generated images are art direction,
not physical room measurements, geometry, or automatic Matrix placement.

## Dated installed-version observations

The observations below describe their specific installed versions and isolated
sessions. Later source merges or a different running service require a fresh
capability check.

On Codex CLI 0.153.4, a real local app-server accepted initialize, thread
creation, a text turn with streamed completion, `thread/read` with
`includeTurns: false`, and `thread/resume` after the first completed turn.
`thread/read` with `includeTurns: true` returned `list_turns is not supported
yet`. Resuming a newly created thread before its first turn returned `no
rollout found`. The portal must retain its own bounded, browser-safe transcript
for reconnect and must not claim that an empty thread is durable.

The app-server protocol remains PC-local; the browser API carries normalized
portal data. An isolated desktop browser test on the installed Codex version
started a session, streamed a reply, followed up, resumed after refresh,
displayed and denied a native command approval, and cancelled a long turn.
The denied scratch-file command left the file absent. This was not a Quest
hardware test, and browser microphone/voice operation remains unverified.

On the installed Codex CLI 0.155.0-alpha.16.4, the exact request "create a cool
flying ice dragon and have it be animated and interactive" reached the Agent
field in an isolated desktop `/web/` smoke test. The previous `read-only`
sandbox failed to start a Windows shell command; Blender MCP also requested an
approval the XR allowlist could not make reviewable. No dragon was created.
Direct disposable-worktree app-server probes showed `workspace-write` with
`windows.sandbox="unelevated"` completing a real file edit, and `read-only`
with the same Windows fallback completing a read command. An isolated
`danger-full-access` probe also edited a file without an approval request,
which is why full access requires explicit PC configuration. A subsequent
isolated `/web/` Agent field run with `workspace-write` and the Windows
fallback displayed the access mode, created and verified a real workspace
file, retained the same conversation after page refresh, and read that file
in a follow-up. The exact dragon request then reached a native MCP approval
that was not reviewable in XR; Deny and Stop worked. A Blender MCP creation,
dragon import through the Matrix runtime, and Quest wearer acceptance remain
unverified.

A later [desktop M1 trace](../Validation/WebRuntime-Blender-MCP-M1-2026-09-25.md)
used an empty Blender 5.2.2 GUI scratch instance and PC-owned automatic Agent
approvals. In one restored Agent Portal conversation, Blender MCP created and
revised a Copper Astrolabe, exported its GLB, and Matrix MCP registered and
placed the validated asset with an observed runtime receipt. The browser
rendered it and retained it after reload. This supersedes the older desktop
Blender-MCP-unverified statement above, but does not claim the same workflow
was operated from Quest or that every external MCP action is XR-reviewable.
