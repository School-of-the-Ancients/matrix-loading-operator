# Issue #91: compressed Blender source provenance

Date: 2026-09-27. Both tracked Version 4 `.blend` files begin with Blender's
Zstandard-compressed frame magic (`28 b5 2f fd`). The earlier
`creationMode: blender` provenance check accepted only an uncompressed
`BLENDER` header, so it rejected these editable Blender 5.2 saves even though
Blender could open them. This affected the result-recording gate, not GLB
validation or rendering.

Commit `6a328b0` keeps the uncompressed path. For a compressed source no
larger than 64 MiB, it opens the exact file in background Blender with file
scripts disabled and a 60-second timeout. The source is accepted only when
Blender succeeds and reports loading that same file. A malformed compressed
candidate was rejected. The check uses an argument list and no new Python
dependency.

The focused receipt-backed concept handoff suite passed **21/21**, including
a Blender-mode build record for the existing animated `.blend` and matching
registered GLB. The full ControlService suite passed **847/847**; WebRuntime
passed **632/632** and the production Vite build passed with the existing
large-chunk advisory. `git diff --check` passed.

This validates compressed source eligibility for Blender-mode provenance.
The earlier [manual animation and Quest observation](Concept-91-Animated-Bridge-2026-09-27.md)
remain separately attributed; this source check does not establish that the
Agent authored the animation or that the tested Blender-mode record was a
new Quest wearer result.
