# Issue #91: selected image to a persistent Matrix bridge

Date: 2026-09-27. This is a desktop virtual-room acceptance run on an isolated
ControlService scene directory. It does not claim Quest wearer, traversal, or
physical AR evidence. The v0.8.0-preview.1 world/runtime remains the regression
baseline.

## Real image variants and explicit selection

The PC Agent Portal was authenticated with ChatGPT, and the local Codex
app-server advertised `imageGeneration: true`. The same continuing Agent Portal
conversation generated native GPT Image variants 3 and 4 and later received
the selected image for the Matrix build. This uses the Codex subscription
capability; it does not configure an Images API key or call the separately
billed OpenAI Images API. ComfyUI is a selectable fallback.

The ComfyUI worker ran the sanitized [Krea2 graph](concept-91-krea2-workflow.json)
at 4:3, 1 megapixel, eight Euler/simple steps, CFG 1, with seed variation. The
loaded graph's canonical SHA-256 was
`2e261f4a556c89758ff137a801478a29cd208042e9a925571f1fd89491dbc408`.
Its diffusion model was `redcraft23INT8INT4FP8_30Krea2.safetensors`, CLIP
`qwen3-vl-4b-heretic_int8.safetensors`, and VAE
`qwen_image_vae.safetensors`. The workflow file omits the unused, disabled LoRA
pass-through; the worker address and any credentials remain PC-only.

| Version | Provider | Concept ID | Image SHA-256 | Evidence |
| --- | --- | --- | --- | --- |
| 1 | ComfyUI Krea2 | `e445627be262427686d855fa5b43a399` | `2900ef5180bcec24b7606a0d406c204bc4f3cc4a44b98b6dd5d7dbd1abff5b19` | [PNG](concept-91-comfy-version-1.png) |
| 2 | ComfyUI Krea2 | `e96a86c8becb497b893791392fd406a9` | `ac6157b482f70b89aa93b4bcd7881a7ecb5f7503451eeb0b888453b3f3e400d6` | [PNG](concept-91-comfy-version-2-selected.png) |
| 3 | Codex GPT Image | `1363df9c9fac475bba7ac25f220d2247` | `454b5c8c63edbf34755b8fa9c6f625e72bc3d00f3a2e0e0c43d7272e71a2acc4` | [PNG](concept-91-codex-version-3.png) |
| **4 selected** | **Codex GPT Image** | **`4ecf4c7e86b34493b9a5502e381e4759`** | **`3ab3bf0cbb35dd2c44b5e2f4f41a5be24208eb35fdc41b351c3e1a1d0499dbc4`** | [PNG](concept-91-codex-version-4-selected.png) |

Version 2 was a new text-to-image sample from Version 1 with seed `393938399`;
Version 1 used seed `3777572567`. Version 4 was a new sample from Version 3.
Earlier images remained available. These variations do not claim
image-conditioned pixel edits. Version 4 was explicitly selected, with notes
for a walkable bridge, paired rails, planks, turquoise trim, amber accents, and
preservation of the existing block. The selected ID and notes were verified in
the PC concept store after the UI write.

## Actual selected pixels in the existing Codex Agent

The Operator used selected Version 4 for a separate build request. Agent Portal
conversation `01a0e4be-7a58-7fd2-bcc1-fda94a5a3ec3` continued through native
image generation and build turns. The local app-server session log records a
`local_image` input pointing to the PC-private Version 4 artifact, followed by
an `input_image` in the model turn. The initial build, Blender authoring, and
final Blender registration/spawn turns each contain the selected image bytes.
Decoding those inputs yields
**2,144,296 bytes**, SHA-256
`3ab3bf0cbb35dd2c44b5e2f4f41a5be24208eb35fdc41b351c3e1a1d0499dbc4`:
the selected preview's hash. Only the hash and a copy of the concept image are
in this PR; the private Agent session log and local path are not.

The build context included room `web-virtual-room-v1`, request-time scene
revision and runtime generation, Creator Mode/capabilities, and a bounded scene
summary with the existing block ID and transform. The image was advisory art
direction, not executable content or spatial measurements. Generation alone did
not start a Matrix mutation; selection and build were separate explicit steps.

## Strategy correction and Blender result

Codex first checked the live catalog and generator list and chose reviewed
`bridge-v1` for a traversable deck, paired rails, supports, and a static
collider. Its fixed materials and gentle slope lacked the selected image's arch,
turquoise trim, and amber lighting. That was an **interim functional result**:
creation receipt `0b66c11fa8064cd292d25e4d6497d936` and collider receipt
`eaaaffe1e2e247c8b6e2dd0c94203b99` succeeded for object
`9d34a00ba3de4d6b833e58af7b12bb2e`; build record
`18bf6e624fa9457aaa4fe156845fd9ef` was completed. The
[interim scene capture](concept-91-matrix-result.jpg) and
[interim checkpoint](concept-91-world-checkpoint.json) retain this rejected
visual for comparison.

The Operator then requested Blender for selected Version 4. The same Agent
authored an editable [Blender source](../WebRuntime/art/concept-v4-garden-bridge.blend)
using its [build script](../WebRuntime/art/build_concept_v4_garden_bridge.py),
exported a self-contained [GLB](../WebRuntime/art/concept-v4-garden-bridge.glb),
and inspected its [preview](../WebRuntime/art/concept-v4-garden-bridge-preview.png).
The GLB passed Matrix's local validator at 1,272,264 bytes and SHA-256
`27db9e18cca49ee37a249f0e30919bb852b30876361bed15e4d11e0e27524e3c`.
The first catalog request included optional metadata the reviewed approval path
could not summarize, so it was declined without changing the catalog. A second
request containing only the local source path, hash, and name was reviewable and
approved. The catalog registered
`web:luminous-garden-footbridge-v4:27db9e18cca4`, and the browser loaded it.
After the authoring-only Agent turn ended, its build request
`defc9691db2d4d819de310d6a0922de9` reconciled to `failed`/unverified on
service restart. The later receipt-backed Blender build stayed `completed`.

Codex issued a typed spawn at `(-3, 0, -2)` in revision 9. Receipt
`8000b04dd3174f449a4eb31c884beb26` returned `ok: true`; live scene state
observed object `0b8d7b29509943898939e9f01ab83a14` with the registered
asset. Durable build record `df59bf23b4d4483489f4dfbe350b3ba3` was marked
`completed` only after the receipt and observed object matched. It links
selected Version 4 and image hash to the GLB asset, object, receipt, and source
filenames. This acceptance run used an explicit Blender request before the new
creation-mode selector was loaded; the mode contract is separately tested and
does not retroactively relabel this live build.

After the Blender object was verified, exact native `delete` command receipt
`80c2c5d034f34438b53a39c96c9fdd74` returned `ok: true` for only the
temporary procedural object. Live state then contained exactly two objects:
the new Blender bridge and the original block
`e647674f24c541758de23075de9561c1`, still at `(0, 0, -2)` with scale
`(1, 1, 1)`. The [final virtual-room capture](concept-91-matrix-blender-result.jpg)
shows the registered bridge beside the block. It is dark under the existing
room lighting, but the curved deck, turquoise rails, and amber accents are
visible. The Blender preview shows the materials more clearly. The simpler
ornament and patina differ from the reference; emissive accents are not dynamic
lighting. The GLB has no verified deck collider or wearer traversal.

The Operator saved **Concept 91 Blender bridge acceptance** as a PC world
checkpoint. Its [checkpoint JSON](concept-91-blender-world-checkpoint.json)
contains both final objects and a dependency on the exact GLB hash. After a
browser reload and service restart, the browser loaded both original IDs. An
explicit checkpoint restore reported the same two active objects, and
`GET /api/state` confirmed their transforms and absence of the interim bridge.
The post-restart CSP fix allowed Three.js to fetch the GLB's embedded wood
texture; the live browser showed brown planks instead of the earlier pale
texture fallback.

## Creation controls and verification

The selected-image build control offers Auto (Codex chooses), Procedural, and
Blender on desktop. The shared in-world CODEX navigation panel carries the same
mode state and selection actions for immersive VR and AR, and its voice route
can explicitly select an image version. Mode and expected selected concept
identity are sent with the build request; the PC stores the mode in immutable
build provenance and rejects a stale selected ID/version. At this desktop run,
the in-world panel reported concepts as text. The later
[XR gallery validation](Concept-91-XR-Gallery-2026-09-27.md) verifies actual
image previews and selection with a Quest wearer.

- Full ControlService suite: **843 passed** in 151.073 seconds. WebRuntime:
  **602 passed**. Vite production build and `git diff --check` passed.
- The desktop microphone path routes speech to the same intent, but this live
  image-to-build run used text.
- #150 skybox runtime, #149 room-aware composition, #26 physical camera
  context, and #148 hosted Operator integration remain separate. #147 was
  validated separately in PR #157, then its branch was merged into #155;
  #155 is stacked on #157 for review.
