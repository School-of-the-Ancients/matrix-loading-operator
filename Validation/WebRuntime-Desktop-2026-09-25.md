# Web Matrix desktop and Quest AR validation — 2026-09-25

This run used `main` at `cdf5d3c20d59a479f3164b36c50979069b2f9632` as its baseline, an isolated ControlService on port 18765, disposable scene/catalog directories, and a new browser origin. It did not read or reset the normal Matrix scene. It advances the M0 desktop gate and tests the user-requested new animated asset from M1. Runtime receipts below are from the actual browser exchange, not just submitted commands.

## Versions and baseline

- Windows desktop; Python 3.13.14; Node 24.16.0; npm 11.17.0; Vite 7.3.6; `codex-cli 0.158.0-alpha.2` logged in with ChatGPT.
- Codex In-app Browser on Windows, User-Agent `Chrome/154.0.0.0` (the browser did not expose a more specific engine build).
- Blender 5.2.2 LTS. `mcp-for-blender==2.0.4` was configured, but its add-on was not connected to a live Blender instance. The asset below used Blender's headless Python CLI, not Blender MCP.
- Baseline `python -m unittest discover -s ControlService -v`: 597 tests passed. After the PC approval change, `python -m unittest discover -s ControlService -q`: 606 tests passed. `npm test` in `WebRuntime`: 75 tests passed. `npm run build`: passed, with Vite's existing 746.28 kB chunk warning.

## M0 desktop browser trace

The PC Agent Portal completed a text turn, recalled `ALPHA` as `ALPHA-BETA` in the same conversation, restored its transcript after browser reload, and recalled `ALPHA-GAMMA` after a ControlService restart. The Stop control cancelled a read-only turn. An exact native animation approval succeeded; a separate requested move was denied and the dragon position did not change.

The offline planner placed a block (`ce33db162f7f427f83bbb25144d07ab5`), which was selected and moved with the mouse. The cataloged Ice Dragon was spawned (`9f26b5a931ae41a2a43ff43cb4f9ed91`) and bound to `Flight` / `Frost Burst` (`e61a6125222f4da3897333d0987011df`). A one-orb delivery game was planned and applied in the browser; dragging and releasing the orb near the pedestal produced `Orb Delivery: complete! 1/1 points. Score 1.` Reload and PC service restart preserved the object IDs, dragon binding, and score.

## A genuinely new animated asset

The first request for Agent Portal to author a new Clockwork Firefly stopped at a generic PC command approval. The portal described the operation only as unreviewable in XR and disabled approval on desktop too. That turn was stopped; no file was produced by it. This is a demonstrated M1 approval blocker, separate from the Matrix asset/runtime path.

An attached interactive PC service console now offers a separate one-time review for generic native **command** approvals. In a live follow-up, the console showed the exact `Get-Location` command, working directory, reason, available decisions and native request; typing `approve` ran that read-only command and the Agent Portal reported its output. The browser still could not approve the generic command and did not receive its raw details. Focused tests cover approval, denial, stale/changed requests, Stop, noninteractive service, and terminal escaping. This is a command handoff only: generic Blender MCP calls and file-change approvals still need a PC review path before they can be accepted.

The new [Clockwork Firefly](../WebRuntime/art/clockwork-firefly/README.md) was then made from scratch in a dedicated headless Blender 5.2 run, preserving its Python source and editable `.blend`. Its self-contained GLB is 566,844 bytes with SHA-256 `15c42ffb780f17d535e4f1fc905bf3a28f3c91433c6fec5a156a65c0b1991e2f`, 79 meshes, 14,706 vertices, no external images, and named clips `Wingbeat` (1.042 s) and `Beacon Pulse` (1.375 s). The Matrix validator accepted it, and Three.js loaded and advanced both clips. Blender's render and the live browser appearance were inspected.

The GLB was registered with `register_web_asset.py` into this service's chosen scratch catalog, then refreshed in `/web/`. In the **same Agent Portal conversation**, Matrix MCP spawned one Firefly with native approval and a succeeded browser receipt `dabf9b7bbc894147904212a99c01baef`, object `085cd72d9b1d40728222c5c73a0b3896`. A second approved call bound `Wingbeat` as loop and `Beacon Pulse` as selection clip; receipt `63dde9998ca94188a073fcbcb3ad36fd` succeeded. A final move into clear view succeeded (`69741fe249fb4771b435303d7c7cc2dc`). The actual Firefly mesh rendered in the desktop browser, and clicking it selected that object. This proves new Blender export → catalog → live desktop import and binding. It does **not** prove Agent Portal performed Blender authoring.

## Live Quest 3 AR trace

A Quest 3 connected through USB ADB opened the isolated ControlService at `http://127.0.0.1:18767/web/` using `adb reverse tcp:18767 tcp:18767`. This was a separate scratch scene and catalog; the normal port 8765 scene was not changed. The wearer entered AR. The service reported a ready room with alignment verified and detected room planes. The Agent Portal remained in one conversation throughout the following operations.

The wearer approved one Clockwork Firefly spawn. Its runtime receipt `61db559716314ee083e1096e9d66483b` succeeded with observed object `3e818c38492947ee9e732e18fc89dc09` on unanchored `web-floor`. A first animation binding conflicted after the wearer changed the scene revision; a fresh binding succeeded with receipt `c05adcfcd22241dea0db544a8f59e90a`. The resulting scene reports `Wingbeat` as loop and `Beacon Pulse` as select clip. The wearer reported **“its flapping”**, confirming the actual animated model was visible in Quest AR. They also reported that selection makes it glow but grabbing did not work in that build.

The same AR session then approved an Ice Dragon preview. Its first request conflicted with another scene revision change; a fresh request succeeded with receipt `5ceb8b56b78d42b39919ce5150ae8f45`, observed object `6a7bb36dceb345669bbb69715c7bd273`. The live scene retained exactly one Dragon alongside the Firefly, and the wearer reported **“Dragon model visible.”** Binding `Flight` as loop and `Frost Burst` as select clip succeeded with receipt `f07442898a244bac8c7b4412c152a10f`; the wearer confirmed **both animations visible**. This is a direct wearer check of the earlier AR import failure fixed by PR #78. Both placements were unanchored virtual-floor previews; neither establishes physical-surface anchoring. The wearer also observed the blue controller ray disappearing when aimed at the Operator panel and that Firefly selection glowed but could not grab. Those input issues are being addressed separately.

## Remaining acceptance

- M1 still needs a reviewed creation and follow-up revision inside one Agent Portal conversation, with source/export/catalog/placement trace. The local script path is a valid fallback; Blender MCP itself remains unproven.
- Quest visual rendering is now wearer-confirmed for the Firefly and Ice Dragon. Physical-surface placement and room-origin recovery still need their own checks.
- PC `Save`/`Restore` remain scene-only; whole experience checkpoint and restore are M2.
