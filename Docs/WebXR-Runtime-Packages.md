# WebXR runtime packages: staged capability boundary

Matrix Agent Portal keeps Codex on the PC. Codex may create a component package,
publish it through the PC-local Matrix MCP, and attach an immutable version to a
live WebXR object. The browser executes only packages validated for its runtime
version. A request that needs a missing primitive remains a normal source
change and reviewable PR, after which future packages can reuse that primitive.

## Implemented schema 1

Schema 1 is a small numeric graph. It has a name and expressions for approved
transform channels. Inputs are elapsed wall-clock time, the object's saved base
transform, and a distinct virtual-floor target's saved base transform. Nodes
are constants, addition, multiplication, sine, and cosine. It can combine
orbiting, pulsing, and other periodic motion without a named Matrix operation.
It cannot execute JavaScript or access browser objects, network, storage, or
credentials.

The PC and browser enforce one component per object, at most nine outputs, 64
nodes, expression depth eight, a 4 KiB package, finite constants, and existing
transform bounds. The scene embeds the validated package version and status,
so restore does not depend on fetching the PC catalog. The PC catalog stores
content-addressed immutable versions and requires an exact package match for
every attach command, including direct Operator commands. A changed package
gets a new ID. Stop restores the saved base pose; Remove clears the attachment.
Failures are visible as `failed` status and a bounded error, and do not keep
executing each frame. Attach/stop/remove use the normal Matrix command queue,
revision guard, native approvals, and runtime receipts.

## Why this execution tier

The first useful test is a transform behavior, so a numeric graph gives Codex
the needed composition with a small, inspectable runtime contract. Sandboxed
JavaScript modules would need an explicit capability API, deterministic event
and resource limits, module provenance, and a way to pass approved rendering
operations to Three.js without exposing `window` or DOM. A Worker removes
direct DOM access but does not by itself bound CPU use or prevent network
access; it also cannot own the Three.js scene graph. WASM provides a bytecode
boundary but still needs the same host-call capability design and memory/fuel
budget. These remain candidate tiers; schema 1 does not imply they are safe to
load today. Unrestricted `eval` or remote script URLs are outside the Matrix
publication boundary.

## Next package tiers

An authored asset may be a GLB plus named animation clips and validated
bindings; a procedural creation may need no GLB. Future package manifests
should reference immutable catalog resources by digest, declare their runtime
capabilities, and have a versioned state/migration contract. Animation playback,
materials/shaders, particles, audio, physics, input events, child entities, and
multi-object composition each need a narrow primitive with validation,
persistence, failure semantics, tests, and a runtime receipt before publication.
Blender remains the authoring tool when geometry, rigging, or clips warrant it;
Three.js remains the executor. No animation, rigging, shader, physics, audio,
or general script capability is claimed by schema 1.

The first clip playback slice validates named GLB clips and loops a single
clip on a virtual-floor instance. A Blender 5.2 background export was accepted
by the catalog and its rotation clip advanced in the Three.js mixer test. This
does not yet prove the Agent Portal to Blender MCP workflow, a multi-clip
binding, or a wearer interaction. Next, bind clips and selection events through
a reusable package or typed runtime contract, then prove the full Blender MCP
flow. Desktop and Quest wearer evidence must be recorded separately.
