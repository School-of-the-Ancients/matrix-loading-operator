# Issue #91: Blender source provenance

Date: 2026-09-27. Both tracked Version 4 `.blend` files begin with Blender's
Zstandard-compressed frame magic (`28 b5 2f fd`). The earlier
`creationMode: blender` provenance check accepted only an uncompressed
`BLENDER` header, so it rejected these editable Blender 5.2 saves even though
Blender could open them. This affected the result-recording gate, not GLB
validation or rendering.

Commit `6a328b0` first added a bounded Blender open check for compressed
sources. Review then found that the raw `BLENDER` header alone did not prove an
editable source: a fabricated header could satisfy the Blender-mode build
record. Both raw and compressed sources now have the same 64 MiB limit and
open in background Blender with file scripts disabled and a 60-second timeout.
The source is accepted only when Blender succeeds and reports loading that
same file. Malformed raw and compressed candidates are rejected. The check
uses an argument list and no new Python dependency.

The focused receipt-backed concept handoff suite passed **22/22**, including
a Blender-mode build record for the existing animated `.blend` and matching
registered GLB, a real uncompressed Blender save, malformed raw-source
rejection, and bounded compressed-source rejection. The full ControlService
suite passed **848/848** after the raw-source extension. WebRuntime passed
**632/632** and the production Vite build passed with the existing large-chunk
advisory before this server-only extension. `git diff --check` passed.

This validates raw and compressed source eligibility for Blender-mode provenance.
The earlier [manual animation and Quest observation](Concept-91-Animated-Bridge-2026-09-27.md)
remain separately attributed; this source check does not establish that the
Agent authored the animation or that the tested Blender-mode record was a
new Quest wearer result.
