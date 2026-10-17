# AI Citizens in the Matrix Web world

This guide covers the existing bounded Citizens capability. It does not require
School or extend the frozen [v1.2 release scope](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/Docs/V1.2-Checkpoint.md).

## Choose the world owner

| Entry | State and ownership |
| --- | --- |
| `/web/` | Interactive browser-owned world. Citizens uses the page's existing MatrixWorld, renderer and bridge. Closing that browser stops its clock. |
| `/web/hosted.html` | Read-only view of the separate PC-owned Ada/Bo fixture. The host checkpoints each tick and continues with visitors closed. Visitors have no writer lease, local Citizens clock or browser checkpoint. Follow the [host runbook](Persistent-World-Host.md). |
| `/web/citizens.html` | [Isolated desktop demo](Citizens-Desktop-Demo.md) with its own browser-local world/save. It does not exchange state with the main page or PC checkpoints. |

These paths do not migrate each other's worlds. A hosted restart resumes its
saved tick without simulating elapsed downtime.
Resident decisions do not receive Agent Portal credentials; bounded hosted
capability requests follow the separate host runbook.

An eligible browser-owned Citizens world can be visited through AR without
cloning its scene or changing IDs. A running simulation continues during the
active AR visit, including temporary loss of the view origin; the overlay hides
until tracking returns. An intentionally paused simulation stays paused. The
visit rejects authored commands from the AR view. Other worlds retain the
ordinary AR placement/recovery path. An AR view anchor establishes neither
physical alignment nor real-room collision.

## Start an isolated desktop world

For a source checkout, run from the repository root. Use an unused port and a
fresh browser profile/origin so an existing world cannot be restored accidentally.

```powershell
npm.cmd --prefix WebRuntime ci
npm.cmd --prefix WebRuntime run build
$citizensPort = 19840 # Choose another unused port if necessary.
$demoRoot = Join-Path $env:TEMP ('matrix-citizens-' + [guid]::NewGuid().ToString('N'))
$citizensScenes = Join-Path $demoRoot 'scenes'
$citizensAssets = Join-Path $demoRoot 'web-assets'
New-Item -ItemType Directory -Force -Path $citizensScenes,$citizensAssets | Out-Null
python ControlService/server.py --host 127.0.0.1 --port $citizensPort --scenes $citizensScenes --web-assets $citizensAssets
```

Open `http://127.0.0.1:<chosen-port>/web/`. In **AI Citizens**, choose a seed and
**Start here** on an empty desktop virtual floor. This creates the chair/table
and two-orb fixture. For an existing scene, select compatible furniture and use
**Use selected station** instead; it preserves that furniture and adds two orb
residents. Finish or remove an active game before starting Citizens.

**Run**, **Pause** and **Step one minute** control Citizens independently of
Creator/Play. One tick is one simulated minute. **1×**, **4×** and **16×** advance
that many sequential minutes per visible half-second; Step always advances one.
Paused or hidden ordinary tabs do not catch up missed time. Active AR visits
have the exception described above.

The panel shows residents' needs, activities, routine scores, station claims,
FIFO waits, appointments, social sessions, relationships and recent outcomes.
**Stop Citizens** requires a second click within ten seconds: it removes the
simulation state while leaving its scene objects. Use Pause to retain a resumable
simulation.

## Stations and navigation

**Use selected station** accepts a built-in chair/table or a registered static
GLB with a reviewed interaction. While paused, select a different complementary
station and choose **Add selected station**. This keeps the same residents,
clock, needs, claims and history; the limit is one rest and one eat station.
An incompatible or unreachable selection leaves the simulation unchanged.

A reviewed GLB descriptor belongs to the scene object. It identifies the exact
asset hash, interaction kind, local approach/use poses, range, duration, capacity
one and bounded need effect. The existing `matrix_set_interaction` tool or
validated `set_interaction` command attaches it; removal uses
`remove_interaction`. Both service and browser enforce current-state
preconditions. Wait for the applied browser receipt and reread the descriptor;
a queued POST or visual resemblance does not qualify a station.

The checked-in [chair](../WebRuntime/test/fixtures/citizens-demo-chair.glb) and
[food table](../WebRuntime/test/fixtures/citizens-demo-food-table.glb) have matching
[rest](../WebRuntime/test/fixtures/citizens-demo-chair-interaction.json) and
[eat](../WebRuntime/test/fixtures/citizens-demo-food-table-interaction.json)
descriptors. The [preserved registration/setup recipe](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Citizens-Shared-World.md#two-reviewed-stations-in-one-world)
records exact asset IDs, bounds and poses. Use those fixtures from a source
checkout; the runtime ZIP does not supply a portable demo world.

Navigation requires a level virtual floor, upright static objects and current
measured footprints. Residents retain their 0.7 scale; resizing or elevating one
invalidates its clearance binding. Registered GLBs must load and be measured by
the renderer before Run/Step is available. Missing or mismatched verification
pauses a running simulation and releases active/queued station work. Animation
clips and moving geometry are unsupported for this finite navigation contract.

## Routines, appointments and outcomes

- **Routines:** Pause, select a resident and existing routine, set start/end
  minutes and High/Default/Low priority, then **Apply routine**. Minute 0 is
  midnight; 1440 is the exclusive day end. Unequal start/end values may cross
  midnight. Edits preserve current activities, claims, waits and social sessions;
  the next idle choice uses the new window.
- **Appointments:** Choose **New appointment**, rest/eat and absolute simulated
  start/deadline minutes. Start is 1–1440 minutes ahead; the inclusive deadline
  is 1–1440 minutes after start. **Apply appointment** can revise a pending
  entry; **Cancel pending appointment** records its cancellation. Other states
  cannot be edited. Each resident retains up to three open commitments and three
  recent terminal outcomes; IDs continue increasing after history is pruned.
  Conflict previews are advisory. Running Citizens, AR, invalid bindings or a
  pending PC exchange block routine/appointment authoring.
- **Choices:** Due appointments normally precede optional routines by earliest
  deadline, then start and ID. Critical hunger may outrank due rest. At fullness
  15 or below, safe reachable food can interrupt optional rest/explore travel
  or a rest FIFO wait; protected use, departure, social and appointment-linked
  work remains committed. Due appointments can adopt a compatible optional
  trip or safely replace optional travel/waiting.
- **Completion:** Need benefits require exact Matrix interaction outcomes.
  Queuing, choosing or starting is insufficient. Missing an inclusive deadline
  records a missed appointment; an underlying action may continue and later
  earn its ordinary benefit without turning that appointment into completed.

Capacity-one stations use execution-bound claims and FIFO tickets. Ordinary
claims expire after 72 ticks and waits after 96. Individual and accepted social
travel tolerate three failed route ticks; the next blocked attempt fails or
interrupts without a benefit. Changed static geometry causes replanning from
the observed pose.

After station use, the resident retains its claim while verified movement clears
the approach. Failed departure pauses Citizens with that claim held: inspect
the geometry, then Run to retry. An uncertain receipt does not free an occupied
station or repeat its benefit.

Social offers use saved seeded responses, expire after four ticks and have a
72-tick accepted-session deadline. Only the matching request/actor/target/kind/
session receipt and distance of at most 0.8 m can raise needs or relationship. Declines,
timeouts, interruptions and unverifiable outcomes do not. This is a bounded
authored interaction, not a general dialogue service or model call each frame.

## Editing, saving and recovery

Finite offline proposals may edit unrelated objects while residents move.
Resident-targeted edits become stale when their poses change. Pause Citizens
for AI, image, voice and game planning because those paths retain broader
snapshot dependencies. A failed command prevents later commands in the same
reviewed batch from applying.

Moving a bound resident/station or adding an active transform owner cancels
affected work, releases claims and pauses Citizens. Incompatible bindings block
checkpoint writes while retaining the previous valid browser copy. Undo the
edit, restore a valid full-world checkpoint, or Stop Citizens to retain the
edited scene without simulation bindings. Deleting a resident retires its ID;
deleting a station removes its binding and affected claims/waits. Remaining
residents can continue; deleting the last pauses the simulation.

The current outer world envelope is v3 with nested Citizens v15. Supported older
states migrate through validation without rewriting original checkpoint files;
scene/game-only v2 worlds remain supported. Full-world saves carry stable IDs,
clock/speed, needs, activities, claims, queues, random state and bounded history
alongside scene/game state. PC save pauses Citizens; Run resumes after restore.
PC restore blocks the timer and browser autosave until the exchange settles.
After browser reopen, wait for the service connection: its runtime lease can
take up to 15 seconds to transfer. Browser recovery does not need that lease.

Save paths differ: desktop Save world is a full PC checkpoint; XR SAVE writes a
full browser checkpoint plus a PC scene-only backup. Do not treat the latter
backup as a complete Citizens save. Keep required catalog manifests and exact
GLB files with recoverable worlds.

If the newest browser save references missing `web:` assets, recovery waits
without replacing it with an empty or older world. Restore the matching catalog
and choose **Refresh assets**; polling also retries. After loading, fresh
renderer measurements are required. Intrinsically malformed saves retain their
existing quarantine/fallback rules. Uncertain old queued commands are reconciled
rather than replayed after recovery.

Before Delete, Clear or scene Load removes a bound object, the browser keeps a
separate verified pre-deletion whole-world copy. Its two-click **Restore**
recovers both scene and Citizens; scene Undo alone can leave a returned actor
retired. The first backup stays until a restored world is durably verified.
Failure to verify the backup preserves previous autosave copies. This recovery
slot is separate from manual checkpoints.

## Evidence

The [complete pre-cleanup guide](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/60ab4599752147f2e590293208bee4692965a524/Docs/Citizens-Shared-World.md)
preserves dated builds, exact seeds, hashes, ports, replay procedures and linked
screenshots/JSON. Those candidate-specific desktop results do not establish a
complete Quest, multiplayer, physical-room or frozen-package pass. Current v1.2
gates remain in the [acceptance ledger](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/Validation/V1.2-Headset-Acceptance.md).
