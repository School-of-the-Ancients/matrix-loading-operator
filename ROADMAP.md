# Matrix roadmap

Detailed requirements and acceptance stay in their owning issues; exact-build evidence stays in `Docs/` and `Validation/`. This roadmap organizes the 28 open issues reviewed on October 1, 2026. Issue-based milestone placement is planning metadata, not proof of implementation or release acceptance. No dates are promised for undated work.

## Current baseline and acceptance gate

[v1.1.0](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.1.0) is the published baseline at `9453ef06b1873937822c1cf985115f05f72e1e20`. Preserve its supported behavior and earlier contracts. The old v0.8/v1.0 plan remains in [repository history](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/9453ef06b1873937822c1cf985115f05f72e1e20/ROADMAP.md) and #152; completed features are not new prerequisites.

**Now: v1.2 fast, simple creation, #173.** #171 measures the complete Creator path; #163 + #171 simplify context and unnecessary serial work; #158 adds deliberate persisted object locks; #174 owns batched acceptance and evidence reuse.

The open draft stack is #175 → #176 → #178 → #192 → #193 → #194 → #196. The October 4 local review uses `v1.2.0-core-candidate.8`, frozen source `c9364ffaa0e3e73ac88b08c531c8a3681c386741`; its corrections cover approvals/session controls, optional room fitting, XR lock-control visibility and one Codex speech destination. Review findings, live creativity/speech, matched latency and all required exact-artifact Quest checks remain gates. Prompt-size reductions and automated tests do not establish wearer speed or acceptance. Recheck the actual candidate before testing. This document does not update the PR description or authorize merge/release.

Run the full applicable suites, production build and reproducible packaging checks on the final source, smoke the extracted artifact, then use one consolidated wearer session and the durable [v1.2 acceptance record](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/c9364ffaa0e3e73ac88b08c531c8a3681c386741/Validation/V1.2-Headset-Acceptance.md). Preserve unchanged evidence; invalidate only affected checks with a reason. Retain failed, blocked and unrun gates.

## Next: v1.3 image to polished world

[#187](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/187) is the bounded sprint contract after v1.2 review and acceptance. Planning can proceed without claiming a reviewed or accepted integrated baseline.

1. A bounded #186 local Quest runner: readiness, logs, load/transforms/save-reopen and truthful pass/fail/blocked evidence. Broader automation remains open; it is not all a prerequisite to authoring.
2. #185: upload a real reference or describe → generate variants → explicitly select one; pass its actual pixels and provenance to the existing Operator. Audit and reuse completed #91.
3. One polished, editable autumn trail bend with walkable 3D foreground, measured Quest budgets and reference-versus-runtime comparison. Obtain actual owner images 7699.jpg, 7701.jpg and 7703.jpg; they are not attached to #185.
4. One manual #154 in-place refinement, retaining identity/lineage, locks, transforms, unrelated edits and saved state. Failed/stale refinement must not damage the draft.

#185 and #186 remain full-scope owning issues. Their v1.3 membership covers only #187's selected slice and does not close their wider acceptance. #154 stays in the later-quality milestone because its full automatic/overnight queue is deferred. No georeconstruction, Citizens, new renderer or second queue enters this sprint.

## Separate access workstream

#188 owns this order, without expanding v1.3:

1. Trusted authenticated HTTPS LAN URL with USB unplugged, the current PC service and local Quest rendering.
2. Compatible setup migration to Windows 3660, after live readiness checks and verified save/catalog recovery.
3. Authenticated off-site school access, tested on the actual school network; a hotspot is separately labeled fallback.
4. Optional GPU streaming only after measured need and feasibility.

Origin migration needs authored-state export/recovery and possible room re-registration; old anchors do not automatically transfer. LAN connectivity does not require WebGPU, CloudXR or remote rendering. Credentials stay computer-side, privileged routes stay protected, and security/network/deployment changes require their own authorization.

## Deferred delivery and research tracks

| Issue-based roadmap track | Open issues | Sequencing and boundary |
| --- | --- | --- |
| v1.2 Fast simple creation | #158, #163, #171, #173, #174 | Active core acceptance only; exact-build gate above |
| v1.3 Image to polished world | #185, #186, #187 | Next bounded sprint; full umbrella acceptance remains visible |
| Wireless access and hosting | #188 | LAN → 3660 → school; optional streaming later |
| ChatGPT integration | #181, #182, #183, #184 | #181 existing capability adapter + #182 secure pairing/tool journey before #183 UI; reuse #31 |
| Later creator quality and content | #9, #154, #172 | Broader catalogs, automatic refinement and wrist/full-panel UX; one manual #154 slice only is in v1.3 |
| v2 Connected inhabited worlds | #20, #22, #29, #31, #32, #148, #156, #180 | Persistent Citizens/shared authority, client-neutral/School experiments and one-block Boulder prototype; select small slices later |
| Research and feasibility | #177, #179, #189 | SAM 3D, geospatial source/location/alignment study and hybrid glasses compute; research is not committed runtime delivery |
| Coursework and release delivery | #24 | Exact artifacts/runbooks plus report/video/slides; verify course dates/rubric before scheduling |

Milestones are tracked as GitHub issues, following the existing repository convention. #173 owns the active sprint, #187 the next sprint, #184 ChatGPT integration, #188 access/hosting and #156 the later v2 roadmap. The thematic rows above are roadmap groupings, not new native GitHub Milestone objects or eight additional tracker issues. The owning issues remain authoritative for detailed scope and acceptance.

### Important cross-track dependencies

- #31's existing client-neutral contract supports #181–184. Do not move its broader School acceptance into the ChatGPT sprint or rebuild local capabilities.
- #20 supplies remaining replay/recovery/performance work; #29 owns broader Citizens; #148 adds authorized Operator access to the same PC-owned world. The hosted read-only Ada/Bo visitor remains read-only until its explicit gates pass.
- #22 retains wider room tracking/recovery/accuracy and room-aware Citizen acceptance. Reconcile existing #149/#167 evidence instead of rebuilding shipped placement. Only relevant regressions belong in the current checklist.
- #32 extends one shared experiment truth across clients; #9 extends validated content provenance/capabilities. Existing implementations are foundations, not claims that all acceptance is complete.
- #179 researches source licensing, location contracts and geospatial registration before #180's one permission-cleared Boulder block. #180 also depends on shared Citizen/world identity and measured alignment. GPS uncertainty is not a movement grid.
- #185's artistic trail scene is distinct from #180's georeferenced shared street. #177 is optional asset feasibility, not a dependency of the selected image-to-world slice.
- #189 follows #188's immediate wireless path and evaluates local/remote/hybrid presentation on verified devices. Neither XREAL support nor remote rendering is presumed proven.
- #156 remains the v2 north star: gameplay → Citizens capabilities → two-human shared authority → portals → School → bounded personal-state bridge → deeper geospatial overlay. Its older v1.0 prerequisite is satisfied only by actual release history; current work still preserves the v1.2/v1.3 gates.

## Issue intake and work selection

1. Review the full new/changed issue and relevant comments, current milestone issues, sprint trackers, related PRs and existing implementations before assigning it. Reuse an existing issue-based milestone where it already owns the outcome.
2. Classify by user-visible outcome and dependency, not recency: active blocker, explicitly selected next slice, separate access/integration, later capability, research, or delivery evidence.
3. Add to the active sprint only when explicitly selected or a genuine existing acceptance blocker; flag any material scope decision. Uncertain scope belongs in later/research, without invented dates.
4. For broad umbrellas, record the bounded sprint slice and deferred remainder. Do not imply the full issue is completed, automatically close/reopen it, or silently discard requirements.
5. Preserve one WebXR world, Operator, capability/receipt boundary and asset/persistence path. Keep approval, identity/revision, Creator/Play and truthful evidence contracts.
6. Keep automated/desktop, emulated XR, actual Quest automation and wearer observations distinct. Documentation refreshes alone do not trigger another headset loop.
7. Make narrow reviewable roadmap changes, retain history, verify writes, and report meaningful changes or blockers. Organization does not authorize implementation, merge, release, deployment or permissions changes.
