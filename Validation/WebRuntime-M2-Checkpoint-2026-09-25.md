# WebRuntime M2 PC checkpoint validation — 2026-09-25

Source tested: `cb79958cd7974a27e806b0c8b5633b3d30d7eba6` on PR #88.
This was an isolated Windows desktop Chrome and ControlService run, separate
from the live Quest service. The disposable test service used ports 18769 and
18771 and one private `--scenes` directory; both test services were stopped.

## Integrated browser and PC restart

1. In `/web/` on 18769, used the Codex proposal planner and **Apply proposal**
   to create a two-orb delivery game with one pedestal, one point per orb, and
   a two-delivery win target. Dragged one orb onto the pedestal in the browser.
   The game showed `playing 1/2 orbs. Score 1` from that earned delivery.
2. Attached a numeric `position.x` orbit component to the delivered orb, with
   the pedestal as target. The service snapshot reported `status: running`.
   Saved **M2 integrated game component** with the browser's **Save world** UI.
3. Closed that browser tab and stopped the 18769 PC service. Started a fresh
   PC service on 18771 with the same scenes directory and opened `/web/` at
   the new origin. Before restore, the page showed `0 objects` and `No game
   running`. Selected the named checkpoint, clicked **Restore world**, then
   **Confirm restore**. The browser showed `3 objects` and `Orb Delivery:
   playing 1/2 orbs. Score 1` with a success receipt.
4. Saved the restored browser world again as **M2 integrated restored audit**.
   The original and audit checkpoint `world` JSON values were identical, and
   both had payload SHA-256
   `44e7f998cbb43a1ee891c5eb3b030f1c21d4beb6980f6b6640758f9041a837e6`.
   This compares the actual browser-restored scene, game bindings and progress,
   component package and target, rather than only the UI summary.

Exact object IDs in both files, in order: delivered orb
`115caabb0e43428ebcd64d87db7f3489`, second orb
`87d0146fee39471eb3c91b2e841286f3`, pedestal
`8d8d2be72bd946f7a2982d7be5249605`. Game state in both files was
`phase: playing`, `score: 1`, `deliveries: [115caabb0e43428ebcd64d87db7f3489]`,
and `objectiveProgress.orbs: 1`. The running component retained ID
`webcomp:orbit-pulse:461d42f49a54`, its numeric expression
`position.x = target.position.x + cos(time)`, and pedestal
target `8d8d2be72bd946f7a2982d7be5249605`. Its active `startedAtMs`
advanced from `1790391122083` to `1790391268144` after restore, showing a
new playback phase; both saved files intentionally store `startedAtMs: 0`.

## Other validation and limits

At the tested source head, Python unittest discovery passed 619 tests,
WebRuntime Node tests passed 84 tests, and Vite built. Automated checkpoint
tests include corrupt or missing registered GLB rejection and failed exchange
rollback. This integrated browser trace used built-in orb and pedestal assets,
so external GLB dependency failure was not manually exercised here. It did
not test Quest AR, physical-plane relocalization, or wearer interaction.
