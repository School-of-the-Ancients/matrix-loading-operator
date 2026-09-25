# Matrix implementation plan

Updated September 25, 2026. **Start at M0. Complete a small step before expanding scope.**

[PRD](PRD.md) · [Project map](PROJECTS.md) · [School build plan](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/BUILD_PLAN.md)

This is the current work-selection guide, not a replacement for detailed issue acceptance. Existing issue histories, source links, and validation remain intact. A step can finish without closing its broader umbrella issue. No GitHub board statuses are changed by this document.

## Reviewed baseline — do not rebuild it

Snapshot: Matrix main [`509a72a`](https://github.com/School-of-the-Ancients/matrix-loading-operator/commit/509a72a344faa8e2cc63c12b67a6b08d140c43ce), after PR #80.

| Already present | Source and remaining distinction |
| --- | --- |
| Three.js/WebXR, GLB loading, input, local speech, room origin and browser persistence | PRs #45–#49. Earlier Quest AR/primitive-robot and same-position reopen evidence exists; that does not establish every later feature. |
| Game/scene saves, storage and room recovery, footprint checks, optional camera probe | PRs #51–#58. Later hardware checks remain; camera and virtual images are not a calibrated composite. |
| PC Codex transport, replaceable session backend, durable mapping, portal, spatial context, MCP and approvals | PRs #60–#69 and #76. Extend these instead of building another agent or gateway. |
| Numeric components, GLB animation and selection bindings | PRs #70–#73 and #75. These are specific bounded capabilities, not arbitrary scripting or complete NPC behavior. |
| Dragon/skiff assets and ready-AR virtual-floor tool support | PRs #77–#79. The dragon has desktop evidence; richer Blender MCP and final Quest creation acceptance are still incomplete. |
| Client pairing, reviewed placement/scale and model proposals | PRs #34, #36, #37. Reuse for School; previous Unity/fixture evidence is not WebXR acceptance. |

PR descriptions and [WebRuntime documentation](WebRuntime/README.md) are evidence references, not tests rerun during this planning review. Refresh main/open PRs before coding.

## M0 — Validate the current build, fix only observed blockers

**Owners:** [#44](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44), [#59](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/59), release evidence [#24](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/24).

Use an isolated service port and disposable browser profile/origin. Do not clear the user's live scene or anchors. Run the current automated suites, then test: same agent conversation through a follow-up and reopen; selected-object move; Approve/Deny/Stop; registered asset spawn and clip selection; browser world/game restore. Test desktop first, then Quest AR; record VR entry separately because the earlier AR success did not establish VR readiness.

Extend [the existing Quest checklist](WebRuntime/QUEST3_ACCEPTANCE.md), rather than making another test framework. Camera access is optional and cannot block non-camera creation. A provider outage can block live-agent acceptance while deterministic/runtime tests continue; record the blocker rather than faking completion.

**Exit:** exact source/CLI/browser/device versions, receipts and wearer observations are recorded for the tested path; failures get small fixes under the existing owners. Do not require every camera, legacy Unity, or future research checklist to pass.

## M1 — Finish one real Blender-to-Matrix conversation

**Owners:** #59 and [#28](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/28). Depends on the relevant M0 portal/receipt checks, not optional camera acceptance.

Reuse configured Blender tools, a dedicated scratch scene, the existing authoring/catalog path and Matrix MCP. Start with one non-primitive static asset; named animations can use the current contract afterward. Demonstrate create → follow-up revision → export → validate → register → place in the same agent conversation. Preserve `.blend`/authoring source outside the runtime catalog. Replacing an already placed asset must explicitly preserve or replace its object identity; do not silently duplicate it.

Make approval handling usable with the smallest change: exact review for understood operations, or a visible PC handoff for broad code execution. Do not summarize arbitrary Python as a harmless one-click action, bypass native approval, or build a general policy engine. Keep the primitive blueprint fallback. Local Blender scripting is a valid separate path; only an actual tool trace establishes Blender MCP acceptance.

**Exit:** one real end-to-end trace, revision, registered asset, acknowledged placement, and final visual check. A generated file or an interrupted authoring turn alone is not done. See [authoring tiers](WebRuntime/BLENDER_AUTHORING_TIERS.md); its old “portal not implemented” wording must be reconciled with the newer merged PRs when editing that guide.

## M2 — Save and restore the whole supported experience

**Owners:** #44 and #24. Reuse existing state and files; no new database.

First inventory the current browser world envelope, manual checkpoint, PC scene save, asset references and component/animation bindings. Browser scene/game restore already exists; PC scene-only backups do not preserve game progress. Add only the missing versioned whole-experience PC checkpoint/export and matching restore, using existing validation and atomic-file patterns.

Keep world data separate from agent chat and School records. Save configuration, not animation playback phase or transient device streams. Preserve existing saves with an explicit compatibility path. Missing content, an interrupted write, or unavailable room origin must preserve the old state and report recovery options. Physical-plane objects keep their honest session-local restriction until separately supported.

**Exit:** save a supported object/game/component configuration, restart browser and PC service, restore exact IDs and progress, and reject a missing/corrupt dependency without silently replacing the world. This is one local recovery path, not multi-user synchronization.

## M3 — One reusable HTML + Three.js experiment

**Owners:** [#31](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/31), [#32](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/32), School roadmap [#8](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/issues/8).

Use the existing scale experiment as the first case. Inspect both existing implementations before choosing the owner of its state and math. Keep one tested calculation/operation implementation; HTML, the Three.js view, and agent actions consume it. A short configuration object and ordinary code module are enough. Do not build a universal experience-package standard or require WebMCP.

Prove set dimensions → observe exact volume/ratio → reset in the browser. Add the supported WebXR presentation and normalized observed events. Surface switching retains identity/state; simultaneous separate devices are out of scope. Reuse the limited client API for School; do not expose the privileged coding agent to the lesson application. M3 can start independently of rich Blender authoring using built-in blocks.

**Exit:** equivalent HTML/3D/tool inputs yield equivalent results, one save/resume works, and School can consume observations through its existing bridge. Scale mathematics is not measured physical volume or a physics simulation.

## Next and later — keep the existing backlog

| Lane | Existing owners | Small next outcome, when selected |
| --- | --- | --- |
| Current Matrix | #44, #59, #28, #24 | M0–M2; no second implementation stack. |
| Shared lesson | #31, #32, #23 | M3 plus the School build plan; no Citizens/Boulder prerequisite. |
| Reusable runtime | #13, #25 | Extend only for a demonstrated missing interaction; reuse numeric components and existing receipts. |
| Content and visual feedback | #9, #8 | One additional provider or same-session capture loop after the basic creation path works. |
| Spatial/device work | #22, #26 | Test required room capabilities; physical-camera support remains optional. |
| Character and Citizens | #14–#20, #29 | One finite character interaction first, then a small routine/needs loop. GOAP, memory, social behavior and model selectors are separate increments. |
| Persistent geography | #38 | Reuse Boulder prototype findings; evaluate one small Web world view and coordinate mapping before a port or city expansion. |
| Alternative realtime agent | #62 | Reuse the existing session backend; add one provider only for a concrete unmet need. |
| Legacy/native | #21 and Unity-specific portions of #12/#22/#24 | Maintain existing packs/builds; do not route Web GLBs through AssetBundles. |
| Late/research | #41; roadmap #14/#15/#18 | Astral presence, community models, Jev/CLM benchmarks. Not first-release gates. |

These are planning lanes, not assertions that entire issues are unimplemented or completed. #12 remains the foundation umbrella. School, Citizens and geography are independently useful tracks, not a mandatory global waterfall.

## Resource inputs retained

Use the existing [catalog guide](Docs/Content-Catalogs.md), [runtime package notes](Docs/WebXR-Runtime-Packages.md), [Boulder PRD](Docs/Matrix-Boulder-PRD.md), and [NPC resource index](https://github.com/School-of-the-Ancients/school-of-the-ancients-roadmap/blob/main/RESOURCES.md) instead of inventing another registry design.

| Input group | Role and disposition |
| --- | --- |
| Three.js/WebXR, HTML, Blender, local Codex, Matrix/Blender MCP | Current runtime/authoring path. Keep working versions and existing adapters. |
| Poly Haven, Sketchfab, Openverse; Scenario, Blockade/Skybox, Adobe Substance | Existing discovery work plus the original asset-library vision. Discovery, acquisition, conversion and runtime readiness are different states. Select one concrete integration at a time under #9/#28. |
| [image-to-3dlab](https://github.com/Bingeljell/image-to-3dlab), local ComfyUI and other generators | Optional asset producers. Verify output, provenance, hardware and licensing before enabling; not required for M1. |
| Aulas-style labs and interactive HTML | Interaction inspiration for M3, not a required framework or a promise of arbitrary browser code execution. |
| ElevenLabs and [Gemini Live/Avatar input](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-live-with-live-avatar/) | Optional voice/presentation/provider leads under #62 and School #7. No new paid dependency for the first lesson. |
| LLMR, Voice2Action, Project Sid/PIANO, Sims/GOAP, [CLM](https://contrastive-lm.notion.site/), [Brood War agent report](https://bw.swerdlow.dev/report) | Research/design inputs to finite actions and Citizens; not a required combined agent stack. Existing roadmap research retains SwarmWorld, Voyager, Jev, Odyssey and motion sources. |
| Cesium/Google tiles, open GIS; generated-world leads | Optional visual/data providers for #38. Keep Matrix-owned entities separate from streamed imagery; confirm rights and actual APIs before integration. |
| Manfred/Omi/phone, Quest/Aura, Demerzel/fleet, NOMAD | Separate input/device/infrastructure tracks. No lifelog, cluster deployment, or new hardware is required to finish this plan. |

This review used available September 20–25 conversation summaries, 26 Matrix issue bodies, 16 roadmap issue bodies, recent organization PR descriptions/evidence, and the linked repository documents. It is not an exhaustive export of every conversation, a line-by-line code review, or fresh runtime testing. External resource mentions are retained leads, not newly verified vendor capability claims.

## Working rules and next Codex task

One active Matrix implementation slice at a time. One independent School slice may proceed separately. Prefer a small PR against current main; inspect existing open work first. Keep tests next to the changed code. Use the current Python suite and WebRuntime `npm test` / `npm run build`; cross-product changes also run the existing School tests/typecheck with the documented Matrix checkout.

Each PR states: user-visible result, reused files/contracts, excluded scope, tests actually run, device checks still pending, and the next step. Update this plan only when evidence changes the queue. Leave PRs open unless the user authorizes merging; do not close umbrella issues from a partial milestone.

**Start prompt:** “Read AGENTS.md, PROJECTS.md, PRD.md and IMPLEMENTATION_PLAN.md. Check current main and open PRs. Work only on M0: validate the existing Web Matrix/Agent Portal and fix demonstrated blockers in small PRs. Preserve live scenes, credentials and old builds. Report automated, desktop and actual Quest evidence separately; do not implement later steps or merge automatically.”
