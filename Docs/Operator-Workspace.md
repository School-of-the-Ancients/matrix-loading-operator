# Operator workspace

Local #203 increment, October 17, 2026. This extends the earlier Operator naming
and blocked-request handoff. It does not complete #203 or change release gates.

Desktop starts with Operator expanded unless this tab has a saved expansion
preference. The workspace shortcuts open and focus an existing section; clicking
again leaves it open. They retain the same controls and handlers, with no new
conversation, request, approval or world action. Replies and approvals precede
optional image tools. Advanced proposals / offline is nested inside Operator;
its request, history and Apply/Discard remain separate from the Agent thread.

## Feature homes

| Audited desktop section | Home and reachability |
| --- | --- |
| Creator / Play | Create / Play shortcut; existing Enter/Return, Pause/Resume and game status. Citizens lifecycle remains separate. |
| Agent Portal | Operator shortcut; same connection, permission selection, context, text/voice, reply speech, active-turn additions, Stop, approval and transcript controls. |
| Visual Concepts | Images shortcut inside Operator; same providers, versions, selection, notes, build method and progress. Opening it does not generate or select an image. |
| Panorama Backgrounds | Backgrounds shortcut inside Operator; same generation, versions, yaw, naming, selection and apply/remove controls. AR restrictions remain. |
| Operator Planner | Advanced proposals / offline shortcut inside Operator; separate offline/AI route, request, Blender action, conversation, safe auto-apply preference and proposal review. New pending proposals reveal both ancestors. |
| AR Room & Camera | Existing expandable section; view/camera consent, measured edits, point marker, origin recovery and recovery archive export/clear. |
| World & Saves | World / Saves shortcut; catalog refresh, Undo/Redo/Clear, selected-object lock, full PC checkpoints, browser archives and legacy scene saves. |
| AI Citizens | Existing expandable section; fixture/station setup, resident authoring, routines, appointments, simulation and inspector. |
| Block Scale Lab | Existing expandable section; selection, factors, baseline, proposal/reset/cancel and acknowledged result. |
| Help & Connection | Settings / Help shortcut; same connection URL/token, setup help and clearly separate demo/hosted routes. |

| Existing XR screen | Supported home and boundary |
| --- | --- |
| Activity/chat | Operator header toggle; runtime feedback and separate Planner proposal activity. |
| Operator/Agent | Same conversation, status, selected-image method, voice, Stop, approval and PC-review handoff. Text drafts remain in the desktop textarea; XR has no equivalent text editor. |
| Concepts / panoramas | Existing Operator preview controls; version/selection/progress stay on the existing shared models. |
| Proposal review | Existing pending-proposal entry and Apply/Discard; distinct from Agent approval. |
| Create/Play | Existing header control, mode/simulation actions and Stop Operator. |
| World | Existing World header; selection/locks, save/restore, Undo/Redo, camera and origin controls. Save scope is now visible before activation. |
| AR layout | Existing contextual World entry; digital layout adjustment and applicable confirmation guards. |
| Browser archives | Existing Worlds entry under World; archive/new/restore controls retain confirmation and recovery guards. |

Compatibility and administration routes are unchanged: `/clients` remains
integration administration; `/web/citizens.html` is a browser-local demo;
`/web/hosted.html` is the isolated read-only hosted observer. `/legacy/operator`,
`/content` and `/learning` retain their existing compatibility purpose. No route
was retired. See [the route guide](Control-Page-Routes.md).

## Save scopes

| Control | What it saves/restores |
| --- | --- |
| Desktop Save world / Restore world | Named full PC checkpoint: scene, supported game and Citizens progress. Existing origin/access restrictions still apply. |
| XR Save world | Full manual checkpoint in this browser, followed by a scene-only PC backup. Each outcome has its own status. |
| XR Restore saved | The manual checkpoint in this browser; it does not load a desktop named full PC checkpoint. |
| Browser Archive + new world / Restore archive | Complete supported browser worlds, preserving the outgoing world through the existing verified archive transaction. |
| Legacy Save scene / Restore scene | Scene-only PC backup, retaining its existing scope. |

These paths retain their current formats and recovery behavior. Nothing migrates
storage or changes authority. Opening a section does not switch mode, pause
Citizens, connect the Agent or apply a proposal. A newly pending Agent approval
still opens Operator; a pending Planner proposal now also opens its Operator
ancestor. Manual collapse preferences and unsent inputs stay in the same tab.

## Local validation

Candidate: local increment over the existing dirty `dev/rendered-review-fixture`
checkout at `2279c3d65228827ec3484aa008b991c8612287df`. The earlier Operator
handoff and parked tooling are retained. No dependency or service code changed.

- Runtime suite: 811 passed, zero failed. Production build passed in a separate
  output directory; the existing large-chunk warning remains.
- Actual source entry in official IWSDK 1.0.1 managed Chromium: all shortcuts,
  repeated advanced navigation and both draft fields checked. Screenshots
  show both distinct drafts before and after emulated AR entry/exit.
- One offline proposal remained reviewable after navigation. It was discarded
  without applying; no runtime commands executed. Five complete object records
  remained unchanged. Test drafts were cleared afterward.
- HTML audit retained all 106 existing control IDs, tags and input types, with
  unique IDs and the intended nested Planner parent. The headset record's prior
  bytes remain intact with an append. Unrelated baseline files are unchanged.
- These are source-entry checks plus a separate successful build. Compiled
  candidate execution, live Agent delivery/approval and physical Quest checks
  were not performed. The XR save-scope text is covered by panel tests; its
  physical readability remains pending.

## Remaining work

This increment covers navigation, reachability and save-scope presentation.
It does not establish every #203 acceptance case. Connected live-Agent delivery,
active-turn/approval behavior during physical desktop/XR transitions, concept
generation and physical Quest readability/input still need candidate-specific
evidence. Use the single [headset acceptance record](../Validation/V1.2-Headset-Acceptance.md),
especially H07/H10; emulator checks are supporting evidence only.

The next bounded #203 increment is contextual selected-object/action-state
presentation across desktop and XR, reusing current selection and authority.
Save unification, richer image/build review, wall/wrist presentation, gameplay
Reset/Replay and Agent setup remain separate work.
