# #91 image previews in the WebXR Operator panel

Date: 2026-09-27. This follow-up stays on PR #155 and reuses its four real
recorded concept images. It adds a gallery page to the existing Three.js
CanvasTexture Operator panel; no wrist menu or second UI system is introduced.

## Behavior and boundaries

- CODEX shows an **IMAGE PREVIEWS** entry when ready concept versions exist.
  PREVIOUS and NEXT IMAGE browse stable version numbers. A visible, decoded
  image can be selected with USE VERSION; a missing or failed preview cannot
  be selected blindly. The same PC Agent session receives the selection.
- The existing desktop concept client fetches preview bytes from the
  authenticated, same-origin API and validates the returned image MIME and
  24 MiB bound. The XR panel receives only a current-session, server-URL-matched
  browser blob URL, version, source label, and short prompt. Session changes
  revoke old URLs and remove decoded image callbacks. A failed fetch has a
  RETRY PREVIEW control.
- The gallery's voice button still routes to the Codex conversation. XR
  selection and retry use the same concept-request busy guard as the desktop
  controls. The Operator panel, its hide/recall behavior, and #147 grab input
  remain in place.

The [canvas layout capture](concept-91-xr-gallery-canvas.png) is a desktop
render of the Operator CanvasTexture with a recorded bridge image. It checks
image sizing, controls, and text overlap; it is **not** a Quest capture.

## Automated and desktop checks

- WebRuntime: **630/630** tests passed after the gallery changes, including
  current-session preview gating, authenticated fetch notification, retry,
  canvas image drawing, controller navigation, selection routing, and voice
  routing. Vite production build and `git diff --check` passed. The existing
  large-chunk Vite warning remains.
- An isolated ControlService on `127.0.0.1:18794` loaded copies of the four
  recorded images from [the #91 desktop run](Concept-91-Live-2026-09-27.md).
  Its scene directory, web asset directory, content cache, Agent session, and
  browser origin are separate from the user's `18791` world. The fixture is
  explicitly labeled as imported; it does not claim new image generation.
  The API reported four ready versions, `/web/` returned 200, and each of the
  four preview responses matched its recorded SHA-256. ADB reverse exposes
  only the new port to Quest Browser.

## Quest wearer check

On the isolated `18794` page, the wearer entered **VR**, opened CODEX → IMAGE
PREVIEWS, browsed the actual bridge images with PREVIOUS/NEXT, and reported
that both images and selection worked. After USE VERSION 2, the PC concept
status independently reported selected ID
`e96a86c8becb497b893791392fd406a9`, Version 2, provider `comfyui`.
This is a focused image-gallery check with imported recorded images. It does
not establish fresh ComfyUI generation, concept-guided 3D construction,
animated asset placement, or AR gallery readability. The separate #147 VR/AR
grab, save, and room-origin acceptance is in
[Grab-Thumbstick-147-2026-09-27.md](Grab-Thumbstick-147-2026-09-27.md).
