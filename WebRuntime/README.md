# Matrix WebXR runtime

`/` is the original Unity Matrix Operator. `/web/` is the separate Three.js/WebXR Matrix. Both use the existing ControlService API and scene schema 1; the Unity player and its camera capability remain supported. Normal WebXR use stays in `/web/`.

## Run on desktop

```powershell
Set-Location WebRuntime
npm.cmd install
npm.cmd run build
Set-Location ..
python ControlService/server.py
```

Open `http://127.0.0.1:8765/web/`. The service grants one active runtime lease, so close other Matrix runtimes before testing this client. Start the configured Codex service to use **Codex AI on PC**; offline rules still handle simple scene commands. Arrow keys or WASD move the desktop camera, right-drag looks around, left-drag moves an object horizontally, and Shift + left-drag changes its height.

## Operator in AR or VR

Enter AR or VR from `/web/`. Aim at the in-world Operator and hold a trigger, or hold either grip, to speak. Release to send a 0.25–15 second request through the PC Whisper and Codex pipeline. The panel shows the current reply, recent-turn count, proposals, and game progress. **Next** pages long replies and proposals. **Apply** and **Discard** work inside the panel. The **World** page offers room confirmation, save, restore, undo, redo, and New Chat. New Chat clears only conversation context; it leaves scene objects and game progress intact.

In AR, inspect the labeled floor and support outlines against the real room, then choose **Outlines align — enable editing** on the WebXR World page. The server and browser still require an AR room in the ready state with confirmed alignment before edits to measured physical surfaces. If tracking becomes stale, local object grabs are paused. The browser keeps the persistent WebXR room origin behavior: a saved origin that cannot be located hides the old virtual floor objects instead of moving them to the current head pose. A permanent room-origin failure currently requires manual recovery; do not reset the browser's anchor data and assume the old world will align automatically.

The `immersive-ar` session shows Quest passthrough behind transparent Three.js content. The WebXR passthrough compositor does not expose its pixels to JavaScript. [Meta's WebXR mixed reality guide](https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality/) describes both behaviors.

The WebXR app now offers a separate **Enable environment camera** action in AR. It requests a rear-facing stream through browser `MediaDevices`; Meta's [IWSDK camera guide](https://developers.meta.com/horizon/documentation/iwsdk/guides/13-camera-access/) documents that camera streams can run during immersive XR. The app detects actual stream success before advertising mixed capture. **Review View** then sends one labeled JPEG with the camera frame on the left and the Three.js render on the right. These panels are **not pixel aligned or spatially calibrated**: current browser camera access does not supply the physical camera pose and intrinsics needed to register virtual objects onto camera pixels. The image is useful for qualitative AI review of both views, while room-plane geometry remains the source for measurements. If camera permission, enumeration, or capture fails, Review View falls back to virtual-only capture. The original Unity Matrix retains its separate calibrated mixed-camera path.

Camera availability still needs a Quest 3 wearer test. A [Meta investigation](https://developers.meta.com/horizon/feedback/vr/investigations/1557993751977106/) reports a Quest Browser build where the headset-camera permission prompt fails and environment-camera selection is rejected. This app does not bypass browser permissions.

## Compose a game

With Codex AI on PC selected, ask for a game such as “Create a game where I return three orbs to a pedestal” or “Score 20 points by returning orbs.” Codex returns a reviewed declarative specification with pickup and delivery-zone roles, release-near rules, and delivered-count or score-at-least objectives. Apply spawns role instances as ordinary Matrix scene objects and binds their object IDs to the game. Grab a pickup and release it within the rule's distance of a matching delivery zone to score once for that object. The Operator shows objective progress and a win state when every objective is met. Multiple role and zone pairs can express matching-object games using the same mechanics. A score-at-least objective must be reachable from the available pickups and rule points; one score threshold may appear in a game. Score and completed pickups persist with the bound scene objects.

Supported mechanics are pickup roles, delivery-zone roles, release-near scoring, delivered-count objectives, and score-at-least objectives. The planner must report unsupported requests honestly. Chasing enemies, combat, weapons, physics systems, pathfinding, and arbitrary executable scripts are not implemented. Game planning currently selects assets already in the catalog; create and register a missing asset through Blender before requesting a game that depends on it.

## Save and restore

The browser writes a version 2 world envelope containing the virtual-floor scene and game in one local storage value after edits and progress changes. It also writes a tab recovery copy. Older scene-only browser saves migrate with the same Matrix object IDs and `game: null`. A stored world that fails validation after the asset catalog loads is quarantined; the active world can then be saved. Persistent save failures remain visible in the page and in-world Operator because closing Quest Browser may lose tab-only changes.

**Save World** on the in-world panel creates a manual browser checkpoint. It also requests a named **scene-only** PC backup through the existing Unity-compatible API; that PC file does not contain game progress. **Restore Saved** requires a second confirming tap and restores the browser checkpoint's scene and game together. Objects on temporary measured WebXR planes remain session-local. The browser copy belongs to that browser profile and origin, and clearing site data removes it.

## Blender assets

Ask the Operator to create an object in Blender or use **Create requested object in Blender**. The current PC path asks Codex for a bounded JSON blueprint of at most 80 primitive parts, then a fixed Blender Python builder exports and validates a GLB. It supports cubes, cylinders, spheres, cones, and tori with bounded dimensions and materials. It does not perform arbitrary mesh modeling, sculpting, rigging, animation, or direct Blender MCP authoring. A validated GLB enters the content-addressed web asset catalog and can be placed in the Matrix scene. Static self-contained GLBs can also be registered with `ControlService/register_web_asset.py`.

If placement on a measured surface fails, the browser reports the failure and labels any virtual-floor fallback as an unanchored preview.

## Quest checks and limits

WebXR needs a secure origin on Quest. The service can be reached through a trusted HTTPS endpoint or the existing ADB reverse-tunnel development setup. Room planes, persistent origin, environment-camera permission and frame capture, voice requests, in-world Apply/Discard, and game interaction still require a focused wearer check for this branch. Automated tests and a desktop browser do not establish headset behavior.

```powershell
Set-Location WebRuntime
npm.cmd test
npm.cmd run build
Set-Location ..
python -m unittest discover -s ControlService -p 'test_*.py'
git diff --check
```
