# Static scale: actual Windows acceptance

The [sanitized validation record](../Validation/block-scale-windows.json) records a passed real-player run on September 22, 2026, 09:20:23–09:20:31 UTC. It used the actual local Matrix HTTP server and an isolated Unity Windows player. Runtime snapshots and acknowledgements came from Unity; no synthetic runtime exchanges were injected.

## What passed

A built-in `block` was spawned with baseline scale approximately `(0.3, 0.4, 0.5)` and a nonzero Y rotation. A paired client then submitted the [version 1 scale contract](Scale-Experiment.md):

| Reviewed operation | Observed scale, rounded | Confirmed mathematical ratio |
| --- | --- | --- |
| Configure factors `(2, 2, 2)` | `(0.6, 0.8, 1)` | `8` |
| Configure `(2, 0.5, 1)`, referencing the first confirmed request | `(0.6, 0.2, 0.5)` | `1` relative to the original baseline |
| Reset, referencing the second confirmed request | `(0.3, 0.4, 0.5)` | `1` |

Every proposal left the real scene unchanged across heartbeats before Apply. The harness inspected the single `set_transform` command and then called the authenticated owner Apply endpoint. Each result had one correlated successful receipt, the exact object in the acknowledging snapshot, and `experiment.observationState: "confirmed"`. Independent arithmetic on the reported scale matched the experiment's result; normal Unity floating-point precision was allowed.

A fourth proposal was left waiting while an ordinary owner command moved the block in the actual player. Applying the older proposal returned HTTP 409, marked it stale, queued no command, and preserved the newer edit. The run passed 36 assertions.

## Exact code and build

The Python implementation was frozen from the scale worktree based on client API commit `d9166f3d9f2c3fc05a2e9fe2a168d7d690d7e60d`. The record contains byte-level SHA-256 hashes for all 13 service Python modules, including the uncommitted scale implementation at test time. These hashes were rechecked against the publication worktree after execution.

No Unity rebuild was needed for this Python-only capability. The reused isolated player was built from cached-restore commit `1af3715bcffdcef8e1eb5299b1b4b9918d39b6e9` ([PR #35](https://github.com/School-of-the-Ancients/matrix-loading-operator/pull/35)), with Unity `6000.6.0f1`, target `StandaloneWindows64`. The earlier build passed 384 Unity core checks; those checks were not rerun as part of this acceptance.

The record pins both the executable and `Assembly-CSharp.dll` hashes. The latter identifies the runtime application code; the launcher hash alone is insufficient.

## Repeat the acceptance

Use disposable service data and a Windows fixture with its own validation product identity. The fixture build in PR #35 supports `Build-WhiteRoom.ps1 -Target Desktop -ValidationId <unique-id>`. Keep its persistent profile separate from the normal Matrix application. Start a matching service on an unused loopback port, configure only the owned fixture, and confirm the real White Room is online.

Spawn a built-in block, pair a local client, and submit the three requests from the table using current runtime identity and scene revision. Chain each later request through `baselineRequestId`. Review each command before owner Apply, poll its outcome, and compare the acknowledged transform to the captured original. Finally, propose another change, edit the object through the ordinary Operator, and verify stale Apply rejection.

The independent `Examples/block_scale_client.py` demonstrates configure and separately reviewed reset. The chain and stale-edit checks use the same documented HTTP API. This run's path-specific harness and raw fixture traces remain in ignored local working storage; the published JSON contains no credentials, pairing codes, private paths, or complete room snapshots.

The owned player and server were stopped, and the temporary credential file was removed. The previously owned validation content cache stayed byte-identical. Live room services, Workshop, and the Quest were untouched.

## Evidence limits

This validates headless Windows execution and the API's acknowledgement/observation boundary. The harness called owner Apply; a human did not click the UI in this run. It does not validate rendering, audio, physical volume, physics, Quest or room-AR behavior, or School's client integration. Synthetic unit tests and browser interaction checks are separate evidence. Issue #32 remains partial.
