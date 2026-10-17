# Canonical Citizens world AR visit — source validation

This record covers the `codex/parallel-world-ar-visit` source candidate based on merged `main` after PR #136. It tests a browser-active AR view into one virtual Citizens scene. It does not establish an independent world clock after browser close or a Quest wearer result.

## Contract exercised

- Eligible virtual Citizens worlds enter AR with the same canonical `web-virtual-room-v1` scene reference, object IDs, Citizens state, and simulation clock. Running Citizens continue; an intentionally paused world remains paused. Worlds with legacy AR origin provenance continue through the earlier AR placement/recovery path.
- Citizens finite move, station interaction, and social actions retain Matrix receipts while the visitor view is active. The browser refuses ordinary authored edits, world switching, manual restore, and room-origin archive/rebase/clear in this mode.
- An AR view anchor positions the overlay without changing saved world provenance. Losing its pose hides the overlay and marks PC observation read-only; local Citizens progression continues until the active browser session ends.
- Browser save captures the canonical v3 scene/Citizens envelope. The ControlService accepts only an explicit `digitalWorldVisit:true` with AR runtime identity, canonical room, validated Citizens state and exact resident motion observation. It denies queued world commands from that view and invalidates previously queued commands on visit entry. It does not infer physical alignment from the view.

## Checks

- ControlService: final `python -m unittest discover -p 'test_*.py'` in `ControlService` — **761 passed**. A first run exposed an anchor freshness regression; narrowing AR jitter normalization to explicit WebXR session or visit snapshots fixed it. Review also found that direct scene save could persist an unrestorable AR visit marker; the server now rejects that save. It rejects a visit that falsely claims physical alignment.
- WebRuntime: final `npm.cmd test` in `WebRuntime` — **490 passed**, including the hidden immersive-page and initial/lost-origin fixtures. The focused five-file suite passed **137/137**. Final `npm.cmd run build` passed.
- Cross-language snapshot smoke: Node created the built-in two-resident world, entered AR visit, serialized `world.snapshot()`, and Python `server.snapshot()` accepted it as `web-virtual-room-v1`, `digitalWorldVisit:true`, two residents, AR room mode. The temporary JSON stayed outside the repository.
- `git diff --check` passed for the source candidate at review time.

## Remaining evidence

The tests simulate AR transitions and tracking. They do not establish that Quest Browser keeps the JavaScript timer at the intended cadence while immersive, that a physical room is aligned, that rendered citizen motion is comfortable, or that residents live with every browser closed. An isolated PC world host is the next acceptance slice; real Quest 3 AR observation and origin recovery must be recorded separately.
