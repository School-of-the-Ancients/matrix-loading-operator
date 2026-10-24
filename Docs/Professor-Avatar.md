# Professor avatars: first implementation

Implemented October 23, 2026 in the existing Matrix and School checkouts.

Update: Professor/Operator routing, a durable shared transcript, local speech recognition, SoVITS playback, audio-driven mouth animation and asynchronous Operator delegation are now implemented. See [Professor-Voice.md](Professor-Voice.md) and [Professor-Delegation.md](Professor-Delegation.md) for current controls and validation. The earlier first-slice limits below are historical; Quest acceptance remains pending.

## Current body motion

The #215 checkpoint replaces the fixed upper-arm pose with a normalized-bone motion controller. Hands rest beside the body with bent elbows from the first frame. Subtle breathing, upper-body sway, blinking and head motion run while idle; recording a Professor-directed question adds listening nods. Actual Professor audio playback drives restrained alternating arm/hand gestures, blended with the existing audio-driven mouth animation. Stop and clip completion blend the arms back to rest. The gaze target follows the active desktop or XR camera.

Motion runs in the existing render loop and leaves the scene root, placement, scale and lesson binding untouched. Missing optional bones are tolerated; the browser's reduced-motion preference reduces movement. No model bytes or external animation clips are modified or added. Model-specific choreography remains future work.

## Teaching with exhibit attention

Each typed or spoken teaching turn can now receive a bounded, read-only list of the current Matrix objects when that world contains this lesson's professor. The teaching model may attach one structured `look` or `point` cue naming an exact object. This cue is saved alongside the reply, outside spoken text. No cue or an unavailable Matrix connection leaves ordinary teaching working.

During actual audio playback, Matrix resolves the cue against the current runtime, room, object and asset identity. Gaze and a restrained torso turn track the exhibit's current bounds centre; pointing aims the nearest arm and extended index finger at it for up to six seconds, then lowers the arm while gaze continues until speech finishes. Moving the exhibit updates the aim, including changing hands if it crosses the torso. Targets behind the professor get gaze without a backwards reach. Stop, removed/replaced targets and lesson/world changes release attention. Replay revalidates the cue. No object, avatar root or saved transform is moved by a gesture.

This uses scene labels and identities, not image recognition or knowledge of unobserved exhibit details. Primitive fallback avatars have no humanoid bones and do not perform these gestures. The Riko model was checked locally unchanged. New supported avatars still need individual visual checks.

Attention validation: 844 WebRuntime tests; 67 School server tests, 26 UI tests, typecheck and all builds. Real-Riko skeleton checks aligned both arms to targets without root drift. A native Codex synthetic teaching turn chose the requested cube and returned a short question plus a matching cue. Desktop preview confirmed gaze/pointing and release using the real model with synthetic speech. Quest wearer appearance/performance remains pending in #215.

Validation: all 840 WebRuntime tests and the production build pass. A separate check using the actual local Riko skeleton exercised idle, speaking and listening, preserving root transforms and mouth-expression values. An isolated desktop preview with the real model confirmed arms beside the body and speech/idle transitions; its speech drive was synthetic. This is not a Quest performance or wearer acceptance result. Save any current work, then reload the Quest page to receive the new browser bundle.

## Use it

Start the existing PC candidate with `node Tools/start_professor_local.mjs` from the Matrix checkout. It refuses to replace services already using ports 8765 or 3110. Open `http://127.0.0.1:8765/web/`, then **Professor**. Create or reopen a lesson, choose **Professor appearance**, and press **Place professor in Matrix**.

The teacher appears in front of the current view on the virtual floor. Select the body to reopen its exact saved lesson. Repeat placement for that lesson reuses the existing object without moving it. Normal Matrix selection, transforms, deletion, world checkpoints, undo and redo continue to apply. To use another appearance after placement, remove that lesson's body first, then place the new one. The teacher and conversation do not change when choosing an appearance.

The bundled primitive **Stylized professor** needs no external model. Riko has been registered locally from `C:/Riko/client/characters/riko/models/Riko1.vrm` into `.utmp/professor-local/assets`. No existing catalog entry was changed. Its SHA-256 is `e46547c9f00a1faab097f7ec99c3a28f3f33d18332b3eefab0480a2037f20080`. The original file is unchanged. Model bytes are not committed or published; its embedded license does not allow redistribution or modification.

To register another owner-supplied model, use:

```powershell
python Tools/import_professor_avatar.py "C:\path\teacher.vrm" --catalog .utmp/professor-local/assets --name "Teacher appearance"
```

Restart/reopen Professor to refresh its picker after an import. This profile supports self-contained VRM 1.0 only, with a 32 MiB limit and bounded skeleton/material/texture complexity. General GLB limits remain unchanged. The import preserves original bytes and license metadata; it does not grant rights to a model.

## How it works

- `ControlService/vrm_assets.py` inspects humanoid structure and metadata. `web_assets.py` uses the existing immutable asset registry.
- `GET /api/professor/avatars` exposes a bounded public catalog behind the existing service authentication. No source paths or credentials are returned.
- `WebRuntime/src/vrm_avatar.js` loads VRM through the pinned three-vrm runtime, sets a relaxed pose, gaze and blinking, and disposes each instance independently. Spring bones initialize after final world placement.
- A normal scene object holds a versioned `professor` binding: teacher identity/name, School session ID, catalog ID, asset digest and representation type. Existing scene validation and save/restore preserve it. There is no separate world simulation or teacher database.
- School's existing parent-window channel sends the selected catalog ID and lesson identity. Matrix validates the request, performs its normal world operation, and returns the receipt. Duplicate requests reuse the lesson's body. Failed or timed-out placement is reported, not silently called complete.

## Historical first-slice verification

Automated: 827 Matrix Node tests passed; 997 ControlService tests passed during implementation, followed by all 14 focused avatar/HTTP/asset tests after final edits; 26 School frontend tests passed; School typecheck and both production builds passed. No new live model request was needed for these checks.

Desktop browser: an isolated fixture lesson for Ada Lovelace used the actual Riko VRM. Placement, relaxed pose, corrected hair physics, reopening the exact lesson by selecting the body, restoring the picker to Riko, repeated placement without duplication, reload, and PC world checkpoint save/restore were observed. No application console errors were captured. The fixture used synthetic teaching replies, not a live Codex conversation. Existing rooms and School archives were not used for the test.

Pending: Quest wearer acceptance, AR floor/scale alignment and performance. The complete Professor page remains restricted to PC loopback under the existing origin policy; it is not yet a remotely accessible Quest lesson UI. This implementation does not add live voice, lip sync, automatic historical-appearance matching, multi-teacher conversation, or new background Operator automation. Those remain subsequent phases. A generic or Riko body is explicitly a representation, not evidence of a historical likeness.

The first native-voice integration should reuse this saved lesson identity and existing Operator job/receipt path. It must separate conversational audio from slow exhibit work, retain interruption/turn ownership, and use the selected provider's supported credentials. The catalog is ready to grow into curated tags and learner-approved matching; no vector database is needed for a small library.
