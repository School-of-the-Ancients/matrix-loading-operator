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
PC-configured Codex sandbox. The default is `workspace-write`, so the real
agent can use its normal repository tools. Set `SANDBOX_CODEX_AGENT_SANDBOX`
on the PC to `read-only`, `workspace-write`, or `danger-full-access`. The last
mode is an explicit PC-operator choice: Codex can act outside the workspace
without relying on a sandbox escalation prompt. `/web/` displays the active
mode but cannot change it or pass a sandbox value in an Agent API request.
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

The wearer can see the effective access mode on the Agent page. Changing it
requires restarting the PC service. Full PC access is available with
`-AgentSandbox danger-full-access`; it does not wait for sandbox escalation
approval before ordinary shell or file operations.

## PC-owned automatic Agent mode

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
future restarts. This is a PC setting. `/web/` and Quest display the effective
access and approval modes but cannot change either one.

In automatic mode, the Agent's native command and file approval policy is
`never`, and the Matrix MCP server uses `auto` for its enabled tools instead
of the reviewed mode's per-tool `prompt` overrides. Runtime argument
validation, scene revisions, and receipts still apply. Other configured MCP
servers may have their own tool and elicitation behavior. In an isolated probe
with Codex CLI 0.158.0-alpha.2, a Matrix MCP tool configured `prompt` emitted
an approval under `on-request` and completed without one under `never`; that
single probe does not establish behavior for every external MCP server.

Changing modes requires restarting the PC service and therefore creating a
new app-server process. The saved Agent Portal session ID and completed
conversation can resume on the new process with the selected policy. A turn
that was working during restart is marked `unknown` and is not continued;
send a new turn after reconnecting. The bounded proposal planner remains on
its separate read-only path.

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
The `/web/` Operator shows a compact Agent page with recent text, activity,
Approve/Deny, Stop, and a PC speech transcription path that sends spoken text
to the same Codex conversation. The browser stores only an opaque Matrix
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
speech captures it at recording start.

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
