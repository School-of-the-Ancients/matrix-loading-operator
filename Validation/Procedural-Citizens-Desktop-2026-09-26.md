# Procedural bench to Citizens: desktop runtime check

Status: isolated built-browser and PC service evidence for [issue #122](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/122), September 26, 2026. The test used `/web/` on `127.0.0.1:19861` with separate scene and asset directories. It did not use the user's 8765 service, a headset, or Blender. Blender and registered GLB paths remain available.

The browser connected to the built Three.js runtime and advertised interaction schema 2. Typed `/api/command` requests were consumed by its `MatrixBridge`. Each accepted edit was checked against the subsequent `/api/state` receipt and scene. The following object kept ID `00eda4c30bb148e3bc7da403b4b6c795` throughout:

| Action | Matching runtime result |
| --- | --- |
| Create `curved-bench@1.0.0:curved-bench-v1` on the virtual floor | Receipt `96e0c24996f14da2a7d3e16bf4092463`, `ok: true`; generated curved geometry visible in the browser. |
| Author the reviewed `bench-rest` v2 interaction | Receipt `45ada694f93842e2a6938d5d0870d12e`, `ok: true`; scene descriptor and source matched. |
| Revise length 1.8 → 2.2 m and arc 75 → 90° | Receipt `12873d0d6be84c56a54f3d85782ca3bf`, `ok: true`, same object ID. |
| Undo then Redo in the browser | Receipts `a3d3f1b4f9ce47cc9df3e5815b9f4e42` and `1a38de37b93b47aba1e1d62730655f81`, both `ok: true`; the scene returned first to 1.8 m / 75°, then to 2.2 m / 90°. |
| Save and reopen | Named PC checkpoint `procedural-bench-revised`; browser reload retained the object ID, revised recipe, and `bench-rest` descriptor. |

The browser selected the bench through an accepted Matrix `select` receipt (`44b1d042ab7b48cd93bc50f89b8906bf`) and used its **Use selected station** control. Two existing Citizens residents were added without replacing the bench. The Citizens checkpoint bound station `chair` to that exact procedural object and v2 descriptor. At minute 14 Ada completed rest. At minute 30 Bo was using the bench with energy **12.5**; at minute 31 Bo completed rest, the decision log reported an observed outcome, and energy was **48.95** after the configured **+37** benefit and one minute of decay. The Citizens implementation applies that benefit only after checking the Matrix interaction receipt and exact outcome.

The browser saved `procedural-bench-citizens`, reloaded, and retained minute 31, both resident IDs, the bench ID, the station binding, and Bo's energy. The isolated PC service was then stopped and restarted using the same isolated directories. The browser advanced to minute 32, then used the named PC **Restore world** control. The service returned minute **31** with the same bench ID, residents (`59d4c14d16164ad3b91e719ac272f5d5`, `b4d490828fd4423f9a12ad8ffd7f7393`), v2 interaction, 2.2 m / 90° recipe, and Bo energy **48.95**. The saved checkpoint and live service snapshot agree on these fields. No browser console errors or warnings were recorded.

Validation after rebasing onto the published Creator branch and adding procedural resource isolation: WebRuntime `npm test` **449/449**, `npm run build` successful; ControlService full `unittest discover` **738/738** on the rebased source before the view-only resource fix. The Vite large-bundle warning remains. Tests include source-bound revision rejection, v1 GLB recenter compatibility, procedural Citizens routing and checkpoint validation, queue rejection for rigid GLB affordances, preservation of unrelated rigid motion through Undo/Redo, and unchanged-instance mesh reuse. The [browser screenshot](procedural-citizens-browser.png) shows the generated bench and Bo's completed rest after reopening. A fresh browser reload against the rebased build again showed the exact bench ID, 2.2 m / 90° recipe, v2 `bench-rest` descriptor, both resident IDs, Bo's energy 48.95, and zero console errors or warnings.

This is desktop virtual-floor proof. Quest VR/AR wearer input, spoken requests, and physical-room surfaces remain unverified. The bench interaction is a reviewed rest affordance; generalized procedural affordance types need their own measured PC contracts.
