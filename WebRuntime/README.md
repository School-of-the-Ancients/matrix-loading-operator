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

The service stores named scenes in its existing PC scenes directory. The browser automatically saves the virtual-floor scene to its local storage after each edit, preserving object IDs when Quest Browser closes and reopens on the same origin. Older tab session saves are imported on the next load. These browser copies stay on that headset/browser profile; use a named PC save to transfer a scene to another client or protect it from cleared site data. Objects tied to temporary measured WebXR planes remain session-only.

## Speak to Operator

In the 2D browser page, tap **Tap to speak**, speak, then tap **Tap to send**; Quest Browser's long-press text selection makes a held page button unreliable. Inside AR/VR, aim a controller at the Operator panel and hold the trigger, or hold either controller grip. Release after a 0.25–15 second request. The in-world panel keeps the transcript and Codex response visible until the next request; **Next** cycles longer replies. The browser retains the six most recent request/reply pairs in this tab and sends them with the next text or voice request, so a follow-up can refer to the previous turn. **New chat** on the in-world panel or **New conversation** in the browser clears that context without clearing the scene. Closing the tab starts a fresh conversation; scene objects have separate durable browser storage. Prior replies are context, not proof that proposed commands succeeded; the current scene and runtime receipts remain authoritative. Press **Pin to wall** to place the panel on a measured wall facing you (or fix it in space if no wall is in view), then **Follow me** to bring it back. In VR, **Pin here** fixes it in the virtual room. **Voice on/off** toggles spoken replies. On Windows, the PC service generates a short WAV using an installed system voice, and Web Audio plays it after the user activates the microphone or request button. Browser speech synthesis is a fallback; Quest audio playback still needs a headset retest. The panel also shows recording, connection, proposal and runtime receipt status even when Quest Browser does not show a DOM overlay. **Review view** captures the current rendered scene and asks Codex to inspect visible placement, scale, and floor issues; it presents any proposed corrections for review. The image contains virtual objects and WebXR room outlines, without physical passthrough pixels. The browser sends a bounded 16 kHz mono WAV to the existing PC-local Whisper worker; the audio is processed in memory. The Codex planner receives the transcript with the current scene, selected surface, and tracked viewpoint. When **Automatically apply safe scene requests** is checked, validated spawn, transform, select, duplicate, and animation commands are queued automatically. Deletion, clearing, and scene loads still stop at the proposal review. Runtime receipts report whether objects actually appeared.

If this checkout says local speech is not installed but another Matrix checkout already has the `.speech-venv` and `.speech-models` directories, restart the PC service with `Start-CodexControlService.ps1 -SpeechRoot 'C:\path\to\that\checkout'`. The launcher also detects a single complete speech installation in this checkout or a sibling checkout, so it does not need to redownload the model. This speech pipeline is separate from ChatGPT Voice in the Codex desktop app; it does not require an OpenAI Realtime API key.

## Add an asset while Matrix is running

Export a **static, self-contained GLB** from Blender. Use metres, and place the object's base near Y=0. Embed textures in the GLB. Then register the file on the PC:

```powershell
python ControlService/register_web_asset.py 'C:\path\to\glass-arch.glb' --name 'Glass Arch' --description 'A translucent display arch' --spawn-scale 0.5 --local-bounds '{"center":{"x":0,"y":1,"z":0},"size":{"x":2,"y":2,"z":1}}'
```

Registration validates the GLB header, embedded resources, size and mesh budget, copies it into an immutable content-addressed catalog, and prints its `assetId`. Measure `localBounds` after the browser's horizontal recentering and floor alignment; the example spans 2 × 2 × 1 m with its base at Y=0. Bounds let the Operator check that the scaled footprint fits a real support surface. The running browser polls the catalog every 10 seconds, or use **Refresh assets**. The next Operator proposal can spawn that ID without a browser or APK rebuild. The browser fetches the GLB from the same authenticated service, checks rendered bounds (each axis at most 20 m), and places its base at the selected point. A named Matrix scene preserves the exact versioned asset ID; restoring it requires the same registered GLB.

The PC can now create a GLB on demand: type a request and select **Create requested object in Blender**, or say something like “Create a portal in Blender.” The service asks the configured Codex CLI for a declarative blueprint, runs a fixed headless Blender builder, validates and registers the GLB, and summons it in the live browser scene. The job status is `queued`, `designing`, `building`, then `ready` or `error`. The result persists in the content-addressed catalog; the job history is session-only. This path uses Blender installed on the PC, but it does not use the live Blender MCP connection or edit the user's open `.blend` file. Blueprints currently compose up to 80 cubes, cylinders, spheres, cones, and tori. Arbitrary sculpting, image-to-3D, and automatic asset replacement after visual review are later work.

## Build a procedural asset on request

In the browser, expand **Create a procedural asset**, choose Arch, Monolith, or Pedestal, a palette and dimensions, then select **Build asset**. The PC service reports `queued`, `building`, then `ready` or `error`. At `ready`, the browser refreshes the catalog and enables **Place generated asset at selected point**. Placement uses the existing runtime command/receipt path; it is an explicit user action and can be undone. The job status reports PC authoring time in milliseconds. The cataloged GLB persists across service restarts, while the job history is session-only.

This is a deliberately limited procedural baseline: the freeform visual brief is retained in the job and asset description for later image/Blender work, but it does not alter the generated geometry yet. A sample slate arch reached `ready` in 11 ms in one local desktop smoke run; that is an observation on this PC, not a latency guarantee and not a prompt-to-visible or headset performance measurement. Four jobs may be active and the service retains at most 32 job records. Asset registration still has the 16 MiB, mesh and vertex limits described above.

## Quest and XR

The client probes `immersive-ar` and `immersive-vr`. AR requests Quest Browser's `plane-detection` feature and Space Setup permission, then displays labeled outlines for the planes returned by WebXR. If no planes appear after three seconds, it asks Quest to open Room Setup when that API is available. The AR runtime sends plane boundaries, labels, and tracked head pose to the Operator. Check that the outlines match the room, then click **Outlines align — enable editing** in the full Operator. Point a controller at a support plane to select a placement point. Until alignment is confirmed, real-room edits are disabled. In XR, point at an object and hold either trigger to grab it; release to commit the transform.

The AR scene starts with a copy of the virtual-room objects. It measures the Quest Space Setup floor and places the virtual floor at that height. The wearer confirmed this corrected the robot and other objects appearing at head height in AR. When available, the client saves a WebXR persistent anchor as a shared origin for virtual-floor objects across AR and VR sessions; the in-world Operator panel reports whether that origin is located. After exiting and re-entering AR while facing another direction, the wearer confirmed “ROOM ANCHORED” and that the robot and other objects stayed in their physical spots. That earlier browser version saved scene objects only in tab session storage, and closing the browser lost the 14-object arrangement. The current version saves virtual-floor objects in durable browser storage on each edit. A Quest Browser close and reopen retained the robot and Kestrel ship with their exact object IDs. The wearer confirmed both returned in the same physical spots, and the AR runtime still reported “ROOM ANCHORED.” If a saved AR origin cannot be restored, the browser hides the old virtual-floor objects instead of silently moving them to the headset's current pose. VR uses the previously measured eye-to-floor height if an anchor is unavailable, but this fallback cannot establish the same horizontal position or direction in the physical room. VR alignment remains unverified. Objects explicitly placed on measured planes remain tied to this WebXR session. When Quest replaces plane objects within that session, the client keeps an ID only if label and measured shape uniquely match; ambiguous matches pause editing for recovery. Ending AR returns virtual-floor edits to the desktop scene. A saved AR scene cannot be restored into a later browser session because these plane IDs are not persistent spatial anchors. The browser does not provide MRUK geometry, physical-camera screenshots, depth occlusion, or native Quest feature parity. Room planes, aligned outlines, virtual objects, and a spoken Blender request that imported a robot were observed on Quest 3. A virtual-only capture from the live Quest Browser rendered the robot and scene objects. PC-generated voice playback, reboot recovery, and stable placement after tracking loss still need headset validation.

For local development without a cable after the first setup, Meta supports ADB over Wi-Fi. With USB connected and developer mode enabled, run `adb shell ip route` to find the headset's Wi-Fi IP, then `adb tcpip 5555`, `adb connect <quest-ip>:5555`, and `adb -s <quest-ip>:5555 reverse tcp:8765 tcp:8765` (substitute the service's actual port). Unplug USB and open `http://127.0.0.1:8765/web/` in Quest Browser. The PC service remains bound to loopback; the wireless ADB reverse tunnel carries this local development connection. Reconnect ADB after a headset reboot or Wi-Fi change. Air Link does not forward Quest Browser's localhost address. A trusted HTTPS endpoint is the direct network option below.

WebXR requires a secure origin on a headset. For a trusted HTTPS endpoint, the existing service can serve the built client and API from one origin:

```powershell
$env:SANDBOX_TOKEN = '<a unique random token of at least 24 characters>'
python ControlService/server.py --host 0.0.0.0 --port 8765 --tls-cert '<trusted-fullchain.pem>' --tls-key '<private-key.pem>'
```

Open `https://<certificate-hostname>:8765/web/` on Quest and enter the token in the panel. The token stays in tab memory. The certificate must be trusted by the headset; an ordinary self-signed development certificate will not establish a trusted WebXR origin. Keep this endpoint on a trusted local network or authenticated tunnel. No browser connection to the local-only `/api/v1/` companion API is assumed.

## Scope and limits

- Browser visuals are light procedural stand-ins for the seven shared catalog IDs. Static Unity AssetBundles are not GLB files and cannot be directly loaded here. New Blender-authored static GLBs use the separate web catalog above.
- The Operator's existing planner can arrange, edit and save these catalog objects. The Blender authoring job builds new objects from bounded declarative geometry; it cannot yet make arbitrary sculpted meshes or executable behaviors. A separate procedural control also provides three typed shapes.
- The runtime supports Rotate and Bob scene configuration; the current browser animation restarts its phase after an edit or reload. Unity's pause/resume phase behavior is more complete.
- Desktop and VR use a virtual `web-floor` anchor. AR uses measured WebXR planes; their plane IDs are only valid within the current session. The separate persistent WebXR anchor is the shared origin for virtual-floor objects when Quest restores it. Quest 3 validation and persistent-anchor mapping are tracked in [issue #44](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44).

## Checks

```powershell
Set-Location WebRuntime
npm.cmd test
npm.cmd run build
```

Run `python -m unittest discover -s ControlService -p 'test_*.py'` from the repository root to check the existing PC service after server changes.
