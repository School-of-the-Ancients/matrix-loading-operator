# M3 block-scale desktop acceptance — 2026-09-25

## Scope and source

Branch `codex/m3-scale-contract` began at `a3b6a5102414c744dfaa62bfd30ed558b960f5b2` (the open #85 head). This is a Matrix virtual White Room experiment over the existing built-in `block`, limited client v1 proposal ledger, reviewed Apply, runtime receipt, and saved Web world. It does not add a School lesson, physical AR measurement, collision, or physics simulation.

Desktop acceptance used Codex's in-app Chromium browser and the isolated `http://127.0.0.1:18773/web/` and `/clients` pages. The final served Web bundle was `index-BpqsHcDV.js`. The test used a new service state directory and a synthetic token. It did not use or clear the live Matrix services or Quest world.

## Observed loop

1. Spawned one built-in block with World Operator in `web-virtual-room-v1`; object ID `ebef259713264ce1a49740079d94972a`, `web-floor` anchor. Paired the HTML lab through a one-use `/clients` code. All scale requests stayed in the reviewed ledger until the PC owner pressed Apply.
2. HTML X/Y/Z factors `2,3,4` yielded an exact `set_transform` proposal. Before Apply, the scene still reported scale `1,1,1`. After Apply and runtime receipt, the lab showed local dimensions `2,3,4 m`, bounding volume `24 m³`, mathematical volume ratio `24`, and `physicalMeasurement: false`.
3. Three.js selection plus keyboard `R` proposed a reviewed reset; the confirmed ratio returned to `1`. HTML factors `2,2,2` then produced confirmed dimensions `2,2,2 m` and ratio `8`. After another reviewed reset, the selected Three.js block's keyboard `2` produced the same `2,2,2 m` and ratio `8`. This compared the two browser inputs on one object and one server calculation.
4. Restarted the isolated PC service, reloaded the same browser origin, and observed the same saved object ID and transform. Re-paired, explicitly captured the current scale `3,3,3` as a new baseline, and applied factors `0.5,0.5,0.5`. The fresh server issued a confirmed event with asset and anchor identity, dimensions `1.5,1.5,1.5 m`, bounding volume `3.375 m³`, and mathematical ratio `0.125`. A page reload restored that object and labeled the matching observation as **historical**. Its limited client session and baseline chain required new pairing.
5. During the test an older process retained port 18773 after a shell interrupt. Its event lacked the newly added `anchorId` field, so the newer browser correctly refused to call that event confirmed. Both isolated 18773 processes were stopped, and a single listener was verified before the final run. This was test-process skew, not evidence of a failed scale transform.

## Automated validation

- `python -m unittest discover -s ControlService -p 'test_*.py' -q`: **616 passed**.
- `WebRuntime/npm test`: **82 passed**.
- `WebRuntime/npm run build`: passed with Vite 7.3.6; the existing large-chunk advisory remains.
- `git diff --check`: passed.
- Independent School-side audit of the existing bridge previously passed 34 focused tests and four synthetic cross-repository HTTP checks. This Matrix branch did not modify School. School typecheck was unavailable in that checkout because dependencies were not installed.

The Python agent-bridge fixture includes a reviewed Apply and exact runtime receipt. This run did not exercise a live Codex-to-Blender or Codex scale tool conversation. Quest scale interaction and a School lesson UI remain untested and separate.
