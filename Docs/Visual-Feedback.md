# Rendered scene feedback

Issue [#8](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/8) adds an explicit image attachment to the existing scene planner. The operator captures a view, previews it, and chooses whether to send it with one typed request or the next headset voice request. Capturing alone does not invoke AI. Continuous video, automatic scene edits, and physical camera access are outside this increment.

## Using the Operator

1. Build the updated player and start the updated PC service. Older players remain usable for text but do not advertise capture support.
2. In the Operator, choose **Capture current view**. Keep the app awake and headset tracking active. The preview is the Unity camera's monoscopic render, not a screenshot of the operating system or a stereo compositor image.
3. Review the image. Select an explicitly listed image-capable Codex model. The service default can be used for images only when its model is explicitly configured and the local Codex model metadata advertises image input.
4. Check **Send this preview with my typed request** and create a proposal, or choose **Include preview in next headset voice request**, then speak normally. The voice attachment is consumed once when the request begins. Model and reasoning settings still apply.
5. An inspection without edits produces an image review with no Apply action. Proposed corrections use the existing review, Apply, acknowledgement, and Undo workflow.

Images become stale after 30 seconds or a runtime/session, scene, or selection change. Recapture to use image input again, or uncheck typed inclusion / disarm voice inclusion for text-only operation. Ordinary head motion does not invalidate the saved image: inference uses the exact snapshot and camera metadata recorded with that image, not a newer head pose. Animated visual offsets are visible in the image while the snapshot continues to store authoritative placement and behavior configuration.

### What an AR capture contains

AR captures include Unity-rendered virtual objects, world-space UI, and visible MRUK debug geometry against a solid background. They do **not** include physical passthrough or photographs of the room. MRUK semantic data remains structured context; it is not evidence of physical pixels absent from the image. White-room captures show the virtual scene. The provider receives this disclosure together with timestamp, runtime identity, revision, and camera pose.

### Planned Quest 3 camera composite

The intended follow-up, requested by the user, is an optional capture containing the actual room camera image plus virtual content on Quest 3. Meta's [Passthrough Camera API](https://developers.meta.com/horizon/documentation/spatial-sdk/spatial-sdk-pca-overview/) exposes camera frames on Quest 3/3S; Quest Pro is not supported by that camera-access route. Merely running this build on Quest 3 does not enable camera images: the current renderer deliberately excludes passthrough on every device.

That follow-up needs explicit camera permission and image-send consent, runtime capability detection, camera-frame timestamp/pose/intrinsics, matching virtual rendering/compositing, and disclosure that physical imagery is included. Camera frames and the headset compositor have different viewpoints and timing, so compositing must be aligned and tested on the actual headset. Preserve the current virtual-only capture as the fallback when hardware, permission or camera availability prevents a composite. This is a planned capability, not implemented or validated in this increment.

## Provider support and data handling

The native Codex route verifies `codex exec --help` exposes `--image`, looks up the explicitly selected model's `input_modalities` in the PC's public model cache, and attaches a temporary JPEG using `--image`. An unavailable cache/model/modality/CLI route produces an explicit error. Temporary image files are removed when the request ends, including error paths. Remote provider rejection is surfaced rather than retried without the image.

An OpenAI-compatible chat-completions endpoint receives text plus an `image_url` data URL only when the operator has explicitly configured `SANDBOX_AI_SUPPORTS_IMAGES=true` for a model/endpoint that supports it. The default is false; compatible JSON alone does not prove vision support. Offline rules reject attached images. Provider credentials remain in the PC service and are never sent to Unity, previews, or scene saves.

The latest capture lives in PC process memory and is excluded from saved scenes and normal state polling. Preview retrieval uses the existing service authentication and `Cache-Control: no-store`. Provider requests still use the configured provider's data handling rules. Capturing another view resets inclusion choices; it cannot silently replace an image already selected for a request.

## Transport and resource bounds

- Unity renders a disabled temporary non-stereo camera at 960 x 540, after presentation updates, from the registered active viewer camera. It does not clone a passthrough component. GPU render targets and CPU pixel buffers are released after each capture.
- JPEG quality falls from 80 to 55 to 30 if necessary; output is capped at 512 KiB. The PC verifies base64, JPEG header dimensions, a maximum of 1280 pixels per axis, metadata, matching snapshot, capture ID, runtime session and revision.
- Both sides limit capture attempts to one per two seconds. Requests time out after 15 seconds. Failed uploads retain one receipt for retry; replaying it does not repeat a render or mutate scene history.
- Exchanges allow up to 3 MiB for the live snapshot, captured snapshot, and encoded JPEG. Other JSON routes retain their 1 MiB limit. An oversized receipt is reduced to an explicit capture error so text heartbeats can recover.
- `renderMs` includes synchronous render/readback; `encodeMs` includes JPEG/base64 conversion. `captureDurationMs` is their sum. `frameTimeMs` is Unity's frame delta sampled before capture; XR can report predicted display cadence despite an application stall. `captureFrameTimeMs` uses a monotonic stopwatch between the bridge's Update callbacks bracketing the capture frame, covering capture work plus other work/waits (zero means unavailable in direct Editor checks). It is not an isolated GPU measurement or proof of frame-budget compliance.

## Validation and device evidence

This increment also fixes the stale voice HUD notice reported during headset checks: room loading cancelled voice work with a loading message but never cleared that message on completion. A loading-owned voice phase now returns to the normal trigger instructions after successful localization, or displays room guidance after failure, while preserving any newer voice error/workflow. Recording and controller gates are unchanged. Seven Unity regression checks cover this transition; all three final builds pass 321 checks.

Python tests cover paired context, stale/session/selection failures, rate and body limits, no-image fallback prevention, preview authentication, one-shot voice inclusion, provider capability checks, actual CLI argument/file transport and cleanup. Panel tests exercise preview loading and explicit consent, unsupported models, read-only reviews and preserved Apply behavior. Unity core checks exercise actual rendering, JPEG output, animated pixels with unchanged saved placement, capture-pose alignment, resource cleanup, and unavailable camera/tracking states.

Run:

```powershell
python -m unittest discover -s ControlService -v
node ControlService/test_operator_panel.js
./Build-WhiteRoom.ps1 -Target Desktop
./Build-WhiteRoom.ps1 -Target Quest
./Build-RoomAR.ps1
python Validation/Run-Visual-Feedback-Loop.py --run
```

The graphical desktop acceptance runner starts its own isolated service/player and stores only synthetic-scene validation artifacts. It does not touch an existing headset session, saves, or service. See `Validation/visual-feedback-desktop-results.json` and `Validation/visual-feedback-validation.json` for the actual completed evidence; do not infer headset observations from desktop tests.

Standalone Quest Pro AR produced three timed captures and separately passed 19 checks including a real Codex image review. The wearer confirmed the room outlines aligned before the timing-instrumentation update. The AI described visible virtual debug geometry without claiming physical-camera imagery. A later AI request returned HTTP 409 while the wearer was using voice/operator controls; its capture succeeded, but that request is not counted as a passed inference. Hardware checks made no scene edits; composition correction, animated pixels and exact Undo/save/restore were validated on the graphical desktop.

| Quest capture | Render + encode (ms) | Actual capture frame (ms) | Unity reported delta (ms) |
| --- | ---: | ---: | ---: |
| sample 1 | 31.7 | 46.8 | 13.9 |
| sample 2 | 24.3 | 39.2 | 13.9 |
| sample 3 | 26.9 | 41.9 | 13.9 |

These are three observations, not a sustained benchmark. Captures cause a synchronous application stall. Physical voice/buttons with image inclusion, standalone animated-object captures and white-room Quest image capture remain untested. The white-room Quest APK builds successfully. Repository reports omit room images and private room metadata; raw headset artifacts stay local.

### Connection alternatives

The default application URL is `http://127.0.0.1:8765` with USB `adb reverse`. Device URL and PC service ports must match: the service validates the HTTP Host port. This validation session uses `http://127.0.0.1:8776` in the AR app's `control.json`, PC port 8776, and `adb reverse tcp:8776 tcp:8776`, preserving the older service on 8765. `PcBridge` supports a configurable URL in its `control.json`, and the PC service supports a network bind with `SANDBOX_TOKEN`, so normal operation can instead use a configured LAN connection. Installing an updated APK still requires an installation route. Editor testing over Link/Air Link is useful development evidence but does not establish standalone Android AR performance.
