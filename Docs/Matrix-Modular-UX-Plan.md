# Matrix: modular UX and guided lessons

Decision record: October 17, 2026 UTC (October 16, America/Denver).
Records the owner's request to simplify the interface and organize the project
around modules. This is a target design and delivery plan; it does not claim the
consolidated UI, delegated lesson permissions or professor integration exists.

## October 17 execution follow-up, America/Denver

The [v1.3 implementation plan](V1.3-Implementation-Plan.md) resolves the next
implementation order following the owner's School/society request: one
professor and exhibit first, using the existing School lesson. Apply only the
#203 navigation/state presentation work needed for that journey; the full UI
cleanup remains its own bounded issue. The earlier references below to keeping
#187's image-world scope unchanged describe the prior planning state. The new
proposal explicitly retains that work under #185/#154 while selecting a
professor-first next release. #173's baseline acceptance and #201's October 27
scope remain intact.

## Product direction

**One world, one Operator, two interaction modes: Create and Play.**

Enter a blank world, reopen a saved world, or view that world in your room
through AR. Operator asks: **"What would you like to build or learn today?"**
Build, Learn and Continue are entry choices within that experience. School is
the first focused learning experience; open-ended creation remains available.

The normal interface contains:

- **Create / Play** for authoring versus experiencing the world.
- **Operator** for conversation, proposals, visual concepts, build progress and review.
- **Selected-object controls** for the object or resident being addressed.
- **World** for opening/saving worlds, versions and world-level settings.
- **Settings** for connection, access, input, display and advanced diagnostics.

Modules describe responsibilities behind this interface. They do not each get
a permanent tab, separate application or new repository.

## Module responsibilities

These boundaries extend [ARCHITECTURE.md](../ARCHITECTURE.md) and the existing
[cross-project ownership catalog](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/MODULES.md).

| Module / boundary | Owns | Connects through |
| --- | --- | --- |
| **Matrix runtime** | World/entity identity, transforms, interaction, physics, execution, supported game state and compatible persistence; desktop/VR/AR presentation. | Validated world actions, current observations and execution receipts. |
| **Operator** | Creation conversation, intent exploration, plans, previews, revision history and orchestration of existing creation tools. | Existing procedural, reusable-asset and Blender/import paths; shared world capabilities. |
| **Citizens** | Resident identity, supported memory, needs, routines, relationships, dialogue and intentions. | A Matrix world adapter: bounded observations in, permitted intentions out, observed outcomes back. |
| **School** | Teaching roles, curriculum, lesson stages, explanations, assessment and learner records. | The client-neutral capability contract and a School adapter; opaque lesson references in Matrix. |
| **World content** | Assets, layouts, reviewed exhibit recipes, provenance and world configuration. | Normal Matrix entities and capabilities. School retains ownership of pedagogical content. |
| **ControlService / infrastructure** | Existing PC-side tools, policy checks, validation, resource limits and receipts; replaceable model/asset providers. | Existing adapters and transports. Privileged credentials remain computer-side. |

A professor is a Citizen with a School teaching role. A minimal teaching role
can be introduced before a general autonomous society is complete. Teaching
records and private learner information do not become public Citizen memory.

Keep Citizens a distinct module inside the existing Matrix architecture first.
Clarify its adapter and lifecycle while reusing current code; extract a package,
repository or service only when independent reuse or deployment requires it.
Do not relocate the whole codebase to make the diagram look cleaner.

Each supported world instance has one authoritative world and simulation owner.
Citizens does not add a second scene graph, physics engine, asset pipeline or
clock per visitor. Its attach/resume/pause/checkpoint lifecycle must preserve
resident IDs and supported state. Current browser-owned worlds and the separate
PC-owned hosted fixture are different supported paths; full shared hosting is
still owned by #20/#148.

A classroom, a village and a future Boulder world are content/settings using
these modules. Georeferenced Boulder additionally needs the existing #179/#180
data and registration work. Private human observations remain behind Manfred's
boundary. None requires a new Matrix engine.

## The creation journey

1. **Explore the intention.** The user describes a place, object, activity or
   learning goal. Operator asks only the questions needed to choose a useful
   first result. Start in the existing world when continuing work.
2. **Review concepts when useful.** For a substantial visual design, Operator
   produces image cards in the conversation. The user selects, revises or skips
   them. A small move, color change or existing-asset placement should not require
   image generation.
3. **Review the proposed world change.** Show the background, walkable space,
   characters, objects, interactions and the scope of the change. Identify the
   selected concept version and which existing entities are affected. A proposed
   plan or image is not a functioning 3D preview.
4. **Build a draft.** Confirm the concrete plan under the applicable review policy,
   then use the fastest suitable backend. Reuse assets and procedural geometry
   where sufficient; use Blender for custom geometry/animation. Surface real
   progress, cancellation and failures in the same Operator task.
5. **Try and revise the actual world.** Inspect the imported/generated result,
   interact with it, ask for changes and retain identity and unrelated edits.
   Distinguish concept approval, successful asset creation and successful world
   application. A completion claim requires the matching runtime outcome.
6. **Save and return.** Make a recoverable version for substantial changes and
   offer one understandable Save/Load journey. Keep storage type, recovery
   provenance and compatibility visible when they affect what can be restored.

The proposed "final world builder" is the plan/build/review stage of Operator,
not another application. A panorama supplies visual background; walkable space,
colliders and interactive objects remain actual world content. In AR, preserve
the current passthrough/background behavior and room/capture consent.

Concept approval never silently becomes permission for arbitrary later changes.
An approval refers to a specific plan/version/scope. Existing tool approvals,
object locks, stale-target checks and execution receipts continue to apply.
Simple authorized edits can keep their current fast path and supported Undo;
lock-policy Undo is not a new requirement.

## Current interface to target organization

Source audit: runtime at
[`679fdb2`](https://github.com/School-of-the-Ancients/matrix-loading-operator/tree/679fdb2f8e9d30bf081eb0d80860722ee2c90e07);
planning base `deda47668a75c7b0dfdb127805f530866f9b61b2` adds roadmap documentation.
This was a source review, not a live desktop or headset acceptance session.
[Desktop source](../WebRuntime/index.html),
[XR presentation](../WebRuntime/src/view.js),
[shared routing](../WebRuntime/src/main.js) and
[route guide](Control-Page-Routes.md) are the audit references.

The current desktop has eight top-level expandable sections, with Visual
Concepts and Panorama Backgrounds nested in the Agent Portal. The headset uses
contextual screens in one panel, rather than the same section layout.

| Current surface / features | Target home and treatment |
| --- | --- |
| **Creator / Play:** enter/return, pause/resume and game status. | Persistent Create/Play control with clear current state; retain distinct game/turn controls where needed. |
| **Codex Agent Portal:** conversation, reconnect/new chat, selected context, text/voice, active-turn additions, Stop and approvals. | User-facing **Operator**. Keep one primary creation conversation; expose backend/settings detail only where useful. |
| **Visual Concepts:** prompts, providers, variants, selection, previews and build notes. | Operator image tool with inline concept cards and retrievable task history. Keep provenance and explicit selection. |
| **Panorama Backgrounds:** prompts, variants, selection, yaw/apply/remove. | Operator background tool plus contextual World background settings; retain AR restrictions. |
| **Operator Planner:** separate request, offline/AI route, Blender action, proposal commands and Apply/Discard. | Preserve as an explicit advanced proposal/offline tool behind Operator. Consolidating navigation must not silently merge its conversation history, proposal state or approval path into the persistent Agent thread. |
| **AR Room & Camera:** shared view, camera, measured-room setup, point marker and origin recovery. | Contextual room/placement and capture controls; advanced recovery under Settings/World. Keep visible capture state and deliberate consent. |
| **World & Saves:** assets refresh, Undo/Redo/Clear, lock, PC checkpoints, browser archives and legacy scene saves. | World menu plus selected-object controls. Design the save mapping before changing labels or retiring any path. |
| **AI Citizens:** start/seed/stations, residents, routines, appointments, social state, simulation controls and deep inspector. | Everyday interaction in the world; resident authoring on selection; simulation management and inspector in advanced World tools. |
| **Block Scale Lab:** target, factors/baseline, proposal/reset/cancel and acknowledged result. | Discoverable experiment/lesson capability and contextual exhibit controls, sharing one state/math model under #32. |
| **Help & Connection:** setup, service token and demo/hosted links. | Settings/help. Keep private connection detail out of immersive teaching panels. |
| **XR screens:** chat/status, Codex, World, mode, AR layout, archives, concepts, panorama and proposal review. | The same task, conversation, selection, approval and action model presented for headset input. #172 separately owns wall/wrist placement. |
| **Other routes:** /clients, Citizens desktop demo, hosted visitor, /legacy/operator, /content and /learning. | /clients remains active integration administration; the isolated demo and read-only hosted observer remain clearly labeled. Unity-era pages stay compatibility/history until a justified cleanup proves their removal safe. |

Three distinctions need explicit implementation decisions:

- **Save is not equivalent today.** Desktop full PC world checkpoints differ from
  XR SAVE's browser full checkpoint plus PC scene-only backup. Browser archives,
  automatic recovery and legacy scene saves retain their actual provenance and
  restoration scope until a compatible unified journey is implemented.
- **Modes and Citizens lifecycle are separate today.** Create/Play does not
  automatically pause/resume Citizens. Define the intended lifecycle before
  wiring it together. "Stop Citizens" currently detaches the simulation while
  leaving scene actors/resources; it must not be relabeled as ordinary Pause.
- **A common UI is not multi-device authority.** Reuse the shared handlers and
  authoritative session/turn/approval state. Do not claim that matching desktop
  and headset panels implements a shared persistent host.

Preserve feature reachability while simplifying defaults. Advanced tools remain
discoverable; unavailable actions explain why. Both desktop and XR should
complete the normal conversation -> review -> apply -> interact -> save journey
without making the user search another interface for an ordinary action.
Sensitive native tool review may retain its existing PC boundary with a clear
handoff. A future wrist panel is not a prerequisite for the first cleanup.

## Guided lessons and world authority

**A lesson may delegate bounded control of its exhibit to Operator.** The
professor chooses the teaching intent; Operator orchestrates permitted changes;
Matrix validates and executes them. Call this lesson control or delegated world
control in the product, rather than "sudo."

Create/Play describes interaction and simulation state. A capability grant
describes authority. Starting a lesson or assigning the professor role does not
grant access, switch Codex to Full access or override locks. The learner should
see one foreground guide during a lesson, with Operator's build/review status
available when it is doing work.

Reuse the completed bounded Citizen-creation foundation
[#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109#issuecomment-5857619362),
the [#31 client contract](Client-API-v1.md) and the existing #32 experiment.
Current client pairing binds read/proposal access to a specific runtime; only
the local Operator can Apply. A lesson-scoped session grant is proposed work,
not existing permission.

A future grant should identify the world, professor, lesson session, exhibit
entities, allowed recipe/actions, parameter bounds, resource limits, expiry and
owner revocation. Requests retain IDs, expected revisions and matching receipts.
The first lesson can use existing human Apply; it does not need new autonomous
authority.

A later **"Let the guide manage this lesson's exhibit"** control could allow
repeated in-scope actions without prompting at every step. Anything outside
that grant needs separate review. The server/runtime must enforce the grant,
including revocation and delayed requests. Current Play guards still win:
where authoring is blocked, pause/return to Create for reviewed changes. Allowing
specific lesson actions during Play requires an explicit capability policy and
acceptance work; it must not be achieved by bypassing mode guards.

No lesson or resident receives OS sudo, owner credentials, arbitrary shell/tool
access or authority over unrelated worlds. School stores learner records;
Matrix stores supported exhibit state and references needed to resume.

### First complete School experience

Use one professor, one learner and one existing Block Scale Lab exhibit:

1. Ask the learner to predict the effect of doubling each length.
2. Propose a bounded change through the existing review/execution path.
3. Explain the **8x mathematical volume ratio** only after a matching receipt
   and current exhibit observation.
4. Let the learner revise/reset the same block through an available control.
5. Save and reopen the same exhibit/professor identities and supported lesson
   reference/state; re-observe before treating saved observations as current.

One denied/stale/out-of-scope request, a competing edit and cancellation must
leave a recoverable lesson state without duplicate application or a false
completion. Keep ideal mathematical ratios distinct from physical measurements.
A local lesson fixture is labeled as such until real School pairing works.

This integrates #32's immersive surface, #31's contract and #29's generic
resident behavior. School owns the actual teaching implementation. Add a second
resident and grounded memory evaluation after this complete loop; a full city
or general society is not its prerequisite.

## Managing and delivering the work

Use the existing issue-based roadmap and product repositories. Maintain one
canonical UX plan here; issue bodies own bounded acceptance and PRs own changes
and evidence. Add links where decisions affect existing roadmaps, rather than
copying the entire plan into each tracker.

Track **modules for responsibility, small user journeys for delivery**. Each
implementation issue should name its primary module, the user-visible outcome,
dependencies, acceptance, affected persistence/permission paths and evidence
needed. Use a small work queue: ready, active, review/validation, done; an item
blocked on hardware says so. This plan creates no new GitHub Project, milestone
objects or schedule.

| Work | Existing owner / selected action |
| --- | --- |
| First UI cleanup: one Operator entry and consistent desktop/XR core actions. | [#203](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/203), a focused child of #156. Reuse completed #122 Creator work, #132 route cleanup and merged #165 sections. |
| Images, plan review and refinement. | #185 and #154; preserve #187's bounded selected sprint and acceptance gates. Do not create new generation queues. |
| Wall-pinned and wrist-recalled panels. | #172; consumes the common interaction model. |
| One professor/exhibit and its supported observations. | #32, #31 and #29; reuse completed #109. School teaching stays in School; closed #23 remains historical ownership context. |
| Citizens module/lifecycle and persistent world integration. | #29, #20 and #148; clarify boundaries incrementally when implementing those slices. |
| AI inspection and development/device automation. | #186 and its existing #191 runner; UI cleanup does not create another test system. |
| Playground presentation and coursework evidence. | #201 under #24, following the existing October 27 runbook. |
| Boulder and private human-state input. | Later #179/#180/#156 work, with the existing Manfred boundary. |

**Recommended next implementation:** consolidate the Operator surface and make
the existing create/revise/save journey coherent before adding more exposed
feature panels. Keep this first slice to navigation, shared state presentation
and reachability; generation redesign, save migration, lesson grants, broad
Citizens refactoring and wall/wrist controls remain separate increments. In this
first slice, present each existing save action's actual scope clearly; unifying
storage behavior belongs to the later save-mapping increment.

The October 27 demo still rehearses the existing working loop. This cleanup,
the complete image pipeline and the professor are not new prerequisites for
that deadline. The [semester plan](Semester-Convergence-2026.md) remains the
delivery order: polished Playground, one professor/exhibit, then two residents.
Apply this UX direction as those increments are selected; avoid a large rewrite
before the demo.

Use draft PRs. Documentation and tracker creation do not authorize runtime
implementation, merging, release or deployment. Keep #173's remaining
exact-candidate acceptance and integrated #187 gate unchanged. For future UI
changes verify the affected desktop path and record relevant XR cases in the
existing evidence workflow; source checks and emulation are not wearer passes.
