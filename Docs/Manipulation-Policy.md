# Explicit object manipulation policy (#158)

Scene objects optionally carry `manipulation: grabbable | locked | environment`.
Missing metadata means grabbable, preserving existing props and GLB imports.
`environment` currently has the same direct manipulation behavior as `locked`;
there is no size inference, hierarchy splitting or permission framework.

Select the object, then use **Lock selected object / Unlock selected object**
in World controls, on desktop or the existing XR World panel. Child mesh hits
select the existing object root. Selection and ordinary Play controls continue
to work. Pointer, controller and hand grabs and their translation/rotation
thumbsticks cannot start or commit a locked edit. Changing the policy during a
held edit cancels that edit. Running Play/Test authority remains unchanged;
policy changes require paused Creator Mode.

Operator uses `matrix_set_manipulation` with the current room, scene revision,
object ID and expected asset ID. The service queues `set_manipulation` with
asset, transform, current policy and Creator revision preconditions. The
existing approval mode, concept guard, private bridge authentication, runtime
queue and receipt path apply. `matrix_manipulation_status` reports succeeded
only after the matching object receipt and policy are observed in the same
connected runtime. Queued and unconfirmed are not success or durable-save
claims. Authorized intentional Operator transform edits remain possible for
locked objects; this policy prevents accidental direct grabs.

The field survives ordinary scene/world serialization, browser reopen, PC
checkpoint restore, duplication and Undo/Redo. Invalid policy values are
rejected by service and runtime loaders. Stable IDs and object transforms do
not change when the policy changes. Automated input simulations cover these
contracts; physical controller/hand feel, multi-mesh assets and integrated
Quest save/re-entry remain pending H08/H09 in the consolidated checklist.
