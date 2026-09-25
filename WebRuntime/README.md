# Matrix Web Runtime v0.1

This is a Three.js/WebXR runtime client for the existing Matrix Loading Operator service. It shares scene schema 1, the seven bundled asset IDs, command names, reviewed proposals, runtime receipts and PC save/restore. The Unity runtimes remain supported.

## Desktop quick start

From this repository, build the web client:

```powershell
Set-Location WebRuntime
npm.cmd install
npm.cmd run build
Set-Location ..
python ControlService/server.py
```

Open `http://127.0.0.1:8765/web/`. Click a floor point, enter `Summon a chair here`, choose **Create proposal**, review the command, and choose **Apply proposal**. The full Operator is still at `http://127.0.0.1:8765/`. To use its Codex planner, start the service with the existing `Start-CodexControlService.ps1` and choose **Codex AI on PC** in the web panel. Do not run a Unity runtime against the same service at the same time: the service grants one active runtime lease.

On desktop, arrow keys or WASD move the camera, right-drag looks around, left-drag moves an object across its current horizontal plane, and Shift + left-drag raises or lowers it. You can switch between horizontal and vertical movement without releasing the mouse; the object stays in place at the switch. Click a floor point to select where the next object goes. A completed drag updates the scene and can be undone or saved.

The service stores named scenes in its existing PC scenes directory. The browser also retains the current scene in this tab's session storage so a refresh keeps the same object IDs until the tab is closed. This is separate from named PC saves.

## Add an asset while Matrix is running

Export a **static, self-contained GLB** from Blender. Use metres, and place the object's base near Y=0. Embed textures in the GLB. Then register the file on the PC:

```powershell
python ControlService/register_web_asset.py 'C:\path\to\glass-arch.glb' --name 'Glass Arch' --description 'A translucent display arch'
```

Registration validates the GLB header, embedded resources, size and mesh budget, copies it into an immutable content-addressed catalog, and prints its `assetId`. The running browser polls the catalog every 10 seconds, or use **Refresh assets**. The next Operator proposal can spawn that ID without a browser or APK rebuild. The browser fetches the GLB from the same authenticated service, checks rendered bounds (each axis at most 20 m), and places its base at the selected point. A named Matrix scene preserves the exact versioned asset ID; restoring it requires the same registered GLB.

The image generation and Blender work can be automated as a queued authoring job that produces this GLB. This slice provides the import/hot-load boundary; it does not yet run Blender MCP, call an image model, or claim screenshot matching or 60 fps on Quest.

## Build a procedural asset on request

In the browser, expand **Create a procedural asset**, choose Arch, Monolith, or Pedestal, a palette and dimensions, then select **Build asset**. The PC service reports `queued`, `building`, then `ready` or `error`. At `ready`, the browser refreshes the catalog and enables **Place generated asset at selected point**. Placement uses the existing runtime command/receipt path; it is an explicit user action and can be undone. The job status reports PC authoring time in milliseconds. The cataloged GLB persists across service restarts, while the job history is session-only.

This is a deliberately limited procedural baseline: the freeform visual brief is retained in the job and asset description for later image/Blender work, but it does not alter the generated geometry yet. A sample slate arch reached `ready` in 11 ms in one local desktop smoke run; that is an observation on this PC, not a latency guarantee and not a prompt-to-visible or headset performance measurement. Four jobs may be active and the service retains at most 32 job records. Asset registration still has the 16 MiB, mesh and vertex limits described above.

## Quest and XR

The client probes `immersive-ar` and `immersive-vr`. AR uses browser hit testing where available and shows a placement reticle. In XR, point at an object and hold either controller trigger to move and rotate it; release to commit its new transform. The object keeps its initial offset from the controller while held. A committed move appears in the Operator snapshot and can be undone or saved. Trigger on the floor selects a placement point. The current scene uses a session-local `web-floor` anchor and reports `white-room` capability to the Operator. It does **not** claim MRUK room geometry, persistent physical anchors, exact Unity prefab visuals, native Quest feature parity, or tested Quest 3 placement.

WebXR requires a secure origin on a headset. For a trusted HTTPS endpoint, the existing service can serve the built client and API from one origin:

```powershell
$env:SANDBOX_TOKEN = '<a unique random token of at least 24 characters>'
python ControlService/server.py --host 0.0.0.0 --port 8765 --tls-cert '<trusted-fullchain.pem>' --tls-key '<private-key.pem>'
```

Open `https://<certificate-hostname>:8765/web/` on Quest and enter the token in the panel. The token stays in tab memory. The certificate must be trusted by the headset; an ordinary self-signed development certificate will not establish a trusted WebXR origin. Keep this endpoint on a trusted local network or authenticated tunnel. No browser connection to the local-only `/api/v1/` companion API is assumed.

## Scope and limits

- Browser visuals are light procedural stand-ins for the seven shared catalog IDs. Static Unity AssetBundles are not GLB files and cannot be directly loaded here. New Blender-authored static GLBs use the separate web catalog above.
- The Operator's existing planner can arrange, edit and save these catalog objects. The procedural authoring controls provide three typed shape recipes; arbitrary geometry and sandboxed generated behaviors require a separate typed command/capability contract before an AI can request them through the shared service.
- The runtime supports Rotate and Bob scene configuration; the current browser animation restarts its phase after an edit or reload. Unity's pause/resume phase behavior is more complete.
- The browser runtime publishes a virtual floor even while showing AR passthrough. Saved positions are not guaranteed to align with the same physical spot after ending and restarting an XR session. Quest 3 hardware validation and persistent-anchor mapping are tracked in [issue #44](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44).

## Checks

```powershell
Set-Location WebRuntime
npm.cmd test
npm.cmd run build
```

Run `python -m unittest discover -s ControlService -p 'test_*.py'` from the repository root to check the existing PC service after server changes.
