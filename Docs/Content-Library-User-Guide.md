# Using the Matrix content library

The content library lets an already-built Matrix app receive additional compatible
props. You install a pack, then ask the Operator to place and edit its props in
your room. Installing a pack adds choices; it does not place anything by itself.

The **Find content** section also searches live public source listings. Poly
Haven offers models, HDRIs, and textures without an account; choose **Sketchfab**
as the provider to page through its downloadable-model listings. These entries
link to their source pages and display their license, but are not packs. Sketchfab
downloads require the player's own authorization. Download a suitable source
through its normal site, review its license and geometry, then use the Unity
preparation path below. A public search result cannot be placed directly.
Select **Openverse audio** to find licensed sounds and open their original source
pages. Search results retain creator and attribution details, but the current
Matrix player does not yet load or play external audio.

### Why does the running app show 23 props?

Those are the prefabs bundled in the current demo. The full Poly Haven index
has thousands of entries, but public listings alone are not Unity prefabs.
The local library workflow mirrors compact source files on the PC and exports
one Android pack per entry. Only a chosen pack is installed on the headset when
needed; it then joins the running app's asset list without rebuilding the APK.
Models become static props, HDRIs become panorama domes, and textures become
material sample tiles. See [the full-library commands](Content-Catalogs.md).

With a configured local catalog and an updated connected player, an AI request
such as **“Summon an armchair here”** searches the ready packs, installs the
top compatible match if needed, waits for the player to acknowledge it, then
creates a placement proposal. You still review and Apply the scene change.
After Apply, the virtual result is automatically captured for an image-capable
AI when that option is checked. The AI can judge visible placement and propose
an installed alternative or name an exact prepared pack to try next. A result
review never silently replaces an
object. Broad or ambiguous requests can still require a better description.

Public Poly Haven search fetches **metadata only**, cached in the PC service
for ten minutes. The optional local mirror downloads source files once; the Unity
batch converts them once into versioned packs. Installing a compatible pack
copies verified bundle bytes to the PC cache and headset. The app can restore
an exact cached dependency after restart while the source provider is offline.

For one new Asset Store prop, this currently takes **more preparation than adding
it directly to a Unity scene**. The benefit comes afterward: you can reuse the
same Matrix APK while adding supported packs and arranging their contents with AI,
reviewed commands, Undo, and saved scenes. The library does not replace Unity's
authoring tools or automatically convert every Asset Store package.

## Do I have to rebuild the app?

| What you are adding | What needs building? |
| --- | --- |
| Your first use of the PR #27 content loader | Install a Matrix APK containing the new loader and run its matching PC service. An older APK cannot gain this loader from the web page. |
| Another prepared Poly Haven prop, panorama dome, or material tile | Install its existing Android pack. The APK stays installed. |
| A new supported static prop outside the prepared library | Export a content pack in Unity. You build the **pack**, not another APK. |
| Different meshes or supported materials/textures on those props | Export a new pack version; the compatible APK can stay installed. |
| New C# behavior, animation playback, a rigged character, audio, or another unsupported feature | Implement the capability and its loading support, then rebuild the app. Exporting a bundle alone does not enable it. |

An exported file is not proof of a successful headset install. Check the running
app's acknowledgement, then inspect the placed prop in the headset. The original
[candidate validation record](../Validation/Spatial-Content-Validation.md) describes
the evidence at that checkpoint; the later
[Quest Pro walkthrough](../Validation/content-headset-walkthrough.json) records
headset installation and the remaining hands-on checks separately.

## What do the import statuses mean?

The **Unity asset preparation checklist** is a manual queue. Its status menu records work
you have completed elsewhere; selecting a status does not perform that work.

| Status | What you should have done |
| --- | --- |
| **Queued** | Saved a package URL or staged an existing local `.unitypackage` for later work. |
| **Acquired** | Obtained access to the asset through its normal licensed acquisition process. |
| **Imported** | Imported the asset into your **Unity project**. It is not installed in the running Matrix app. |
| **Exported** | Used the Matrix exporter to create the bundle, `content-pack.json`, and `catalog.json`. It still needs catalog configuration and installation. |
| **Failed / Cancelled** | Recorded why you stopped or that the work should not proceed. |

**Installed** is a separate runtime result under **Downloads and installation**.
Wait for a successful `ready` result before asking the AI to place a new prop.
Changing a queue item to **Exported** cannot produce that result.

## Browse individual prefabs

The **Prefab browser** at the top of the library shows the props reported by the
connected Matrix app, including its bundled props and installed packs.

1. Use **Find a prefab**, **Availability**, and **Source** to narrow the cards.
2. Select **Browse available packs** to search your configured catalogs and see
   individual prefabs inside their packs as well. This does not install anything.
3. Check the card's name, description, platform, pack version, and measured
   dimensions. **Asset details** includes the exact ID and available provenance.
4. For a catalog prefab, **Install pack** installs its whole pack. Incompatible
   platform or Unity versions are disabled. An Android and Windows version of
   the same prefab are separate entries.
5. For an installed prefab, choose **Use in Operator**. This selects the prop and
   fills an empty request with a suggested placement request. Select a point in
   the headset, create a proposal, review it, and Apply when satisfied. Opening
   the link does not call the AI or place an object.

After **Browse available packs**, choose **Preview prefab** on a card with a
matching sample. It downloads the catalog's image to the PC cache, displays a
thumbnail, and opens a larger sample above the cards. It does not install a pack,
ask the AI, or change your room. The supplied samples are actual authored prefabs
rendered in Unity Editor studio lighting; they are not live Quest screenshots or
interactive 3D models. Lighting may differ in the headset. A provider must supply
a matching sample before this button appears.

Dimensions appear only when the app has measured the prefab. Offline
cards are marked as last reported, and their Use action is disabled. A historical
`ready` installation job alone does not mean a pack is loaded in the current app.
The existing room-localization and alignment checks still apply in Operator.

## First try: install the prepared sci-fi beacon

This path starts with an already-exported pack, so it needs no Unity authoring.
It requires the matching updated PC service and Matrix app, a localized room,
and a configured, enabled **matrix-fixture** catalog containing the Android pack.

1. Open the content library from your current Operator page. It is the `/content`
   page on the same PC service that your headset uses.
2. Check the connection line. It should identify an online content loader with
   platform **Android** and Unity **6000.6.0f1**. If it instead asks you to connect
   an updated app, fix that connection before trying to install anything.
3. Choose the fixture provider and search for **sci-fi**. Select the Android
   `scifi-props` pack, version `1.0.0`; a Windows pack is for the desktop player.
4. Click **Install prefab pack**. Wait for its job to become `ready` and show the
   available asset IDs. The beacon ID is
   `matrix-fixture:scifi-props:1.0.0:beacon`.
5. Choose **Back to the room**. In AR, inspect the real-room outlines and confirm
   alignment before placement. Select a suitable floor point, then ask:
   **“Put one Sci-fi Beacon at the selected point.”**
6. Read the proposed arrangement, then choose **Apply**. If the AI says the
   beacon is unavailable, return to the library and check the install result;
   a search result alone does not make it available to the player.
7. Select the placed beacon and ask **“Make this beacon a little larger.”**
   Review and Apply the change. Use **Undo** to check that the edit reverses.
8. Ask **“Save this scene as BeaconDemo.”** Review and Apply that proposal.
   Once the save is confirmed, clear the scene through the normal reviewed flow,
   then separately ask **“Restore BeaconDemo.”** Review and Apply the restore.

After restarting an **updated Matrix app**, reconnect to the PC service, localize
the room and confirm alignment, then restore BeaconDemo normally. Restore checks
the saved pack versions against the device's cached manifests and bundles and
registers them before loading the scene. The upstream catalog/provider can be
offline; the PC service still supplies the saved scene and receives the result.
No manual library reinstall is needed when every required pack is cached.

If restore reports a missing, corrupt or incompatible dependency, your current
scene is preserved. Make the exact original pack available, install it again,
then retry. A new pack version does not substitute for the saved version. Older
APKs still require manual reinstall after restarting; this change needs a player
rebuild. Windows restart checks and pending Quest acceptance are documented in
[content packs](Content-Packs.md#restore-after-restarting-the-app).

## Bring in a new Unity Asset Store prop

Start with a small static object. A package that includes custom scripts,
animation controllers, special shaders, or a whole game needs additional work.

1. Optionally paste the package's Asset Store URL into **Unity asset preparation checklist** and
   click **Add to checklist**. This records your plan; it does not purchase,
   download, or import the package. An existing local `.unitypackage` can also be
   added to the queue.
2. Acquire the asset through Unity's normal authorized workflow. Mark it
   **Acquired** when that is done.
3. Open a project containing Matrix's runtime and content-pack Editor tools in
   **Unity 6000.6.0f1**, matching the player exactly. Import your asset into this
   project, then record **Imported** in the queue.
4. Inspect a prefab and prepare a supported static version. The current loader
   accepts meshes, mesh renderers, transforms, and box/sphere/capsule colliders.
   Use the built-in renderer with **Standard**, **Unlit/Color**, or **Unlit/Texture**.
   Remove unsupported components from the export copy; do not expect its original
   scripts or Animator to run in Matrix. See the full [pack limits](Content-Packs.md#compatibility-and-limits).
5. Select the prepared `.prefab` assets in Unity's Project window. Choose
   **Matrix → Content Packs → Create specification for selected prefabs**.
6. Fill in the specification's provider ID, pack ID, version, permanent asset IDs,
   useful descriptions, and license/attribution. Confirm distribution permission
   for the intended use before setting `distributionPermissionConfirmed` to true.
   An asset's purchase or download does not automatically permit every form of
   redistribution.
7. Set Unity's active build target to **Android** for Quest. Set the specification's
   platform to `Android` as well. A Windows export requires its own matching target
   and pack; one bundle does not serve both platforms.
8. Choose **Matrix → Content Packs → Export from JSON specification**, select your
   specification, and choose an output folder. A successful export creates the
   bundle, `content-pack.json`, and `catalog.json`. Now record **Exported**.
9. Add a **local** provider to the PC service's private content configuration.
   Its `id` must match the specification's `providerId`; its `manifest` must point
   to the exported `catalog.json`. Enable the provider and ensure the service was
   started with that configuration. See [provider setup](Content-Catalogs.md#configure-providers-on-the-pc)
   and the [example configuration](../ControlService/content-config.example.json).
10. Return to the content library, search your enabled provider, and choose the
    Android pack. Install it, wait for `ready`, then use the beacon walkthrough's
    reviewed placement, Undo, and save/restore steps with your new prop's name.

Keep the exported pack and its version available for saved scenes that use it.
When changing its contents, publish a new version rather than replacing the bytes
behind an existing asset ID. The [pack authoring guide](Content-Packs.md) explains
the specification and compatibility checks in more detail.

## What can I ask the AI to do?

The Operator searches the local Poly Haven prefab catalog before a typed or
headset-voice AI request. For a scene needing missing props, the AI can choose
up to four exact compatible local packs. The PC installs them sequentially,
waits for each Quest acknowledgement, and asks the AI to compose again from
the updated prefab catalog. Review and Apply the final scene proposal. No APK
rebuild is needed for each compatible pack. A disconnected headset or changed
scene stops this sequence with an explicit error; reconnect and request a new
proposal instead of assuming an edit landed.
Cancelling a voice request stops later pack selections and cancels the current
PC preparation when it has not been sent to the player. A pack already being
installed on the Quest can still finish; installed packs remain in its cache.

- After searching: **“Which of these packs fits a small sci-fi control station?”**
- After installing: **“Arrange three Sci-fi Beacons around the selected area.”**
- With a placed prop selected: **“Make it bob gently above its current position.”**

The automatic install path applies to **ready, compatible local prefab packs**.
Generic prop requests shortlist object models rather than panorama domes or
material sample tiles. Ask explicitly for a panorama or material to see those
pack categories; a panorama dome is a scene object, not a true Unity skybox.
The AI does not acquire Asset Store packages, author Unity prefabs, export new
bundles, or start generation jobs. Assets that lack a ready pack still require
the authoring workflow above. You still review and Apply scene changes. Save
and restore are separate proposals.

## Images, backgrounds, and the eight categories

**Generate with ComfyUI** runs an explicitly approved configured workflow. Its
output can be retrieved into the PC cache and previewed in the library. Generating
a classroom image does **not** put that background in the headset or create room
geometry. A texture-bearing static prop needs a compatible Unity export; runtime
skybox switching, video surfaces, and generated 3D need additional integrations.
A flat image cannot become a complete VR skybox by merely stretching it onto a
sphere. A reviewed 360-degree equirectangular workflow or image extension step,
plus a runtime skybox application path, is needed. No ComfyUI worker or reviewed
360-degree workflow is enabled in this checkout's current service configuration.

The eight category choices organize catalog entries and import work. They do not
mean that eight runtime systems are available. This version installs **static
prefab packs**. Downloaded animation clips, rigged characters, voices, audio
playback, game logic, and arbitrary scripts are not enabled by their category.
Existing Matrix Rotate/Bob behavior can still animate a supported installed prop.

For an asset you only need once in a fixed Unity scene, direct Unity authoring may
be simpler. Use the Matrix pack workflow when you want to keep adding compatible
props to an installed app and let reviewed AI requests compose them into different
rooms, demonstrations, and saved experiences.
