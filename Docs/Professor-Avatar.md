# Professor avatars: first implementation

Implemented October 23, 2026 in the existing Matrix and School checkouts.

Update: Professor/Operator routing, a durable shared transcript, local speech recognition, SoVITS playback, audio-driven mouth animation and asynchronous Operator delegation are now implemented. See [Professor-Voice.md](Professor-Voice.md) and [Professor-Delegation.md](Professor-Delegation.md) for current controls and validation. The earlier first-slice limits below are historical; Quest acceptance remains pending.

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

## Verified and pending

Automated: 827 Matrix Node tests passed; 997 ControlService tests passed during implementation, followed by all 14 focused avatar/HTTP/asset tests after final edits; 26 School frontend tests passed; School typecheck and both production builds passed. No new live model request was needed for these checks.

Desktop browser: an isolated fixture lesson for Ada Lovelace used the actual Riko VRM. Placement, relaxed pose, corrected hair physics, reopening the exact lesson by selecting the body, restoring the picker to Riko, repeated placement without duplication, reload, and PC world checkpoint save/restore were observed. No application console errors were captured. The fixture used synthetic teaching replies, not a live Codex conversation. Existing rooms and School archives were not used for the test.

Pending: Quest wearer acceptance, AR floor/scale alignment and performance. The complete Professor page remains restricted to PC loopback under the existing origin policy; it is not yet a remotely accessible Quest lesson UI. This implementation does not add live voice, lip sync, automatic historical-appearance matching, multi-teacher conversation, or new background Operator automation. Those remain subsequent phases. A generic or Riko body is explicitly a representation, not evidence of a historical likeness.

The first native-voice integration should reuse this saved lesson identity and existing Operator job/receipt path. It must separate conversational audio from slow exhibit work, retain interruption/turn ownership, and use the selected provider's supported credentials. The catalog is ready to grow into curated tags and learner-approved matching; no vector database is needed for a small library.
