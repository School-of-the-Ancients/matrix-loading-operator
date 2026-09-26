# Web Matrix virtual-floor physics

This first physics capability lets an imported GLB fall and bounce vertically on
the **White Room's virtual floor**. It is an opt-in, bounded approximation for
the existing Three.js Matrix. It does not measure the real Quest floor, collide
with other objects, tumble, or use a general rigid-body engine.

## Use

1. Register a GLB with finite `localBounds` that match its rendered rest-pose
   dimensions. The browser loads the GLB and checks the actual X/Y/Z size
   against those catalog bounds. A missing or mismatched bound leaves the model
   renderable but ineligible for physics. Existing catalog entries without
   `localBounds` need measured bounds added through the reviewed registration
   path before they can use this capability.
2. Spawn or move that GLB to a height from 0 to 5 metres in the White Room.
   Keep it upright and remove attached numeric components and enabled Rotate/Bob
   behaviors. Named GLB animation clips may remain bound to the visual child.
3. Use the reviewed `matrix_set_physics` tool with the current room ID, scene
   revision, object ID, exact asset ID, and restitution from 0 to 0.75. Gravity
   is fixed at 9.81 m/s². The same typed `set_physics` command is available
   through the Matrix command API.
4. Read `matrix_physics_status(request_id)`. `queued` means the browser has not
   acknowledged the command. `succeeded` means the matching saved config and
   transient run were observed. `contactObserved: true` means that same run
   reported contact with the virtual floor. The current public state includes
   position, vertical velocity, contact count, and approximate impact speed.
   `matrix_remove_physics` stops the run and removes its saved configuration.

The solver allows at most 16 configured bodies. It uses the GLB's measured
rest-pose box as a contact proxy; imported models are centered horizontally and
floor-aligned by the existing loader. Animation can change the visible shape
without changing that proxy. Repeated input, pause/resume, and rebound are
bounded by fixed 1/60-second steps and a frame-time cap.

## State and ownership

`object.transform` and `object.physics` are authored scene state and participate
in Undo, scene save, and the whole-experience checkpoint. `physicsStates` is a
transient runtime observation. It is excluded from scene revisions and saves,
so a falling object does not stale an unrelated pending edit. Reload restores
the authored height and configuration **inert**; another `set_physics` starts a
fresh run. No final resting pose or playback phase is implicitly baked into a
checkpoint.

Removing physics also returns the displayed object to its authored transform.
To keep a resting position, explicitly move the object to that position before
removing physics; a later reviewed bake action could make that easier.

The solver writes only the displayed root's vertical position. A successful
`set_transform` or moved grab starts a new run from the newly authored pose and
zero velocity. An unchanged grab release resumes the paused run. Delete, clear,
load, Undo/Redo, AR entry, and room replacement discard transient runs.
Unrelated scene redraws keep a run for the same object and authored transform.

This scope advances the reusable runtime path in [issue #13](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/13)
and the [Web runtime](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/44).
Physical-surface contact, object-to-object collision, rotation, joints, and
mass/forces are separate future capabilities and require their own evidence.
