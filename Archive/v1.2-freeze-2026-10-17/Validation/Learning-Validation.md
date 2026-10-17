# Connected learning validation — 2026-09-20

This increment adds one authored Observation and Scale lesson backed by the canonical `sota-v2` service. It does not claim live model interpretation, educational efficacy, mastery assessment or physical Quest operation.

| Layer | Evidence |
| --- | --- |
| Canonical core | 99 Node tests, including 15 Operator tests: required prediction, valid/invalid evidence, legal stages, source-backed authored content, revision conflicts, durable receipt retries, immutable checkpoint forks, corrupted storage rejection, writer protection and local HTTP boundaries. |
| Existing web frontend | Vite production build and two frontend tests pass. The old Vite demonstration is not represented as the new Operator UI. |
| PC bridge, persistence, HTTP and planner | 76 Python tests: original 49 plus 27 learning adapter checks. Adapter tests use a fake core explicitly; the integration row below uses the real core. |
| New Unity guide | Compiled and ran seven Editor checks in the isolated desktop fixture: bounded plain text, stale revisions, new restored session identity, malformed progress, oversized fields and absent-guide compatibility. |
| Reproducible desktop build | Fresh `Build-DesktopFixture.ps1` run passed 80 core + 7 guide checks and built `Builds/FixtureValidation/AR-Sandbox.exe`. The 25-check integration was then repeated successfully against that fresh executable. |
| Real complete loop | `Run-Learning-Loop.py` runs actual Node + Python HTTP + built Unity Windows player. 25 checks pass; see `learning-loop-results.json`. Includes language-driven scale revision, authoritative evidence, learner prediction/explanation/reflection, save/clear, restarting both services, exact scene restore and checkpoint fork preserving the later completed record. |
| Browser UI | Actual panel and simulation exercised: place block, start, example, prediction, language proposal/apply, runtime scale display, practice evidence, Socratic answer, reflection, completion and source disclosure. |
| Quest authored source | QuestRoomAdapter compiles in Editor and Android conditional branches; QuestBuildSetup compiles against installed Meta/MRUK metadata. Only existing deprecation warnings. No vendor assembly was restored or antivirus protection changed. |
| Quest hardware/native build | No ADB device connected. Native APK import/build was not retried after the prior confirmed Meta AIBlocks quarantine. No new APK, installation, passthrough, controller, room setup or physical-anchor persistence result. |

## Reproduce

In the canonical `sota-v2` checkout:

```powershell
npm ci
npm test
npm run build
npm run test:frontend
```

In this Operator checkout:

```powershell
python -m unittest discover -s ControlService -v
./Build-DesktopFixture.ps1
python Validation/Run-Learning-Loop.py --core-project ../sota-v2
```

The loop uses temporary local data, starts only its own services/player, stops them afterward, and writes a sanitized JSON report. The integration runner needs the compiled Windows player. Source-only Quest checks used existing installed metadata and are not a portable substitute for a clean Android import/build.

## Review fixes and practical limits

Independent reviews found and corrected non-practice actions incorrectly carrying evidence, obsolete receipt replay reactivating prior bindings, and durable receipt content not being checked against its immutable lesson. Tests cover each regression. A successful load acknowledgment also must include a matching scene snapshot before learning restoration; mismatches pause and require explicit recovery. Core writes are atomic and fail closed for malformed stored data; a writer lock plus disk fingerprint prevents stale writers overwriting another service's changes.

Core learning data and PC scene snapshots are separate local stores. A saved scene contains a checkpoint reference, not a full export; back up both. Pending PC mutations are not journaled across PC crashes. After a restart, explicitly load a saved learning scene. Absent or changed real room/anchor UUIDs are not remapped automatically. The [runbook](../Docs/Learning-Sessions.md) explains failed acknowledgments and retry behavior.
