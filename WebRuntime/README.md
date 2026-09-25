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

In AR, inspect the labeled floor and support outlines against the real room, then choose **Outlines align — enable editing** on the WebXR World page. The server and browser still require an AR room in the ready state with confirmed alignment before edits to measured physical surfaces. If tracking becomes stale, local object grabs are paused.

When a saved room origin cannot be located, or a saved world has objects but its anchor handle is missing, `/web/` hides the old virtual world and pauses editing. Checkpoint restore and scene edits remain locked while that origin is unavailable. The in-world World page offers **Retry Saved Room Origin**, **Archive + Place Here**, and **Archive + Start Empty** as applicable. The latter two need a second confirming tap. Place Here deliberately positions the existing virtual world at a new tracked room origin; Start Empty clears the active world. Both first save the old virtual scene, game, and anchor handle in a local recovery archive. If archiving fails, the reset stops without changing the world. Session-only physical objects must be left behind by exiting AR before reset because they cannot be restored from that archive. The new room stays read-only until its anchor is tracked. At most three archives are retained; use **Download room recovery archives**, verify the downloaded file, then **Clear local recovery archives after export** to free slots. These recovery actions still need Quest wearer validation.

The `immersive-ar` session shows Quest passthrough behind transparent Three.js content. The WebXR passthrough compositor does not expose its pixels to JavaScript. [Meta's WebXR mixed reality guide](https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality/) describes both behaviors.

The WebXR app now offers a separate **Enable environment camera** action in AR. It requests a rear-facing stream through browser `MediaDevices`; Meta's [IWSDK camera guide](https://developers.meta.com/horizon/documentation/iwsdk/guides/13-camera-access/) documents that camera streams can run during immersive XR. If exact facing selection is unavailable, the user-initiated flow can enumerate a labeled rear camera and briefly open a generic permission stream to reveal device labels. Even after exact selection succeeds, the stream must have affirmative environment evidence from track settings, a recognizable label, or its enumerated device. Unknown or front-facing streams are stopped and never advertised as mixed; an explicit permission denial is not retried automatically. The app detects actual stream success before advertising mixed capture. **Review View** then sends one labeled JPEG with the camera frame on the left and the Three.js render on the right. These panels are **not pixel aligned or spatially calibrated**: current browser camera access does not supply the physical camera pose and intrinsics needed to register virtual objects onto camera pixels. The image is useful for qualitative AI review of both views, while room-plane geometry remains the source for measurements. If camera permission, enumeration, or capture fails, Review View falls back to virtual-only capture. The original Unity Matrix retains its separate calibrated mixed-camera path.

Camera availability still needs a Quest 3 wearer test. A [Meta investigation](https://developers.meta.com/horizon/feedback/vr/investigations/1557993751977106/) reports a Quest Browser build where the headset-camera permission prompt fails and environment-camera selection is rejected. This app does not bypass browser permissions.

## Compose a game

With Codex AI on PC selected, ask for a game such as “Create a game where I return three orbs to a pedestal” or “Score 20 points by returning orbs.” Codex returns a reviewed declarative specification with pickup and delivery-zone roles, release-near rules, and delivered-count or score-at-least objectives. Apply spawns role instances as ordinary Matrix scene objects and binds their object IDs to the game. Grab a pickup and release it within the rule's distance of a matching delivery zone to score once for that object. The Operator shows objective progress and a win state when every objective is met. Multiple role and zone pairs can express matching-object games using the same mechanics; each pickup-role and delivery-zone-role pair has at most one rule. A score-at-least objective must be reachable from the available pickups and rule points; one score threshold may appear in a game. Score and completed pickups persist with the bound scene objects.

Supported mechanics are pickup roles, delivery-zone roles, release-near scoring, delivered-count objectives, and score-at-least objectives. The planner must report unsupported requests honestly. Chasing enemies, combat, weapons, physics systems, pathfinding, and arbitrary executable scripts are not implemented. Game planning currently selects assets already in the catalog; create and register a missing asset through Blender before requesting a game that depends on it.

## Save and restore

The browser writes a version 2 world envelope containing the virtual-floor scene and game in one local storage value after edits and progress changes. It also writes a tab recovery copy. Each write has a monotonically increasing timestamp, so reload tries the newer envelope first if either storage write failed. After the asset catalog loads, a world that fails full scene or game validation is quarantined before the older copy is tried. If quarantine storage fails, automatic recovery waits without overwriting either browser copy. Older scene-only browser saves migrate with the same Matrix object IDs and `game: null`. Persistent save failures remain visible in the page and in-world Operator because closing Quest Browser may lose tab-only changes. A tab-copy failure is reported separately when the durable copy succeeded.

**Save World** on the in-world panel creates a manual browser checkpoint. It also requests a named **scene-only** PC backup through the existing Unity-compatible API; that PC file does not contain game progress. **Restore Saved** requires a second confirming tap and restores the browser checkpoint's scene and game together. Objects on temporary measured WebXR planes remain session-local. The browser copy belongs to that browser profile and origin, and clearing site data removes it.

## Blender assets

Ask the Operator to create an object in Blender or use **Create requested object in Blender**. The current PC path asks Codex for a bounded JSON blueprint of at most 80 primitive parts, then a fixed Blender Python builder exports and validates a GLB. The job captures the Operator's selected Codex model and reasoning effort when submitted; a typed `/api/plan` request may use its validated per-request Codex selection, while the direct Blender button uses the saved service preference. It supports cubes, cylinders, spheres, cones, and tori with bounded dimensions and materials. It does not perform arbitrary mesh modeling, sculpting, rigging, animation, or direct Blender MCP authoring. A validated GLB enters the content-addressed web asset catalog and can be placed in the Matrix scene. Static self-contained GLBs can also be registered with `ControlService/register_web_asset.py`.

[Blender authoring tiers](BLENDER_AUTHORING_TIERS.md) records the richer Agent Portal direction. The current blueprint builder remains a bounded fallback; full Blender MCP authoring through the portal is not yet a runtime capability.

### Agent Portal Matrix tool

The PC-local Codex conversation can now call `matrix_scene_summary` through a read-only Matrix MCP server. Install the optional MCP dependency into the **same Python environment that starts ControlService**:

```powershell
python -m pip install -r ControlService/requirements-agent-mcp.txt
```

ControlService registers this MCP server only for its Agent Portal Codex app-server process. Existing Codex tools and configured MCP servers remain available. `matrix_scene_summary` reads the current connected room ID, scene revision, and at most 24 virtual objects. It returns `online: false` after the runtime lease expires. The MCP server uses a random PC-only loopback credential, which never enters `/web/` responses or browser storage. The wearer can include selected-object and pointing context with a turn; world changes require a typed action tool and runtime receipt.

Codex may request approval for an MCP call. Agent Portal carries this native approval to the existing in-world Approve/Deny controls. Only the exact `matrix_scene_summary`, `matrix_move_object`, and default-metadata `matrix_register_glb` calls have XR-reviewable descriptions; other MCP calls show a generic PC-review message, with Deny and Stop available. This prevents a Blender or other MCP write from being approved on the basis of an incomplete headset summary. A registration with custom description, scale, or bounds needs PC review.

`matrix_move_object` is the first write tool with such a contract. It moves one existing object on the **virtual floor** only, using the current room ID and scene revision, the object's ID and expected asset ID, and a bounded target position. Codex app-server prompts for native approval before the MCP call. The service queues the normal `set_transform` command and waits briefly for a runtime receipt. The tool distinguishes `succeeded`, `failed`, `queued`, and `unconfirmed`; `matrix_move_status` can check the same receipt later. A queued or unconfirmed result must not be retried automatically. Rotation, scale, existing WebRuntime persistence, and command validation remain in the normal runtime path. This tool does not place assets on physical AR surfaces.

`matrix_list_assets` reads a bounded page of the existing GLB catalog. `matrix_register_glb` registers an already exported PC-local `.glb` after Codex provides its SHA-256 digest and the wearer approves the native MCP request. The service stages the exact file bytes, checks the digest, and applies the same GLB validator and content-addressed catalog used by the existing authoring paths. Registration does not spawn an object or modify the scene. The optional MCP dependency is required for these tools; Blender modeling and export still happen through Codex's separately configured Blender MCP.

Registration validates the GLB header, embedded resources, size and mesh budget, then copies it into an immutable catalog. Record the GLB's measured `localBounds` size after the browser's horizontal recentering and floor alignment. Bounds let the Operator check that the scaled, rotated rendered footprint fits a real support surface, including concave edges. Support-bound objects are rechecked on moves, duplicates, and scene loads. The browser refuses to render a GLB whose measured horizontal bounds exceed its registered size. The running browser polls the catalog every 10 seconds, or use **Refresh assets**. A named Matrix scene preserves the exact versioned asset ID; restoring it requires the same registered GLB.

If placement on a measured surface fails, the browser reports the failure and labels any virtual-floor fallback as an unanchored preview.

## Quest checks and limits

WebXR needs a secure origin on Quest. The service can be reached through a trusted HTTPS endpoint or the existing ADB reverse-tunnel development setup. Room planes, persistent origin, environment-camera permission and frame capture, voice requests, in-world Apply/Discard, and game interaction still require a focused wearer check for this branch. Automated tests and a desktop browser do not establish headset behavior.

Use the [Quest 3 acceptance record](QUEST3_ACCEPTANCE.md) for a test-profile run that captures browser capability evidence without changing the wearer's live scene.

```powershell
Set-Location WebRuntime
npm.cmd test
npm.cmd run build
Set-Location ..
python -m unittest discover -s ControlService -p 'test_*.py'
git diff --check
```
