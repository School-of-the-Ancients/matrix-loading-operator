# Voice and Codex controls

Voice and model controls are available in the virtual white room and room-aware AR. The validation section below records the original September 20, 2026 white-room voice milestone; later evidence is linked from the [current checkpoint](Current-Checkpoint.md).

## Start or resume

Use the same full checkout for the PC service and local speech installation.
Keep the Quest awake, USB debugging authorized, and both controllers tracked.
From that checkout in PowerShell:

```powershell
.\Setup-LocalSpeech.ps1
.\Start-CodexControlService.ps1
```

Speech setup is needed once per checkout. Keep the service terminal open. In a
second terminal run `.\Connect-QuestControl.ps1`, then open **Matrix Operator**
for the virtual room or **Matrix Operator AR** for your physical room. Open the
PC panel at <http://127.0.0.1:8765/> and confirm the runtime is connected. Port
8765 is the default: match the actual service port, retained headset URL, and
USB reverse port if using an override. The installed Quest app must include
voice support. In AR, first [verify the outlines and confirm alignment](Room-AR.md#configure-and-verify-the-physical-room-first).

Pre-voice recovery: commit `6e20899`, tag
`checkpoint/2026-09-20-160737`. The local PC save
`BeforeVoiceInstall_20260920` contains the **40 objects** present before the
voice installation. Save any newer layout before restoring it: restore replaces
the current scene. Personal saves, builds, and model weights are not Git source.

## Speak, review, apply

| Control | Action |
| --- | --- |
| Right trigger while pointing | Select an existing object or a supported placement point (floor or, in AR, furniture top). |
| Hold left trigger | Record speech, up to 15 seconds. |
| Release left trigger | Send the recording to the PC for transcription and AI planning. |
| Y, after reading the proposal | Apply the reviewed voice proposal once. |
| Left grip | Undo one runtime edit; AR triggers Undo on release. A proposal containing several edits may need several undo presses. |

On the first recording attempt, accept **microphone access** inside the headset.
Then release and hold the left trigger again; accepting permission does not
start recording automatically.

Try **“Put a table in front of me with two chairs.”** After applying it, point
at a chair and select it with the right trigger. Then say **“Make this twice as
big.”** The HUD shows listening, transcription, planning, the text it heard, and
the proposal summary. Read it before pressing Y. Holding the left trigger for a
new request replaces an unapplied voice proposal.

The PC panel retains typed requests, proposal details, explicit Apply, Undo,
Redo, and save/load. **Review voice proposal** opens the voice result there.
Successful speech recognition alone never applies edits. The headset confirms
runtime acknowledgements after Apply; partial failures leave successful edits
in place.

Selection and viewpoint are captured when recording begins. “This object” uses
that selected object's stable ID. Scene edits, selection changes, or a runtime
reconnection make a stale request fail rather than switch targets. Ordinary
head movement does not invalidate the captured viewpoint. Keep controller edits
idle during planning. Focus/tracking loss cancels recording and unapplied voice
work; if Apply already queued commands, check PC results before retrying.

## Choose a Codex model and reasoning effort

Choose **Codex (ChatGPT subscription)** in the PC planner. **Codex model** lists
choices from this PC's local Codex model metadata. **Reasoning effort** lists
levels supported by the selected model. The displayed cache may be stale;
provider errors remain visible rather than falling back to the offline parser.

Selections affect subsequent typed and headset voice requests for this running
service session. They do not modify global Codex settings and reset when the
service restarts. Voice captures the chosen settings when submitted. **Service
default** preserves the service configuration; **Model default** uses the chosen
model's own reasoning default. Higher reasoning can take longer. Changing a
selector does not execute a proposal. Existing Codex authentication stays on the
PC; the headset receives no AI-provider credentials.

## Local speech and troubleshooting

English speech recognition uses faster-whisper 1.2.1 and the pinned base.en
model on the PC CPU, with int8 inference. Setup creates ignored `.speech-venv`
and `.speech-models` folders. Each utterance runs in an isolated subprocess with
a 90-second transcription timeout; recognition uses local files without an API
key or implicit model download. Audio is processed in memory, not saved by the
voice service. Codex receives the transcript and scene context for planning.

Errors appear on the HUD and PC panel. For missing speech files, rerun setup.
For permission denial, enable microphone access in headset app permissions.
For stale selection, select again and repeat. Silence, very short recordings,
invalid audio, and unavailable Codex produce no executable proposal.

## Original voice milestone validation

- **Automated:** 214 Python tests passed, including 31 mocked voice/context
  tests. Unity core validation passed **181 checks in each build target**.
- **Real Codex:** six checks passed with requested `gpt-5.6-luna` / `low`
  settings against an isolated snapshot. The receipt confirms requested
  settings and a completed real model turn, not an independently reported
  effective model or headset execution. See `Validation/codex-selector-live.json`.
- **Speech and actual Windows player:** **24 checks passed** using generated
  Windows speech, real local STT and two real Codex turns. The loop spawned a
  table and two chairs, doubled the selected object ID supplied by the
  runtime, exercised undo/redo, then saved, cleared and restored exact object
  IDs and transforms. See `Validation/voice-desktop-results.json`. This does
  not establish headset microphone quality or physical controller input.
- **Headset:** 12 device/network checks passed after installation: granted
  microphone permission, a live speech transcript, real Codex inference using
  the selected table ID, four successful runtime transform acknowledgements,
  and observed undo transitions restoring the exact 40-object scene. See
  `Validation/voice-headset-results.json`. Physical button identity and HUD
  readability still await separate wearer confirmation; telemetry alone does
  not establish comfort or the full focus/tracking checklist.

At this original voice milestone, native MRUK/passthrough validation was still
pending. The later [room-AR milestone](Room-AR.md) completed Quest Pro placement,
voice editing, and save/clear/restore; the earlier Meta assembly blocker is
historical. These later results do not retroactively change the scope of the
white-room checks above.
