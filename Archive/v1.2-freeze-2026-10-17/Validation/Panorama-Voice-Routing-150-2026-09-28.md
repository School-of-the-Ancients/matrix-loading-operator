# Panorama voice routing follow-up — 2026-09-28

## Reported failure

In Quest VR, the wearer said “Create a sci-fi panorama.” LocalSpeech transcribed that wording, but the panorama intent parser recognized only forms such as “create a panorama of …”. The request fell through to the general Codex Agent. That Agent generated a separate image, then requested a PC command that the XR review panel could not display. The nonreviewable command was denied; no panorama registration or world change resulted from that turn.

## Change

Spoken requests that put a description before `panorama`, `skybox`, or `background scene` now use the existing #150 image generation, preview, selection, and explicit apply flow. Optional `Codex` or `can you` prefixes and a trailing `in VR` are accepted. Bare “create a panorama” prompts for a scene description. Requests to create ordinary 3D objects and worlds retain their existing routes.

## Verification

- WebRuntime suite: 668/668 passed. Vite production build and `git diff --check` passed.
- Isolated PC service on 18972 served the exact fix with LocalSpeech configured. The desktop UI displayed a scene-description prompt for bare “Create a panorama” without an Agent turn.
- The exact reported wording produced panorama Version 1 through the native image workflow, with no PC review prompt. Ready PNG: 1774×887, SHA-256 `700b47338c2223bafe76976c414850298caba9715b621c8ee395023ec096e26f`.
- After preview and selection, the app applied the registered asset `panorama:sci-fi-horizon:700b47338c22` to the eleven-object garden at yaw 0°. Receipt: `039b6532372c44b3b2af2f951d37a99a`. The saved private checkpoint `quest150-voice-sci-fi-garden-v1` contains eleven objects and that environment digest.
- The desktop browser writer was closed, and USB reverse for Quest port 18972 was installed. Quest wearer verification of VR appearance and spoken requests is pending.

The generated image and checkpoint are private review artifacts and are not part of the release package.
