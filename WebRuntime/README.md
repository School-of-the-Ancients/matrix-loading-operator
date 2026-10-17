# Matrix WebXR runtime

`/web/` is the current Three.js/WebXR Matrix and the destination of `/`. Its ordinary world is browser-owned. ControlService supplies PC capabilities, validation and receipts. The original Unity Operator remains loopback-only at `/legacy/operator`; see the [route map](../Docs/Control-Page-Routes.md) and [Unity archive](../Archive/Unity/README.md).

The published **v1.2.0** package is frozen at `858d486e9ee8507af36e2a05d78f1d34fc9ca2b0`. Follow its bundled `RELEASE-README.md` and the [checkpoint guide](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/Docs/V1.2-Checkpoint.md) for downloads, dependencies, checksums and acceptance. This guide describes current source, including the later [#207 Operator handoff](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/207); that change is absent from the frozen package. Historical implementation details and evidence remain in the [immutable previous guide](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/WebRuntime/README.md).

## Run on desktop

Build a source checkout with its locked dependencies:

```powershell
Set-Location WebRuntime
npm.cmd ci
npm.cmd run build
Set-Location ..
python ControlService/server.py
```

Open `http://127.0.0.1:8765/web/`. Close other Matrix runtimes: the service grants one active runtime lease. AI requires configured PC Codex; offline rules handle simple scene commands.

| Input | Action |
| --- | --- |
| WASD/arrows; right-drag | Move desktop camera; look around. |
| Creator left-drag; Shift + left-drag | Move an editable object horizontally; change height. |
| Running Play/Test drag | Grab a dynamic body; release resumes Rapier. |
| XR trigger on an editable object | Hold and carry with controller movement/rotation. |
| Grabbing hand's `xr-standard` stick | X sideways, Y forward/back relative to view; hold stick click for vertical Y. |
| Opposite hand's stick | X yaw, Y pitch of the held object. Roles swap with grabbing hand. |

A gold outline marks the held object; Operator stays visible. Creator release commits the same object ID. Play/Test release uses bounded recent XR movement/spin; cancelled or untracked release does not throw. **Hide controls / Show controls** changes sidebar layout only. Display boards show a large bound headline and smaller complete reading; static headlines can truncate.

### Quest controls FAQ

**How does AR point placement work?** Select a prop, pin a fresh destination and ask Codex. Ordinary edits use free placement without automatic resizing, straightening or physical-clearance certification. **Fit to room** and its fitting checks are deferred from v1.2. Explicit measured tools retain their guards.

**Where does speech go?** **Hold for Codex** uses the persistent Agent conversation from every Operator page. **Hold to Add** targets the captured active turn; **Stop Turn** remains available on World. Connect and apply permissions first. Navigation and the separate text Planner do not reroute speech. Stale/failed delivery keeps editable words; session refresh never resends them or starts another turn. No-speech/busy-transcription recovery refreshes status; a failed status read requires reconnecting.

**Where is the panel?** Click either thumbstick to recall a pinned/hidden panel or hide a following one. Release an object first: grabbing-hand stick click controls height during a grab.

**How do I leave?** Select **WORLD → EXIT VR / EXIT AR** to return to the same `/web/` page.

## Operator in AR or VR

Aim at Operator and hold a trigger, or hold either grip, then release a 0.25–15 second voice request through PC Whisper/Codex. The panel shows replies, recent turns, proposals and game progress. **Next**, **Apply**, **Discard**, **Hide**, pin/recall and **CREATE/PLAY** remain available. **WORLD** includes room confirmation, saves, Undo/Redo and **New Chat**.

| Surface | Frozen v1.2 | Later #207 source |
| --- | --- | --- |
| XR conversation | **CODEX** | **OPERATOR**, with **ACTIVITY** return |
| Separate desktop text Planner | **Operator Planner** | **ADVANCED PROPOSALS / OFFLINE** |
| Image return | **BACK TO CODEX** | **BACK TO OPERATOR** |

Current disconnected creative requests open Operator with an explanation and copy into an empty draft, preserving a different draft. They do not connect, send or approve automatically. An uncertain-delivery warning survives reconnect/Stop until editing or confirmed delivery. These later changes need their own candidate validation.

Use **Start or resume Codex**, choose **Reviewed** or deliberately acknowledge/apply **Full access**, and check service status before XR. An unapplied selection grants nothing; mode changes require idle work. Matrix validation and receipts apply in either mode. **New conversation** in the Agent section archives the previous Portal session and retains world/permissions; exit XR and finish or stop work and pending images/panoramas/builds first. Other views must reconnect. Planner **New conversation** and XR **New Chat** clear only Planner context. See [Agent Portal operations](../ControlService/AGENT_PORTAL.md).

Under the conversation's **IMAGE PREVIEWS**, **PREVIOUS / NEXT IMAGE**, **USE VERSION**, **RETRY PREVIEW** and the return button manage concepts. **VISUAL CONCEPTS → Image source** chooses a configured provider; **Auto / Procedural / Blender** chooses the selected-image build method. Generation/selection alone never builds. An explicit later build/model/place request attaches the selected image bytes; ordinary chat does not.

### AR room and origin

Inspect real-room floor/support outlines before **Outlines match — enable measured edits**. This confirms scan geometry, not every object's fit. Measured-surface edits require ready AR and confirmed outlines; stale tracking pauses grabs.

A bound world's missing/untracked persistent origin hides its old objects and blocks edits/checkpoint restore. It requires the exact saved handle. Nonempty older saves lacking explicit provenance require archive/rebase even if an old handle exists. Explicitly unbound new worlds can preview without one; passive session anchoring stays unbound. A verified persistent handle or retained virtual-floor scene/game edit records binding; a temporary measured object alone does not.

**Retry Saved Room Origin**, **Archive + Place Here** and **Archive + Start Empty** resolve these cases. The latter two require confirmation and successful recovery archiving before changing anything. Place Here carries digital poses together to a new anchor at current floor position/facing; it does not fit objects to surfaces. Start Empty clears the active world. Exit AR before resetting session-only physical objects. The new room stays read-only until tracked. Recovery retains at most three archives: **Download room recovery archives**, verify the export, then **Clear local recovery archives after export**.

With a tracked persistent anchor, **World → Move / Turn Digital Layout** moves the root by 0.25 m or turns it 15°. IDs, local transforms and game/Citizens data remain unchanged. Active Agent work/exchange blocks adjustment; a step invalidates the old point, tracking-epoch commands and outline confirmation. Inspect, choose **I Checked Scene Clearance**, then separately confirm outlines. Existing-object clearance is not automatically revalidated. Only browser saves/manual checkpoints retain this offset with the exact anchor; PC checkpoints exclude it. Missing/different handles hide the saved world. These recovery/layout flows still need wearer acceptance.

### Camera review

Passthrough compositor pixels are unavailable to JavaScript. **Enable environment camera for AI review** separately requests a MediaDevices rear camera. Unknown/front streams stop; permission denial never retries automatically. Enabling shares nothing; **Stop environment camera** ends tracks.

**Review View** (desktop **Review current view with AI**) explicitly shares a fresh capture with the persistent Agent. An identified AR environment stream produces a labeled camera/render JPEG pair, **not calibrated or pixel-aligned**. Measurement uses room geometry. The service binds an opaque capture ID to client, room, revision, runtime generation and presentation, requires its ready receipt, and attaches it once. Browser-supplied image paths are not accepted; temporary files clear on completion/cancellation/error/restart. Without a usable camera, review is virtual-only. Mixed failure is explained before a new virtual capture; it never becomes a physical-image claim. Camera timestamps describe JavaScript frame copying, not sensor exposure or end-to-end latency. Device availability remains subject to browser permissions and wearer checks.

## Compose a game

**Enter Play/Test**, **Stop / Pause**, **Resume Play**, **Return to Creator** and XR **CREATE/PLAY** control the same world. [Creator tools](../Docs/Procedural-Creation.md) provide procedural recipes, bounded Rapier bodies/colliders, existing-ID challenges, reviewed scaling, displays and archives.

**Lock selected object / Unlock selected object** requires paused Creator and valid tracking/origin. Locked scenery stays selectable while direct grabs cannot move it; Play cannot unlock it. Lock policy saves with the object.

The separate **Codex AI on PC** Planner can propose “return three orbs to a pedestal.” Apply binds ordinary object IDs to pickup/delivery roles and release-near scoring. Each pickup scores once; each role pair has one rule, a score threshold must be reachable, and all objectives must pass to win. Progress saves. This planner does not configure general physics, combat, pathfinding or executable scripts. Procedural creation needs no Blender export.

### AI Citizens desktop fixture

| Path | Ownership and controls |
| --- | --- |
| `/web/` **AI CITIZENS** | Opt-in browser world. **Start here** requires empty desktop virtual floor. **Use selected station** preserves a nonempty authored scene and adds two residents. |
| `/web/citizens.html` | Separate seeded local simulation with needs, movement, contention, pause/step, inspector/log and its own save; no main-world join or Agent Portal. |
| `/web/hosted.html` | Separately started PC/Node owns the fixed Ada/Bo world and clock. View token only; no visitor edits, ticking or local saves. Never enter the owner token. |

Main-world stations support reviewed built-in chair/table, static registered GLB or pinned static curved-bench affordances. Active games, moving/unsupported geometry and blocked placement are refused. While paused, **Add selected station** allows one complementary rest/eat station; replacements preserve surviving residents/progress. Movement uses bounded static replanning; a fourth blocked social tick interrupts without benefit. Nested Citizens v15 migrates supported older states; outer world v3 still loads v2 scene/game saves. Moving affordances/navigation and broader Quest simulation remain unaccepted. See [shared-world operations](../Docs/Citizens-Shared-World.md).

The [hosted fixture](../Docs/Persistent-World-Host.md) resumes its last complete tick without downtime catch-up. It does not migrate Creator worlds. Its one addition belongs to either a reviewed PC human request or Bo's bounded request. Digital-world AR viewing does not establish physical alignment/collision.

**Block Scale Lab** pairs through a one-use `/clients` code for a selected desktop virtual-room block. X/Y/Z factors are 0.25–4; canvas **1–4** proposes uniform factors and **R** a reviewed reset after confirmation. Every proposal needs owner Apply on `/clients`, including MCP proposals and when safe auto-apply is enabled. Results use matching receipts/catalog bounds, not physical measurement. Reloaded results require matching ID/transform; another request requires pairing. Restart loses the Agent's process-local baseline. See [the experiment contract](../Docs/Scale-Experiment.md).

## Save and restore

| Control/storage | What it preserves |
| --- | --- |
| Automatic browser save + tab recovery | Scene/game, origin provenance/verified handle; v3 includes Citizens v15. Profile/origin scoped. |
| XR **Save World / Restore Saved** | Manual browser whole-world checkpoint; restore needs a second tap. Save also requests a separate scene-only PC backup, without game progress. |
| Desktop **Save world / Restore world** | PC whole-world checkpoint in `--scenes/world_checkpoints/`; ready desktop virtual room only. Second-click restore validates dependencies and waits for PC snapshot acceptance. |
| **Save scene / Restore scene** | Legacy scene-only contract. |
| **Archive + new world / Restore archive** | Archive validated active browser world before switching; distinct from PC files and three-slot room-recovery archives. |

Whole-world paths preserve supported IDs, bindings, progress, components, animation bindings and bounded Rapier pose/velocity/sleep. Held-body saves wait for release; pending solver attach retains motion and blocks edits. Older files without motion load authored pose/zero velocity. Contacts/caches are transient; replay is not bit-exact.

Reload tries the newer timestamped browser copy. Invalid worlds are quarantined before trying older data; quarantine failure stops recovery without overwriting copies. Missing registered assets instead pause edits/checkpoints/PC exchange while preserving saves. Restore the exact `--web-assets` manifest/GLBs, then **Refresh assets** or wait ten seconds. Checkpoints contain references, not asset bytes. Old uncertain commands are rejected after recovery, never replayed automatically. Persistence warnings distinguish durable and tab-copy failure; closing the browser can lose tab-only changes.

Archive switching requires paused Creator, no held body/pending action and usable origin; Agent archive tools retain approvals/receipts. Temporary measured-plane objects remain session-local. Clearing site data removes browser worlds/archives. See [PC checkpoint operations](../ControlService/WORLD_CHECKPOINTS.md).

## Panorama environment

One equirectangular panorama reference stores digest/yaw; bytes remain in the PC catalog. **PANORAMA BACKGROUNDS** generation and selection are separate from **Use selected panorama / Remove panorama**. It appears on desktop/VR, stays hidden but retained in physical AR, and must validate before restore. Each exchange preflights at most one panorama and sends its exact receipt before another dependency. Missing dependencies fail; inspect status/world before retrying.

## Blender assets

**Create requested object in Blender** uses a validated blueprint of at most 80 bounded primitive parts, then a fixed exporter. It captures model/reasoning selection on submission; direct-button jobs use saved preference. Richer modeling uses separately configured PC Blender MCP or local scripting; the blueprint is not arbitrary modeling/rigging.

Register exported GLBs through `register_web_asset.py` or approved `matrix_register_glb`: exact staged SHA-256, embedded-resource/size/mesh validation and immutable catalog. Registration is not placement. Refresh/poll, then separately approve spawning; success requires a receipt and observed ID. Registered bounds account for recentering/floor alignment; excess rendered bounds fail, and measured-support footprints are rechecked on moves/duplicates/load. Fallbacks are labeled unanchored previews.

Up to eight bounded named clips are catalog-checked and independently cloned. A single clip loops on virtual-floor instances; `bind_animation` selects loop/one-shot clips, triggered by desktop click/XR selection. Measured-support instances stay static. Playback restarts on reconstruction; phase is unsaved. [Authoring tiers](BLENDER_AUTHORING_TIERS.md) separate these paths. Source `art/` examples are omitted from release ZIPs; retrieve matching examples from the frozen source.

### Agent Portal Matrix tool

Install MCP into the same Python environment as ControlService:

```powershell
python -m pip install -r ControlService/requirements-agent-mcp.txt
```

Only Portal's Codex process receives Matrix MCP; other configured tools remain. Credentials stay PC-only. `matrix_scene_summary` reports room/revision and at most 24 objects, or offline after lease expiry; selected/pointing context is optional.

Reviewed bounded Matrix requests offer XR Approve/Deny. Generic commands/MCP calls and custom GLB metadata need complete PC review: an interactive service terminal accepts one-time `approve`/`deny` (Enter denies). Incomplete/oversized requests, other elicitation forms and file-change approvals gain no approval path. Without a terminal, Deny/Stop, restart interactively, reconnect and explicitly retry. No in-flight replay. See [approval operations](../ControlService/AGENT_PORTAL.md#reviewing-blender-and-other-tool-requests-on-the-pc).

`matrix_move_object` requires paused Creator and current room/revision, ID, asset and observed transform; optional complete rotation/scale preserves omitted fields. Scale is 0.01–20. This edits virtual-floor objects, including ready AR previews, not physical supports. Move/spawn/component status tools reconcile queued or unconfirmed receipts; never retry uncertain writes automatically.

### Runtime components, schema 1

One numeric package per virtual-floor object supports nine transform outputs, 64 nodes, depth eight and 4 KiB. Saved base transforms, a distinct target and elapsed time combine through bounded `add/mul/sin/cos`; no JavaScript, DOM, storage, network, shell or credentials. Invalid output/missing target fails back to base pose. Stop before grabbing. Saves/Undo/Redo embed packages/status; wall-clock phase advances while closed. Publication stores an immutable version without editing the world; attach/stop/remove validate identity/revision and require receipts. This schema excludes physical-surface edits and arbitrary behavior code. [Detailed component contract](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/WebRuntime/README.md#runtime-components-schema-1).

### Virtual-floor drop, schema 1

The older `set_physics`/`remove_physics` path runs one bounded registered-GLB vertical drop in the White Room. Contact needs matching transient `physicsStates`, not merely a command receipt. It saves authored pose/config, not velocity/contact/settled pose; this differs from whole-world Rapier motion above. See [scope and lifecycle](../Docs/Web-Floor-Physics.md).

## Quest checks and limits

Quest needs trusted HTTPS or the existing ADB reverse setup. Follow the [Quest acceptance entry](QUEST3_ACCEPTANCE.md) and [single current acceptance record](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/Validation/V1.2-Headset-Acceptance.md). Automated/desktop evidence does not pass hardware checks. Identify the candidate and consolidate the remaining wearer session; this guide does not promote frozen v1.2 or later #207 to physically accepted.

```powershell
Set-Location WebRuntime
npm.cmd test
npm.cmd run build
Set-Location ..
python -m unittest discover -s ControlService -p 'test_*.py'
git diff --check
```
