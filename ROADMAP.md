# Matrix roadmap

**Current delivery: published Professor checkpoint v1.3.0-rc.1 and remaining acceptance.** The paired build, source tags and release upload are complete. October 24 documentation/issue review reconciles delivered work without starting another feature sprint. [The candidate guide](Docs/V1.3-Checkpoint.md) records scope and evidence limits. The published v1.2 source remains `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0`; its tag and assets stay unchanged. [The v1.2 guide](Docs/V1.2-Checkpoint.md) and [acceptance record](Validation/V1.2-Headset-Acceptance.md) retain their unresolved checks. [Vision](VISION.md) and [architecture](ARCHITECTURE.md) define the product and module boundaries.

## Reviewed implementation status

Reviewed October 24 against the paired release, merged changes through Matrix
#227 / Professor #12, retained checks and the owner's recorded Quest sessions.
An issue can finish its bounded implementation while broader acceptance remains
in another explicit owner. No frozen H01–H10 result is changed by closing it.

| Owner | Status and remaining boundary |
| --- | --- |
| Matrix #212; Professor #5 | Completed bounded shared-transcript, voice-target and async Operator checkpoint. Broader recovery/integration stays in #187/#31. |
| Professor #7 | Completed short exhibit-led teaching slice, with recorded student turns and adaptive feedback. Not a learning-efficacy study. |
| Matrix #214 / #215 | Implemented catalog/motion/part-attention foundations. Art, failed-avatar-job recovery, per-avatar Quest performance and transition coverage remain. |
| Matrix #211; Professor #4 | Partial local asset reuse/background preparation. Reviewed curriculum templates, independent-session reuse/restore and publication governance remain. |
| Professor #3 | Partial transcript and slow-job bridge. Native streaming voice, automatic turns and barge-in remain unimplemented. |
| Professor #2 | Research proposal; no completed curriculum-authoring evaluation. |
| Matrix #187 / #31 / #32 | Partial embodied teaching and capability foundations. The specified scale-experiment round trip, broader interaction/rebinding and negative cases remain. |
| Matrix #203 / #172 | Partial navigation and persistent floating conversation UI. Full workspace/input coverage and the wrist/pinned-panel design remain. |
| Matrix #24 / #201 | Package and recorded-demo progress. Course rubric, complete delivery materials, identified-release rehearsal and required recovery checks remain. |
| Matrix #173 / #171 / #163 / #158 | Retained partial v1.2 acceptance. Packaging/implementation are present; matched timing, stale/approval/lock/input/recovery cases remain as recorded. |
| Matrix #9 / #20 / #22 / #29 / #148 / #156 | Existing partial content/host/room/citizen foundations or ownership umbrellas. The Professor release does not finish their wider acceptance. |
| Matrix #154 / #177 / #179 / #180 / #181–185 / #186 / #188 / #189 / #195 | Uncompleted broader refinement, research, automation, remote-plugin, wireless or measured-physics scope. Reused components are not those end-to-end outcomes. |

The code-visible recovery finding for direct Operator input and failed-avatar-job
retry remain in #187 and #214 respectively. They are review findings, not new
runtime reproductions in this documentation pass.

## Retained v1.2 acceptance and coursework

The [active v1.2 issue view](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22scope%3A%20v1.2%22) contains six owners:

| Issue | Remaining selected work |
| --- | --- |
| [#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173) | Release acceptance and frozen source/artifact identity. Collect the missing evidence and resolve the current checklist. |
| [#171](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/171) | Matched cold/warm text/voice latency, visible-frame correlation and remaining ordinary placement/edit evidence. |
| [#163](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/163) | Remaining compact-context, creative capability and guard/input acceptance. The bounded five-request creative case already passed. |
| [#158](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/158) | Remaining lock input variants and persistence, including PC checkpoint restoration. |
| [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24) | The current v1.2 setup, release/runbook accuracy, evaluator handoff and required delivery materials. Broader submissions remain future scope. |
| [#201](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/201) | Rehearse and deliver the October 27 Playground creation → interaction → revision → save/reopen demonstration using existing capabilities. |

`scope: v1.2` selects the bounded work above. It does not import every historical or future requirement from a broad issue. Delivery does not create another runtime sprint or pass missing release checks. Actual course requirements remain owned by #24/#201.

Fit-to-room controls and H04 measured-fitting acceptance remain deferred; ordinary AR edits use free placement and explicit measured tools retain their guards. General editing Undo/Redo remains required; lock-policy Undo/Redo is excluded. Preserve existing Citizens/hosted-world compatibility without adding Civilization features to this release.

Reuse completed implementation, package checks and unaffected wearer observations. Collect the remaining physical cases in the existing consolidated session, with exact candidate identity. A later runtime fix needs a separately identified candidate and checks for affected behavior; it must not replace the published v1.2 assets.

## Module backlogs

The other open issues remain outside the frozen v1.2 selection. The owner has now selected the implemented #212 Professor experience for a separate v1.3 release candidate; this does not add requirements to v1.2 or schedule further features. Shared labels on #22, #31 and #156 expose real integration responsibilities; other issues have one module owner.

The broader Professor integration remains partial under #187, while #212 and
Professor #5 finish the bounded conversation/delegation checkpoint. Merged #213–#227
and Professor #6–#12 cover voice/avatar binding, short teaching, catalog/reuse,
per-teacher speech, saved-lesson recovery, named parts, exact selected surfaces,
virtual-view input, direct invention routing and the floating transcript. The
published paired package identifies the precise code and companion build.
Dynamic historical-model generation, curriculum preload, per-model device
coverage and the prescribed interactive scale-lab journey remain unfinished.
No curriculum or Civilization sprint is selected by these completed slices.

| Module / area | Existing issues | Responsibility |
| --- | --- | --- |
| Matrix creation and UI | #9, #154, #172, #185, #203, #211 | Content connectors, progressive refinement, spatial controls, image-guided worlds, workspace consolidation and reusable generated assets. #211 extends the existing catalog/registration paths (#9/#154; completed #28/#91/#122), with School curriculum/preload consumers in [Professor #2](https://github.com/School-of-the-Ancients/sota-professor/issues/2)/[#4](https://github.com/School-of-the-Ancients/sota-professor/issues/4). It adds no v1.2 or October 27 prerequisite. |
| Matrix spatial and presentation | #22, #31, #32, #195 | Generic room access/physics, client-neutral capabilities and interactive exhibits. #22A is Matrix; #22B resident behavior is Civilization. #31 also carries School connection acceptance. |
| Matrix optional clients | #181, #182, #183, #184 | ChatGPT adapter, pairing/hosting and client UI. |
| Matrix access and tooling | #186, #188 | Rendered/input testing and wireless/deployment access. Reuse existing test-runner foundations for v1.2. |
| Matrix research | #177, #189 | Image reconstruction and remote/hybrid glasses compute. |
| School | #187, #212, #214, #215 | Independent historical-mind conversations using Matrix presentation tools; coordinate with [School #7](https://github.com/School-of-the-Ancients/school-of-the-ancients/issues/7). #212 owns the bounded Professor/Operator asynchronous delegation, attributed transcript, voice-target and VRM binding checkpoint through #31/#32. Keep its source/desktop/live-model evidence separate from Quest acceptance and Professor #3's broader full-duplex voice research; no new October 27 prerequisite or v1.2 gate is introduced. |
| Civilization | #20, #29, #148, #179, #180 | Resident state and hosting, agent society, hosted Operator access, Boulder and geographic AR. |
| Shared routing | #156 | Routes longer-term requirements across Matrix, School and Civilization. |

Browse [Matrix](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22module%3A%20matrix%22%20-label%3A%22scope%3A%20v1.2%22), [School](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22module%3A%20school%22%20-label%3A%22scope%3A%20v1.2%22) or [Civilization](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22module%3A%20civilization%22%20-label%3A%22scope%3A%20v1.2%22) future issues. School's product lives in its [own repository](https://github.com/School-of-the-Ancients/school-of-the-ancients); Civilization's code and issues remain here pending a deliberate extraction task. A module need not introduce a new repository, service, renderer or UI tab.

## Keeping the project organized

Select work by changing this short current-work section and the owning issue. Give an implementation slice an observable finish condition and only the dependencies it needs. Close issues only when their actual acceptance is complete, duplicated or explicitly canceled.

Use issues for requirements and PRs for implementation/test evidence. Update the single acceptance record for release status. Replace stale summaries instead of appending another dated plan or progress file. Research and unselected plans remain in the [archive](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/Archive/README.md); they do not override the selected scope. Reuse existing implementation before opening a replacement task.
