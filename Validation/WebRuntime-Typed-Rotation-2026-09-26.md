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
receipt/observed-transform path together in a desktop runtime. It does not
prove Codex intent parsing or wearer-visible Quest rotation; those remain
separate checks.
