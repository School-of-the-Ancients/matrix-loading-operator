# Hosted Citizens world and visit — 2026-09-27

## Scope and ownership

This slice advances [#20](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/20) and the shared-world path for [#22](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/22) and [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29). It starts an isolated PC Node owner for the built-in Ada and Bo fixture using the existing `MatrixWorld` and `CitizensSimulation`. The existing `ControlService` exchanges each serial virtual tick and atomically saves a version 3 named checkpoint. Browsers receive only a saved, read-only observation; they do not lease the world, tick Citizens, exchange commands, or save a second copy. The service rejects owner/view token reuse and hosted/browser checkpoint crossover.

The new `/web/hosted.html` projects that observation through the existing `MatrixView`. Desktop and WebXR VR can view the digital scene. WebXR AR uses the existing tracked digital-world view anchor; visitor polling preserves its tracking state and hides the overlay while tracking or the host observation is unavailable. The ordinary `/web/` Creator and browser Citizens paths retain their existing contracts.

## Automated evidence

From this branch's checkout:

| Check | Result |
| --- | --- |
| `npm.cmd test` in `WebRuntime` | 504 passed, 0 failed, including 9 host and 5 visitor tests |
| `npm.cmd run build` in `WebRuntime` | Passed; emitted `dist/hosted.html` and visitor bundle |
| `python -m unittest discover -s ControlService -p 'test_*.py'` | 767 passed, 0 failed |
| `git diff --check` | Passed |

The host tests cover serial advancement, restart from the exact checkpoint without downtime catch-up, command failure receipts, invalid fixture and isolation rejection. Service tests cover view-token separation, saved-observation gating, and hosted checkpoint ownership. Visitor tests cover a desktop/AR projection of the same object IDs at a later clock, stale/changed-world rejection, restart monotonicity, read-only interaction gates, and absence of a browser writer path.

## Local process and browser trace

An isolated service ran on `127.0.0.1:18876` with separate temporary scene and asset directories and distinct owner/view tokens. The Node host used world name `AdaBo`; observation returned `online: true`, `readOnly: true`, the same two resident IDs (`ada`, `bo`), and four stable scene object IDs. A separate Node ↔ Python HTTP restart trace advanced from tick 3 to 4 across a service restart with unchanged resident IDs and exact checkpoint recovery.

In desktop Chrome, `/web/hosted.html` connected with the view token and rendered Ada and Bo. Without a browser-owned Citizens timer, the same page showed saved tick **512 → 519** and observation sequence **514 → 521**, retaining Ada's object prefix `769d1bbb` and Bo's `0ecf044d`; Ada's activity changed from travel to use. The details panel toggled. The page has no owner token or local world-save control. The Codex in-app browser loaded the current bundle and canvas, but its automated clicks did not change controls; no page error was captured there. That interaction path remains unexplained, while desktop Chrome produced the stated result.

## Limits and next acceptance

This is the built-in two-resident fixture and an isolated service/host path, not a general-purpose multiplayer world host or a migration of existing browser-owned worlds. Operator commands sent to the hosted fixture receive failure receipts. Prior experimental host checkpoints without the new ownership marker require explicit migration; the host will not silently adopt them.

Quest 3 wearer evidence is still needed for VR and AR entry, room alignment/relocalization, comfort, performance, and physical collision behavior. AR here visits the same *digital* world; measured room planes do not change the hosted state. The broader #20/#22/#29 acceptance, and #122 creator loop and #116 connected Operator acceptance, remain open.
