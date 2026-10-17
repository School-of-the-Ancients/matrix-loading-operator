# Creator Undo desktop recovery check — September 26, 2026

This check ran the **built** `/web/` Matrix runtime with the Creator Undo fix in the Codex in-app browser against an isolated ControlService at `127.0.0.1:19862`. The service used `work/creator-undo-proof/scenes` and `work/creator-undo-proof/assets`; no other Matrix service or saved world was touched. The browser reported **Operator connected**, Desktop virtual room, and zero console errors. `npm run build` passed before the browser run. This is desktop runtime evidence, not Quest or AR wearer validation.

The browser's Creator/Play controls entered Play/Test and returned to Creator twice. A built-in block (`70b2e4ca74794a57978f84e6b82bb4db`) had a Rapier dynamic body. After a slow-gravity run (`y = −1 m/s²`), its observed position was `y = 56.75243377685547 m` when a separate wall (`fa15f936787b4dfdb994ee869e71e614`) was authored. Another Play/Test run let the block continue falling. Returning to Creator paused its latest state at `y = 0.00041171908378601074 m`. The focused Creator integration suite also passed **7/7**.

| Action and live receipt | Wall | Block solver position `y` | Result |
| --- | --- | ---: | --- |
| Before Undo | Present | `0.00041171908378601074` | Two objects; block had moved after wall authoring. |
| `undo`, `26688e8cfea84d02bea6cffac2c6292b`, `ok: true` | Absent | `0.00041171908378601074` | Exact block solver position and linear velocity retained; scene pose matched solver pose. |
| `redo`, `dd77599216104792b6ddd7c5f4bcaab6`, `ok: true` | Present | `0.00041171908378601074` | Exact solver position and linear velocity still retained. |
| Deliberate block `set_transform`, `df73fda086554ac08d6736586a31079f`, `ok: true` | Present | `4` | Scene and solver moved to the authored target. |
| Target `undo`, `91d227306a8e465aa90e65adbdf727d8`, `ok: true` | Present | `0.00041171908378601074` | Full prior block transform and solver position restored. |
| Target `redo`, `bee36aa87d5e4597b78c29cba0a81492`, `ok: true` | Present | `4` | Authored target restored again. |

The unrelated Undo/Redo retained the block's exact linear velocity `{x: 0.0015915101394057274, y: 0.002882341854274273, z: -0.003306747879832983}`. The receipts were queued through `/api/command`, then observed as applied in `/api/state` with the connected browser's authoritative scene and rigid states. The screenshot [creator-undo-browser.png](creator-undo-browser.png) shows the isolated connected Creator world after Redo. No headset controller, spoken request, or physical-room collider was tested.
