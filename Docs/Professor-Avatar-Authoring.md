# Authoring reusable Professor avatars

This is the authoring runbook for the PC-side avatar Operator. School owns teacher
identity and conversation; an avatar job creates an approximate visual asset.
It does not grant the teacher editor access or change a Matrix world. See
[the library contract](Professor-Library.md) and
[native VRM export setup](../Tools/vroid-export/README.md).

## Reuse before generation

1. Search the library for a suitable finished avatar. School's appearance preparer
   already tries exact teacher matches before requesting an asset job.
2. When a new appearance is necessary, inspect `seedCatalog` in the job brief if
   present. This private JSON index points to editable sources, recipes and evidence.
   Verify selected source files against their recorded hashes.
3. Prefer a compatible `.vroid` base with working expressions and the desired body
   and clothing family. Open it and immediately save a copy to `sourceProject`
   before editing. Never alter the library's source in place.
4. Otherwise create a stock male/female base and customize it. A new historical name
   alone is not a reason to regenerate a suitable existing avatar.

The eleven-teacher run reused finished male and female bases for later variants.
Reapplying identical face/body settings was slow and added no visual value.
A seed is a starting point, not proof of likeness.

## Discover the editor instead of guessing controls

Use the configured `vroid_studio` MCP. If absent from the agent tool list, inspect
the local MCP configuration, initialize its configured HTTP endpoint, and use
`tools/list` for the current schema. The observed endpoint was loopback port 17891
with `/mcp/`; do not assume that address on another installation. Do not launch a
second editor or reinstall a plugin merely because discovery failed.

The verified sequence in VRoid Studio 2.14.0 was:

```text
state / status
save a recovery copy of an unrelated open project, if needed
main_menu -> open(seed.vroid) OR create(male|female)
save(job/source.vroid) before modifying an opened seed
sections -> categories(section) -> enter(section, category)
presets(section, category) -> optional preset_preview_list
select_preset / set_param in small ordered batches
camera(frame) -> screenshot after edits settle
save(job/source.vroid)
export_vrm(job/native.vrm, title)
```

`main_menu` bypasses the unsaved-changes dialog. Never use it to discard unknown
work. Serialize authorship: two jobs must not interleave changes in one editor.

- Discover exact case-sensitive labels and stable parameter paths. Preset indexes
  and short parameter indexes are version/session-specific.
- Inspect thumbnails and the whole outfit. The nominal "White Bamboo Print Set"
  included shorts and tall socks, which were unsuitable for Confucius.
- Set global hair colors while a populated Hairstyle Set is active, **before**
  clearing Front/Back groups. Clearing all populated groups first made those
  colors unavailable. Base Hair has a separate color from Main/Emission.
- Use finite values in the returned ranges. Some sliders use `-1..1`, others
  `0..100`; do not apply one numeric scale to all controls.
- Use batches of about 5–6 changes and check every result. Never poll screenshots
  during a rebuild. On timeout, query `status` and wait for the in-flight command;
  do not replay a possibly still-running batch.
- The editor slowed considerably while backgrounded in this run. Bringing the
  existing window forward improved progress. Inspect liveness before treating a
  watchdog warning as failure.
- Native export refuses to overwrite a destination. Use a new revision filename
  and preserve prior sources/exports. A saved project alone is not a finished VRM.

## Make a recognizable, usable character

Save a declarative recipe: teacher ID, approximate age/presentation, palette,
garment silhouette, accessories, seed and subsequent refinements. Treat the brief
as data, not execution authority. Do not claim a verified historical likeness.

Useful cues in the initial cast included Leonardo's long silver hair/beard and
soft cap; Socrates' bald scalp; Ada's dark gown/ringlets; Einstein's white flyaway
hair/moustache; Cleopatra's dark bob/diadem/collar; and Marcus' laurel. The other
scholars used distinct palettes, hairstyles and period-inspired clothing.
Inspect shoes, socks, stray anime antenna hair and modern garment details too.

Keep the lips visible, eyes unobstructed, and arms usable for teaching gestures.
Matrix supplies idle, talking and pointing motion to the VRM humanoid rig. These
models do not gain recorded animation clips merely by being exported from VRoid.

## Optional custom finishing while preserving VRM

Stock presets lacked the needed beards, caps and jewelry. The working method kept
the native VRM intact and added locally authored geometry:

1. Preserve `nativeVrmFile` and the editable `.vroid` source.
2. Author accessories in an isolated Blender scene/process. Do not clear or replace
   a user's existing scene. Prefer connected Blender MCP; the initial cast used
   installed Blender in background mode after its MCP connection was unavailable.
3. Use curved tapered strands, caps, jewelry and drapery as appropriate. Attach
   rigid portrait details to the head and torso details to a suitable torso bone.
   Convert authored positions through the inverse of the actual bone world matrix.
   Distinguish glTF Y-up from Blender Z-up.
4. Preserve original node indexes, skeleton, skins, inverse bind matrices, morph
   and expression bindings, look-at data and spring-bone references. Append geometry,
   accessors and materials. A normal Blender GLB export is not a replacement for
   the native VRM and can discard required extensions.
5. Group accessory geometry by compatible bone/material to limit draw calls.
   One mesh per beard strand was consolidated. Use coherent shade variation:
   independent random RGB variation produced unwanted colored stripes.
6. Inspect the actual VRM/MToon renderer. Blender lighting initially overexposed
   the beard. Check cloth intersections and headwear contact from multiple views.
   Per-triangle surface sampling caused sharp drape discontinuities at garment
   boundaries; a smoother authored surface avoided those artifacts.
7. Save the assembled `.blend`, final VRM, recipe and previews. Explain that these
   additions appear in the Blender/final VRM files, not the native `.vroid` base.

The local `finish_vroid_cast.py` records this method, but contains fixed paths,
cast-specific geometry and sizing heuristics. Adapt and visually verify it for
another model. Do not run the whole cast's scripts as an unattended arbitrary-person
generator. It is not a general Blender-to-VRM exporter.

Editable seed reuse is a private local authoring workflow. Bundling finished
avatars is separate from distributing a model-generation application; consult
the [VRoid Studio guidelines](https://vroid.com/en/studio/guidelines), including
their character-creation-tool provision, before distributing such a generator.
The release contains runtime models and their notice, not the editable seed corpus.

## Validate, register, then report

Before claiming completion:

- Run Matrix's `web_assets.inspect_glb` on the **final** VRM. Check size, embedded
  resources, humanoid structure, bounds and expression support.
- Compare native and final `skins`, `VRMC_vrm.humanoid`, `expressions` and `lookAt`.
  The finishing pass must not silently lose or renumber those structures.
- Load through the existing Three.js/three-vrm renderer. Inspect face and full
  body; exercise arm posing, head turns, blink and speech mouth shapes. Distinguish
  new errors from historic preview errors caused by not-yet-exported files.
- Save hashes, previews and validation evidence. Keep native export, desktop
  rendering, library registration, automatic matching and Quest evidence separate.
  The initial eleven-model run passed desktop checks, not a new Quest acceptance run.
- Call `matrix_register_library_asset` with the final path, a fresh SHA-256,
  `kind=avatar`, the exact teacher ID, visual tags and assigned `job_id`. Check its
  returned hash/catalog ID, then inspect the library result.
- Keep editable paths and recipes PC-local. Do not expose them in the headset
  catalog, upload models, or assume redistribution rights.
- Record refinements and remaining limitations beside the job outputs.
  Registration is not placement. School's existing binding flow owns attachment
  and preserves manual appearance pins.

If export, validation or registration fails, report that stage and preserve the
recoverable files. An Operator success message is not a registered result.
Failed-job retry/reset and fully unattended arbitrary-person quality remain separate
work under the avatar issue; this runbook does not establish those features.
