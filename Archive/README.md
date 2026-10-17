# Archive

The active repository keeps v1.2 requirements, operating contracts, build tools, executable checks and required fixtures. Older progress records, generated validation output, research and unselected plans are preserved in the **pre-freeze snapshot**:

- [Browse the complete snapshot](https://github.com/School-of-the-Ancients/matrix-loading-operator/tree/60ab4599752147f2e590293208bee4692965a524)
- Preservation branch: `archive/pre-v1.2-freeze-2026-10-17`
- Exact commit: `60ab4599752147f2e590293208bee4692965a524`

Links below use the commit so they continue to identify the same files even if branches move. Original paths, evidence bytes and relative links are intact inside that snapshot. It includes work after the published v1.2 release; **the v1.2 source remains `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0`**.

## Find historical material

| Material | Preserved location |
| --- | --- |
| Build/progress chronology | [Current Checkpoint](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Current-Checkpoint.md), [Progress Log](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Progress-Log.md) |
| Historical runbooks and plans | [Docs directory](https://github.com/School-of-the-Ancients/matrix-loading-operator/tree/60ab4599752147f2e590293208bee4692965a524/Docs) |
| Validation logs, screenshots, saved outputs and candidate evidence | [Validation directory](https://github.com/School-of-the-Ancients/matrix-loading-operator/tree/60ab4599752147f2e590293208bee4692965a524/Validation) |
| Full v1.2 candidate chronology | [Acceptance record before cleanup](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Validation/V1.2-Headset-Acceptance.md) |
| Interface inventory and proposed creation journey | [Modular UX plan](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Matrix-Modular-UX-Plan.md) |
| School reference integration and teaching proposals | [Integration plan](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/V1.3-Implementation-Plan.md), [School plan](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/School-Generative-Agents-Plan.md) |
| Civilization and Boulder proposals | [Boulder PRD](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Matrix-Boulder-PRD.md), [Boulder MB0](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Matrix-Boulder-MB0.md) |
| Existing October 27 demo runbook | [Playground rehearsal](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Matrix-Playground-Demo-2026-10-27.md), supporting delivery issue [#201](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/201) |
| Broader coursework proposals | [Semester plan](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Semester-Convergence-2026.md) |
| Research collection | [Resources](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/RESOURCES.md), [research notes](https://github.com/School-of-the-Ancients/matrix-loading-operator/tree/60ab4599752147f2e590293208bee4692965a524/Docs/Research) |
| Later #207 Operator handoff evidence | [October 17 JSON](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Validation/Operator-Creation-Handoff-2026-10-17.json) — subsequent candidate, outside the published v1.2 package |
| Unity implementation | [Existing Unity archive](Unity/README.md) |

## What the cleanup means

The cleanup removes 38 of 52 `Docs/` files and 221 of 242 `Validation/` files from the active branch. It retains the five documentation files required by the release builder, the client API fixture, all 19 existing Validation Python tools/tests, runtime source and test inputs. The current v1.2 acceptance ledger remains active; its older chronology is preserved above.

New validation output is ignored by default. Executable checks, the current ledger and explicitly retained fixtures remain versioned; add any genuine new fixture deliberately with its owning change.

Archived files are reference material; [the roadmap](../ROADMAP.md) and the owning issue decide current scope. The preserved October 27 runbook still supports selected delivery issue #201. Future proposals remain unselected unless the owner chooses a slice. Archival does not mean a feature was implemented, canceled or rejected. Valid future issues stay open under the Matrix, School and Civilization labels in [the module backlogs](../ROADMAP.md#module-backlogs).

Use GitHub's snapshot view to read or download an old file. To recover one file into a local checkout for inspection, use `git show 60ab4599752147f2e590293208bee4692965a524:path/to/file`. Restoring historical instructions to active use requires reconciling them with the current scope and implementation. Keep future build logs and progress evidence in their owning issue/PR instead of repopulating the active source tree.
