# Room-aware object volume guard

Base: `58f26f4` (#149 / PR #160).

The typed room-constrained surface spawn and virtual-floor move now preflight
the catalog bounds against other fresh, finite WebXR support and wall polygons.
The browser repeats the check against its latest unsmoothed observed planes
before creating or moving an object. The chosen support is excluded so valid
contact placement is preserved. A rejected preflight queues no edit; an
execution rejection leaves the object and scene unchanged.

The check transforms the scaled and rotated asset box into each plane frame,
intersects the box with that plane, and tests the resulting section against
the measured polygon. Plane contact at the object's top or base and clear
space beyond a finite wall edge remain allowed. Synthetic cases cover a tall
floor object crossing a higher support, a low floor orb, an orb on the higher
support, near-wall clearance, wall penetration, and a changed observed wall
between planning and execution.

Validation on this isolated source:

- ControlService: `python -m unittest discover -p 'test_*.py'` — 881 passed.
- WebRuntime: `npm test` — 678 passed.
- WebRuntime: `npm run build` — succeeded.

This is a guard for measured planes and catalog volumes in the current static
pose. WebXR planes do not describe every physical object or full furniture
volume. The guard cannot establish clearance from an unmeasured TV or other
obstacle, and it does not sweep animations or motion through space. No live
scene edit or Quest wearer verification was performed for this change.
