# Operator scene readiness — 2026-09-27

This is a focused [#116](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/116) follow-up on `main` at `1a37cf7`. The Agent Portal's per-turn context already reports room readiness, alignment verification, and read-only state. Before this change, `matrix_scene_summary` returned only `roomMode`; a later authoritative scene read could not distinguish a ready AR view from one whose tracked origin had been lost.

The PC-only `matrix_scene_summary` now projects the existing, server-validated `roomContext` as a bounded `room` object: `mode`, `state`, `alignmentVerified`, and `readOnly`. It also reports the separate `digitalWorldVisit` flag. A tracked canonical AR visit can have `room.readOnly: false` yet still prohibit edits through `digitalWorldVisit: true`; the two flags have different meanings. The summary omits the room's free-form message. Offline reads return `room: null` and `digitalWorldVisit: null` with no stale scene. `roomMode` remains for existing callers. The MCP tool description tells Operator that AR mode alone does not prove physical alignment or grant edit authority. Mutation guards and receipt handling are unchanged.

## Evidence

`ControlService/test_matrix_tool_bridge.py` exercises the actual private authenticated bridge after live `State.exchange` calls. It reads a ready desktop room, a ready AR view with unverified and verified alignment, then the same AR room after origin loss (`state: missing`, `readOnly: true`). It also checks an offline result, an older snapshot without room metadata, and exclusion of free-form room messages. `ControlService/test_world_checkpoint.py` uses the existing valid Citizens fixture to check that a tracked canonical AR visit stays explicitly observational before and after origin loss.

| Check | Result |
| --- | --- |
| Bridge tests | 5 passed |
| World checkpoint tests | 48 passed |
| Full `ControlService` unittest discovery after the final change | 763 passed, 0 failed |
| `git diff --check` | Passed |

This confirms the service-to-tool observation path, not the model's choice to call the tool or a live world edit. The broader two-turn Ice Dragon and resumed-thread acceptance in #116 remain open. No Quest wearer alignment or physical-surface behavior is claimed.
