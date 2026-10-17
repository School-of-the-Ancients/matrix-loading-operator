# AI Citizens desktop demo

This bounded [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) slice runs at `/web/citizens.html`. It reuses WebRuntime rendering and `MatrixWorld` scene identity, action validation, and local receipts. It has its own browser-local world and versioned save (`matrix-citizens-desktop-v1`); it does not exchange state with the main `/web/` Agent Portal world, School, or a PC scene checkpoint. The page makes no Agent Portal or privileged tool requests.

## Run

From the repository root in PowerShell, build both WebRuntime pages and serve them on an isolated loopback port with separate service directories:

```powershell
npm.cmd --prefix WebRuntime ci
npm.cmd --prefix WebRuntime run build
$demoRoot = Join-Path $env:TEMP 'matrix-citizens-demo-19837'
$scenes = Join-Path $demoRoot 'scenes'
$assets = Join-Path $demoRoot 'web-assets'
New-Item -ItemType Directory -Force -Path $scenes,$assets | Out-Null
python ControlService/server.py --host 127.0.0.1 --port 19837 --scenes $scenes --web-assets $assets
```

Open `http://127.0.0.1:19837/web/citizens.html` in a separate, persistent desktop browser profile. Keep the same profile and port for save/reopen; browser storage is scoped to that origin. The ordinary `/web/` world remains separate. Stop this test service with Ctrl+C.

The seeded scene starts with Ada and Bo, two colored temporary resident markers, one chair for resting, and one table for eating. **Run/Pause** advances one simulated minute every 0.5 seconds; **Step one minute** advances a single tick. **Reset seed** creates a paused new scenario from the entered positive integer; use **Run** to begin it. **Save** and **Load saved** use the demo's browser-local checkpoint. The resident cards show fullness, energy, fun, current activity, and last outcome. The resource list shows each capacity-one reservation, and the log shows choices, blocked alternatives, arrivals, failures, and completions. The social inspector shows a bounded invitation, its outcome, any observed receipt reference, and the pair's relationship score.

Needs change on each tick. Seeded utility scores select rest, eat, or explore. Residents travel across the open floor by validated `MatrixWorld` transform requests. Rest and eat use chair/table advertised interactions; a matching local execution receipt and observed outcome are required before the need benefit is applied. A held chair or table blocks the other resident until its reservation is released. Saved state includes resident and object IDs, needs, activities, reservations, clock, random state, and the bounded log. Loading validates both the scene and simulation before replacing the active world; an invalid save is rejected without discarding the current world.

## Verification and limits

The WebRuntime Node suite passed **155/155**, the Vite build passed, and ControlService Python unittest passed **643/643**. An actual Chrome **153.0.8010.53** run used the built ControlService page at isolated port **19837**. Across **45 manually advanced ticks**, the browser DOM and storage showed both residents acting and chair contention; close/reopen retained the state, the same seed replay matched, and a corrupt save was rejected while the current world stayed available. No page errors were recorded. This is desktop browser evidence, not Quest wearer evidence.

Review the [browser evidence](../Validation/citizens-browser-evidence.json), [desktop screenshot](../Validation/citizens-desktop-demo.png), and [decision log screenshot](../Validation/citizens-decision-log.png). These were captured from the built page served by ControlService.

Movement is a direct path across an open floor, without obstacle navigation. Figures are simple orb-based markers. The current candidate has a finite, seeded social invitation and observed conversation outcome, but no generated dialogue, GOAP, LLM decision loop, Agent Portal integration, School records, or headset acceptance. Its browser-local save is not the main Matrix world checkpoint or a shared multi-client simulation. [M4 Quest checks](../WebRuntime/QUEST3_ACCEPTANCE.md) remain open independently.
