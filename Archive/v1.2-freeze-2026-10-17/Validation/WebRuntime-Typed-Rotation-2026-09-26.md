# Typed rotation integration check — September 26, 2026

PR #95 adds an optional Euler-degrees `rotation` to the existing
`matrix_move_object` path. This check used a disposable local service and scene;
it did not change the wearer's Quest scene or the normal Matrix service.

## Automated checks

- `SANDBOX_AI_MODE` removed for the Python test process:
  `python -m unittest discover -s ControlService -p test_*.py -q` — **643 passed**.
- `npm test` in `WebRuntime` — **126 passed**.
- `npm run build` in `WebRuntime` — passed.
- Focused HTTP coverage confirms that a 202-character rotation approval summary
  remains visible and reviewable in XR, while an oversized hidden summary cannot
  be approved through the Agent Portal API.

## Isolated desktop runtime

A scratch ControlService on port **18781** served the #95 WebRuntime bundle and
a copied Ice Dragon GLB catalog. A headless Chromium `/web/` page established
the real browser exchange. The check used the private typed Matrix bridge to
spawn the Dragon, bind `Flight`/`Frost Burst`, and request a rotation on that
same object. Each action received a successful browser runtime receipt:

| Action | Request ID | Observed result |
| --- | --- | --- |
| Spawn | `85cf8df4adb44a74b5b8faa363d1d2ae` | Object `3ee1a7d5b46a44e9b007955056b5c0a9` appeared |
| Bind animation | `0463d42a6def42658bc32fbc6166ec39` | `Flight` loop and `Frost Burst` selection clip bound |
| Typed rotation move | `0841a855ab3d466e95c078c8330fa8ab` | Rotation `{x:0.17,y:180.26,z:-6.64}` acknowledged |

The final snapshot retained the same object ID and asset, position
`(0, 1.5, -2)`, scale `0.5`, and both animation bindings. The scene revision
advanced from 2 to 8. All three receipts had `ok: true`. The disposable
browser and service stopped after the check.

This proves the typed bridge, service queue, browser `set_transform`, and
receipt/observed-transform path together in a desktop runtime.

## Quest VR Agent follow-up

After the PR stack merged, a separate service on port **18782** served the same
Git tree as merged `main` (`e54707b2a958…`) with a fresh scene, copied Ice
Dragon catalog, PC-local Codex Agent and local speech. USB ADB reverse connected
Quest Browser to that service; the normal port-18778 scene was untouched.

In VR, the wearer used CODEX push-to-talk to load the existing Ice Dragon at
`(0, 1.5, -2)`, scale `0.5`, and bind its `Flight` loop. The wearer confirmed
the model appeared and animated. The service recorded successful spawn receipt
`ebd88cb62dad4894893ddd7c81fed20d` and Flight-binding receipt
`202ef22a11a643328da76fd3d5ea0936` on the same object
`b7b2c88caa184442a105152e7c264a56`.

In the same Agent conversation, the wearer asked by voice to turn that same
Dragon 180 degrees around room Y while keeping position, scale and Flight. The
Agent reported a succeeded Matrix move receipt for request
`d93fb582e94540e78c125cb865e3dd4c` at scene revision 9, with the requested
position and scale preserved. The service's browser runtime result was
`ok: true` for that same object ID, and the wearer confirmed the Dragon visibly
turned while Flight continued. The wearer subsequently grabbed/moved it with a
controller; a later revision-13 snapshot therefore has a different pose and
does not represent the immediate rotation receipt.

This verifies spoken Codex interpretation and wearer-visible rotation in Quest
VR for this object. It does not establish the same workflow in AR, all panel
controls, or a general physics/rotation system beyond the typed virtual-floor
move contract.

On the same merged build, the wearer opened the in-world WORLD page, tapped
**SAVE WORLD**, and confirmed the save message appeared inside the panel. The
PC service listed scene-only backup `WebWorld_20260926065501` (4,027-byte JSON)
afterward. This checks the formerly missing in-world save notice; this run did
not close/reopen the Quest browser to verify the new browser checkpoint.
