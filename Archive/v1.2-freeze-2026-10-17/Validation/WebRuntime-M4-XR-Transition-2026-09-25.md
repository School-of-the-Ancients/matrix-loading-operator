# WebRuntime M4 AR to VR transition — 2026-09-25

This check uses the isolated `http://127.0.0.1:18772/web/` origin, a fresh
ControlService scene/asset directory, and USB ADB reverse tunnel. The live
Matrix origin on port 18767 and release `v0.6.0-preview.1` are unchanged.

## Reproduction and diagnosis

- Quest 3 / Quest Browser `152.0.0.44.30.1069357998`. The wearer reported that
  VR could open first, but after AR exit on the same page, VR briefly hid the
  browser and returned without entering.
- Quest Browser's JavaScript log on the PR #89 build reported competing
  `offerSession` calls and an `InvalidStateError` from `requestSession` because
  another immersive session was active. The page used two independent Three.js
  ARButton/VRButton helpers, each with its own session state.
- The first isolated revision on port 18772 also failed the wearer check. Its
  VR request omitted `local-floor` even though Three's renderer required that
  reference space. Quest logged `cancelAnimationFrame` on a null context while
  Three cleaned up that failed setup. This was corrected before the current
  retest; the initial failure is retained here as evidence, not counted as a
  successful run.
- The next isolated revision could not enter either mode. `initXRIfReady`
  replaced the XR button container with a loading message, removing a status
  element that the new button handler expected. The handler then failed before
  requesting a session. The status element is now created by `initXR` after
  loading completes; a test covers the loading-message path.

## Current change and PC checks

- One controller now owns both immersive entry modes, keeps request and exit
  transitions mutually exclusive, and reports a failed entry next to the
  AR/VR buttons, including a session that Quest closes immediately. It never
  calls `offerSession`.
- AR requests `local`; VR requires `local-floor`. The native reference space is
  checked before calling Three's `setSession`, so an unsupported space does not
  enter Three's partial setup path. A late AR hit-test source is cancelled.
  Saved AR room anchors are restored and applied only during AR, so they cannot
  move the VR virtual floor.
- WebRuntime: 88 Node tests passed; Vite production build passed. The
  ControlService suite passed 610 Python tests on this stacked base.

## Quest retest

Before the left controller was paired again, the wearer confirmed AR entry on
the corrected port 18772 bundle, but VR still returned to the browser. A
temporary Quest Browser diagnostic showed `requestSession('immersive-vr')`
granted an opaque session and then received
the native `end` event about 30–40 ms later, including on a fresh page before
AR. The diagnostic did not observe Matrix calling `session.end()` for the
tested failure. Quest displayed **“left controller not connected”** and the
wearer reported that pressing a button did not reconnect it. The headset log
showed the left interaction profile unavailable and the right present. That
run cannot establish whether the VR failure came from the app, Quest Browser,
or the headset input state.

After a headset reconnect, a read-only controller log enumerated and tracked
only the right controller. The wearer also reported that the left controller
remained disconnected in Quest Home despite a fresh battery. No new VR attempt
occurred in that log window; this observation does not establish the cause of
the earlier session exit.

The wearer subsequently paired the left controller again. On the same port
18772 page, they completed **enter VR → exit VR → enter AR → exit AR → enter VR
→ exit VR**. A read-only Quest Browser check confirmed that page was running
the current `index-B_6S6Mfy.js` build. This verifies the original same-page
transition on Quest after controller recovery. The wearer also confirmed that
the VR floor matches their real floor. This does not isolate whether the
earlier failure came from the controller state, Quest Browser, or the previous
Matrix session code.

In a subsequent wearer check on the same port 18772 build, the wearer entered
VR, selected CODEX, connected, held and released **HOLD TO SPEAK**, and said
“Operator, describe this room.” They reported that the mic labels changed and
exactly one Codex turn appeared. This is partial VR voice evidence. The
transcript, microphone permission result, and a typed follow-up in the same
thread were not recorded at that point. The full M4 Agent journey remains
unverified on this branch. No room imagery or conversation content was retained.
