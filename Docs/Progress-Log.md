# AR Sandbox durable progress log

## 2026-09-20 — Quest Pro prototype continuation

User priority: Quest Pro with manually configured room data; Quest 3 optional. Meta MRUK samples take precedence over further VaM investigation. Bundled prefabs only. Acceptance: load real room → spawn → revise through natural language → PC save → clear → restore in one running app.

Baseline: existing Unity 6000.6.0f1 project, Core/MRUK 205.0.0, three bundled props, stable object IDs, anchor-local transforms, PC HTTP service, desktop fixture. Earlier desktop tests passed; native Android import was blocked by Malwarebytes quarantining generated AIBlocks assemblies. User reports adding Meta Core to allow list. No security settings changed by the agent.

Initial live check: no Unity Editor process and `adb devices -l` lists no headset. Hardware tests therefore pending; recheck after build. No Unity MCP available; use Editor batch entry points and actual-player HTTP tests.

Ownership to prevent conflicts:
- MRUK agent: QuestRoomAdapter.cs, QuestBuildSetup.cs, Docs/MRUK-QuestPro.md.
- Runtime agent: SandboxData/World/App, DesktopControls, SandboxCoreChecks, Docs/Runtime-Editing.md.
- AI agent: new ai_adapter.py, test_ai_adapter.py, Docs/AI-Integration.md.
- Coordinator: PC bridge/service/UI/persistence, generated assets/settings, build/install, integration tests, this log and final handoff.

Next: verify native compilation, add state-bound natural-language proposals and offline constrained language mode when no provider is configured, test complete loop, compile/build APK, install only if a headset becomes available. Credentials must stay server-side and out of logs/project files.

### Implementation and first build attempt

- MRUK now follows the installed ImmersiveSceneDebugger's explicit `OVRScene.RequestSpaceSetup` then device V1 reload flow. Left grip + Y opens native room setup; Y retries. Stale room targets are invalidated on failure. Pro is primary; high-fidelity/depth are unnecessary.
- Runtime repairs preserve the selected object when a different one is deleted, reject invalid selections, validate a replacement world before disposing the old one, and expose room invalidation. Core suite expanded to 80 checks (source compiled; Editor run pending).
- PC service now binds proposals to the current runtime session and scene/selection revision, expires them after two minutes, and rejects stale/replayed proposals. Save/load language intents execute on PC after prior commands are acknowledged.
- AI credential discovery found no configured compatible provider in checked environment/standard configuration locations. Offline constrained language mode and mock-provider tests are being added; no live model access is claimed.
- Direct batch build found the main project already open in Unity. It exited before compiling. To preserve the open scene, native validation now uses an isolated source copy at `work/native-validation`; output APK and log target the deliverable project's Builds/Quest and Validation/quest-pro-build.log.

### Completed implementation and final evidence

- MRUK lane finished and froze QuestRoomAdapter/QuestBuildSetup. Source follows Meta's installed debugger setup/reload pattern and official MRUK sample guidance. No further VaM investigation.
- Runtime lane finished and actual Unity fixture run passed **80 checks**. Windows player rebuilt successfully from `work/command-fixture` into `outputs/AR-Sandbox/Builds/Desktop`.
- AI lane delivered `ControlService/ai_adapter.py`, 32 tests and Docs/AI-Integration.md. No compatible credentials found. Explicit offline language mode works; configured model mode has real HTTP mock transport tests, with sanitized errors and response validation. No live-provider claim.
- PC/service lane added session/revision-bound proposals, 120-second expiry, replay rejection, PC save/load language intents, current-mode status, browser Apply flow and runtime acknowledgement messages. 17 real-HTTP service tests passed. Combined final suite: **49 tests**, no failures, ResourceWarning treated as error.
- `Validation/Run-Prototype-Loop.py` exercised **41 passing checks** against the rebuilt actual Windows player and PC service: room/catalog → text spawn → twice-size → left20cm → rotate45 → second prop → delete it → save → clear → exact restore. Same application process throughout; no runtime exceptions. This is offline language and simulated room only.
- Browser validation used the actual service/player. Verified explicit desktop/offline labels, proposed spawn, Apply acknowledgement, same-ID resize and visible completion. Fixed Connect planner-status refresh and invalid-config offline fallback. Temporary service/player were stopped after checks.
- Authored Quest adapter compiled in Editor and Android branches and QuestBuildSetup compiled against installed metadata: all exit0, deprecation warnings only. `Validation/quest-source-check.txt`. This does not replace a native build.
- Native Android import again quarantined `work/native-validation/Library/Bee/artifacts/1300b0aE.dag/Meta.XR.BuildingBlocks.AIBlocks.dll` at 12:10 local; same SHA256 as earlier Android copy. Malwarebytes report: quarantine successful. `Validation/quest-pro-build.log`. No APK produced; no security changes or repeated native retries after confirmed detection.
- ADB recheck still lists no headset. No installation, room-capture interaction, passthrough validation or physical persistence test performed.

### Resume instructions for another session

Authoritative project: `outputs/AR-Sandbox`; read README.md, Validation/Prototype-Validation.md, Docs/Security-Block.md and per-lane reports. Latest priority is Quest Pro manual floor/table setup, superseding Quest 3-primary history. Preserve the open Editor and user modifications; do not regenerate scenes in an occupied session without preserving edits.

After the external security detection is resolved, close the main project's Editor and rerun Build-Quest.ps1 (native source copy was only for isolated validation). Fix concrete build errors if any, then install with Install-Quest.ps1 only on an authorized connected headset. Run the same loop on actual Quest Pro room anchors and record hardware evidence separately. If provider credentials are supplied/configured, perform a real model proposal test; never treat the offline parser as model AI. No background automation or native build is pending.

### GitHub publication — same day

The user selected the existing public repository `School-of-the-Ancients/matrix-loading-operator`. The prototype is imported at its root on `codex/ar-sandbox-prototype`; no separate AR-Sandbox repository is created. The original MIT license and Matrix operator concept are preserved. Continue source work in this Git checkout; references above to the unversioned sandbox folder are historical.

Publication omits generated SDK credentials/session IDs, local upload preferences, raw logs, caches, builds and scene saves. Workstation paths in historical reports are redacted. A serialized-reference audit found no missing local assets after the omissions. The imported service/adapter suite passed all 49 tests again. All four PowerShell entry scripts parsed successfully. Build-Desktop.ps1 is a new convenience wrapper around the existing Editor method; native Unity import/build remains subject to the previously recorded external blocker.

## 2026-09-20 — Research-informed learning layer (in progress)

PR #1 was merged into main at 7eeb9b3. Authoritative work now lives in the Git checkout, branch `codex/learning-sessions`; canonical core is a sibling checkout `sota-v2` on `codex/operator-learning-sessions`, based on 77b070d0f421746447a800580ada1cd44e32ec28. The user asked for organization/research review then the next logical layer. Attached framework PDF matches the research repository by SHA-256; see Organization-Review.md.

Decision: canonical v2 owns a durable authored Observation and Scale session using its existing LessonRuntimeService. Operator owns real room/object binding, acknowledged scale evidence, and a read-only guide. Start binds an already placed bundled block; language editing remains through the existing proposal/apply flow. Saved scenes include immutable core checkpoint references, and restore forks that checkpoint only after Unity load acknowledgment. No cloud, voice, downloadable catalog, or invented model credentials.

Ownership: core agent owns new v2 operator domain/server/tests; content agent authored the lesson and organization review; XR agent owns guide DTO/desktop/Quest presentation and adapter tests; coordinator owns Python integration/UI/runbook/full-loop tests. Base v2 suite: 84 tests passed; build and 2 frontend tests passed. Prior Operator 49 tests still pass. Guide compiled in isolated Unity fixture and 7 contract checks passed; new Windows build is in progress. Native headset build has not been retried after the recorded security detection. Headset not connected at initial check.

Remaining: finish core/adapter tests, real Node+Python+Unity roundtrip including service restart, browser verification, source-only Quest compilation, final documentation and cross-linked PRs. Keep source and hardware results separate. Do not consume usage-reset credits without explicit confirmation.

### Connected learning implementation and validation complete

- Canonical `sota-v2` change is committed at 5812d624f2ff0cabb8ddf3e914114dd9fa052523 and published as draft PR https://github.com/School-of-the-Ancients/sota-v2/pull/77. It exposes local API v1, uses the existing LessonRuntimeService, and atomically persists authored lesson snapshots, sessions, receipts and immutable checkpoint forks. 99 Node tests pass (15 new); Vite build and two frontend tests pass.
- Operator binds an existing bundled block, preserves stable request payloads on retries, forwards authoritative Unity scale evidence, and displays sourced authored guidance with learner response history. A saved scene includes the canonical checkpoint reference. Only a successful Unity load acknowledgment with a matching resulting scene can trigger the checkpoint fork. Failed/uncertain outcomes require explicit recovery and never imply success.
- 76 Python tests pass (49 existing, 27 new adapter checks). Independent review fixes cover evidence sent on wrong action types, old receipts reactivating obsolete sessions, and inconsistent durable receipt guidance. Snapshot mismatch after a successful ACK now has a regression test.
- Fresh reproducible `Build-DesktopFixture.ps1` run: 80 core checks, seven guide checks, Windows player build success. Test output is Builds/FixtureValidation/AR-Sandbox.exe; normal default is Builds/Desktop/AR-Sandbox.exe. Raw build log and generated path-bearing core JSON remain local/ignored.
- Real Node + Python + Unity player integration: 25 checks pass, including language-driven resize, prediction/observation/reasoning/reflection, checkpoint save, clear, restart both services, exact scene restoration and a new session fork preserving the later original completed record. Repeated against the fresh fixture executable. Browser flow also completed with current scale values, response history and source links visible; no browser JS errors.
- Quest authored source compiles in Editor/Android branches against installed metadata; only existing deprecation warnings. Latest ADB check found no devices. No native build retry, vendor DLL restoration, antivirus change, APK, headset installation or physical validation. No live model credentials used or usage-reset credit redeemed.

Resume from these two Git checkouts and Docs/Learning-Sessions.md. Existing app/Vite placeholders, mastery assessment integration, cloud deployment, voice and catalogs are outside this layer. Back up both core .sota-data/operator and PC ControlService/scenes for learning saves. Pending unsaved PC operations are not recovered automatically after a PC crash. New PRs should be reviewed together; core service is needed for the authored learning panel, while ordinary sandbox editing remains available without it.

### Published handoff

Both changes are published as linked draft pull requests: [canonical core #77](https://github.com/School-of-the-Ancients/sota-v2/pull/77) and [Operator #2](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/2). Operator implementation commit: `4f9b238`; canonical implementation commit: `5812d62`. No merge or cloud deployment was performed. Temporary browser/test services and players were stopped. Startup uses separate foreground core/control-service terminals and the Windows player, as documented in the runbook. The fresh fixture build and all source/check results above are complete; only the explicitly identified native hardware/model work remains untested.
