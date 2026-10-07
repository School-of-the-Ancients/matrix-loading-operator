# School of the Ancients: professor, experiments and generative Citizens

**Planning snapshot: October 6, 2026. Status: proposal; implementation deferred.**

Build this inside the existing Three.js/WebXR Matrix. The first useful experience is an ancient professor who teaches a short lesson, requests a demonstration through Operator, observes the result, and responds to the learner. Extend that into a small community with memory and plans, then a resident-operated computer that can run a bounded simulation inside the world.

The owner reported a CSCI 4519 midterm on October 7 and a lifelog due October 14. Protect the exam day. The October 14 slice below is a proposed personal demonstration and process record, subject to available time and the actual lifelog rubric; it is not a promised delivery or verified course requirement. This document authorizes no runtime work, service changes, deployment or world mutation.

## Recommended first experience

**One professor, one learner, one exhibit, one meaningful revision, save and return.**

Use a fictional ancient scholar with a clearly identified modern teaching adaptation. A historical persona can follow after School supplies sources and distinguishes historical beliefs from modern explanations. Text interaction comes first, so this works on a laptop without a headset or audio.

Start with the existing **Observation and Scale** lesson direction in [#23](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/23). Its [older lesson guide](Learning-Sessions.md) describes useful lesson/recovery semantics but includes archived Unity instructions: audit the present School API and `ControlService/learning.py` before reusing it. That guide is not proof of a working WebXR professor or deployed School integration.

Suggested exhibit: two cubes, a visible unit grid and dimensions. Ask what happens to volume when each length doubles. The learner predicts; the professor asks Operator to create the exhibit; the learner requests a size change; the professor explains the observed dimensions and eightfold mathematical volume. Label the representation as ideal geometry. Do not claim rendered appearance alone measures volume or establishes learner mastery.

The conversation should feel like this:

1. Learner: "Show me what you mean."
2. Professor requests an allowed scale exhibit. Operator reuses or creates it in a designated exhibit area.
3. The interface shows progress. The professor describes it only after a matching Matrix receipt and current scene inspection.
4. Learner: "Make that cube twice as large."
5. The same entity changes; dimensions and comparison update. The professor asks the learner to explain the result.
6. Save, reopen, and resume the correct lesson stage with the same professor and exhibit IDs.

A later lesson could compare ideal pendulum periods or historical cosmological models. It must carry its assumptions and sources. A new physics engine, arbitrary generated programs, realistic city and photorealistic human are not prerequisites for the scale lesson.

## What already exists, and what must be added

Source baseline inspected: `9931345730805159b34da19168be815236c84679`, matching `origin/main` on October 6. This is a source snapshot, not a claim about the packaged service currently running.

| Area | Existing foundation | Selected addition / remaining boundary |
| --- | --- | --- |
| World | `WebRuntime/` and `ControlService/`: entities, desktop/WebXR views, editing and saves | A lesson exhibit bound to existing entities; preserve unrelated worlds and locks |
| Citizens | Needs, seeded choices, routines, appointments, navigation, relationships and bounded social interactions | Grounded model dialogue, episodic memory and reflection; current social sessions are not general LLM conversations |
| Resident creation | Saved capability journal, policy decisions and receipt-backed construction/procedural/generated-asset paths | A narrowly scoped teaching intent through the existing broker, not unrestricted Creator access |
| Operator | Agent Portal, procedural tools, asset catalog and Blender/import workflows | Carry resident/lesson provenance and enforce exhibit limits through the existing execution path |
| Persistence | Compatible world saves and nested Citizens state; PC host/checkpoints for the bounded Ada/Bo fixture | Professor/lesson references and migrations; arbitrary browser worlds are not already hosted |
| School | Existing compatibility adapter and authored lesson direction | Verify current School lesson/session contract and implementation home; School remains learning-record authority |
| Human appearance | Validated GLB import and bounded embedded animation playback | Reuse one licensed rigged scholar; current clip support is not a full locomotion, gesture or lip-sync controller |
| In-world computer | Ordinary props and bounded numeric runtime components | A sandboxed child-simulation capability is new work; a monitor model alone does not execute programs |

The [Citizens guide](Citizens-Shared-World.md) and [PC host guide](Persistent-World-Host.md) distinguish the interactive browser-owned world from the fixed PC-owned fixture. Choose one authority path per demonstration. Do not attach another simulation clock or migrate the current populated world as a shortcut.

## Architecture: teaching intentions become ordinary Matrix actions

```text
Learner text / later voice
  -> School lesson + professor conversation
  -> grounded observation and a bounded teaching intention
  -> PC-side Matrix capability policy / existing request journal
  -> existing Operator / procedural / asset workflow
  -> authoritative Matrix mutation + exact receipt
  -> observed result -> professor response + supported memory
  -> School lesson event/checkpoint reference
```

Matrix owns generic resident behavior, spatial execution, object identity and runtime evidence. School owns the lesson content, persona sources, conversation pedagogy, assessment and learner records. A local fixture must be labeled as such until real School pairing and deployment are demonstrated. Private lifelog material stays outside public world saves and repository evidence.

### Professor dialogue and memory

- Begin with an authored lesson state machine: explain, predict, request exhibit, inspect, revise, check, recap. Keep it usable when model access fails.
- Give the model the current lesson, selected learner message and a bounded observation of visible entities and accepted events. It may choose only currently legal intentions. Dialogue text cannot itself mutate the world.
- Persist supported professor experience under stable resident/world IDs: event ID, simulation tick, UTC observation time, source/receipt reference and concise content. Link lesson IDs; do not duplicate School's learner record store.
- For the first slice, remember one observed experiment and the learner's selected parameter. Separate learner statements, observed facts and model inferences. No fabricated recollection of an unobserved event.
- Later retrieve by relevance, recency and importance, and create bounded reflections referencing their source events. These additions follow the memory/planning direction of [Generative Agents](https://arxiv.org/abs/2304.03442); transplant ideas rather than its separate town engine.
- Request model reasoning on questions and meaningful events, not each animation frame or simulation tick. Configure inference/concurrency budgets, timeout/cancel and an honest offline response. Select the supported PC-side inference backend at readiness review; existing Creator access is not proof of an NPC dialogue backend.

### Bounded access to the "Codex creator thing"

Reuse the existing Agent Portal and Citizen capability envelope. The professor supplies a structured request; the PC broker decides whether and how Operator executes it. Do not hand a resident Codex/MCP credentials, impersonate the owner, or create another unrestricted chat/queue.

Proposed teaching request fields, to reconcile with the existing schema before coding:

```text
residentId, worldId, lessonSessionId, intentId, requestId,
capability, exhibitId, allowed entity IDs, parameters,
expected revision, policy grant, deadline and budget
```

For the first slice, allow a reviewed scale-exhibit recipe and bounded scale changes to its own entities. Grant one active request, a fixed small entity count, a defined virtual exhibit region and a finite inference/asset budget. Existing entity locks and owner controls remain authoritative. Wider natural-language asset creation can follow when this path is proven.

Use the existing pipeline in this order:

1. Read fresh world/authority state; validate the resident grant, lesson binding, allowed action, IDs and revision.
2. Reserve the existing request slot. If a human Creator turn already owns it, report waiting/busy; do not silently steer that turn or fork a competing writer.
3. Prefer the reusable recipe or procedural tools. Invoke Blender only for geometry the exhibit actually needs.
4. Track request identity through policy, execution and the matching receipt. Cancellation/denial stops the request without advancing the lesson.
5. Inspect resulting entities and parameters before recording success or updating the professor's beliefs.
6. On an uncertain outcome, reconcile the original request and receipt. Do not resubmit as a fresh creation. Stop from the owner UI must prevent subsequent actions from that cancelled intent.

This is a mediated resident capability, not permission for the professor to execute arbitrary Python, JavaScript, shell commands or external communications.

### Appearance and animation

Use a licensed rigged base character with a simple robe/portrait and one validated idle clip. Record source, license, GLB hash, scale, bounds and advertised clips. [Quaternius](https://quaternius.com/packs/universalbasecharacters.html) is a candidate to review, not a selected or already imported asset. Reuse compatible imported content when available. A portrait or stylized stand-in is an acceptable first demonstration.

Blender should adapt costume or build exhibits. Writing human anatomy from primitives is a poor dependency for this deadline. Navigation-to-animation transitions and speech gestures are later work; do not promise them from current `asset_animation.js` playback.

## Implementation slices and order

These are proposed future work packages. No new GitHub issues, assignments or due dates were created by this planning edit. Review current issues/comments and select the smallest owned slice when implementation resumes.

| Slice | Work | Existing ownership | Done when |
| --- | --- | --- | --- |
| P0: readiness | Verify School prototype/API, rubric, model access, capability journal, current saves and a licensed avatar; choose browser-active demo authority | #23, #29, #109, #24 | One runnable plan and fallback, with current dependencies confirmed |
| P1: prepared professor | Text lesson panel, one professor presentation, authored scale activity and current-world observation | #23; School implementation | Complete lesson works without general NPC autonomy; fixture/integration labels are accurate |
| P2: professor requests exhibit | Scoped resident teaching capability -> existing Operator -> current-world receipt -> response; revise same exhibit | #109 and #29; #31/#32 contracts | Request, creation, one revision, denial/Stop and uncertain-outcome recovery have evidence |
| P3: memory and return | One grounded experiment memory, compatible save/reopen, School checkpoint linkage after acknowledged world restore | #29, #23, #20 | Same identities, observed parameters and stage resume; unrelated saved data survives |
| P4: small generative society | Two then three residents, scoped observations, retrieval/reflection, bounded plans and grounded conversations | #29 | Residents remember actual events and coordinate one task without bypassing existing movement/social guards |
| P5: independent living | Generalize supported hosted state, artifacts and authorized Operator path after recovery gates | #20, #148 | One PC owner continues without visitors; restart and rejoin retain IDs/state without duplicate actions |
| P6: resident-operated computer | Bounded sandboxed child simulation displayed through a workstation | Later #29/#156 slice; new narrow issue only when selected | One resident creates/runs/stops a tiny inner simulation within enforced limits |

P1-P3 are the proposed October 14 demonstration ceiling. P4-P6 are later; the larger v2 ordering in [ROADMAP.md](../ROADMAP.md) still applies. This plan does not insert Citizens into #187's v1.3 sprint or replace #173's remaining acceptance.

### Proposed calendar, after the exam

| Date, America/Denver | Suggested activity | Scope cut if time is short |
| --- | --- | --- |
| Oct 6 | Save this plan; no implementation | Completed by this documentation task |
| Oct 7 | Midterm; leave this project parked | No background build or automatic restart scheduled |
| Oct 8-9 | P0 and P1: verify rubric/services and finish one text-first prepared lesson | Keep avatar a portrait; omit voice and navigation |
| Oct 10-11 | P2: one live professor request and one in-place revision | Restrict to the scale recipe, not arbitrary assets |
| Oct 12 | P3 and recovery validation; save/reopen and collect timing/evidence | If integration is blocked, use a labeled local fixture |
| Oct 13 | Freeze the working demo; record process, failures and reflection | Stop feature work; record the actual supported path |
| Oct 14 | Submit the lifelog in the instructor's required format | Claim only demonstrated behavior |

Fallback: a prepared exhibit with the professor guiding the learner and the human explicitly triggering Operator. Label this **human-assisted creation**, not autonomous NPC tool use. If only P1 is stable, that is a coherent process result; do not simulate successful tool calls in a recording.

## Later: the simulation inside the simulation

The desired experience is a professor or resident using a visible computer to construct a small agent experiment, observe it and explain what changed. This does not require emulating a physical CPU or moving Matrix to Unreal.

Implement the first version as an explicitly separate **child experiment**, attached to a workstation entity in the existing outer world. Its agents/state have a child experiment ID; they do not become a second authority for Matrix objects. A displayed canvas/texture or panel presents its results. The outer world retains its existing owner and clock; the child has an explicit bounded timestep controlled by the experiment job.

Start with a declarative recipe, for example three inner agents sharing a limited food supply. The resident chooses a policy, predicts an outcome, runs a finite number of steps and compares results. Make this deterministic and replayable before allowing generated source code.

If generated programs become part of the experience, add a dedicated isolated worker/process boundary: narrow input/output schema, allowlisted packages, no owner credentials or unrestricted filesystem/network, memory/CPU/runtime limits and owner Stop. Browser workers alone do not establish a sufficient boundary for arbitrary code. Require review/validation and a narrow execution grant, not the current numeric-component interpreter as a loophole. Start with nesting depth one and a tiny agent budget.

Persist recipe/code hash, seed, version, resource limits, results and source event links. Keep inner reasoning and events distinguishable from outer-world observations. The professor must say "this inner model produced..." rather than treating an inner outcome as measured real-world truth.

Matt Shumer's [3D-world workflow](https://somethingbig.ai/3d-worlds) and [review](https://somethingbig.ai/astra-review) provide build-process and AI-resident inspiration, not a published drop-in Matrix NPC runtime. Use their reference/assets/assembly/critique approach for authoring. Build workers and in-world Citizens are separate roles. The exact implementation of the reported recursive-computer demo has not been verified here; this section is our proposed architecture, not a reconstruction of his unpublished code. The reported NYC example is also an unverified reference; it does not replace the repository's bounded Boulder direction (#179/#180).

## Evidence and completion checks

For P1-P3, keep a concise run record keyed by source/build, world, professor, lesson and request IDs. Record wall-clock UTC timestamps for submit, policy decision, dispatch, receipt and observed result; record simulation ticks separately. Measure dialogue latency separately from exhibit creation and human waiting. Do not derive a total duration from unrelated job timestamps.

- The learner can complete the text lesson without audio or a headset.
- A live professor request is distinguishable from an authored script, a human action and an offline fallback.
- Creation and revision have matching receipts and observed parameters; the revision preserves exhibit identity and unrelated entities.
- Denied policy, missing asset/model, stale revision, competing writer, timeout and Stop produce honest recoverable states without fake lesson progress or duplicate creation.
- Save/reopen restores supported resident/experiment state; School restore happens only after the world acknowledges the correct restore. Preserve the separate scene and learner-record backups.
- A future hosted claim additionally requires visitor closure, host restart and rejoin evidence. A browser-active professor demo does not establish independent living.
- Record desktop, actual model, service receipts and any real Quest wearer evidence separately. Desktop is sufficient for the proposed laptop demo, subject to the 4519 rubric; it does not pass existing physical-room release gates.
- Lifelog evidence should show the actual process: goal, baseline, attempts, generated/reused content, one working interaction, observed failure/recovery and reflection. Confirm required submission media and privacy boundaries before recording. Any future learner pilot needs actual participants; no educational efficacy claim comes from a completed dialogue.

Meaningful implementation tests should target policy/identity/receipt handling, cancelled and ambiguous requests, compatible persistence and lesson recovery, followed by the one complete browser journey. Run only affected suites and required repository checks. Planning edits need link checks and `git diff --check`, not a headset session.

## Resume point

After the midterm, begin with P0: inspect the active source/runtime, inspect the current School prototype and rubric, and choose the **prepared professor + scale exhibit** slice. Preserve all existing worlds. Do not begin with a city, a full multi-agent framework or the recursive computer.

Related: [vision](../VISION.md), [architecture](../ARCHITECTURE.md), [roadmap](../ROADMAP.md), [research references](../RESOURCES.md), [Citizens](Citizens-Shared-World.md), [persistent host](Persistent-World-Host.md), [v1.2 acceptance](../Validation/V1.2-Headset-Acceptance.md).
