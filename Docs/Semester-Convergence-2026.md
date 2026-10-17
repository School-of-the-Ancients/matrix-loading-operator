# Fall 2026: one Matrix platform, distinct course contributions

Decision record: October 16, 2026, America/Denver. Captures the owner's choices in the planning conversation. Dates below are coursework planning targets from that conversation, not newly verified rubrics or instructor approval. This document changes no running service, world, permissions, release, or acceptance result.

**Build order: polish the existing Playground demo -> one working professor and exhibit -> two generative Citizens -> an optional digital-self observation feed.** The ML coursework proceeds independently in parallel; it must not wait for the world integration.

## October 17 release-planning follow-up, America/Denver

The [v1.3 implementation plan](V1.3-Implementation-Plan.md) now proposes the
professor/exhibit loop as the next release outcome under #187. It connects the
existing School lesson and records to WebXR, then advances to two residents.
This explicitly changes the earlier separate image-world sprint ordering
referenced below; #185/#154 retain that work and its acceptance. The course
delivery order, October 27 demo scope, product ownership and #173's remaining
acceptance are unchanged.

## UX organization follow-up — October 17 UTC

The [modular UX and guided-lesson plan](Matrix-Modular-UX-Plan.md) records the
owner's subsequent simplification direction: one Operator journey, Create/Play,
contextual controls, and distinct Matrix/Citizens/School responsibilities.
Apply the focused UI cleanup as upcoming increments are selected; it does not
add a rewrite or professor dependency to the October 27 demo. The professor
remains the first complete learning experience. Its world changes use reviewed,
bounded capabilities; a lesson role does not grant PC privileges or imply an
implemented autonomous lesson-session permission.

## Selected outcomes

| Deliverable | Target | Distinct contribution |
| --- | --- | --- |
| CSCI/ATLS 4616 Project 2 | October 27 | A better, rehearsed Matrix Playground demonstration using the existing faster creation/editing loop, meaningful interaction, and save/reopen. No new product or NPC dependency. |
| CSCI/ATLS 4616 final | December 1 | School of the Ancients: an embodied professor teaches a short lesson, requests interactive materials, observes manipulation, and resumes the lesson in WebXR. Emphasis: the spatial learning experience. |
| ATLS 4519 / CSCI 4830 final | December 2 | Extend the same professor into a small generative-agent world with individual memories, grounded dialogue, plans, and an actual evaluation. Emphasis: agent behavior, not another rendering engine. |
| CSCI 4622 project | Follow the actual ML project deadlines | Preserve the existing ExtraSensory smartphone activity-classification project. Independently produced predictions can later supply the Manfred/Demerzel digital-self interface. Matrix integration is a separate consumer, not a replacement for ML evaluation. |
| CSCI 3104 application | No additional graded deadline asserted | Use graph algorithms for Citizens' routes and optional infrastructure planning. This is an application of course knowledge, not a claim that Algorithms has a new project requirement. |

Sharing a platform does not make the submissions interchangeable. Confirm permitted reuse and the exact WebXR/MR requirements with the instructors; identify the new contribution and evidence for each submission. The owner has reported a no-generative-AI policy for 4622. This plan does not authorize AI-generated ML coursework, training code, results, or submission prose; obtain explicit permission where needed. Other course policies must also be checked and followed.

## Current foundation: reuse, do not rebuild

Repository review baseline: `1057d72842844fdddc87735f9bcabacfae995587` on October 16. The live installation has not been inspected in this planning pass.

- [#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173) records merged v1.2 compact-context, point-movement, locks, approval, speech, and tracing work. Remaining exact-package Quest and matched-latency acceptance is still open. Release metadata is not acceptance evidence.
- The owner reports placement falling from minutes to seconds after removing unnecessary surface profiling and simplifying prompts. Blender-heavy creation can still take minutes. Treat this as wearer-reported improvement, not a benchmark or a guarantee for every request. Preserve the fast ordinary-edit path and measured-operation guards.
- [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24) already owns coursework packaging and evidence. [#171](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/171) owns latency; [#186](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/186) owns the existing test runner. Do not create replacements for either.
- [#187](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/187) remains the separate gated image-to-polished-world sprint. A polished class presentation does not require completing all of #185, #186, or #154 first, and does not close their acceptance.
- [#32](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/32) already has the shared Block Scale Lab foundation. Generic immersive controls and observations belong there; do not implement the experiment math separately for HTML, WebXR, and agents.
- [#109](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/109) is closed as completed and provides a bounded resident-creation foundation. Audit its implemented contract rather than rebuilding resident tool access.
- [#23](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/23#issuecomment-5853402985) was closed to avoid duplicating School's backlog in Matrix, not as proof of a complete professor. School still owns teaching, curriculum, and learner records. Do not automatically reopen it.
- [Draft PR #200](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/200) contains separate research documentation. This plan neither merges it nor depends on its proposed integrations.

This delivery overlay supersedes the proposed October 8-14 work calendar in [the October 6 professor plan](School-Generative-Agents-Plan.md) for future planning; it does not claim that the earlier proposed work was completed. Its architecture and historical evidence remain useful. The broader [roadmap](../ROADMAP.md), [agent rules](../AGENTS.md), and owning issue acceptance remain in force.

## 1. Now: a reproducible Matrix Playground demo

Use October 17-26 to improve the presentation and reliability of what already works. Follow [the October 27 runbook](Matrix-Playground-Demo-2026-10-27.md).

The audience journey is: enter a prepared world -> make one real fast edit -> interact -> revise the same object -> save and reopen. Choose an existing scene that rehearses well; a new fantasy village, reconstructed Boulder, or elaborate classroom is not required.

Show a deliberate contrast between **placing/editing an available asset** and **generating a new Blender asset**. Use the owner's preferred ultrafast configuration when actually available, recording its exact model/settings and approval mode. Do not claim that cached placement measures new-asset generation or that a time-compressed video is real-time performance.

Keep this work scoped to demo content, reproducible setup, presentation materials, measurement, and concrete defects encountered in the existing loop. Do not restore mandatory per-surface profiling. Do not pull autonomous Citizens, live GPS, a new network deployment, or the entire #187 sprint into the October deadline. Preserve the single [v1.2 wearer checklist](../Validation/V1.2-Headset-Acceptance.md); do not reset it or mark blocked checks passed to meet a class date.

## 2. First new feature after the demo: one professor, one exhibit

**Recommended initial implementation slice:** finish the missing immersive interaction/observation surface for the existing Block Scale Lab under #32, then connect one text-first professor through the existing client-neutral and resident-capability boundaries (#31, #29, completed #109). Audit the current source before selecting exact files or declaring an endpoint available.

A complete small experience:

1. The learner predicts what happens to a cube's volume when each length doubles.
2. The professor requests the bounded scale exhibit through Operator.
3. Matrix validates the request and returns an execution receipt; the professor inspects the current exhibit before describing success.
4. The learner changes the cube using an immersive control or a supported bounded request. The same entity and shared experiment state update.
5. The professor explains the observed dimensions and the mathematical volume ratio, distinguishing ideal geometry from a measured physical experiment.
6. Save and reopen. The same professor/exhibit identities, lesson stage, and one supported interaction memory return.

The visible professor may initially be a simple licensed avatar or clearly labeled stand-in. Do not make photorealism, lip sync, free-roaming navigation, arbitrary physics generation, or live voice prerequisites for the first loop. The final 4616 experience still requires actual headset interaction and any instructor-required room grounding, not only a laptop transcript.

Matrix owns generic world actions, observations, identity, and Citizens. School owns lesson content, pedagogy, assessment, and learner records. A local demonstration fixture must be identified as a fixture until real School pairing works; do not imply that a local lesson panel establishes production School integration.

**Acceptance for the bounded slice:** create, revise, inspect, and resume work with matching identities and receipts; failed/denied/stale requests do not advance the lesson; the professor does not recall an unobserved event. Verify automated, desktop, live-model, and wearer behavior separately. A scripted fallback is useful, but is not evidence that generative behavior passed.

## 3. Extend the professor into generative Citizens for 4519

Start with **two residents**, not a whole city: the professor and an assistant/learner. Add a third only after the two-agent loop is stable.

Give each resident its own bounded observation history and retrieved memories. A useful demonstration is selective knowledge: the professor witnesses an exhibit change; the other resident initially does not know it; a recorded conversation conveys the information; the recipient then changes a plan. Link recollections and inferences to their source events. Do not inject every event into every agent and call that social learning.

Reuse [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29), normal world actions, and compatible persistence. Make model calls on meaningful events or decisions, not every movement/render frame. Set explicit call/concurrency budgets and truthful timeout/cancel behavior through existing mechanisms.

Suggested evaluation, not a course-mandated sample size: 10-20 scripted cases, including known events, unobserved events, save/reopen, communication, blocked actions, and changed goals. Compare the same model/settings with and without episodic retrieval; keep task inputs matched and report variation across repeats. Record grounded recall, unsupported claims, task completion, action failures, latency, and model usage. Use actual logs and outputs, not invented scores. A small evaluation is evidence about the tested prototype, not proof of human-like understanding or general educational effectiveness.

For the first demo, use one supported world owner and an explicitly described lifecycle. Browser-session persistence is not independent living after all browsers close. Broader always-on hosted interaction remains with [#20](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/20) and [#148](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/148); the existing hosted visitor stays read-only until its authorized path is implemented and accepted.

## 4. Digital-self input: the 4622 / Manfred / Demerzel connection

The selected vision is an authorized observation feed, not a second world simulation:

```text
phone sensor observations -> independently developed 4622 activity classifier
phone location -----------> private Manfred/Demerzel context boundary
                            -> permitted, timestamped observation
                            -> Matrix digital-self presentation
                            -> observations available to selected Citizens
```

An activity prediction and a GPS fix are separate evidence. They do not reveal thoughts, prove an intention such as studying, or establish exact headset/room alignment. ExtraSensory training data does not itself provide a working live phone sensor pipeline.

Build the integration in stages: **clearly labeled synthetic/replayed observations first**, then independently produced classifier output, then a separately authorized live phone session. Do not publish real routes, account memories, room scans, or the full LLM wiki brain as demo fixtures.

Proposed contract fields to reconcile with [#31](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/31) and [#179](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/179), not an implemented endpoint:

| Concern | Required information/behavior |
| --- | --- |
| Identity and origin | Version, observation ID, source/session, sequence, authorized subject reference, and live/replay/synthetic flag. |
| Activity | Supported label(s), model/version, input-window time, score and its meaning. A model score is not automatically calibrated confidence. |
| Location | Its own capture time, coordinate system, explicit units, horizontal uncertainty; optional altitude/heading only with source and uncertainty. Global coordinates are not a local XR pose. |
| Freshness | Observed/received times and expiry; reject or mark stale/out-of-order updates rather than silently moving the avatar from old data. |
| Permissions | Selected recipients, visible sharing state, stop/revoke, and retention/deletion rules covering derived NPC memories as well as the transport feed. Default to synthetic or coarse location for public demonstrations. |
| Separation | Observations cannot silently overwrite authored objects or an independently controlled virtual avatar. Label physical observation, model inference, and simulated state distinctly. |

GPS-to-local-world registration and a genuinely georeferenced world remain under #179/#180. An artistic demo scene is not a surveyed map. Raw private context stays outside Matrix; a Citizen gets only observations its grant permits. Live capture or streaming requires a separate explicit user action, not merely merging this plan.

## 5. Algorithms: make existing Citizens planning visible

Use the current navigation/planning foundations before introducing another pathfinder or planner.

- **Shortest paths:** a resident chooses a destination, a bounded graph search computes a legal route, and the movement controller follows it. Show route/cost and a controlled obstacle-change replan. Dijkstra handles nonnegative weighted edges; any A* comparison must state its heuristic assumptions and use the same graph and costs.
- **MST:** optionally connect several generated locations using minimum-total-cost infrastructure. This is a network-design problem, not a shortest route from A to B; the tree's route need not be the shortest available route.
- Keep LLM goal selection distinct from deterministic route execution. Blocked/unreachable targets must not produce a false arrival or conversation receipt.

A route overlay or small comparative experiment is a useful extension after the professor works. Do not add a general GOAP rewrite, city generator, or MST system merely to mention every algorithm in the coursework portfolio.

## Personal assistant and hardware boundaries

The owner's Demerzel/Manfred goal is an assistant using the user's **ChatGPT account context and memory**, not silently replacing that with an unrelated API memory database. The owner describes VisionClaw/OpenClaw/Gemini as a reference prototype with a different memory/backend arrangement; this document does not independently verify that project's current capabilities.

Keep this as a separate integration investigation. Authenticate only through supported, user-authorized mechanisms; do not extract credentials or assume signing in to Codex grants access to ChatGPT personal memory. The [#184](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/184) Matrix-as-a-ChatGPT-client integration is not proof of personal-memory export. Verify an actual supported context path before making a promise. Agent demo memory must remain explicitly distinct from account memory.

Skyrim AI/VR is a reference, not a required engine port. Aura arrival, SDK access, live glasses sensing, remote rendering, robotics, and a full always-on society remain optional later work. Use the existing Quest/desktop route for required submissions. No purchases, new paid inference budget, device migration, account connection, or deployment are selected here.

## Handoff and scope cuts

- **October 17-26:** execute the Playground runbook. Aim to finish content by October 24, record by October 25, and finish/check presentation materials by October 26. These are suggested preparation targets, not scheduled automations.
- **After October 27:** take the #32 immersive exhibit / one-professor slice first. Aim for a runnable core before early-November exam work; do not trade away correctness to force a date.
- **Then:** add the second resident and collect evaluation evidence while developing, rather than postponing all tests until the finals week.
- **Parallel:** keep 4622 work and its deadlines independent. The Matrix-side replay contract can precede a live data integration without claiming ML results.
- **Before December 1-2:** freeze each distinct submission, rehearse, record, and check the actual required report/video/slides. Cut extra residents, live GPS, advanced animation, or new hardware before cutting evaluation and reproducibility.

Next-task ownership stays in existing issues: #24 for delivery, #173/#171 for the current acceptance/latency evidence, #32/#31 for generic exhibit/client capabilities, #29 for generative Citizens, and #179/#156 for the later personal-state bridge. A scoped delivery child issue is not a new release sprint. Use draft PRs; do not merge, release, deploy, reset a world, or close umbrella issues from this planning change.
