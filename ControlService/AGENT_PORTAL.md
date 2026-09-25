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

The next slice owns a durable, opaque Matrix session to Codex thread mapping,
a provider-neutral session interface, event and approval normalization, and
authenticated Matrix API routes. A following slice adds the in-world Operator
UI and voice transcription routing. Matrix tools, Blender-specific workflows,
spatial grounding, and rich artifacts follow the generic portal.

## Installed-version observations

On Codex CLI 0.153.4, a real local app-server accepted initialize, thread
creation, a text turn with streamed completion, `thread/read` with
`includeTurns: false`, and `thread/resume` after the first completed turn.
`thread/read` with `includeTurns: true` returned `list_turns is not supported
yet`. Resuming a newly created thread before its first turn returned `no
rollout found`. The portal must retain its own bounded, browser-safe transcript
for reconnect and must not claim that an empty thread is durable.

This slice has not exposed app-server to a browser or run a Quest test. The
fake-server tests cover approval response shape and routing; a real native
approval request is still an acceptance check for the completed portal.
