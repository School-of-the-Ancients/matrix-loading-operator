# AI Citizens in the Matrix Web world

This [#20](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/20) slice builds on the isolated [Citizens desktop fixture](Citizens-Desktop-Demo.md). The ordinary `/web/` page now has an opt-in **AI Citizens** panel. It runs the same two-resident simulation through the page's existing `MatrixWorld`, `MatrixView`, and `MatrixBridge`. The panel starts only on an empty desktop virtual floor; it never clears an existing world. Its residents, chair, and table become ordinary Matrix scene objects. The Agent Portal is not used for resident decisions or given to residents.

## Try it safely

From the repository root, build and use an isolated ControlService port and scene directory:

```powershell
npm.cmd --prefix WebRuntime ci
npm.cmd --prefix WebRuntime run build
$demoRoot = Join-Path $env:TEMP 'matrix-citizens-shared-world'
$scenes = Join-Path $demoRoot 'scenes'
$assets = Join-Path $demoRoot 'web-assets'
New-Item -ItemType Directory -Force -Path $scenes,$assets | Out-Null
python ControlService/server.py --host 127.0.0.1 --port 19838 --scenes $scenes --web-assets $assets
```

Open `http://127.0.0.1:19838/web/` in a separate browser profile with no saved world for that origin. Choose a seed and click **Start here** in the AI Citizens panel, then **Run** or **Step**. The panel shows each resident's need levels, activity, recent outcome, reservations, and decision log. **Stop Citizens** requires a second click within ten seconds; it removes the simulation state but leaves its objects in the scene. Existing worlds cannot start this fixed-position scenario until the user explicitly chooses a separate empty world.

The usual browser world save now carries a version 3 envelope when Citizens is active. Existing version 2 scene/game saves still load and retain their original shape. The manual browser **Save world** checkpoint and named **PC world checkpoint** include the Citizens clock, IDs, needs, current intent, reservations, RNG state, and bounded log alongside scene/game state. PC save pauses the simulation before capturing it; click **Run** after restore to continue. After closing and reopening the browser, wait for **Operator connected** before using PC save/restore; ControlService's single runtime lease can take up to 15 seconds to pass to the new client. Browser-local recovery does not require the PC lease.

An authored move of a bound resident or station cancels the affected activity, releases its claim, and pauses Citizens. Removing a bound object pauses the simulation and blocks invalid browser/PC checkpoint writes; the previous valid browser copy remains available. Undo the edit to recover or use **Stop Citizens** to keep the edited scene without simulation bindings. AR pauses this desktop simulation; no Quest simulation acceptance is claimed. Room-origin recovery archives preserve the version 3 virtual world state.

## Verification and limits

WebRuntime Node tests passed **165/165**, the Vite production build passed, and ControlService Python tests passed **645/645**. Chrome **153.0.8010.53** ran the built `/web/` page through **45 manual ticks** on isolated ControlService port **19838**. Both residents acted, chair contention appeared four times in the bounded log, browser close/reopen retained their exact scene and simulation state, and a named PC checkpoint restored minute 45 after the browser had advanced to minute 46. Stepping the restored world reproduced the earlier minute-46 scene and simulation state. The named PC checkpoint also restored after stopping and restarting the isolated service with the same checkpoint directory. A real `/api/command` deletion of the chair paused Citizens, showed recovery guidance, and left the last valid browser save untouched. No browser page errors occurred. See the [shared-world screenshot](../Validation/citizens-shared-world.png), [roundtrip evidence](../Validation/citizens-shared-world-evidence.json), [service restart evidence](../Validation/citizens-service-restart-evidence.json), [recovery screenshot](../Validation/citizens-shared-world-recovery.png), and [edit evidence](../Validation/citizens-shared-world-edit-evidence.json).

The start flow currently places a fixed two-resident fixture only on an empty virtual floor; it does not bind arbitrary authored furniture or import a live existing world. Resident travel is direct over open floor, interactions are local `MatrixWorld` outcomes rather than new ControlService commands, and there is no social action, GOAP, LLM loop, shared multi-client simulation, or Quest budget measurement. The independent [M4 wearer checks](../WebRuntime/QUEST3_ACCEPTANCE.md) remain open.
