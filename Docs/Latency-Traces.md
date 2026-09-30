# Local latency traces

For diagnostics, load the ordinary Matrix Web page with `?latency=1`.
Tracing is off by default. In the browser developer console, export
`JSON.stringify(window.matrixLatencyTrace.snapshot(), null, 2)` and copy the
result into the local acceptance record. Use
`window.matrixLatencyTrace.clear()` before each journey. Clearing also
discards unfinished spans from the previous journey.

The export holds at most 256 completed spans in browser memory. It is not
saved with a world or sent to the PC service. Stage names are fixed; prompts,
transcripts, audio, images, tokens, request bodies, error text, scene data,
object IDs, session IDs and arbitrary URL paths are excluded.

| Stage | Measurement |
| --- | --- |
| `microphone.acquire` | Browser microphone request through recorder readiness or failure |
| `voice.finalize-and-deliver` | Release/Send through recording finalization and the selected delivery path returning or failing |
| `http.agent.transcribe` | Browser request through PC transcription response parsing |
| `http.agent.turn`, `http.agent.steer`, `http.agent.cancel` | Browser request through the corresponding acknowledgement response parsing |
| `http.agent.status` | A status refresh, including periodic polling |
| `http.exchange` | One exchange through response parsing, before browser command application |
| `command.apply` | One received command through local receipt creation, including guards and dependency preparation |
| `receipts.acknowledged` | A timeline marker when a successful exchange acknowledges previously sent browser receipts |
| `http.other` | Other requests without retaining their route or content |

Times are relative to the browser's monotonic clock. Do not subtract them
from PC timestamps. HTTP measurements include network, service and parsing
time; they do not separate server inference from network delay. The voice
span excludes the time the user holds the microphone and ends when the
delivery workflow returns, which can differ between Agent and planner paths.
Acknowledgement is not model completion or proof of a visible world edit.
Receipt acknowledgement is a marker, not a latency estimate. No trace proves
physical sensor timing, headset frame rate, or wearer acceptance.

For one local session, record separate journeys for text submission, voice
submission, an instruction during an active turn, Stop, and a reviewed world
edit. Export after each journey to avoid evicting early spans with heartbeat
polls. Keep confirmation receipts and outcome observations alongside timings;
never infer completion from a request acknowledgement alone.

This is preliminary instrumentation for the core v1.2 work. The sprint issue
criteria were unavailable through the cloud GitHub API during this change;
interruption simplification and bounded object locks are still pending.
Physical Quest/AR/VR acceptance is pending.
