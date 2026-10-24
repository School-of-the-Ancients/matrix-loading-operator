# Operator context audit (#163/#171)

Baseline: v1.1.0 `9453ef06b1873937822c1cf985115f05f72e1e20`,
`ControlService/agent_portal.py:build_matrix_turn_message`.
The table accounts for the sentence groups in every baseline builder branch.

| Baseline sentence group | Classification | Disposition and authoritative boundary |
| --- | --- | --- |
| Operator live contract, advisory IDs/data, preservation and truthful outcomes | Stable role / runtime invariants | Retain concise role, preservation and confirmation/reconciliation semantics; authority, revisions and bounds stay in State.queue/MatrixWorld.execute and typed tools |
| Native coding approvals; code changes versus live results | Duplicated tool documentation | Remove per-turn duplication; native approval policy and typed world mutations remain distinct |
| Runtime identity, desktop/VR/AR, unknown/offline, room readiness | Task-specific context | Structured fresh runtimeDescriptor/online/room metadata; offline notice remains explicit |
| Capability observation versus enabled tools; schema/count instructions | Duplicated tool documentation | Keep version/count data; schemas describe available tools |
| Creator/Play and digital-world owner/visitor sentences | Runtime invariant / context | Keep authority metadata and brief hosted-visit notice; queue/runtime guards unchanged |
| Panorama identity, not geometry, AR visibility and typed edits | Context / duplicated tool docs | Keep environment state; existing environment tool validation and AR rendering rules enforce behavior |
| Retained point versus hover; virtual floor; measured marker, footprint and freshness instructions | Task context / duplicated tool docs | Keep independent selectedPlacement/pointingTarget/viewer data; exact support query, frame conversion and footprint checks stay in admission and surface tools |
| Room layout geometry, unused supports, occupied volume, physical-fit claims | Context / runtime invariants | Keep room summary/readiness/counts; omit polygons/tokens from model-facing envelope and fetch exact geometry lazily through existing room queries; no relaxation of validation |
| Selected image, art direction, unrelated state and request-time/fresh-revision prose | Deterministic concept protocol / duplicated runtime docs | Keep image meaning and identity; unchanged concept guard binds current state and receipts |
| Procedural/Blender/Auto branches and provenance registration | User-selected protocol requirements | Keep explicit chosen backend boundaries and concept receipt/provenance step; Auto remains free to combine supported capabilities |
| Load/create discovery, whole catalog paging, archives, environment and procedural enumeration | Hand-authored creative workflow | Remove broad regex prescription; existing discovery tools remain enabled and paginated |
| Move/turn/rotate/resize/scale refresh and target-inspection recipe | Hand-authored workflow / duplicated tool preconditions | Remove prescription; request-time selected transform/identity and typed stale checks remain; one tool can move, rotate and scale |
| Scene-aware composition capture/list/re-read/save/reopen recipe | Hand-authored workflow / runtime invariants | Remove broad regex branch; model-directed capabilities and existing transaction/persistence guards remain |
| Physical-room keyword recipe, recapture/choose/recapture/token and retry instructions | Hand-authored workflow / deterministic operation requirements | Remove keyword branch; lazy exact-support tool validates freshness/alignment/frame/bounds at mutation; no silent measured-fit fallback |
| Context and selected-concept JSON delimiters; user utterance | Protocol packaging | Preserve escaping and untrusted-data separation; compact context rather than duplicate scene/plane data |

The authoritative context is still assembled and validated by the service.
Only the model-facing representation omits unrelated object samples, plane
polygons and support tokens. `matrix_scene_summary`, entity paging and
`matrix_room_spatial_context(anchor_id)` retain detailed/global access.
Non-spatial opt-out stays non-spatial. No new classifier, planner or executor
is introduced.

The initial admission now returns its authoritative Portal snapshot. The
browser consumes it instead of immediately making a second status request;
older acknowledgements still use the compatible refresh path. An acknowledged
submission is never automatically resent after a refresh failure.

Run `python Tools/Benchmark-Operator-Context.py --output <local-json>` for
matched v1.1/candidate samples. The fixture contains eight workloads and 60
raw warm assembly samples per workload/implementation. This measures prompt
bytes and service assembly overhead, not model creativity or end-to-end
visible edits. Five varied packaging cases have identical role/context prose,
including a physics/interaction combination. Their live model execution,
matched cold/warm edit p50/p95, speech samples and wearer perception remain
pending in H01/H02 of the consolidated acceptance record.

Working diagnostic budgets: a common fixed role/context envelope under 4 KiB
and warm assembly p95 under 1 ms on this cloud fixture. These are application
budgets, not an agreed wearer latency target or proof that #171's gate passes.
The core gate and conditional #154/#172 remain open.
