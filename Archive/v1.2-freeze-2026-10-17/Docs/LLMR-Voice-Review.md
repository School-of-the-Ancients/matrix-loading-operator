# LLMR and local speech review

Reviewed 2026-09-20 against Matrix baseline `6e20899` and Microsoft LLMR commit
`9d4b72faeee99524220c31df925bcf785b272643`. This is a source and dependency review,
not a headset test. Implementation and hardware results belong in the progress
log and feature validation reports.

## What to retain and what to borrow

LLMR is a relevant reference for runtime authoring, but its generated C# and
Roslyn execution architecture is different from Matrix's validated command
executor. Keep `SandboxWorld`, stable object IDs, anchor-relative persistence,
explicit proposal review, runtime acknowledgements, and undo. No LLMR source code
was copied during this review.

| LLMR evidence | Matrix evidence at the checkpoint | Concrete implication |
| --- | --- | --- |
| [SceneParser.cs](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/Assets/Scripts/MR_Copilot/Orchestration/SceneParser.cs) provides request-aware scene summaries and a two-stage path that selects relevant object names before requesting details. | `ControlService/ai_adapter.py::_context` already supplies authoritative IDs, transforms, prefab bounds, available anchors, selection, and tracked viewer frames. | Keep structured context. Capture the selected ID and viewer pose when speech begins so later transcription cannot silently change what “this” means. Request-specific context reduction can wait while the scene is capped at 100 objects. |
| [Planner.cs](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/Assets/Scripts/MR_Copilot/Orchestration/Planner.cs) retains finalized plans; [Builder.cs](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/Assets/Scripts/MR_Copilot/Orchestration/Builder.cs) supports full, last-chat, and memoryless operation. | Each Matrix request receives current scene state and selection. It does not depend on an accumulating chat transcript. | Immediate pointing is already a better identity reference than a remembered display name. Add explicit pronouns and carry the request's captured selection through voice. Do not replace current scene truth with older model output. |
| [ChatCompilationManagerModular.cs](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/Assets/Scripts/MR_Copilot/ChatCompilationManagerModular.cs) coordinates scene analysis, builder, inspector, compiler, and bounded debugging passes. [DebuggerGPT.cs](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/Assets/Scripts/MR_Copilot/Orchestration/DebuggerGPT.cs) prepares compiler-error feedback. | Matrix validates proposals before queuing, rejects stale scene/selection revisions, and records execution results. It has no general model-driven repair loop. | First expose listening, transcription, planning, review, and execution outcomes clearly. If repair is added later, use a fresh snapshot and a new reviewed command proposal; never replay a partly executed batch automatically. |
| [Whisper.cs](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/Assets/Scripts/MR_Copilot/Whisper.cs) is entirely commented-out microphone/transcription sample code. [RuntimeErrorRecorder.cs](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/Assets/Scripts/MR_Copilot/RuntimeErrorRecorder.cs) is a stub. | No speech capture or STT adapter exists at the Matrix checkpoint. Runtime command errors are already returned by `SandboxWorld.Execute`. | These files are not a ready-made voice or error-recording integration. Build speech as another input to the existing proposal pipeline. |

LLMR's [README](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/README.md)
documents a runtime Roslyn compiler dependency and tested Unity versions
2021.3.25f1 / 2022.3.11f1. That does not establish compatibility with the current
Quest IL2CPP build. The repository is [MIT licensed](https://github.com/microsoft/LLMR/blob/9d4b72faeee99524220c31df925bcf785b272643/LICENSE);
copying substantial code would require retaining its copyright/license notice.

## Speech recommendation for this PC

Use PC-local **faster-whisper 1.2.1**, **base.en**, CPU **int8** for the initial
push-to-talk implementation. Keep one loaded model and process bounded utterances
sequentially. This is real speech-model inference; Codex remains responsible for
planning the resulting transcript. It requires no speech-provider API credential.

The installed environment inspected for this review is Windows x64, Python
3.13.14, ONNX Runtime 1.24.4, with `ffmpeg.exe` available. Hugging Face cache
directory names showed no Whisper model. No authentication files were read.

Verified primary-source compatibility and download facts:

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) documents CPU int8,
  PyAV audio decoding, and Silero VAD. Its [1.2.1 package metadata](https://pypi.org/pypi/faster-whisper/1.2.1/json)
  requires Python >=3.9, CTranslate2 >=4,<5, ONNX Runtime >=1.14,<2, and PyAV >=11.
- [CTranslate2 4.8.2 metadata](https://pypi.org/pypi/ctranslate2/4.8.2/json)
  lists `ctranslate2-4.8.2-cp313-cp313-win_amd64.whl`.
  [PyAV 18.1.0 metadata](https://pypi.org/pypi/av/18.1.0/json) lists
  `av-18.1.0-cp311-abi3-win_amd64.whl`; this stable-ABI wheel covers Python 3.13.
  Resolve/install these in an isolated environment before declaring the adapter
  ready; metadata alone does not prove a successful local import.
- The public [SYSTRAN base.en model](https://huggingface.co/Systran/faster-whisper-base.en/tree/3d3d5dee26484f91867d81cb899cfcf72b96be6c)
  reports MIT licensing. All repository files total 147,772,310 bytes at revision
  `3d3d5dee26484f91867d81cb899cfcf72b96be6c`; the implementation may download a
  smaller required subset. Store weights outside Git. The faster-whisper code
  also uses the MIT license.
- [tiny.en](https://huggingface.co/Systran/faster-whisper-tiny.en/tree/0d3d19a32d3338f10357c0889762bd8d64bbdeba)
  is an alternative if measured latency is unsuitable: 78,093,394 bytes across
  its files, MIT, revision `0d3d19a32d3338f10357c0889762bd8d64bbdeba`.
  Its accuracy and latency on this user's speech have not been measured.

CPU mode avoids adding CUDA/cuDNN dependencies for this milestone.
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) is a viable MIT-licensed
Windows CPU alternative, but would introduce a separate executable/model-format
integration. The Python service already has a practical wheel-based path, so
there is no demonstrated reason to add both implementations.

## Acceptance boundaries

The voice path should record only while the controller button is held, stop on
tracking/focus loss, bound recording size/duration, and expose permission denial
and silence as clear non-executing outcomes. Keep transcripts visible and require
the same explicit proposal application as typed requests. Keep raw recordings
ephemeral by default. Preserve the scene/client revision guard across speech
capture, transcription, planning, and application; head motion alone should not
invalidate a request made from its captured viewpoint.

Automated validation should cover malformed/oversized audio, silence, provider
failure, target deletion/selection changes, disconnect/reconnect, repeated
release/apply, and empty transcripts. A real local speech sample establishes
model execution, but only a wearer test establishes Quest microphone permission,
controller capture, audible input quality, HUD readability, and end-to-end
point-and-say usability. None of those headset checks were performed by this
review.
