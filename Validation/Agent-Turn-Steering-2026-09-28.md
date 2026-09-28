# Agent turn steering validation — 2026-09-28

## Behavior

The Agent Portal now accepts one additional text instruction through
`/api/agent/steer` while a normal Codex turn is active. It binds the request to
the opaque Matrix session and the currently active native turn ID, then sends
Codex app-server `turn/steer` with `expectedTurnId`. The native response must
name the same turn. The Portal records the addition under that turn in its
bounded transcript. It neither starts another turn nor cancels the current
one. The existing Stop control still uses `turn/interrupt`.

The desktop Agent box changes **Send to Codex** to **Add to current turn** while
working. XR shows a voice control beside Stop; a recording started during a
turn stays bound to that turn through transcription. If the turn ends before
delivery, the Portal rejects the stale turn ID. The browser keeps the text so
the wearer can decide whether to send it as a later turn. The service does
not retry an uncertain steer. Already applied Matrix actions remain; the
additional prompt directs Codex to inspect current scene state and receipts
before making or retrying a change.

## Checks

- Local installed Codex CLI 0.153.4 stable app-server schema includes
  `turn/steer` with `threadId`, `expectedTurnId`, text `input`, and a `turnId`
  response. This was schema inspection, not a live Codex turn.
- Focused transport, backend, Portal, and authenticated HTTP tests:
  **76/76 passed**. They cover same-turn identity, stale IDs, transcript
  persistence, origin/token checks, strict request shape, and no replacement
  turn after a failed steer.
- Full ControlService suite: **890/890 passed**.
- Full WebRuntime suite: **701/701 passed**. The Agent client and XR panel
  checks include captured turn identity and the voice/Stop controls.
- `npm run build`: passed (Vite 7.3.6). The existing large-chunk warning remains.

The tests use fake app-server responses and isolated HTTP state. No live
Matrix service, world, Quest headset, native steer delivery, or wearer result
was exercised here. A deployment must load this source in its own PC service
and browser page before the control becomes available there.
