# #91 current-head review: concept intent and native image boundary

A read-only review of PR #155 at `b5e5edd` found two selected-image routing
cases and one image-only permission boundary that the earlier GitHub automated
review had not covered. This change extends the existing Agent Portal and
ConceptStore path; it does not add a world owner, command path, or image API.

## Selected-image intent

`Build a bridge, not the selected concept` previously opened a selected-image
build from the browser and attached the selected PNG in ControlService despite
the explicit exclusion. `Build concept v3 in Matrix` could also attach the
selected Version 4 PNG because the PC matcher recognized `version 3` but not
`v3`. The browser and PC classifiers now strip explicitly negated clauses;
the PC matcher recognizes abbreviated `vN` references while ignoring a
hyphenated asset name such as `bridge-v1`. An explicit exclusion of the selected
version, concept ID, or image fails closed. A deferred selected-concept request
such as `Build selected concept, not now; build a bridge` does not transfer the
PNG to the later ordinary build. Positive requests such as `Build the selected
concept`, `Do not use v1; build v2`, and `not only ... but also ...` retain their
established route. The PC remains authoritative when the requested version
differs from the selected version. Focused browser and PC handoff tests confirm
the routed turns, absence of unwanted build records, and image attachment.

## Native image-only turns

The image-only prompt and Matrix tool-bridge POST guard were already present,
but an automatically approved native Codex thread could inherit its normal
`danger-full-access` policy. The image-only turn now explicitly requests
`readOnly` with network access disabled and `on-request` approval. Every
ordinary Agent turn explicitly restores its configured sandbox and approval
policy, because [Codex App Server turn overrides](https://learn.chatgpt.com/docs/app-server)
become defaults for later turns. Any approval request during a native image
turn is declined and the turn is interrupted. The existing Matrix bridge
mutation guard remains in place. If multiple approval requests are pending in
one poll, every request is declined before the native turn is interrupted.
The policy is enforced at the app-server turn boundary; the prompt still
describes the intended image-only behavior.

An isolated local probe used `codex-cli 0.158.0-alpha.2.1`, an ephemeral thread
`01a0e719-7019-7e12-b641-623c648213b9` configured as
`danger-full-access`/`never`, and one image turn
`01a0e719-7156-7ae3-aa43-9a8c2ae8e16f` with explicit
`readOnly`/`on-request`. Native image generation completed with a 904,276-byte
PNG, SHA-256
`e33aef44982e9b9aa066e090ff312d796d4ed53f87e2da147039e60fdb143a08`.
Its event stream contained user message, reasoning, agent message, and image
generation items, with no command execution, file change, MCP call, or
approval event. The scratch probe had no Matrix MCP server or `MATRIX_*`
environment value. It did not change a Matrix world or the saved #91 Agent
conversation. This probe establishes image-generation compatibility with the
stricter policy.

A separate deterministic `command/exec` probe under the same `readOnly`,
no-network policy attempted to write a sentinel in that isolated scratch
directory. The local Windows sandbox returned
`exec failed: windows sandbox: helper_unknown_error: apply deny-read ACLs`;
the sentinel was absent before and after. A loopback GET to a probe-owned
endpoint failed at the same sandbox setup step. This confirms shell execution
failed closed on this machine; it does **not** independently demonstrate a
working network filter, because the network command never started. Neither
probe touched a Matrix world or repository source.

## Validation

- ControlService: **861/861** tests passed, including the per-turn policy wire
  shape, native approval decline, concept version/negation/defer handoff, and
  existing Matrix tool-bridge guards.
- WebRuntime: **636/636** tests passed, including the aligned browser intent
  cases. Production Vite build passed with the existing large-chunk warning.
- `git diff --check` passed on the working diff before commit.

The separately documented Strong Beacon Quest VR/AR wearer check is still
pending; this guard review does not substitute desktop evidence for a wearer
observation.
