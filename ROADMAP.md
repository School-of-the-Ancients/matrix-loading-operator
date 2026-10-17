# Matrix roadmap

**Current selection: finish and deliver the frozen v1.2 checkpoint.** Its implementation is merged. The published source is `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0`; current `main` includes later work. [The checkpoint guide](Docs/V1.2-Checkpoint.md) owns release requirements, dependencies and identity. [The acceptance record](Validation/V1.2-Headset-Acceptance.md) owns H01–H10 and their evidence. [Vision](VISION.md) and [architecture](ARCHITECTURE.md) define the product and module boundaries.

## Current work

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

The other 24 open issues are retained as future work. No next release or implementation sequence is selected by this table. Shared labels on #22, #31 and #156 expose real integration responsibilities; other issues have one module owner.

| Module / area | Existing issues | Responsibility |
| --- | --- | --- |
| Matrix creation and UI | #9, #154, #172, #185, #203 | Content connectors, progressive refinement, spatial controls, image-guided worlds and workspace consolidation. |
| Matrix spatial and presentation | #22, #31, #32, #195 | Generic room access/physics, client-neutral capabilities and interactive exhibits. #22A is Matrix; #22B resident behavior is Civilization. #31 also carries School connection acceptance. |
| Matrix optional clients | #181, #182, #183, #184 | ChatGPT adapter, pairing/hosting and client UI. |
| Matrix access and tooling | #186, #188 | Rendered/input testing and wireless/deployment access. Reuse existing test-runner foundations for v1.2. |
| Matrix research | #177, #189 | Image reconstruction and remote/hybrid glasses compute. |
| School | #187 | Independent historical-mind conversations using Matrix presentation tools; coordinate with [School #7](https://github.com/School-of-the-Ancients/school-of-the-ancients/issues/7). |
| Civilization | #20, #29, #148, #179, #180 | Resident state and hosting, agent society, hosted Operator access, Boulder and geographic AR. |
| Shared routing | #156 | Routes longer-term requirements across Matrix, School and Civilization. |

Browse [Matrix](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22module%3A%20matrix%22%20-label%3A%22scope%3A%20v1.2%22), [School](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22module%3A%20school%22%20-label%3A%22scope%3A%20v1.2%22) or [Civilization](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22module%3A%20civilization%22%20-label%3A%22scope%3A%20v1.2%22) future issues. School's product lives in its [own repository](https://github.com/School-of-the-Ancients/school-of-the-ancients); Civilization's code and issues remain here pending a deliberate extraction task. A module need not introduce a new repository, service, renderer or UI tab.

## Keeping the project organized

Select work by changing this short current-work section and the owning issue. Give an implementation slice an observable finish condition and only the dependencies it needs. Close issues only when their actual acceptance is complete, duplicated or explicitly canceled.

Use issues for requirements and PRs for implementation/test evidence. Update the single acceptance record for release status. Replace stale summaries instead of appending another dated plan or progress file. Research and unselected plans remain in the [archive](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/Archive/README.md); they do not override the selected scope. Reuse existing implementation before opening a replacement task.
