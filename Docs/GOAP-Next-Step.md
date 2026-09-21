# GOAP and character execution: inspected next step

Review date: 2026-09-20. This is an integration note, not a GOAP implementation or a hardware validation result.

Inspected the private [thetopham/goap-playground repository](https://github.com/thetopham/goap-playground/tree/2c94c2e38ce6110c141867cbe26c4e400f7c4474) through authenticated GitHub access at commit **2c94c2e38ce6110c141867cbe26c4e400f7c4474**. Links require access to that repository. No source, assets, packages, or scene objects were copied into Matrix.

## What exists

- [GoapPlanner.cs](https://github.com/thetopham/goap-playground/blob/2c94c2e38ce6110c141867cbe26c4e400f7c4474/Assets/GoapPlayground/Runtime/GoapPlanner.cs) is pure C#. It uses deterministic uniform-cost search over grid position, hunger, tiredness, carried food, and food availability. Its eight actions and goal are hardcoded to that experiment. The search and precondition patterns are useful; this is not yet a general character or Unity behavior engine.
- [GoapDemo.StepOnce](https://github.com/thetopham/goap-playground/blob/2c94c2e38ce6110c141867cbe26c4e400f7c4474/Assets/GoapPlayground/Runtime/GoapDemo.cs#L79) checks an action with `Planner.TryApply`, immediately commits `state = after`, and removes the step. Its `Update` then moves the capsule toward the already committed grid position. There is no asynchronous execution result, physical arrival check, or animation-completion gate. That separation is acceptable for the discrete demo but must change for a character acting in a measured room.
- [ObserveObjects and Replan](https://github.com/thetopham/goap-playground/blob/2c94c2e38ce6110c141867cbe26c4e400f7c4474/Assets/GoapPlayground/Runtime/GoapDemo.cs#L151) show useful state-preserving replanning when food or bed positions change.
- The repository's [validation report](https://github.com/thetopham/goap-playground/blob/2c94c2e38ce6110c141867cbe26c4e400f7c4474/Validation/VALIDATION.md) records 17 planner and 18 Windows runtime checks. These are previously recorded results, not tests rerun during this review. Its report explicitly excludes Quest, MRUK, NavMesh, and XR input.

## Character assets are not present

The complete tracked tree at the pinned commit contains C# scripts, a generated scene, two materials, project settings, and validation reports. It contains no model files, rigged character, Avatar asset, Animator Controller, or animation clips. [CreateWorldView](https://github.com/thetopham/goap-playground/blob/2c94c2e38ce6110c141867cbe26c4e400f7c4474/Assets/GoapPlayground/Runtime/GoapDemo.cs#L205) constructs the agent from a Unity capsule and removes primitive colliders. There are no idle or wave clips to reuse from this repository.

Its README identifies no external local character-asset directory. No other drives or unrelated projects were searched. A rigged character and compatible idle/wave clips therefore remain an explicit input for a character-animation milestone, unless a later task deliberately uses a procedural primitive character.

## Integration seam: observed execution before symbolic effects

Keep Matrix's validated command executor, stable object IDs, anchor-relative placement, undo, and persistence. Introduce a small Unity action executor between a future GOAP plan and those systems. Each invocation owns an execution ID, target object/anchor IDs, relevant world revision, cancellation, and timeout. Its result is **Running**, **Succeeded**, or **Failed**, with a reason.

| Result | Meaning | Planner response |
| --- | --- | --- |
| Running | The action started and its observed completion condition has not occurred. | Keep the current step; commit no symbolic effects. |
| Succeeded | The runtime actually met the completion condition and relevant targets/preconditions still hold. | Commit the action's effects once, then advance. |
| Failed | The action was rejected, cancelled, timed out, lost its target, or became impossible. | Commit no promised effects; observe current state and replan, or report no plan. |

`Planner.TryApply` can predict transitions during search. Predicted state must not become authoritative simply because a script started or an Animator trigger was sent. An arrival action succeeds on measured arrival; a finite wave succeeds on the intended animation's verified completion. A late completion from an obsolete execution ID must not affect a replacement plan.

If an object is deleted or an MRUK anchor disappears or changes materially, cancel its affected action, discard stale remaining steps, and replan from the surviving observed world. Do not recreate missing targets, bind by label alone, or move a character to a guessed origin. Ordinary anchor tracking updates should preserve relative placement; loss or changed geometry requires explicit handling. Editing, clear/load, and undo must cancel or reconcile active actions so old completions cannot modify restored state.

## How the present behavior work fits

The current rotate/bob configurations are a foundation for attaching persistent, editable behavior to an existing scene object. They are not character goals, navigation, locomotion, or physics simulation. Their transient visual phase is separate from the object's saved placement.

An instruction to **attach** a continuous behavior can succeed when the existing command executor acknowledges its configuration. The endless animation itself does not have a natural completion event. A future finite action such as “wave once” needs a different completion condition; it should not be represented as an infinite loop that blocks the plan.

Unity can implement future actions with compiled scripts, Animator/Playable clips, procedural motion, or Rigidbody/joint physics. The extensible contract is the action's parameters, lifecycle, cancellation, and observable result. It does not require a new prefab for every request. Physics-driven movement would also need one authoritative pose owner, collision rules, and a persistence/undo policy; it cannot silently share transform ownership with the present decorative child animation. No arbitrary generated-script execution is introduced by this foundation.

## Room navigation remains a separate milestone

MRUK supplies room geometry and semantic targets; it does not by itself make a character navigate. Navigation still needs a traversable floor representation, character clearance, obstacle/collision representation, reachable destinations, runtime path execution, stuck/timeout detection, and response to room edits or missing data. The GOAP grid and its capsule interpolation do not provide these capabilities.

The next bounded character demonstration would use an identified character asset and idle/wave clips: select it, request one wave, report Running then Succeeded on actual completion, and verify cancellation/deletion does not produce a false success. Only after that executor works should room-aware movement be connected as another action and then selected by GOAP. The existing white-room and AR editing paths remain independent throughout.
