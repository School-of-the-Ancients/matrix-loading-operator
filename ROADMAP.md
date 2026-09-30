# Matrix roadmap

Keep this intentionally short. Detailed acceptance belongs in the issue being worked; evidence belongs in `Docs/` and `Validation/`.

## Current release baseline

v1.1.0 is published from `9453ef06b1873937822c1cf985115f05f72e1e20`.
It includes browser sections, active-turn steering, retained raycast points,
and whole-layout AR placement/generated-object bounds. Preserve its supported
behavior and historical validation; do not rebuild those features.

## Now — Matrix v1.2: fast, simple creation

Follow [#173](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/173):

1. #171: correlate submission, context, model/tools, command, receipt and visible
   frame; collect matched v1.1.0 baseline samples before optimization.
2. #163 + #171: compact advisory context and model-directed capabilities; remove
   only unnecessary work while retaining approvals, identity/revision guards,
   physical-placement validation, truthful receipts, Undo and save/reopen.
3. #158: one explicit persisted manipulation lock; select locked scenery,
   deliberately unlock it, and preserve ordinary prop and Play authority.

#154 manual draft/refinement and #172 wrist recall are conditional after the
fast-loop gate. Defer them if that gate is pending or a new subsystem is needed.
V2 #156 and unrelated backlog expansion are outside this sprint.

## Candidate acceptance

Run all available automated checks and record exact before/after sample counts,
settings and limitations. Freeze the candidate, build and smoke an identified
artifact, then perform one bundled local Quest session using
[the durable acceptance record](Validation/V1.2-Headset-Acceptance.md).
Physical VR/AR checks remain pending until wearer evidence exists. Keep
known v1.1 gaps visible. Draft PRs do not authorize a merge or release.
The full release gates remain in #173; none are removed by this runbook.

## Later work

Important, but not blockers for this v1.2 sprint:

- #148 — interactive Operator inside the persistent hosted Citizens world;
- #20 / #29 — deeper persistent Citizens and SwarmWorld-like society work;
- #9 — broader provider/catalog integrations;
- #31 — external/School client-neutral integration;
- #32 — broader reusable experiment capabilities;
- #24 — coursework report/video/slides and later submission packaging.

The existing v0.8 hosted Citizens world remains available as its currently supported read-only visitor experience. Do not claim hosted human editing until #148 passes.

## Work-selection rule

1. Follow #173 and the currently active slice.
2. Continue compatible merged work; do not create a second world, Agent loop, renderer, or asset system.
3. Preserve the v1.1.0 baseline and earlier supported contracts.
4. Prefer one user-visible end-to-end slice over framework expansion.
5. Separate automated/desktop evidence from actual Quest wearer evidence.
6. Keep slices reviewable with draft PRs; do not merge without authorization.
7. New research links go to [RESOURCES.md](RESOURCES.md) unless they create a concrete implementation need.
