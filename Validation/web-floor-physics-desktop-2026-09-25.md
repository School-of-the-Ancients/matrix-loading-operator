# Web virtual-floor physics desktop validation — 2026-09-25

## Source and automated checks

- Base: `codex/m3-scale-contract` (PR #92). The initial physics commit was
  `0fb8081`; the renderer-measured follow-up was validated before its commit.
- Windows 11, Python 3.13.14: `python -m unittest discover -s ControlService
  -p 'test_*.py' -q` — 626 tests passed.
- Node 24.16.0: `npm test` in `WebRuntime` — 103 tests passed after the
  renderer-measured and review fixes.
- `npm run build` in `WebRuntime` — Vite 7.3.6 build passed.
- `git diff --check` — passed.

## Isolated desktop browser trace

Used `http://127.0.0.1:18774/web/` with a scratch scene store and catalog.
The normal Matrix service and scene at port 18765 were not touched.

1. Measured the actual Clockwork Firefly GLB via Three.js `GLTFLoader`. Its
   raw bounds center is approximately `(0, 1.1314, -0.0035)` metres and size
   `(2.4554, 1.0769, 2.4211)` metres. The first scratch catalog carried the
   measured size. This asset verifies the off-center GLB pivot case; the later
   trace uses no catalog bounds.
2. Spawned `web:clockwork-firefly-physics:15c42ffb780f` at authored
   `(0, 2, -2)` and scale `0.3`; receipt `a4d510ea...` succeeded. The real
   GLB was visible above the virtual floor in the desktop browser.
3. Set gravity-floor physics with restitution `0.45`; receipt `4d6edd49...`
   succeeded. The browser showed the GLB resting on the floor. The service
   observed a matching transient run, `settled` at y=0 with six approximate
   floor contacts. The authored y remained 2.
4. Bound `Wingbeat` as the loop clip and `Beacon Pulse` as the selection clip;
   receipt `a9cbf448...` succeeded. Re-running physics (`65b5f441...`)
   preserved the binding and again observed floor contact. Unit tests verify
   that the GLB animation mixer and physics frame advancement coexist.
5. Saved `Physics Firefly`. Its stored scene retained the exact object ID,
   authored transform, animation binding, and physics config; it contained no
   `physicsStates`. Reloading the browser left the configuration inert at
   authored y=2. Explicit `set_physics` (`e81aa738...`) started another
   observed run. `remove_physics` (`c433382...`) restored the displayed
   authored pose and cleared config and transient state.
6. Restarted the isolated PC service and loaded the saved scene. Load receipt
   `97ab4bf8...` succeeded. The same ID, transform, clips, and config were
   restored; `physicsStates` was empty. The browser rendered the GLB at its
   authored height after the restart.
7. After the renderer-measured follow-up, used a separate scratch catalog with
   the existing versioned Clockwork Firefly and Ice Dragon IDs and **no**
   `localBounds` on either entry. The Firefly spawned above the floor
   (`20059680...`) and settled with six contacts after `set_physics`
   (`f9a16510...`). Refreshed the catalog in the browser, spawned the Ice
   Dragon (`02d66fc...`) above the floor, and observed its `set_physics`
   receipt (`70221440...`) settle at y=0 with four contacts. Both real GLBs
   were visible on the floor together. Binding the Dragon's Flight loop and
   Frost Burst selection clip (`8c4ce1d...`) preserved its physics state.

## Evidence limits

This was a desktop White Room test. No Quest wearer test, AR physics, physical
floor collision, object-to-object collision, or general rigid-body behavior
was established. The first trace registered the Firefly with bounds; the
follow-up used the existing Dragon and Firefly asset IDs without catalog
`localBounds`. The normal port-18765 service and live scene were not changed.
