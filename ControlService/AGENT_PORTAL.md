# Matrix Agent Portal gateway

Issue #59 tracks the WebXR Agent Portal. The PC gateway will connect `/web/` to a
persistent Codex conversation without sending Codex or MCP credentials to the
browser. The Unity `/` client remains separate.

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
read-only sandbox. The installed Codex configuration otherwise routed a safe
isolated write through `auto_review` without a Matrix approval request.

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
command text and tool arguments remain PC-only. The only XR-approvable command
form currently recognized is creation of one new file inside the Matrix
repository with short literal text. Unknown commands, overwrites, outside-repo
targets, and file-change approvals show a PC-review message and cannot be
approved through the browser; Deny and Stop remain available. Broader useful
approval descriptions need their own reviewed allowlist before wearer
acceptance is complete.
The `/web/` Operator now shows a compact Agent page with recent text, activity,
Approve/Deny, Stop, and a PC speech transcription path that sends spoken text
to the same Codex conversation. The browser stores only an opaque Matrix
session ID; when a service bearer token is configured, it must be re-entered
after page refresh. Matrix tools, Blender-specific agent workflows, and rich
artifacts remain later slices.

An optional version 1 spatial context on `/api/agent/turn` identifies the
active Matrix client and room, input source, selected object, and a separate
pointing hit. The PC checks the IDs against its current room snapshot and adds
the service scene revision, up to eight object summaries, room recovery state,
and one relevant viewer frame. The result is advisory turn context, not a
Matrix command. No camera image, raw hand telemetry, browser credential, or
free-form asset description is included. A world change still requires a
future typed Matrix tool and runtime receipt. Desktop text attaches context
only when the wearer selects the checkbox; in-world speech captures it at
recording start.

## Installed-version observations

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
