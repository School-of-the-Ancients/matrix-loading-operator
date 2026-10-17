# Matrix: shared creation and presentation UX

Target design from the October 17, 2026 interface review. Full consolidation
remains a target; [PR #207](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/207)
already introduces Operator naming and the disconnected creation-request handoff.
[ARCHITECTURE.md](../ARCHITECTURE.md) defines ownership and
[ROADMAP.md](../ROADMAP.md) selects current work. This document keeps the UI
mapping and migration decisions.

## Normal interface

**One world, one Operator, two interaction modes: Create and Play.**

Enter a blank world, reopen a saved world, or view it through AR. Operator asks,
**"What would you like to build or learn today?"** Build, Learn and Continue are
entry choices, not separate editors.

- **Create / Play:** author or experience the world, with current state visible.
- **Operator:** conversation, proposals, visual concepts, progress and review.
- **Selected-object controls:** actions for the object or character being addressed.
- **World:** open/save, versions and world-level settings.
- **Settings:** connection, access, input, display and advanced diagnostics.

Capabilities do not each need a permanent tab. School owns historical minds,
conversation, teaching and learner records; its Cosmos/World's Fair experience
can use Matrix for optional exhibits, environments or avatars. A mentor may
appear in conversation or use a generic Matrix entity. Neither requires a
Citizens simulation. Broader School direction belongs in the
[School repository](https://github.com/School-of-the-Ancients/school-of-the-ancients)
and [School #7](https://github.com/School-of-the-Ancients/school-of-the-ancients/issues/7).

## Creation journey

1. **Explore the intention.** Describe a place, object, activity or learning goal.
   Operator asks only enough to choose a useful first result; continuing work
   starts in the existing world.
2. **Review concepts when useful.** Show image cards for substantial visual
   decisions. Select, revise or skip them. Moving an object, changing a color or
   placing an existing asset should not require image generation.
3. **Review the proposed world change.** Identify background, walkable space,
   objects, characters, interactions and affected entities. Show the selected
   concept version and change scope. An image or plan is not a functioning 3D preview.
4. **Build a draft.** Confirm the concrete plan under the applicable review
   policy. Use procedural geometry, reusable assets or Blender as appropriate;
   keep progress, cancellation and failures in the same Operator task.
5. **Try and revise the world.** Interact with the actual result and request
   changes while preserving identities and unrelated edits. Distinguish concept
   approval, asset creation, world application and a validated working experience.
   Completion requires the matching runtime outcome and current observation.
6. **Save and return.** Offer one understandable Save/Load journey and recoverable
   versions for substantial changes. Expose storage scope, compatibility and
   recovery provenance when they affect what can be restored.

The "final world builder" is Operator's plan/build/review stage. A panorama
supplies background; walkable geometry, colliders and interactions remain world
content. Preserve AR passthrough behavior and room/capture consent.

Concept approval applies to a specific plan/version/scope, not arbitrary later
changes. Existing tool approvals, locks, stale-target checks and receipts remain.
Simple authorized edits retain their fast path and supported Undo; lock-policy
Undo is not a new requirement.

## Current interface to target organization

Source audit: runtime at
[`679fdb2`](https://github.com/School-of-the-Ancients/matrix-loading-operator/tree/679fdb2f8e9d30bf081eb0d80860722ee2c90e07);
planning base `deda47668a75c7b0dfdb127805f530866f9b61b2` adds documentation.
This was source review, not live desktop or headset acceptance.
References: [desktop](../WebRuntime/index.html),
[XR presentation](../WebRuntime/src/view.js),
[shared routing](../WebRuntime/src/main.js) and
[route guide](Control-Page-Routes.md).

The audit found eight top-level desktop sections, with Visual Concepts and
Panorama Backgrounds nested in the Agent Portal. PR #207 names that section
Operator and the separate Planner Advanced proposals / offline. XR uses
contextual screens within one panel. The feature families below remain the
scope of the UI cleanup.

| Surface / feature family | Target home and treatment |
| --- | --- |
| **Creator / Play:** enter/return, pause/resume and game status. | Persistent Create/Play control; retain distinct game/turn controls where needed. |
| **Operator (formerly Codex Agent Portal):** conversation, reconnect/new chat, selected context, text/voice, active-turn additions, Stop and approvals. | Primary creation conversation. Show backend/settings detail where useful. |
| **Visual Concepts:** prompts, providers, variants, selection, previews and build notes. | Operator image tool with inline cards, explicit selection, provenance and retrievable task history. |
| **Panorama Backgrounds:** prompts, variants, selection, yaw/apply/remove. | Operator background tool and contextual World settings; retain AR restrictions. |
| **Advanced proposals / offline (Planner):** separate request, offline/AI route, Blender action, proposal commands and Apply/Discard. | Advanced tool behind Operator. Do not silently merge its history, proposal state or approval path into the persistent Agent thread. |
| **AR Room & Camera:** shared view, camera, measured-room setup, point marker and origin recovery. | Contextual room/placement and capture controls; advanced recovery in Settings/World. Keep visible capture state and deliberate consent. |
| **World & Saves:** assets refresh, Undo/Redo/Clear, lock, PC checkpoints, browser archives and legacy scene saves. | World menu and selected-object controls. Map save behavior before changing labels or retiring paths. |
| **AI Citizens:** start/seed/stations, residents, routines, appointments, social state, simulation controls and deep inspector. | In-world interaction; resident authoring on selection; simulation management and inspector in advanced World tools when Citizens is attached. |
| **Block Scale Lab:** target, factors/baseline, proposal/reset/cancel and acknowledged result. | Discoverable experiment/lesson capability and contextual exhibit controls; share the existing state/math model under #32. |
| **Help & Connection:** setup, service token and demo/hosted links. | Settings/help; keep private connection detail out of immersive teaching panels. |
| **XR screens:** chat/status, Codex, World, mode, AR layout, archives, concepts, panorama and proposal review. | The same task, conversation, selection, approval and action model for headset input. #172 separately owns wall/wrist placement. |
| **Other routes:** /clients, Citizens desktop demo, hosted visitor, /legacy/operator, /content and /learning. | /clients remains active integration administration. Label the isolated demo and read-only hosted observer clearly. Unity-era pages remain compatibility/history until removal is justified and safe. |

## Migration and parity cautions

- **Save scope differs today.** Desktop Save world creates a full PC world
  checkpoint. XR SAVE creates a full browser checkpoint plus a PC scene-only
  backup. Browser archives, automatic recovery and legacy scene saves retain
  their provenance and restoration scope until a compatible unified journey exists.
- **Modes and Citizens lifecycle are separate.** Create/Play does not currently
  pause/resume Citizens automatically. Define that behavior before wiring it
  together. Stop Citizens detaches the simulation while leaving scene actors
  and resources; it cannot be relabeled as ordinary Pause.
- **Shared UI does not establish multi-device authority.** Reuse shared handlers
  and authoritative session/turn/approval state. Browser-owned interactive worlds
  and the PC-owned read-only hosted fixture remain different paths; panel parity
  does not implement a shared persistent host or justify a second simulation.

Keep every mapped feature reachable while simplifying defaults. Advanced tools
remain discoverable and unavailable actions explain why. Desktop and XR should
complete conversation → review → apply → interact → save through the same task
and state. Sensitive native tool review may keep its PC boundary with a clear
handoff; ordinary actions should not require searching another interface.
A wrist panel is not a prerequisite.

## Guide interaction and authority

During a School experience, show one foreground guide and Operator's progress
or review when needed. School chooses conversational and teaching intent;
Matrix executes permitted world changes. The bounded Galileo example and its
integration checks live in the [reference integration plan](V1.3-Implementation-Plan.md);
it does not define the whole School product.

The current [#31 client contract](Client-API-v1.md) binds read/proposal access to
a runtime; the human owner reviews and Applies on the PC's /clients page.
The reference integration retains human approval and must make its bounded
review reachable in the headset. Create/Play, starting a lesson or assigning a
mentor role grants no authority.

A future **"Let the guide manage this exhibit"** control would need an enforced
grant: world and School session/mentor reference, exhibit entities, allowed
actions/recipes, parameter and resource limits, expiry and owner revocation.
Keep request IDs, expected revisions and matching receipts. Enforce revocation
for delayed requests; out-of-scope actions require separate review.

Such delegation is proposed work. It does not override locks or Play guards:
return to Create when authoring is blocked. Supporting particular actions during
Play needs explicit policy and acceptance. Guides and residents receive no
owner credentials, arbitrary shell/tool access or authority over unrelated
worlds. School keeps learner records; Matrix keeps supported exhibit state and
opaque references needed to return.
