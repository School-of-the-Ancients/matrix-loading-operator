# Local latency traces

For diagnostics, load the ordinary Matrix Web page with `?latency=1`.
Tracing is off by default. In the browser developer console, export
`JSON.stringify(window.matrixLatencyTrace.snapshot(), null, 2)` and copy the
result into the local acceptance record. Use
`window.matrixLatencyTrace.clear()` before each journey. Clearing also
discards unfinished spans from the previous journey.

The export holds at most 256 completed spans in browser memory. It is not
saved with a world. Browser exports stay local; only the opaque trace ID is
sent to the PC service to correlate its bounded timing records. Stage names are fixed; prompts,
transcripts, audio, images, tokens, request bodies, error text, scene data,
object IDs, session IDs and arbitrary URL paths are excluded. Opaque random
trace IDs correlate submissions across clocks; typed command IDs link queue,
execution and rendered-frame events. These IDs are not credentials.

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

Each event identifies its clock. Do not subtract browser and service
timestamps; correlate by trace/command IDs and compare durations within one
clock. Service retention is bounded to 16 runs with 128 events each. HTTP measurements include network, service and parsing
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

Service traces additionally record context assembly, prompt build/bytes, Agent
start/first-tool/completion, human approval wait, command queue and received
receipt stages. Browser submission and first post-mutation rendered-frame
markers share the submission trace ID. The frame marker does not prove physical
display timing or sensor latency.

`frame.visible` is armed only after the completed command batch has synchronized
the Three.js scene, then emitted after its next render. A receipt alone cannot
arm it: a later panorama dependency may still be delaying that synchronization.
It measures the rendered batch state, not separate presentation of every
intermediate command. External GLBs may still show a loading placeholder on
that frame; this marker does not measure completed asset loading. Clearing
the trace also removes synchronized markers still awaiting a frame.

`Tools/Benchmark-Operator-Context.py` records matched prompt assembly samples
against the exact v1.1.0 builder: bytes, p50/p95 and raw counts. This does not
simulate model reasoning, transcription or headset acceptance. The compact
context and lock increments build on this measurement path.
Physical Quest/AR/VR acceptance is pending.
