# Matrix Operator checkpoints

## Citizens occupied-chair handoff candidate (September 26, 2026)

The `codex/citizens-station-egress` branch is stacked on open [PR #112](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/112) and addresses the observed shared-chair handoff gap under [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15) and [#19](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/19). After a matching Matrix interaction outcome grants a rest or eat effect once, the resident enters persisted `egress` and keeps its capacity-one claim. Finite, clearance-checked Matrix movement receipts move it away; only then can the original FIFO waiter take its turn. A blocked or uncertain departure, navigation pause, external move, or identical scene replacement keeps the claim and wait ticket until verified clearance. Once the resident is clear, unrelated waiter obstruction uses the waiter's own bounded retries. The panel names the resident's leaving phase. Nested Citizens v8 preserves this phase in browser and PC world checkpoints and migrates valid v1–v7 saves; the outer world envelope remains v3.

In the [isolated built `/web/` replay](../Validation/citizens-egress-browser.json) on port **19852**, the prior two-GLB minute-1 checkpoint kept four stable objects, Ada's chair execution 1 and Bo's FIFO execution 2. At minute **14** Ada completed rest but still held the chair while Bo waited. At minute **18** Ada cleared it and Bo inherited execution 2; Bo reached the chair at 24 and completed rest at **31**. Named PC checkpoint `egress-m14` saved the occupied departure phase; restoring it after minute 32 and taking 18 browser Step actions reproduced minute 32. Browser reload retained the replayed state, and console errors were **0**. [Claimed-chair](../Validation/citizens-egress-claimed.png) and [handoff](../Validation/citizens-egress-handoff.png) screenshots show the visible world and inspector. WebRuntime **306/306**, ControlService **687/687**, Vite build and `git diff --check` passed. Focused tests additionally cover rejected and uncertain departure movement, independent waiter obstruction, navigation pause, identical scene replacement, lease/wait expiry, receipt-backed use, v7 migration and checkpoint rejection. This evidence covers static reviewed furniture in the desktop virtual room; the rejected unreachable second-station browser edit, moving/animated affordances, broader #17 schedules and [M4 wearer checks](../WebRuntime/QUEST3_ACCEPTANCE.md) remain open.

## Citizens virtual-day routines candidate (September 26, 2026)

Open review: [PR #112](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/112), stacked on open PR #111.

The `codex/citizens-virtual-day` branch is stacked on open [PR #111](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/111) and advances [#17](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/17) as an idle-choice layer within the existing two-resident Matrix Web world. Nested Citizens v7 persists a simulated minute clock, selectable **1×/4×/16×** speed, up to six recurring daily windows per resident, and a bounded latest candidate score trace. Fresh or valid v1–v6 saved Citizens worlds migrate to v7. The overlapping morning meal/walk windows and overnight rest window bias legal `rest`/`eat`/`explore` choices by need, preference, travel, station availability, weight and priority. A critical hunger check can override an optional window at the next idle decision. Already active actions, FIFO waits and social sessions still use the existing finite execution and observed Matrix receipt paths. The outer world checkpoint remains v3; PC validation now accepts exact v7 state and the existing v6/v7 selected built-in station approach mode. Hidden tabs, pause and reload do not catch up missed wall time.

The [isolated built `/web/` browser run](../Validation/citizens-virtual-day-browser.json) restored a prior paused minute-1 two-GLB v6 checkpoint on a new port **19851**, showing migrated v7 state with the same four object IDs and initial claim/waiter. At **16×** it reached day 2, minute **1761**, with reviewed static chair and food table rendered, observed rest/eat/explore outcomes, routine/need decision scores, two independent station claims, and completed social receipt history. A named PC world checkpoint saved v7/speed16 at 1761; browser reload retained that state, paused **Step** reached 1762, and named PC restore returned to 1761. [World](../Validation/citizens-virtual-day-browser.png) and [inspector](../Validation/citizens-virtual-day-inspector.png) screenshots accompany the structured record. WebRuntime **297/297**, ControlService **685/685**, Vite build, JS-to-PC validator parity checks and `git diff --check` passed; browser console errors: **0**. The browser sampled selected moments, while focused tests cover 09:00 overlap, midnight, seeded aggregate shifts and a full 1,440-minute state.

This is a partial #17 implementation: hard appointments, in-flight interruption, a social need and broader schedule authoring remain open. The prior occupied-chair approach handoff at minute 82 is reproducible: Ada can release the chair while standing at its single authored approach, leaving Bo's next FIFO claim with no clear route. That separate #15/#19 fix needs a validated egress or deferred handoff. The rejected unreachable second-station browser edit, animated/moving interactions and [M4 wearer checks](../WebRuntime/QUEST3_ACCEPTANCE.md) also remain open. See the [updated runbook](Citizens-Shared-World.md) for how to try this slice.

## Browser world waits for missing Web catalog assets (September 26, 2026)

Open review: [PR #111](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/111), stacked on open PR #110.

The `codex/citizens-catalog-recovery` candidate addresses a restart gap in the ordinary `/web/` world. If the newest browser save refers to registered `web:` assets absent from the current catalog, startup reports their exact asset IDs and keeps that save pending. It does not quarantine that copy, restore an older tab copy, overwrite either browser save, or exchange an empty fallback scene with the PC. The page leaves world editing and checkpoints locked while it waits. After the matching catalog entries return, **Refresh assets** or the ten-second catalog poll retries the same saved candidate through normal scene, game and Citizens validation. Intrinsic envelope, origin, scene-object and transform errors still use the quarantine and older-copy recovery path; asset-dependent validity is decided when the catalog returns. The first exchange after recovery rejects any old queued command whose outcome might already be in the saved world, returning a failed receipt for reconciliation instead of replaying it. Named PC whole-world checkpoints continue to require their exact catalog files and hashes; this change does not embed or fetch GLB bytes.

The [isolated browser run](../Validation/citizens-catalog-recovery-browser.json) used port **19850** and the paused minute-123 two-GLB Citizens checkpoint. With only that demo catalog's manifest unavailable, `/web/` named both missing asset IDs, held recovery and disabled world edits; the PC lease expired with its four-object snapshot intact. After the manifest returned, **Refresh assets** brought back the same four object IDs, two rendered GLBs, Ada's chair claim, minute **123**, ended social event and relationship **55**. A second browser reload kept that state. The isolated PC checkpoint hash remained unchanged and the browser error log was empty. The focused scene-store tests passed **34/34**, full WebRuntime **288/288**, ControlService **682/682**, and Vite built. Browser storage bytes were not directly inspected; the store tests assert they remain unchanged during the wait. The stale-command case was exercised in a bridge test, not in this browser run, which had zero pending commands. Quest wearer checks remain pending.

## Two reviewed Citizens stations in one world (September 26, 2026)

Open review: [PR #110](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/110), stacked on open PR #108.

The `codex/citizens-dual-stations` candidate extends the open [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15) and [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29) work on the ordinary `/web/` desktop virtual room. **Use selected station** still starts two residents from one existing, reviewed object. The new **Add selected station** action runs only while Citizens is paused, accepts a complementary `rest` or `eat` object, checks the current bindings and both resident routes, and keeps the existing clock, needs, reservations and social state. One simulation can bind at most one station of each kind. It uses the same MatrixWorld movement and interaction receipts; a new station does not create residents or replace the scene. Selected built-in furniture now retains its chosen approach after the station count changes; the original fixed **Start here** fixture retains its old approach rule.

An original [food table GLB](../WebRuntime/test/fixtures/citizens-demo-food-table.glb), its [editable generator](../WebRuntime/test/fixtures/build_citizens_demo_food_table.py), and [reviewed eat definition](../WebRuntime/test/fixtures/citizens-demo-food-table-interaction.json) supply a second need effect (`hunger +32`) beside the prior static chair (`energy +22`). The table's registered SHA is `53b79a6a6f7f8950d004b2beb55d42bd4a547d719500dfbb40414166cf9ef0c7`, with 1.2 × 0.855 × 0.8 m measured bounds and no clips. Its descriptor is tied to that exact asset, a local approach/use pair, a five-tick duration, and capacity one. The focused GLTFLoader/MatrixWorld fixture test validates the bytes, bounds, descriptor and one matching eat outcome; catalog registration accepted the same bytes in an isolated temporary catalog.

The isolated browser on port **19849** rendered both GLBs at `(0, 0, -2)` and `(2, 0, 0)`, applied each queued `set_interaction` with a browser receipt, then ran seed **29** with the food table added while paused. Ada and Bo first contended for the chair. Ada completed eat at minute 45 and Bo at minute 62. A completed conversation at minute **96** produced saved event `social-29-9-ended-96`, referencing `citizens-29-social-9-91`; their relationship changed from **50 to 55**. The named PC whole-world checkpoint `dual-stations-m123` contains the same four Matrix object IDs, both exact GLB dependencies, outer world v3 and nested Citizens v6. It is paused at minute **123** with Ada's latest rest at 112 and Bo's latest eat at 121. Restoring `dual-stations-m1` and taking 95 browser **Step** actions reproduced the same minute-96 social end and relationship score; a later restore and browser reload retained minute 123, four objects and relationship 55. The browser console error log was empty. See the [structured browser record](../Validation/citizens-dual-stations-browser.json), [world screenshot](../Validation/citizens-dual-stations-browser.png), [decision log](../Validation/citizens-dual-stations-log.png), and [reproduction runbook](Citizens-Shared-World.md).

The final WebRuntime suite passed **282/282**, ControlService **682/682**, Python compilation and the Vite build passed. This evidence covers two static registered objects and a finite two-resident social session on desktop. One chair route attempt exhausted its retries at minute 82 when another resident overlapped the destination; later need and social outcomes still completed. It does not prove simultaneous multi-resource activities, animated or moving stations, AR room alignment, multiplayer, or Quest wearer acceptance. The next useful browser check is a rejected unreachable second-station addition that leaves the current saved world intact; moving/animated interaction ownership and the unfinished [M4 wearer checks](../WebRuntime/QUEST3_ACCEPTANCE.md) remain separate.

## Reviewed registered GLB Citizens station candidate (September 26, 2026)

Open review: [PR #108](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/108), stacked on the open route-recovery PR.

The `codex/citizens-affordances` branch continues [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15) on the ordinary `/web/` desktop virtual floor. A reviewed version-1 interaction descriptor can bind one registered static GLB scene object to a finite rest or eat action. It names the exact asset SHA-256, local approach/use poses, range, duration, capacity one and bounded need effect. PC typed tools and the raw queue validate the installed asset, descriptor and current world. For both `set_interaction` and `remove_interaction`, the latest queue snapshot supplies the observed transform and prior descriptor as command preconditions; the prior descriptor is `null` on a first set. The browser requires the current object's rendered bounds, an upright static pose, reachable clearance and a matching interaction definition before returning the use receipt. Citizens routes and reserves independently, applies the advertised effect only after that receipt, and pauses on incompatible station or catalog changes. Rotated local poses and rectangular obstacles now use the same positive-Y convention as Three.js. Built-in chair/table interactions remain supported.

The isolated `/web/` browser on port **19848** rendered an original static [demo chair](../WebRuntime/test/fixtures/citizens-demo-chair.glb), attached its reviewed descriptor after the applied PC queue receipt, and selected that existing object without replacing it. Seed 29 created two orb residents. At minute 1 Ada held the capacity-one chair and Bo waited. Ada completed rest at minute 14; Bo temporarily encountered Ada at the approach lane, kept his execution during bounded route retry, and completed rest at minute 29. The browser displayed Bo's energy at 35 and released chair claim. A named PC whole-world checkpoint preserved all three object IDs, the GLB dependency and nested Citizens v6 state. Reload briefly disabled Run/Step until the GLB rendered and verified again; named PC restore returned the minute-1 claim/wait state, and 28 browser Step actions replayed Bo's minute-29 completion. Browser console errors: none. [Screenshot](../Validation/citizens-authored-seat-browser.png), [structured browser record](../Validation/citizens-authored-seat-browser.json) and [runbook](Citizens-Shared-World.md) distinguish visible behavior from the focused receipt tests.

The outer world envelope stays v3; nested Citizens state is v6 and earlier valid v1–v5 saves migrate. The PC validates saved GLB dependencies before replacing a live world and accepts v6 bindings without rewriting old files. WebRuntime passed **276/276** tests, ControlService **681/681**, Vite built, and Python compilation passed. This covers one static, renderer-verified GLB rest station; general animated/moving affordances, broader #15 navigation, AR alignment and unfinished M4 Quest wearer acceptance remain open. The port-19846 and port-19847 demos below are separate historical checkpoints and remain untouched.

The two-station candidate above follows this earlier one-station checkpoint. General moving or animated interactions and headset acceptance remain separate open work.

## Citizens route recovery candidate (September 26, 2026)

The `codex/citizens-route-recovery` branch continues the open [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15) work on the ordinary `/web/` desktop virtual floor. During an active individual Citizens trip, `MatrixWorld` supplies a bounded identity for the current navigation geometry, excluding the two resident orbs' own movement. A changed static obstacle makes the resident plan again from its observed pose. If a route is unavailable, the current execution keeps any station claim for at most three retry ticks; clearing the obstacle in time lets that execution continue. A fourth blocked attempt fails it and releases its claim, if any, without a need benefit. Every successful move still uses a clearance check and MatrixWorld receipt. This is a narrow route recovery rule for static, floor-aligned geometry, not general moving-body navigation. Social-session travel still interrupts immediately when a route is unavailable.

The built `/web/` page on an isolated loopback service at port **19847** used one selected built-in chair, one authored wall and seed 3. After Ada began traveling, the wall moved across her route; the panel reported replanning, showed her go around its end, and recorded a completed rest at minute 18. After Bo acquired the chair, the wall moved over his current position. The panel logged retry 1/3, and a named PC world checkpoint `route-retry-m20` preserved the four object IDs, Bo's execution 2 and chair claim, route retry count and geometry identity. Browser reload resumed at minute 20. Retry 2/3 occurred after reload; moving the wall away let the same execution complete a rest at minute 33. Restoring the named checkpoint and leaving the wall in place yielded retry 2/3, retry 3/3, then explicit failure and claim release at minute 23 with no Bo rest benefit. The browser reported no console errors. The focused Node test, rather than the browser trace, checked every swept move against the changed wall. [Structured browser evidence](../Validation/citizens-route-recovery-browser.json) records the observations and limits. WebRuntime passed **257/257** tests, ControlService **674/674**, and the Vite production build passed.

At this earlier route-recovery checkpoint, the outer saved world remained version 3 with Citizens and nested Citizens state advanced to version 5: an active activity stored the bounded retry count and geometry identity. Browser restore migrated valid nested v4 state to v5 with no prior retries; the PC validator accepted v1 through v5 without rewriting old checkpoint files. The current branch advances the nested state to v6 for one reviewed static GLB station. General affordances beyond that one station, animation swept bounds, full #15 acceptance and Quest wearer checks remain open. The earlier port-19846 registered GLB readiness result below is a separate historical checkpoint.

## Registered GLB navigation readiness candidate (September 26, 2026)

Open [PR #106](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/106)
on `codex/citizens-glb-readiness` extends the Citizens stack from
[PR #105](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/105)
for a narrow [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15)
readiness slice. A registered GLB obstacle must load in the actual Three.js
view, and its measured model size must fit the catalog footprint, before
Citizens uses that footprint for virtual-floor routes. Verification belongs to
the current scene object and asset signature. Catalog or scene replacement,
failed loading, and AR entry clear it; ordinary redraws during resident ticks
preserve evidence for the same content-addressed GLB. A nearby unverified GLB
also blocks a direct `MatrixWorld.interact` clearance receipt. Any catalog GLB
with animation clips blocks finite interaction because its motion has no
measured envelope. If the footprint
becomes unavailable while Citizens runs, the simulation pauses before the next
tick, releases claims and waits, and grants no speculative need benefit. The
panel explains the reason and disables Run/Step until the renderer verifies the
model again. Registered GLBs with catalog animation clips are refused as
obstacles because the initial measured box is not a swept animation envelope.

The built `/web/` page on isolated port **19846** showed a static registered
GLB and selected chair in the same scene. Deliberately shrinking the catalog
footprint to 0.1 m refused Citizens start with an explicit verification
message. After restoring the measured footprint, seed 29 added two residents;
Ada claimed the chair and Bo queued. Bo completed a rest at minute 27. A named
PC whole-world checkpoint at minute 76 survived browser reload. Run/Step
waited for the reloaded GLB, then minute 82 completed Ada's rest and raised
her energy to 100. PC restore returned minute 76, and six steps replayed that
outcome. A live catalog mismatch later paused the run at minute 91, failed
Bo's active rest execution, and released his chair claim without that rest
benefit. The final isolated browser scene was restored to the clean minute-76
checkpoint with four objects and the measured catalog. [Structured browser
evidence](../Validation/citizens-glb-readiness-browser.json) records the
fixture, IDs, and limits. The full WebRuntime suite passed **250/250**,
ControlService passed **672/672**, and Vite built.

This verifies a static, registered GLB obstacle on a desktop virtual floor.
At this earlier checkpoint, general geometry versions and route repair,
versioned object affordances, moving-target ownership, real-room geometry, and
Quest wearer checks remain open under #15 and M4. Keep the port-19844 and
port-19845 demos and their saved state intact.

## Live Citizens revisions and interaction clearance candidate (September 26, 2026)

Open [PR #105](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/105)
on `codex/citizens-live-revisions` builds on the selected-furniture
[PR #104](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/104)
for a narrow [#13A](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/13)
and [#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15)
slice. The ordinary `/web/` runtime advertises its active Citizens orb IDs and
an authored scene generation in the PC snapshot. The PC service retains the
latest full poses but excludes only those residents' observed X/Z motion from
the broad scene revision. Browser reload, explicit scene edits, selection and
room changes still advance proposal freshness. The service validates the
observation marker and derives proposal dependencies itself: a finite offline
edit to an unrelated object may survive resident motion, while a proposal
targeting or selecting a resident becomes stale if that actor moves. A queued
command aimed at a resident also carries its reviewed transform; the browser
rejects the command if the resident moves before execution. A reviewed command
batch skips successors with failed receipts when a predecessor fails. AI, image, voice,
game, capture, and other implicit whole-scene paths keep full-pose freshness
checks through Apply. Legacy scene-only saves omit the transient marker.

At station use, Citizens checks the current line to the target against measured
obstacles, and `MatrixWorld.interact` independently refuses an occluded
receipt. A changed wall cannot yield an unobserved need benefit. This is a
bounded built-in virtual-floor check, not a general geometry-version or
affordance system.

The built browser on isolated port **19844** ran two residents while an offline
pedestal move waited under review from minute 550 to 583. Apply returned the
matching runtime receipt and changed its X position from 3 to 2.8. A second
proposal aimed at moving Ada was rejected before dispatch. After a named PC
checkpoint and browser reload, stepping minute 947 to 948 produced the same
Bo energy change before and after PC restore. In a separate step from that
checkpoint, a wall inserted between Ada and the chair caused a visible failed
use at minute 956, no energy gain, and handoff of the chair claim to Bo. The
clean checkpoint was restored afterward, with five objects and Citizens paused
at minute 947. The browser reported no errors. [Structured browser evidence](../Validation/citizens-live-revisions-browser.json)
records IDs and outcomes. The final WebRuntime suite passed **241/241**,
ControlService passed **672/672**, and Vite built. The final rebuilt page
reloaded the five-object saved world, stepped from minute 947 to 948, restored
the named PC checkpoint to minute 947, and reported no browser console errors.

Still open: general navigation geometry readiness/versioning and moving-target
route invalidation, versioned object affordances, broader motion ownership,
AI proposals that safely declare narrow spatial dependencies, and Quest wearer
checks. An AI command inferred from a resident pose can still become stale
between Apply and browser execution if the command does not target that
resident; pause Citizens for those paths. This desktop result does not complete
#13A or #15.

## Selected existing Citizens furniture candidate (September 26, 2026)

Open [PR #104](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/104)
stacks this candidate on the open social-session PR #103. The current
[#15](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/15)
slice adds an explicit **Use selected chair or table** path to the ordinary
`/web/` desktop virtual room. A selected, existing built-in chair or table
becomes the simulation's rest or food station by its Matrix object ID. Two orb
residents are added; the user's existing scene objects and furniture remain.
An active game must be finished or removed before starting this path.
The original **Start here** two-station fixture still requires an empty floor,
and `/web/citizens.html` remains a separate seeded fixture.

This path checks the selection and bounded virtual-floor navigation before
starting or acting. Resident movement and interaction go through finite
`MatrixWorld` commands and observed receipts; blocked, unavailable, changed,
or unsupported targets must produce a visible refusal or cancellation without
an unobserved need benefit. The existing capacity-one reservation and finite
social-session rules remain. Browser and named PC whole-world checkpoints
carry the scene and Citizens bindings together; restore rejects incompatible
dependencies before replacing the active world.

An isolated browser run on loopback port 19843 created a chair and wall through
the ordinary offline planner, selected the chair in Three.js, and added exactly
two resident orbs. Bo completed rest at minute 23 while Ada queued; a later
conversation completed at minute 308 with Matrix receipt
`citizens-29-social-37-242`, raising the pair score to 55. The scene retained
the chair and wall IDs. A browser reload retained the paused minute-319 state,
and named PC checkpoint restore returned the same four objects and state after
one step; replay reproduced Ada's minute-320 energy. The page had no captured
errors. [Browser evidence](../Validation/citizens-selected-furniture-browser.json)
and [screenshot](../Validation/citizens-selected-furniture-browser.png) record
the observations. The final local WebRuntime suite passed **223/223**, the
ControlService suite **658/658**, and Vite built. The obstacle detour and
blocked-start assertions are unit tests; the browser run demonstrates the
selected chair in a nonempty world rather than a full #15 obstacle fixture.

Issue #15 still requires general versioned object affordances and their
capabilities/predicates/poses/effects, tested changing-route recovery and
navigation readiness, a complete motion-owner contract, and its full obstacle,
missing-dependency, and real-room acceptance. This selected built-in
chair/table path does not make arbitrary authored GLBs interactive or close
Quest wearer checks.

## Bilateral Citizens social session candidate (September 26, 2026)

Open [PR #103](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/103)
(`codex/citizens-social-sessions`) extends the Citizens PR stack
toward [#19](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/19).
It keeps the outer Matrix world checkpoint envelope at version 3 and moves the
nested Citizens state to schema version 4 after the relationship-evidence review fix. Two available residents carry the
same stable social session ID. A saved random response produces an acceptance,
decline, or unanswered invitation; offers and accepted sessions have explicit
simulation-tick deadlines. An accepted initiator moves through `MatrixWorld`
and must receive a matching in-range `converse` receipt before either fun or
the pair's relationship score rises. Terminal outcomes and receipt references
are visible in both Citizens inspectors and persist with browser and named PC
world checkpoints. V4 saves a bounded per-pair list of completed session and
receipt IDs, derives relationship score from that list, and requires each
retained `ended` event to match it. Nested v1/v2 saves migrate in the browser;
v3 migrates only when its visible completed events account for its score.
The PC service accepts exact v1–v4 shapes without rewriting older files.

The PR #103 review found that v3 restore accepted an arbitrary score without
a completed receipt. The v4 ledger keeps the last ten confirmed completions
per pair and requires the displayed score and retained `ended` events to
match. Browser and PC validation reject a forged v3 score such as 99 with no
completed event. If an older v3 event ring has already discarded a completion
needed to explain its score, restore reports incomplete history instead of
silently granting a benefit; keep the old checkpoint for recovery or review.
The PC service validates historical receipt references but cannot independently
attest a past browser-only MatrixWorld action.

The review fix passed **206/206** WebRuntime tests, **654/654** ControlService
tests, and the Vite production build. The built `/web/` page on isolated port
**19842** restored the earlier raw v3 named checkpoint `social-seed2-m112` at
minute 112 with relationship 55. Saving it as `ledger-v4-restored` produced
nested v4 with one completion record for `social-2-9` and receipt
`citizens-2-social-9-80`; all four Matrix object IDs matched the old file.
Browser reload retained minute 113 and the outcome, while v4 PC restore to
minute 112 and the next step reproduced the earlier minute-113 resident and
station state. Neither browser run reported a page error. See the [migration
screenshot](../Validation/citizens-receipt-ledger-migration.png) and [structured
evidence](../Validation/citizens-receipt-ledger-migration.json). The original
isolated demo on port 19841 was left running unchanged.

The fixed-seed fixture has one active bilateral session at a time. Deletion,
authored movement, scene replacement, AR entry, Stop, and rejected interaction
cancel it without a relationship benefit. The open [#19](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/19)
still covers broader multi-resource ordering and future social policy. This
candidate adds no dialogue generation, multiplayer synchronization, or Quest
wearer validation. Selected furniture and bounded paths are a subsequent #15
candidate described above.

After rebasing on the PR #102 AR deletion recovery fix, the local WebRuntime
suite passed **203/203** and the Vite build passed. The full ControlService
suite passed **652/652** on the identical Python source before the rebase;
the checkpoint module passed **20/20** afterward. Browser restore now also
rejects malformed surrogate text under the same UTF-16 limits as the PC
checkpoint validator. The built desktop browser
on isolated port **19841** ran seed 2 in `/web/`: Ada
invited Bo at minute 76, Bo accepted at 77, and the local MatrixWorld receipt
`citizens-2-social-9-80` ended the session at 87. The relationship inspector
rose from 50 to 55. Browser reload preserved minute 112 and the social
events; named PC checkpoint `social-seed2-m112` restored that state after a
step to 113, and stepping the restored world reproduced minute 113. In the
isolated fixture, seed 1 produced a timeout at minute 48 and a decline at
minute 80. The relationship stayed 50, and browser reload preserved the
events at minute 97. Both pages reported no page errors. See the [shared
screenshot](../Validation/citizens-social-shared.png), [failed-attempt
screenshot](../Validation/citizens-social-failed.png), [browser
evidence](../Validation/citizens-social-browser-evidence.json), and
[shared-world runbook](Citizens-Shared-World.md) for reproduction and limits.

## Citizens reservation lifecycle candidate (September 26, 2026)

The `codex/citizens-reservation-lifecycle` branch continues the open shared-world
Citizens work toward [#19](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/19).
The saved Matrix world inside browser and named PC checkpoints remains version
3 when Citizens is present. Its nested Citizens checkpoint is now schema
version 2. It adds `actionSequence`, execution IDs on active intentions,
capacity-one station claims, FIFO wait queues, and retired resident IDs. The
claim records owner, execution, and expiry tick; a waiter records resident,
execution, and enqueue tick. A claim expires after at most 72 simulation
ticks, and a wait times out after 96. Release and cancellation clear the
matching execution, while `MatrixWorld` still validates interaction outcomes
before needs change.

Live deletion of a bound actor retires that actor and releases its claim or
wait. Live deletion of a station removes the resource and cancels its claimant
and waiters. Surviving residents can continue; the last actor's removal pauses
the simulation. The panel shows retired actors, missing fixture resources,
claim ownership and queue order. An incompatible remaining binding still
pauses Citizens and preserves recovery guidance and the previous valid browser
copy. Checkpoint restore rejects missing/incompatible bindings before changing
the active world. AR entry clears active claims and queued waits before
detaching the desktop simulation.

The first removal of a bound Citizens object preserves the prior complete
browser world in a dedicated pre-deletion recovery slot before autosave. It
covers Delete, Clear, and scene Load; a failed backup blocks both autosave
writes. The panel shows the saved minute and offers a double-confirmed full
restore. A successful durable save of that restored world clears the slot, so
the next deletion records a fresh copy. The manual browser checkpoint remains
separate. Scene Undo returns objects but cannot by itself recreate retired
Citizens bindings. Named PC restore pauses Citizens and gates timer/autosave
until the service accepts or rejects the candidate; a delayed rejection test
confirms the staged world is never saved. Pause Citizens before Operator
scene/game planning because
the moving scene can change revision during a guarded plan and cause a 409.

Valid nested Citizens v1 saves migrate in the browser: active resident order
assigns deterministic execution IDs, each old station holder becomes a claim,
and wait/retired lists start empty. The PC validator accepts both v1 and v2
without rewriting old files. Scene/game-only version 2 world envelopes remain
compatible. The fixture still starts with two residents and two stations on an
empty virtual floor; v2 state is bounded to four live-plus-retired residents,
two stations, and 80 log entries. This candidate does not add selected authored
furniture, multi-resource acquisition, or bilateral social sessions. The
initiate/accept/decline/timeout/end and observed relationship outcomes in #19
remain work for a later slice. [Runbook and limits](Citizens-Shared-World.md).

Current v2 validation: WebRuntime **190/190**, ControlService **650/650**, and
Vite production build passed. Chrome **153.0.8010.53** ran the built `/web/`
page on isolated port **19839**. Seed 17 produced Ada's chair claim and Bo's
FIFO wait at tick 1. A real actor deletion handed Bo the chair; he completed
rest, and exact browser reopen plus named PC restore/replay worked. Deleting
the chair removed its claim and wait state; Bo and the food station remained,
and another PC checkpoint saved. A second Chrome run confirmed that both
deletions while **Run** was active left Citizens unpaused and ticking, with no
page errors. [Browser evidence](../Validation/citizens-reservations-browser-evidence.json),
[running evidence](../Validation/citizens-reservations-running-evidence.json),
[queue screenshot](../Validation/citizens-reservations-queue.png), and
[survivor screenshot](../Validation/citizens-reservations-survivor.png) record
these checks. A third Chrome run tested the dedicated pre-deletion copy:
scene Undo alone left Ada retired, explicit restore recovered both scene and
Citizens, its durable save cleared the slot, and another deletion captured a
fresh minute-2 copy. The isolated `/web/citizens.html` page displayed the v2
claim and FIFO wait accurately. [Recovery evidence](../Validation/citizens-pre-deletion-recovery-evidence.json),
[recovery screenshot](../Validation/citizens-pre-deletion-recovery.png), and
[isolated-page evidence](../Validation/citizens-standalone-v2-evidence.json)
record those checks. The older counts and browser evidence below describe v1
on the shared-world candidate.

## Earlier shared-world Citizens checkpoint candidate (September 26, 2026)

The `codex/citizens-world-checkpoints` branch builds on the open desktop fixture
PR #100 and brings its two residents into the ordinary `/web/` Matrix world by
explicit opt-in on an empty virtual floor. They use the page's existing
`MatrixWorld`, view, bridge, browser world save, manual browser checkpoint, and
named PC world checkpoint. Active Citizens use a validated version 3 world
envelope; existing version 2 scene/game saves remain compatible. A staged
restore checks resident/station IDs and reservations before replacing the
active scene. Authored bound-object moves and active station transform owners
cancel affected activity and pause the simulation. Missing bindings block
invalid saves while retaining the last valid browser copy. AR entry cancels
active reservations before the desktop simulation detaches.
[Runbook and limits](Citizens-Shared-World.md).

The combined WebRuntime suite passed **170/170**, the Vite build passed, and
ControlService Python tests passed **647/647**. In Chrome **153.0.8010.53** on
an isolated built service, 45 manual ticks showed both residents acting and
four chair-contention log entries. Browser close/reopen matched the scene and
Citizens state; a PC checkpoint restored minute 45 after the browser advanced
to minute 46, then replay matched the earlier minute-46 scene and state. The
named PC checkpoint also restored after a restart of the isolated service. A
queued chair deletion paused Citizens and kept the previous valid browser save;
the valid PC checkpoint then repaired that live scene. An active behavior on a
reserved chair released its claim and blocked invalid persistence until Undo.
[Browser evidence](../Validation/citizens-shared-world-evidence.json),
[PC recovery evidence](../Validation/citizens-shared-world-recovery-restore-evidence.json),
and [transform-owner evidence](../Validation/citizens-transform-owner-evidence.json)
are recorded. No headset simulation or Quest performance budget is claimed.

At this earlier checkpoint, the next work was reservation cleanup and fairness
under #19. The candidate above addresses that lifecycle; bilateral social
outcomes remain open. Binding selected existing furniture is separate #15
work. The interaction receipt is still local to `MatrixWorld`; a general finite
executor and shared multi-client simulation remain open. Preserve the
independent M4 Quest wearer checks.

## AI Citizens desktop demo candidate (September 26, 2026)

The `codex/ai-citizens-desktop-demo` branch adds an isolated
[`/web/citizens.html` demo](Citizens-Desktop-Demo.md) under [#29](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/29).
Two simple colored residents choose activities from changing needs, move through
validated local `MatrixWorld` actions, interact with an advertised chair/table,
and apply need benefits only after matching observed receipts. The chair has
capacity one; the page shows activity, needs, reservations, and a decision/action
log. Seeded replay, pause/run/step, and a separate versioned browser-local
save/reopen are included. This branch candidate is not a claim that the live
`/web/` Agent Portal world now runs Citizens.

The WebRuntime Node suite passed **155/155**, the Vite build passed, and the
ControlService Python suite passed **643/643**. In Chrome **153.0.8010.53** on
the built page at isolated port **19837**, 45 manual ticks showed both resident
actions and chair contention in the DOM/storage. Close/reopen matched the saved
state, the same seed replay matched, a corrupt save was rejected without losing
the active world, and the page reported no errors. See the [demo runbook](Citizens-Desktop-Demo.md)
for exact commands and limits. This is desktop evidence. The unfinished
[M4 Quest acceptance checks](../WebRuntime/QUEST3_ACCEPTANCE.md) remain open.

## Current Matrix Web snapshot (September 26, 2026)

The current generalized Matrix runtime is the [Three.js/WebXR client](../WebRuntime/README.md)
at `/web/`, backed by the PC-local ControlService and Codex Agent Portal. The
[project map](../PROJECTS.md) separates it from the supported original Unity
apps, Matrix World, and AI Citizens. The Web stack through
[PR #98](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/98)
merged at `2f6554c`, followed by [PR #99](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/99)
checkpoint documentation at `0cb8c23`. The earlier
[v0.6.0-preview.1 release](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.6.0-preview.1)
freezes commit `add6e299`; it predates these merges and remains a preserved
working checkpoint. The
[v0.7.0-preview.1 release](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v0.7.0-preview.1)
tags `0cb8c23` and predates this Citizens candidate.

The merged Web stack includes Blender/GLB registration and animation, a
persistent Codex conversation in the Operator panel, bounded numeric
components, browser world checkpoints, PC whole-world checkpoints, the
reviewed Block Scale Lab, bounded vertical drops for eligible imported GLBs,
typed position/rotation edits to an existing virtual-floor object, Operator
panel hide/recall (#97), and browser-local AR origin provenance and recovery
guards (#98). The [implementation plan](../IMPLEMENTATION_PLAN.md) and [Quest acceptance
matrix](../WebRuntime/QUEST3_ACCEPTANCE.md) track remaining gates. This is not
a general rigid-body system or a validated physical-floor collider.

On the merged tree, **643 ControlService Python tests**, **141 WebRuntime Node
tests**, and the Vite build passed. [The #95 desktop runtime
check](../Validation/WebRuntime-Typed-Rotation-2026-09-26.md) obtained
successful spawn, Flight binding, and rotation receipts for the same Ice
Dragon while its position, scale, asset ID and animation bindings were
preserved. A separate [Quest VR Agent
journey](../Validation/WebRuntime-Physics-Checkpoint-Integration-2026-09-25.md#quest-3-agent-and-browser-checkpoint-journey)
confirmed voice-driven Dragon spawn/Flight, follow-up movement, browser save,
reopen, and continued conversation. After the CODEX paging fix, the wearer
confirmed page two of a Completed reply stayed visible. On the merged tree, a
separate [Quest VR rotation follow-up](../Validation/WebRuntime-Typed-Rotation-2026-09-26.md#quest-vr-agent-follow-up)
returned a successful typed move receipt and the wearer saw the Dragon turn
while Flight continued. The wearer also saw the WORLD save notice on that
merged Quest VR build; the PC scene-only backup appeared. In a separate
[AR Agent journey](../Validation/WebRuntime-AR-World-Transition-2026-09-26.md#fresh-ar-creation-loop-on-merged-main)
on the then-merged main build, the wearer created and animated a Dragon by
voice, moved and grabbed it, and recovered the same ID, Flight binding and
conversation after browser reopen. On the #97 candidate, the wearer confirmed
[panel hide and thumbstick recall](../Validation/WebRuntime-M4-Panel-Recall-2026-09-26.md)
in VR and AR with the blue ray visible. On the initial #98 candidate, the
wearer saw the same animated Dragon after VR → AR; later origin-identity fixes
have automated coverage but no Quest retest. Reviewed approval/Stop, text
readability, physical-surface behavior and saved-origin loss/recovery remain
open in the [Quest matrix](../WebRuntime/QUEST3_ACCEPTANCE.md). No CI checks
are configured for this repository's PR stack.

## Historical Unity checkpoints

The dated entries below describe earlier native Unity source, APKs, scenes and
device runs. Their use of “current” reflects the date of each original entry.
Use a matching source/APK/PC-service release when reproducing them.

### Quest 3 live catalog and AI review (September 24, 2026)

The virtual Quest app and native Matrix AR app both built as ARM64 APKs with 457
Unity core checks each and were installed on a real Quest 3. The native AR app
launched after the wearer granted spatial permission and published a 23-asset
room snapshot; this session did not confirm physical alignment or install a
pack in AR. The white room installed and placed a Poly Haven armchair, which
the wearer judged recognizable and correctly sized.

A real headset voice request for a sci-fi scene originally stopped after naming
four packs. The revised service now lets the AI select exact compatible local
packs, installs them into the connected Quest, and replans from the registered
assets. Replaying that request installed four packs, applied 13 scene placements,
captured the virtual result, and used image-capable AI review to identify an
obstructing panorama dome. After one offline interruption, a fresh reviewed
correction removed it and moved the workbench props nearer the viewer. The
Quest acknowledged the four correction commands and the final virtual capture
showed a recognizable lab. The [sanitized headset record](../Validation/quest3-autoload-20260924.json)
and three virtual JPEGs in `Validation/` separate observed results from gaps.
The ComfyUI connector currently has no enabled worker or reviewed 360-degree
workflow in this service; a flat generated image is not yet a VR skybox.

### 4616 miniature world source candidate (September 24, 2026)

The `codex/4616-miniature-world` branch adds 16 original miniature props to the seven bundled assets, bounded two-waypoint motion, and saved selection toggles for the lamp and chest. The Operator discovers the new IDs, bounds, behavior kinds and compatible interactions. The existing reviewed Apply, receipt, Undo and schema-1 save paths remain authoritative. The [inventory and repeatable demo](4616-Miniature-World.md) give the exact scope.

An isolated Windows player and PC service passed 27 end-to-end checks, including one real Codex proposal that did not execute until reviewed Apply. A final post-polish player run passed 24 checks. The Desktop and virtual Quest Unity builds each passed 457 core checks; PC source passed 479 Python tests. [Exact validation](../Validation/miniature-world-validation.json) is separate from headset evidence. ADB found no connected device. The native room-AR build stopped during official Meta XR AIBlocks import when Bee received `Access is denied`, before application compilation and APK output. Do not treat the virtual Quest APK as AR acceptance. This candidate needs the native build and intended Quest/table rehearsal before the September 29 demo.

<a id="current-candidate-quest-3-capture-and-content-catalogs"></a>

### Historical Unity candidate: Quest 3 capture and content catalogs

Branch **`codex/quest3-capture-content-catalogs`**, based on merged checkpoint
**`67e3ffe`**. The candidate adds an explicit Quest 3 physical-camera capture path,
a PC content library and approved generation workflow, and versioned static
AssetBundle props that register through the existing scene executor. Quest Pro
continues to use virtual-only captures; unsupported mixed capture fails explicitly.
See [content catalogs](Content-Catalogs.md), [pack authoring](Content-Packs.md), and
the [candidate validation record](../Validation/Spatial-Content-Validation.md).

The library now includes an individual-prefab browser with search, availability
and source filters, measured dimensions, exact pack provenance, and explicit
whole-pack installation. **Use in Operator** selects an installed prop and
prepares an empty request without automatically invoking AI or editing the scene.
These PC page changes need no APK rebuild. **Preview prefab** shows a matching
catalog image as a thumbnail and larger sample without changing the scene.
The seven bundled props and beacon have actual Unity Editor studio renders;
these are authored-prefab samples, not headset screenshots or interactive 3D.
Start with the [user guide](Content-Library-User-Guide.md).

Three player builds succeeded with **352 core checks per build**, plus **14
camera protocol/projection checks**. Final PC source passed **378 Python tests**
and the Node Operator checks. The actual exported Windows bundle passed
**18 Unity Editor checks** covering registration, instantiation, provenance and
scene recovery. One bounded real ComfyUI image-generation job completed and its
image was inspected. The validation inventory records those Python/Node results,
artifact hashes and the limits of the original candidate checks.

**Quest Pro deployment and pack registration are verified:** the updated AR APK
is installed, and the Android sci-fi beacon pack was installed through the PC
service and acknowledged `ready` by the runtime. The available asset count is
now **eight**, including `matrix-fixture:scifi-props:1.0.0:beacon`. Real Codex placed
it at a wearer-selected floor point, and the wearer confirmed its appearance and
alignment. A second applied proposal enlarged it by 25%; Undo restored the exact
original scene. PC save, acknowledged clear, and restore preserved the exact
scene and pack provenance. `BeaconDemo_PR27_20260921` retains that one-beacon scene
on the review service. The wearer also confirmed it returned to the same floor
spot and original size after restore.
The first AI placement attempt proposed no commands, reporting that its requested
viewer-relative point was outside the floor boundary. Evidence is recorded in the
[headset walkthrough](../Validation/content-headset-walkthrough.json).

**The final PC service still needs a restart.** Port **8789** is serving the live
walkthrough from the existing process. It predates the final
`contentLibrary` capability flag and lease/worker fixes; passing source checks do
not mean those fixes are loaded. Automatic approval review rejected its restart
with only "blocked by policy" reported. Port
**8776** remains the previous running service. The separate Windows player
install/AI acceptance loop remains pending. Quest 3 camera permission, alignment,
image quality and performance checks still require Quest 3 hardware.

Static packs do not add arbitrary scripts, downloaded animation clips or runtime
skyboxes. After an app restart, explicitly reinstall the matching pack before
restoring a saved scene that uses it; verified cached bytes can be reused.

### Historical: rendered scene feedback before this candidate

Previous increment: **[Rendered scene feedback](Visual-Feedback.md)** for issue [#8](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/8), on `codex/rendered-scene-feedback` from merged `main` commit `80cf846`. Explicit PC capture/preview and typed/next-voice image inclusion are implemented with a matching snapshot/session/revision, bounded JPEG transfer, truthful AR disclosure, supported Codex model checks, read-only image reviews, and existing reviewed edits/undo. The isolated actual graphical Windows player passed **83 checks**, including three real Codex turns, two image attachments, exact edit/undo/save/clear/restore and visible behavior phases. **323 Python tests** and the Operator interaction suite pass. See [validation](../Validation/visual-feedback-validation.json) for final build counts, artifacts, and remaining acceptance.

The updated AR APK is installed on Quest Pro without clearing app data. The wearer confirmed the room outlines aligned. Three timed read-only captures and a separate real Codex image review passed; the harness made no scene edits. A later AI request returned HTTP 409 during active wearer/operator use and is not counted as a passed inference. Capture-frame wall time uses a monotonic clock because Unity's XR delta did not reflect observed capture stalls. See the [headset report](../Validation/visual-feedback-headset-results.json) for timings. Physical voice/buttons with image inclusion and standalone animated-object capture remain untested; these have automated/desktop coverage. The older service and saved scenes remain available. The new AR panel is on port **8776** with matching app URL and USB reverse mapping; port 8765 is the older service. The previous installed APK is retained locally. Issue #8 remains open for review.

The wearer also reproduced the stale voice "Room loading" notice while confirming that the trigger still worked. The final build clears only that loading-owned notice when localization finishes; recording behavior is unchanged. Seven regression checks cover the correction, with **321 Unity checks passing in each of three builds**. Quest 3 physical-camera plus virtual-content compositing is documented as a planned follow-up, not enabled by this virtual-only capture implementation.

Latest completed milestone: **[Live Rotate/Bob behaviors](Runtime-Behaviors.md)** on `codex/runtime-prefab-behaviors`, [PR #7](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/7), based on completed AR checkpoint **`6962eaf`**. Existing props support independent pause/resume, disabling, removal, undo/redo, and saved behavior configuration. The placed wrapper remains authoritative; its animated child does not change the saved pose or scene revision each frame. A shared PC-derived skill catalog exposes only capabilities advertised by the connected player. General programs, interaction triggers, physics, generated C#, and navigation remain proposed.

Validation: **292 Python tests**, **301 Unity checks in each of three successful builds**, and **46 actual Windows-player checks including four real Codex requests**. Additional actual Quest Pro validation passed **30 checks**, with separate wearer confirmation of bobbing and restored table alignment. See [behavior-validation.json](../Validation/behavior-validation.json), [desktop results](../Validation/behavior-desktop-results.json), and [headset results](../Validation/behavior-headset-results.json).

Actual Quest speech **“Make this orb rotate slowly and float gently above the table”** reached real Codex (`gpt-5.6-sol`, `xhigh`) and produced two acknowledged commands on the same orb: Y rotation at 15 degrees/second and upward bob at 0.03 meters / 0.5 Hz. The wearer confirmed visible bobbing. Device checks exercised a one-centimeter baseline move and undo, independent pause/resume, removing Bob and undoing removal, and exact behavior-bearing save/clear/load. The wearer confirmed the orb returned to the same physical table spot and continued bobbing. The uniform orb's visible rotation was not separately verified.

**Live scene at completion:** the pretest one-orb scene **`BeforeVoiceRestart_20260920_175100`** was restored exactly and its static orb reselected. **`AnimatedRoomBehavior_20260920_181054`** preserves the tested animated version. The earlier two-object orb/block scene remains saved as **`BeforeBehaviorVoice_20260920_174538`**. Recheck live state before restoring; subsequent wearer edits are separate.

The earlier silent-capture problem recovered after the user-reported restart and USB/developer authorization recovery. ADB was authorized, port 8765 was restored, and system microphone mute was then false. No source, build, microphone code, or silence threshold changed during recovery; the original system/HAL mute policy remains unidentified. One post-restart room restore was observed with 28 anchors, seven support surfaces, aligned outlines, and unchanged manual room IDs. Recreated/deleted native anchors remain hardware-untested. A known cosmetic voice status can still say “Room loading” after `BindRoom`; when actual room state is ready and the PC is connected, the trigger can start speech despite that stale line.

Local behavior checkpoint: sibling **`outputs/checkpoints/RuntimeBehaviors_20260920/`**, containing a source bundle, the new AR APK, preserved baseline and animated scene saves and a SHA-256 inventory. The Desktop full checkout and both Unity Hub source exports are synchronized; its unrelated Unity assets remain preserved.

Before-update save: **`BeforeBehaviors_20260920_172929`** in `ControlService/scenes/`. The prior working AR APK and save are preserved locally in sibling `outputs/checkpoints/RoomARBeforeBehaviors_20260920/`. Current AR build: `Builds/RoomARQuest/MatrixOperatorAR.apk`, SHA-256 `C94A760F55B15B01CF7E5FACFCF6CDDE165AB4BBC91014567A49F18DF9A79DAC`. The white-room regression APK was built but not installed over its working app.

To continue, verify the service on port 8765 and the authorized USB reverse mapping, manually open **Matrix Operator AR**, check room alignment, and confirm the system microphone is unmuted. Restore `AnimatedRoomBehavior_20260920_181054` to view the preserved animation, or select the static orb and hold/release left trigger for a new request, review, and apply with Y. Keep credentials on the PC. The [LLMR review](LLMR-Behavior-Runtime.md) and [GOAP next-step note](GOAP-Next-Step.md) separate implemented foundations from later composable programs and character navigation.

Previous completed milestone: **[Quest Pro room AR](Room-AR.md)** on `codex/quest-pro-room-ar`, [PR #6](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/6), based on merged PR #5. The actual Quest Pro loaded 28 manually configured MRUK anchors. The wearer verified outlines, voice orb placement on the real table and voice movement toward its center. PC save/clear/restore retained the exact scene; the wearer confirmed that the restored orb returned to the same spot on the real table. The requested same-session acceptance loop is complete. Hardware and automated evidence are separated in `Validation/room-ar-validation.json`.

AR acceptance save: **`RoomARAcceptance_20260920_171926`**. The APK used for that earlier acceptance had SHA-256 `BD83A89FEC5B4E6D966E7F3AF057CD92F0BC3B1A84954107045F6C7686850111`; it is the preserved previous build, not the current behavior APK. That earlier acceptance covered one session; the subsequent behavior milestone adds the limited post-restart evidence described above. Changed-anchor recovery remains hardware-unverified. The white-room app and its earlier checkpoint below remain available.

Previous milestone: **push-to-talk and Codex model/reasoning selectors** are implemented, pushed and installed. Start with [Voice-And-Codex-Controls.md](Voice-And-Codex-Controls.md). The real audio-to-AI-to-Windows-player loop passed 24 checks. The Quest then supplied real microphone speech, received a real Codex proposal, acknowledged four edits and returned to its exact original 40-object scene through observed undo changes: 12 device/network checks passed in `Validation/voice-headset-results.json`. Separate wearer confirmation of physical buttons and HUD readability is pending. The earlier recovery checkpoint below remains intact; the pre-install layout is also saved as `BeforeVoiceInstall_20260920`.

Checkpoint: **2026-09-20 16:07:37 America/Denver**. The wearer confirmed **“it works”** and requested commit, push and a complete checkpoint.

Git recovery tag: `checkpoint/2026-09-20-160737` on `codex/quest-pro-ai-validation`, tracked by [PR #5](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/5). This file and the confirmation record are part of that checkpoint commit. Implementation and earlier synchronization were already published through `bc97027`.

### Earlier white-room checkpoint scene and files

- PC save: `MatrixCheckpoint_20260920_160737`, containing **40 objects**. It was saved through the running service, read back and SHA-256 checked. This is the scene at checkpoint time; subsequent edits are separate.
- Save SHA-256: `272134C61FE6F7D9F6684EAB7A3AC3BA42B70664489BCBF39315BFBB5FB8658D`. The live viewer pose is excluded from the save.
- Authoritative service/source checkout: the task's `outputs/matrix-white-room`. The running service is at `http://127.0.0.1:8765/`; verify health on resume.
- Desktop full clone: `Desktop/Game Design/Matrix Loading Operator`. Unity Hub source copies: `Matrix White Room Quest` and `Matrix White Room Desktop` in the same folder. Their separate source/prefab/scene state is preserved in the local checkpoint archive.
- Local archive: sibling `outputs/checkpoints/MatrixCheckpoint_20260920_160737/`. It includes a Git bundle, built players, PC saves, Unity Hub source exports, preserved Desktop-local Unity assets and a SHA-256 inventory. Builds and personal scenes remain local; credentials, Unity caches and vendor packages are excluded.

### Working behavior and evidence

The real Codex CLI planner uses existing ChatGPT sign-in on the PC. It receives scene state, prefab geometry/orientation, selection and tracked anchor-relative viewpoint, then composes arrangements using the seven bundled prefabs. Requests are reviewed in the Operator before Apply. The offline mode remains a separate finite parser.

The exact table/two-chair request and a room made from wall pieces passed **93 checks on Quest Pro**, including save, clear and exact restore. A separate actual Windows player passed **90 live AI checks**. Automated validation also passed **167 Python tests**, **169 Unity checks per build target**, and a **13-check isolated desktop preflight**. The wearer subsequently confirmed the result works; that general confirmation is distinct from individual harness assertions or a comprehensive comfort/collision assessment.

Installed Quest package: `com.matt.matrixoperator.whiteroom`. APK: `Builds/WhiteRoomQuest/MatrixOperator.apk`, 53,838,926 bytes, SHA-256 `5CFBD0F64763392F9F4EC120CF8AC0358A20E84B19302DD59761021E42C1ADED`. Both generated build targets use Unity **6000.6.0f1**. See the composition reports in `Validation` for exact execution evidence.

### Recover the earlier white-room checkpoint

1. Use this tagged checkout, or clone `source.bundle` from the local archive and check out the tag. Do not overwrite later work without checking its Git state.
2. If port 8765 is not already serving this project, run `./Start-CodexControlService.ps1` from the chosen full checkout. Keep credentials in Codex's existing PC login; no API-key substitute is required.
3. Connect the authorized Quest Pro, run `./Connect-QuestControl.ps1`, and open Matrix Operator in the headset. Keep the headset awake for viewer-relative requests.
4. Open the Operator page, choose **Codex (ChatGPT subscription)**, enter a request, review its summary/assumptions and Apply. Head motion is allowed; scene edits or selection changes invalidate a pending proposal. Proposals expire after two minutes.
5. To recover the checkpoint layout, choose `MatrixCheckpoint_20260920_160737` in Saved scenes and restore it. Restoring replaces the runtime scene; save any newer layout first. Scene persistence does not restore live head pose or undo history.

Native MRUK/passthrough results are recorded separately in [Room-AR.md](Room-AR.md). The earlier generated-assembly security failures remain in the progress log; consult the newer build evidence before assuming that historical blocker still applies. No physical-room success can be inferred from this white-room checkpoint. Catalogs and SOTA lessons remain deferred.
