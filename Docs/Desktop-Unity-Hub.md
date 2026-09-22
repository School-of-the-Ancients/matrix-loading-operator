# Open the content workshop in Unity

Use **`Desktop\Game Design\Matrix Content Workshop`** to import assets, inspect prefabs, and export content packs for Matrix. This is a separate Unity Editor project prepared from the current desktop fixture. It includes the seven bundled props, the sci-fi beacon, the content-pack exporter, and prefab preview tools.

| Folder under `Desktop\Game Design` | Purpose |
| --- | --- |
| **`Matrix Content Workshop`** | Current project to open in Unity Hub for content preparation. |
| `Matrix Loading Operator` | Full Git repository: application source, PC service, build scripts, documentation, and version history. |
| `Matrix White Room Quest` / `Matrix White Room Desktop` | Earlier exported projects. They were left unchanged and may contain older code or scenes. |

The source repository was updated to `9718c42` on `codex/quest3-capture-content-catalogs`. The workshop was copied from the matching generated Desktop fixture. Its 115 copied source/project files were compared by SHA-256; generated caches were excluded. **The workshop is ready to open:** Unity 6000.6.0f1 completed Android import and compilation successfully, and all 352 core checks passed. The 115 copied files remained unchanged after import. No APK was built and no new headset test is claimed.

## Add the workshop to Unity Hub

1. In Unity Hub, choose **Add project from disk**.
2. Select **`Desktop\Game Design\Matrix Content Workshop`**, the folder containing `Assets`, `Packages`, and `ProjectSettings`.
3. Open it with **Unity 6000.6.0f1**. Install that Editor's **Android Build Support**, SDK/NDK, and OpenJDK to export Quest packs.
4. Open **`Assets/Sandbox/WhiteRoom/Scenes/WhiteRoomDesktop.unity`** in the Project window.
5. Let Unity finish importing and compiling before importing additional assets.

The workshop uses the **built-in render pipeline** and retains `SANDBOX_CORE_FIXTURE` in `Assets/csc.rsp`. Keep that file. It has no Meta XR/MRUK packages: it is a content-authoring project with a desktop preview scene. The native AR application is built from the full repository using `Build-RoomAR.ps1`.

## Import and prepare a prop

Use Unity's normal asset workflow: acquire a package through its licensed source, import it through **My Assets** in Package Manager, or choose **Assets → Import Package → Custom Package** for a local `.unitypackage`.

Inspect the imported content in Unity, then make a separate working copy of the prefab you want to publish, for example under `Assets/MatrixImports`. Keep the source package intact while preparing that copy.

The current Matrix loader accepts static props with these components:

- `Transform`, `MeshFilter`, and `MeshRenderer`.
- `BoxCollider`, `SphereCollider`, or `CapsuleCollider` when needed.
- Materials using `Standard`, `Unlit/Color`, or `Unlit/Texture` shaders.

Prepare compatible materials when an asset uses another render pipeline. Remove unsupported components from the export copy. Scripts, Animator playback, rigged characters, audio, particles, and physics bodies need additional runtime support before they can be used as downloadable props. See [pack compatibility and limits](Content-Packs.md#compatibility-and-limits).

## Export it for the Quest

1. In Unity's **Project** window, select the prepared `.prefab` assets.
2. Choose **Matrix → Content Packs → Create specification for selected prefabs**.
3. Edit the generated JSON specification: choose your provider ID, pack ID, version, permanent asset IDs, names, descriptions, and scale. Record the actual license and attribution; confirm distribution permission only when your intended use permits it.
4. Set the active build target to **Android** for Quest and set the specification's platform to `Android`. Use this exact Editor version, **6000.6.0f1**, to match the current Matrix player. Windows packs are separate exports for `StandaloneWindows64`.
5. Choose **Matrix → Content Packs → Export from JSON specification** and select an output folder. This produces the bundle, `content-pack.json`, and `catalog.json`.
6. Configure a file catalog provider on the PC service. Its provider ID must match your specification and its manifest path must point to that exported `catalog.json`. Follow [provider configuration](Content-Catalogs.md#configure-providers-on-the-pc); keep configuration and credentials in the existing private PC setup.
7. Open the content library on the service connected to your headset. Choose **Browse available packs**, find the Android pack, then **Install pack**. Keep Matrix awake and connected until it reports the prefabs as installed.
8. Select **Use in Operator** for an installed prop, choose a placement point, and create, review, and apply a proposal.

This builds a **content pack**, so compatible new static props do not require rebuilding or reinstalling the APK. New application code or unsupported features require a separate application build. Export a new pack version when changing its contents. After restarting Matrix, reinstall the matching pack before restoring a saved scene that uses it.

The workshop includes a ready-made example specification at `ContentPackSpecs/WorkshopBeacon.json`. It references `Assets/MatrixContentPackFixture/Beacon.prefab` and uses provider `matrix-workshop`, pack `beacon-demo`, version `1.0.0`, and prefab ID `matrix-workshop:beacon-demo:1.0.0:beacon`. Its Android export completed at `Builds/ContentPacks/WorkshopBeacon`: the 88,446-byte bundle matches the SHA-256 and size in both manifests. `content-config.example.json` in the workshop shows a local provider for this pack; it has not been applied to the running service. See the [workshop validation record](../Validation/desktop-content-workshop.json). Use a new version when adapting this example.

For optional rendered browser samples, follow [Add visual samples to a catalog](Content-Packs.md#add-visual-samples-to-a-catalog). The workshop includes `SandboxPrefabPreview`; sample images are exported separately from the pack.

## Keep your imported work

The workshop is an isolated working copy. **Imports, prefab changes, and scenes edited there do not automatically synchronize to `Matrix Loading Operator` or Git.** Keep it as your working project after importing assets; do not recreate or overwrite it from a generated fixture.

For a lasting source change, deliberately copy the relevant authored files and their `.meta` files into the full repository, then review and commit them. Imported third-party assets and their redistribution permissions need their own review. The repository's build scripts regenerate fixtures under the repository; they do not collect changes from this workshop.

Creating the workshop did not move the running PC service, provider configuration, or saved scenes. Continue using the existing service and its matching port for the headset walkthrough. The older exported White Room projects and the Desktop repository's existing local files were preserved.
