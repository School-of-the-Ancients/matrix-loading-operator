# Web virtual-floor physics desktop validation — 2026-09-25

## Source and automated checks

- Base: `f63d517` (`codex/m3-scale-contract`, PR #92). Validation ran on the
  uncommitted physics branch before this evidence note was added.
- Windows 11, Python 3.13.14: `python -m unittest discover -s ControlService
  -p 'test_*.py' -q` — 626 tests passed.
- Node 24.16.0: `npm test` in `WebRuntime` — 99 tests passed.
- `npm run build` in `WebRuntime` — Vite 7.3.6 build passed.
- `git diff --check` — passed.

## Isolated desktop browser trace

Used `http://127.0.0.1:18774/web/` with a scratch scene store and catalog.
The normal Matrix service and scene at port 18765 were not touched.

1. Measured the actual Clockwork Firefly GLB via Three.js `GLTFLoader`. Its
   raw bounds center is approximately `(0, 1.1314, -0.0035)` metres and size
   `(2.4554, 1.0769, 2.4211)` metres. Registered those bounds in the scratch
   catalog. This asset verifies the off-center GLB pivot case.
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

## Evidence limits

This was a desktop White Room test. No Quest wearer test, AR physics, physical
floor collision, object-to-object collision, or general rigid-body behavior
was established. Existing Web GLB catalog entries without accurate
`localBounds` need reviewed registration with measured bounds before this
physics action can be used on them.
