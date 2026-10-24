# Durable room-aware surface placement

Base: `58f26f4` (#149 / PR #160). This isolated candidate also includes the
measured-plane volume guard from `5abc9bb` and its concave-polygon correction.

`matrix_spawn_on_surface` still takes a fresh support ID, a support-local pose,
and the room spatial token. At browser execution, the existing alignment,
tracking epoch, latest support footprint, and nearby measured plane checks run
before a new ID is allocated. The accepted pose is transformed through the
current measured support and located web-floor origin. The resulting entity is
stored as `web-floor` in the canonical scene, so AR exit and normal browser
Save/reopen carry the same ID and transform into desktop and VR. The WebXR
support ID and geometry remain temporary observations, not world assets.

The spawn receipt reports the selected support and resolved web-floor pose.
ControlService reports success only after the same runtime's scene contains a
new object with the receipt ID, asset, canonical anchor, and exact resolved
transform. A bare success receipt stays unconfirmed. The status can recognize
that same object after AR exit into desktop on the same runtime.

Synthetic tests cover a rotated room origin, browser save/reopen with origin
provenance, stable IDs, stale tracking rejection, support footprint fit, wall
and shelf intrusion. Plane polygons are triangulated and clipped to the convex
object section to detect positive-area overlap. Regressions cover a concave
U-shaped shelf whose open notch stays clear, a collinear-edge overlap strip,
an interior triangle with all vertices on the object boundary, and edge-only
contact.

Validation on this isolated source:

- ControlService: `python -m unittest discover -p 'test_*.py'` — 883 passed.
- WebRuntime: `npm test` — 681 passed.
- WebRuntime: `npm run build` — succeeded.

The change does not rewrite objects already created on temporary WebXR plane
IDs. A retained scene backup can be reviewed for an explicit conversion only
when it includes the original support poses and web-floor origin; the wearer
must still verify alignment and physical clearance before use. No live service,
Quest scene, or private backup was changed by this source validation. Measured
planes alone cannot prove clearance from unmeasured furniture such as a TV.
