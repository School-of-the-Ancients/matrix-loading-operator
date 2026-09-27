# Matrix roadmap

Keep this intentionally short. Detailed acceptance belongs in the issue being worked; evidence belongs in `Docs/` and `Validation/`.

## Current release baseline

`v0.8.0-preview.1` is the frozen working baseline.

It establishes the forward Three.js/WebXR Matrix Creator/Operator loop on Quest VR/AR: request, create/import, interact, revise, save/reopen, plus a separately hosted read-only Ada/Bo Citizens world.

Do not rebuild the engine or reopen completed v0.8 milestones to implement v1.0.

## Now — Matrix v1.0

Canonical implementation epic: [#152](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/152).

Complete these milestones in order:

### 1. Grab + thumbstick transforms — #147

Improve direct VR/AR manipulation while preserving the existing ray-grab, animation, physics and persistence behavior.

### 2. ComfyUI visual ideation — #91

Add voice/text → real image variants → explicit selected concept → actual image supplied to the existing Codex Agent.

The selected image is design context. Codex remains free to choose existing assets, procedural generation, Blender, agent-authored Python/code generation, or a combination.

### 3. Persistent panorama / skybox environment — #150

Add the smallest world-level equirectangular panorama capability for desktop/VR, with typed Operator actions and save/reopen persistence. Keep passthrough AR honest.

### 4. Restore room-aware Operator context — #149

Repair the spatial-context capability lost in the Unity/MRUK → Three.js/WebXR port.

Restore a bounded renderer-neutral room model so Operator can ground interactions such as:

- “put that there”;
- “put this on that table”;
- “reorganize this to fit my room.”

Reuse the relevant WebXR room/alignment work from #22 rather than reintroducing Unity/MRUK.

### 5. Quest physical-camera context — #26

Let the wearer explicitly share an environment-camera frame with Operator for qualitative visual understanding.

Keep camera imagery separate from measured room geometry. #149 supplies metric/spatial constraints; camera pixels must not be treated as precise measurements.

## v1.0 release gate

After #147 → #91 → #150 → #149 → #26:

1. stop feature work;
2. run the integrated Quest VR/AR journey defined in #152;
3. run full ControlService and WebRuntime suites plus production build;
4. build from an exact frozen commit;
5. smoke the extracted package;
6. run wearer acceptance on that exact package;
7. publish `v1.0.0` only from the tested frozen artifact.

The target experience is:

> **Ask Operator to imagine, create and revise a world; manipulate it naturally in VR; surround it with generated visual environments; bring it into AR with actual room-aware spatial context; optionally let Operator see an explicitly shared physical-room image; save it and return.**

## Parallel / post-v1.0 work

Important, but not blockers for this v1.0 definition:

- #148 — interactive Operator inside the persistent hosted Citizens world;
- #20 / #29 — deeper persistent Citizens and SwarmWorld-like society work;
- #9 — broader provider/catalog integrations;
- #31 — external/School client-neutral integration;
- #32 — broader reusable experiment capabilities;
- #24 — coursework report/video/slides and later submission packaging.

The existing v0.8 hosted Citizens world remains available as its currently supported read-only visitor experience. Do not claim hosted human editing until #148 passes.

## Work-selection rule

1. Follow #152 and the currently active milestone issue.
2. Continue compatible merged work; do not create a second world, Agent loop, renderer, or asset system.
3. Preserve v0.8 behavior as the regression floor.
4. Prefer one user-visible end-to-end slice over framework expansion.
5. Separate automated/desktop evidence from actual Quest wearer evidence.
6. Finish and merge the active milestone before starting the next one.
7. New research links go to [RESOURCES.md](RESOURCES.md) unless they create a concrete implementation need.
