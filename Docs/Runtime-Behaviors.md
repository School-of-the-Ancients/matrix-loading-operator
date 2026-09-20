# Runtime behaviors

This increment adds editable **Rotate** and **Bob** to the seven bundled prefabs. The AI configures compiled Unity capabilities through the existing reviewed command executor. After installing this update once, new supported configurations take effect live without rebuilding or reinstalling. General motion programs, interaction triggers, physics commands, generated C#, and autonomous navigation are not implemented yet.

## Launch and speak

Run `Start-CodexControlService.ps1` from the full checkout and open the PC Operator at `http://127.0.0.1:8765/`. Open **Matrix Operator AR** on Quest Pro, verify the MRUK outlines, confirm alignment, and select an existing prop. The new desktop and white-room Quest builds support the same behaviors. An older player explicitly reports that it needs an update before behavior requests can run.

Hold/release the left trigger to speak, review the proposal, and press Y to apply. Text input uses the same pipeline. Try these separately:

- “Make this orb rotate slowly.”
- “Make it float gently above the table, keeping its rotation.”
- “Pause its rotation.” Then “Resume its rotation.”
- “Stop the bobbing but keep it rotating.”
- “Remove its animations.”

The PC panel shows each selected object's configured behavior and running/paused/disabled state. A uniformly colored sphere can make rotation difficult to see; a block or chair makes angular motion more apparent. A configured rotation is not proof of wearer-visible motion.

## Behavior contract

Each object may have one Rotate and one Bob. `set_behavior` replaces the named kind's full configuration; the other kind remains unchanged. `remove_behavior` removes one kind or `all`. Unknown kinds, duplicate kinds in saves, invalid axes and non-finite/out-of-range parameters are rejected.

| Parameter | Meaning | Bound/default |
| --- | --- | --- |
| `enabled` | Whether this kind contributes to the visual transform | Boolean; default true |
| `paused` | Freeze this kind's current phase; resume continues it | Boolean; default false |
| `axis` | Rotate around the object's local X, Y or Z | `x`, `y`, `z`; default `y` |
| `speedDegreesPerSecond` | Signed rotation speed | −180 to 180; default 30 |
| `amplitudeMeters` | Bob height above the placed baseline | 0 to 0.25 m; default 0.05 m |
| `frequencyHz` | Bob cycles per second | 0.05 to 2 Hz; default 0.5 Hz |

The wire configuration includes all fields for both kinds. Bob always follows the room anchor's up direction and ignores `axis`; it rises from zero to the configured height and returns, rather than moving below the placed baseline. Its height is in actual meters even when the prop is resized. Disabling removes a kind's visual contribution while retaining its settings/phase; pausing holds its contribution at the current phase. Removing resets that contribution to baseline. Removing all behaviors restores the prefab child's baseline transform.

The placed wrapper remains authoritative for object ID, anchor ID and saved position/rotation/scale. Only its child is animated. Moving the object changes the wrapper baseline; animation does not accumulate into placement or cause scene revisions every frame. Selection still resolves animated collider descendants to the same object ID.

Undo/redo includes behavior edits. Saves preserve configurations and enabled/paused state, and old scenes without behavior fields still load. Animation phase is deliberately not persisted. A paused behavior therefore restarts paused at its baseline phase after load or history replay. An old player cannot restore a behavior-bearing save and silently discard those settings.

These are decorative procedural behaviors, not a physics solver or obstacle-avoidance system. Static placement checks still apply, but animated swept volumes are not tested against surrounding furniture. X/Z spins can visually intersect a supporting table; a stretched prop under nonuniform parent scale can deform while rotating. Use modest upward bobbing and Y rotation for the initial table demo. No artificial headset locomotion was added.

## Validation and continuation

`Validation/behavior-validation.json` records current builds and hardware status. `Validation/behavior-desktop-results.json` records actual Windows-player acknowledgements with four real Codex requests. It does not certify Quest microphone/display behavior. Unity checks directly inspect the animated child, stable wrapper, pause/resume/removal, repeated ticks, history and restored configurations.

The starting AR scene was saved as `BeforeBehaviors_20260920_172929`; its working APK and save are preserved in the local sibling checkpoint `RoomARBeforeBehaviors_20260920`. Personal saves and raw room/device logs remain outside Git.

The next runtime layer should let the AI compose supported motion, interactions and physics as program data, without a build for each combination. [LLMR-Behavior-Runtime.md](LLMR-Behavior-Runtime.md) maps inspected LLMR ideas to that design; its structured skill catalog is implemented, while the general program interpreter remains proposed. [GOAP-Next-Step.md](GOAP-Next-Step.md) identifies the separate planner/executor seam and missing character assets. Finish and validate a small finite behavior sequence before adding navigation or a virtual human.
