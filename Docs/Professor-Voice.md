# Professor and Operator conversation

Implemented October 23, 2026 in the existing Matrix/School candidate. This extends the avatar implementation; it does not start a separate Riko conversation engine.

## Use it

1. Start the existing candidate with `node Tools/start_professor_local.mjs`, or the supplied **Start Professor.cmd** shortcut. Keep your existing GPT-SoVITS service running on port 9880.
2. In Matrix on the PC, open **Professor**, choose or reopen a lesson, and choose/place its appearance. Close the School panel to see the body and conversation controls.
3. **Professor** is the default target. Use **Speak to Professor** or type into the message field. Speech records until the second tap/controller release, with the existing 15-second recording limit.
4. Select **Matrix Operator** to use the existing direct Codex world conversation. Its current permission and active-turn steering controls still apply. Select **Professor** to resume the same lesson.
5. **Replay voice** speaks the latest professor reply. **Stop voice** stops playback and discards pending clips for that playback. The shared transcript retains the reply and marks interrupted playback. Turning off **Speak replies aloud** also stops Professor speech.

The same target selector is included on the XR Operator panel. Its hardware behavior still needs a wearer check. The full School page and its APIs remain PC-loopback-only under the existing deployment policy; this change does not make the lesson UI available through a Quest LAN URL.

## What is implemented

- A target is captured when recording starts. Switching targets during transcription does not reroute the captured utterance. Changing lesson/world invalidates stale Professor playback.
- Professor input uses the existing School persona, goals, lesson, full saved teaching messages and bounded shared-conversation context. The active Codex teaching adapter remains constrained to teaching output.
- A versioned journal is persisted with each School session. Existing messages are migrated into its view without replacing old records. Journal writes have stable IDs; retried spoken-message requests return the existing reply rather than generating it again.
- Learner utterances to either target, Professor replies, and newly observed user-facing Operator turns are attributed by speaker and recipient. Long Operator text is saved in bounded parts. Direct Operator exchanges are context for the teacher, not scored student answers.
- Direct Operator turns receive a bounded lesson-context object through the existing server request. That context is advisory data; existing Matrix tools, permissions and runtime receipts retain authority.
- The existing local English Whisper recognizer is installed in this checkout's isolated `.speech-venv`, with local model files under `.speech-models/base.en`. Existing local weights were reused. No API key is required for transcription.
- The PC proxies Professor TTS to the already-installed SoVITS service. `ControlService/professor_voice.json` identifies the local Riko reference clip and reference text. Browser requests cannot choose a different TTS URL or reference file. Audio is returned to the requesting browser, not broadcast through all Riko tabs.
- Playback uses Web Audio, bounded chunks and one-clip prefetch. Audio activity and spectral shape drive smoothed VRM mouth shapes. The existing gaze, relaxed pose, blink and spring bones continue to run. This is heuristic lip-sync, not phoneme-level alignment.
- The next microphone turn is available while a previous reply is being played; starting a new capture stops that playback. Model generation is still a serial teaching turn. Stop speech and cancel an Operator job are separate actions.

## Current limits

This remains push-to-talk plus transcription, model response and synthesized playback. Professor-to-Operator asynchronous task delegation is now available; see [Professor-Delegation.md](Professor-Delegation.md). Full-duplex native live voice, automatic turn-taking, semantic animation selection and the complete Riko motion library remain subsequent work. Existing explicit image/build controls still work.

The journal retains full accepted events up to its explicit archive limit; model context remains bounded. The existing School teaching-message and archive limits still apply. Stop/replay records the latest playback attempt's delivery state; it does not claim an exact word-level heard transcript when playback is interrupted. No background room recording occurs with the microphone off.

## Validation

- Matrix: 1,001 ControlService tests passed during this change, followed by 8 focused Professor voice/HTTP tests after the final server edit. The final WebRuntime suite passed all 833 tests, including 6 focused conversation/playback cases.
- School: 52 server tests, 26 frontend tests, typecheck and production build passed. A pre-existing asynchronous test-cleanup race was repaired by waiting for exhibit preparation before deleting its temporary archive.
- Actual local TTS generated a valid WAV using Riko's reference clip. A synthetic spoken test sentence was decoded by the actual local recognition endpoint in approximately 1.94 seconds in one run; this is not a headset latency benchmark.
- The actual native Codex teaching adapter completed a bounded subscription-backed test. In a separate isolated browser lesson, the new Professor path received the question about two plus three, generated the live answer "Two plus three is five," spoke it through SoVITS, and saved it as spoken.
- Browser observation showed audio activity and the avatar's mouth moving. Target labels changed correctly, the same lesson survived switching and reload, and Stop changed the reply to interrupted. No application console errors were observed in that test page.
- Existing rooms, assets and original School archives were not used for mutation testing. Temporary test services were stopped after validation; existing Riko/SoVITS processes were preserved.

Remaining acceptance: actual microphone capture/device selection and playback quality on the user's hardware, Quest input/room alignment/performance, and live direct-Operator task completion with this journal attached. Automated routing/context tests do not substitute for those hardware checks.

## Quest over USB

The same local Professor app can now run in Quest Browser using the existing PC service. Connect one authorized USB Quest and run `python Tools/connect_professor_quest.py` after starting the Professor service. This maps only Quest port 8765 to PC port 8765; it leaves other mappings and network bindings alone. Open **http://127.0.0.1:8765/web/** in Quest Browser and keep USB connected. Do not use the PC's LAN HTTP address for this setup.

The Professor launcher now starts Operator with Full access and automatic approvals, as explicitly requested by the owner. This changes only this launcher's service environment; native Codex account settings and the general Matrix launcher are unchanged. Existing Matrix validation, task identity, world checks and receipts still apply.

To continue a saved PC lesson, open **Professor → Continue on Quest / another device → Create device code** on the PC. On Quest, open Professor, expand the same section, enter that code and select **Link this browser**. The receiving browser must have no existing lesson records. Codes expire after five minutes, work once and convey access to the same local learner archive; they do not contain Codex credentials. Reusing the same archive keeps both sides on the same conversation. Close the PC Matrix world tab before entering Quest AR so it does not hold the single active-world lease.

In Quest, choose the saved lesson, select **Riko** as the appearance and press **Place professor in Matrix**. The generic stylized placeholder has no VRM facial rig. Close Professor and enter **AR**. Select **TALK: PROFESSOR** on the floating panel. Hold a controller side-grip button to record, then release to send. Alternatively, point at HOLD: PROFESSOR and hold/release the trigger; the browser's microphone permission uses the Quest microphone. The current mode remains push-to-talk, with local Whisper followed by the teacher and SoVITS. Reply audio is played on Quest and drives the active lesson's VRM mouth. Stop voice does not cancel a background Operator task.

Ask, for example, “Ask Operator to build a small demonstration while you explain the idea to me.” The task panel tracks the separate Operator turn; continue asking the professor questions while it runs. The existing [delegation guide](Professor-Delegation.md) explains queued, completed and unconfirmed states.

USB discovery/forwarding, saved-lesson pairing and Full-access startup are verified independently of wearer evidence. Actual Quest AR placement, microphone, audio/lip-sync and a concurrent build require the identified headset session; no desktop result counts as that pass.
