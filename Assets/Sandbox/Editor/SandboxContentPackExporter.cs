using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>Exports licensed static prefab packs for an already-built compatible player.</summary>
    public static class SandboxContentPackExporter
    {
        [Serializable]
        public sealed class ExportSpec
        {
            public string providerId, packId, version, platform;
            public ContentLicense license;
            public bool distributionPermissionConfirmed;
            public ContentPackAsset[] assets;
        }

        [Serializable] private sealed class CatalogMetadata { public ContentPackManifest contentPack; }
        [Serializable] private sealed class CatalogAsset
        {
            public string assetId, version, title, category = "objects", format = "assetbundle", targetPlatform;
            public string sha256, location;
            public long byteLength;
            public ContentLicense license;
            public string[] dependencies = Array.Empty<string>();
            public CatalogMetadata metadata;
        }
        [Serializable] private sealed class Catalog { public int schemaVersion = 1; public CatalogAsset[] assets; }
        [Serializable] private sealed class ExportValidationReport
        {
            public string status = "failed", startedUtc, completedUtc, unityVersion, platform, packId, version, sha256, error;
            public string scope = "Unity Editor only: actual exported bundle loading and temporary SandboxWorld operations. No standalone player, PC HTTP, headset, AI or visual acceptance.";
            public long byteLength;
            public bool standalonePlayerTested, headsetTested, pcServiceTested, languageModelUsed;
            public int passed, failed;
            public List<string> checks = new List<string>();
        }

        // Read-only input files; all GameObjects belong to a temporary Editor world.
        // -contentPackManifest <content-pack.json> -contentPackValidationOutput <report.json>
        public static void ValidateExportedFromArguments()
        {
            string manifestPath = Path.GetFullPath(Argument("-contentPackManifest"));
            string outputPath = Path.GetFullPath(Argument("-contentPackValidationOutput"));
            string directory = Path.GetDirectoryName(manifestPath);
            var report = new ExportValidationReport { startedUtc = DateTime.UtcNow.ToString("O"), unityVersion = Application.unityVersion };
            GameObject root = null, existingPrefab = null;
            SandboxWorld world = null;
            AssetBundle bundle = null;
            Action<string, bool> check = (name, condition) =>
            {
                if (!condition) throw new InvalidOperationException(name);
                report.checks.Add(name); report.passed++;
            };
            try
            {
                check("Validation runs only in a Windows Editor fixture targeting Windows", Application.platform == RuntimePlatform.WindowsEditor && EditorUserBuildSettings.activeBuildTarget == BuildTarget.StandaloneWindows64);
                var manifest = JsonUtility.FromJson<ContentPackManifest>(File.ReadAllText(manifestPath));
                SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion);
                report.platform = manifest.platform; report.packId = manifest.packId; report.version = manifest.version;
                report.sha256 = manifest.sha256; report.byteLength = manifest.byteLength;
                check("Actual exported manifest matches platform and exact Unity version", true);
                string filename = (manifest.providerId + "-" + manifest.packId + "-" + manifest.version + "-" + manifest.platform + ".bundle").ToLowerInvariant();
                string bundlePath = Path.Combine(directory, filename);
                check("Actual bundle bytes match declared size and SHA-256", SandboxContentLoader.VerifyFile(bundlePath, manifest));
                bundle = AssetBundle.LoadFromFile(bundlePath);
                check("Unity loads the actual exported AssetBundle", bundle != null);
                var names = new HashSet<string>(bundle.GetAllAssetNames(), StringComparer.Ordinal);
                check("Bundle prefab roots exactly match the typed manifest", names.Count == manifest.assets.Length);
                var entries = new PrefabEntry[manifest.assets.Length];
                for (int i = 0; i < entries.Length; i++)
                {
                    ContentPackAsset asset = manifest.assets[i];
                    check("Bundle contains declared prefab " + asset.assetId, names.Contains(asset.prefabPath));
                    GameObject prefab = bundle.LoadAsset<GameObject>(asset.prefabPath);
                    SandboxContentPrefabValidator.Validate(prefab);
                    check("Loaded prefab passes runtime component/material limits: " + asset.assetId, true);
                    entries[i] = new PrefabEntry { assetId = asset.assetId, displayName = asset.displayName, description = asset.description,
                        spawnScale = asset.spawnScale, prefab = prefab, source = SandboxContentRules.Source(manifest) };
                }
                root = new GameObject("Temporary exported content validation");
                existingPrefab = new GameObject("Temporary existing prefab"); existingPrefab.SetActive(false);
                world = new SandboxWorld("content-export-editor", root.transform,
                    new[] { new PrefabEntry { assetId = "existing-prop", prefab = existingPrefab } },
                    new[] { new RoomTarget { anchorId = "floor", origin = root.transform } });
                CommandResult initial = world.Execute(new SandboxCommand { op = "spawn", assetId = "existing-prop", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                check("Temporary baseline object is created through SandboxWorld", initial.ok);
                world.TryGetObject(initial.objectId, out GameObject retained);
                string baseline = JsonUtility.ToJson(world.Capture().scene); int undoBefore = world.UndoCount;
                world.RegisterAssets(entries);
                check("Actual bundle registration preserves baseline scene history and instance", JsonUtility.ToJson(world.Capture().scene) == baseline && world.UndoCount == undoBefore && world.TryGetObject(initial.objectId, out GameObject current) && current == retained);
                PrefabEntry first = entries[0];
                AssetInfo registered = world.Capture().assets.Find(asset => asset.assetId == first.assetId);
                check("Registered geometry has measured positive bounds", registered.localBounds != null && registered.localBounds.size.x > 0 && registered.localBounds.size.y > 0 && registered.localBounds.size.z > 0);
                check("Registered catalog retains exact source provenance", SandboxContentRules.SameSource(registered.source, SandboxContentRules.Source(manifest)));
                TransformData pose = SandboxWorld.DefaultTransform(); pose.position.x = 1;
                pose.scale = new Float3(first.spawnScale, first.spawnScale, first.spawnScale);
                CommandResult spawned = world.Execute(new SandboxCommand { op = "spawn", assetId = first.assetId, anchorId = "floor", transform = pose });
                check("Actual loaded prefab instantiates through the ordinary executor", spawned.ok && world.TryGetObject(spawned.objectId, out GameObject placed) && placed.GetComponentsInChildren<MeshRenderer>().Length > 0);
                SceneData scene = world.Capture().scene;
                string saved = JsonUtility.ToJson(scene);
                check("Placed object retains exact provider pack version and digest", SandboxContentRules.SameSource(scene.objects.Find(item => item.objectId == spawned.objectId).source, SandboxContentRules.Source(manifest)));
                check("Undo restores the complete baseline scene", world.Execute(new SandboxCommand { op = "undo" }).ok && JsonUtility.ToJson(world.Capture().scene) == baseline);
                check("Redo restores exact downloaded object ID pose and source", world.Execute(new SandboxCommand { op = "redo" }).ok && JsonUtility.ToJson(world.Capture().scene) == saved);
                SceneData deserialized = JsonUtility.FromJson<SceneData>(saved);
                check("Clear removes all temporary instances", world.Execute(new SandboxCommand { op = "clear" }).ok && world.Capture().scene.objects.Count == 0);
                check("Serialized save clear and restore preserve the exact scene", world.Execute(new SandboxCommand { op = "load", scene = deserialized }).ok && JsonUtility.ToJson(world.Capture().scene) == saved);
                deserialized.objects.Find(item => item.objectId == spawned.objectId).source.sha256 = new string('f', 64);
                check("Conflicting saved bundle digest is rejected without changing the scene", !world.Execute(new SandboxCommand { op = "load", scene = deserialized }).ok && JsonUtility.ToJson(world.Capture().scene) == saved);
                report.status = "passed";
            }
            catch (Exception exception)
            {
                report.failed = 1;
                report.error = exception.GetType().Name + ": " + exception.Message.Replace(directory, "<content-pack-directory>").Replace(Application.dataPath, "<fixture-assets>");
                throw;
            }
            finally
            {
                world?.Dispose();
                if (root != null) Object.DestroyImmediate(root);
                if (existingPrefab != null) Object.DestroyImmediate(existingPrefab);
                if (bundle != null) bundle.Unload(true);
                report.completedUtc = DateTime.UtcNow.ToString("O");
                Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
                File.WriteAllText(outputPath, JsonUtility.ToJson(report, true));
                Debug.Log("Exported content Editor validation: " + report.passed + " passed, " + report.failed + " failed; standalone player not tested.");
            }
        }

        [MenuItem("Matrix/Content Packs/Export from JSON specification")]
        public static void ExportMenu()
        {
            string spec = EditorUtility.OpenFilePanel("Content pack export specification", "", "json");
            if (string.IsNullOrEmpty(spec)) return;
            string output = EditorUtility.OpenFolderPanel("Content pack output folder", "", "");
            if (string.IsNullOrEmpty(output)) return;
            Export(JsonUtility.FromJson<ExportSpec>(File.ReadAllText(spec)), output);
        }

        [MenuItem("Matrix/Content Packs/Create specification for selected prefabs")]
        public static void CreateSpecMenu()
        {
            var assets = new List<ContentPackAsset>();
            foreach (Object selected in Selection.objects)
            {
                string path = AssetDatabase.GetAssetPath(selected);
                if (!path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase)) continue;
                assets.Add(new ContentPackAsset { assetId = "local:my-pack:1.0.0:prop" + (assets.Count + 1),
                    prefabPath = path.ToLowerInvariant(), displayName = selected.name, description = "", spawnScale = 1 });
            }
            if (assets.Count == 0) throw new ArgumentException("Select imported prefab assets in the Project window.");
            string output = EditorUtility.SaveFilePanel("Save specification; fill in license and permission before export", "", "content-pack-spec.json", "json");
            if (string.IsNullOrEmpty(output)) return;
            File.WriteAllText(output, JsonUtility.ToJson(new ExportSpec { providerId = "local", packId = "my-pack", version = "1.0.0",
                platform = EditorUserBuildSettings.activeBuildTarget == BuildTarget.Android ? "Android" : "StandaloneWindows64",
                license = new ContentLicense { name = "REQUIRED", url = "", attribution = "" }, assets = assets.ToArray() }, true));
        }

        // Batch: -executeMethod ArSandbox.SandboxContentPackExporter.ExportFromArguments
        // -contentPackSpec <json> -contentPackOutput <directory>
        public static void ExportFromArguments()
        {
            string spec = Argument("-contentPackSpec");
            Export(JsonUtility.FromJson<ExportSpec>(File.ReadAllText(spec)), Argument("-contentPackOutput"));
        }

        public static ContentPackManifest Export(ExportSpec spec, string outputDirectory)
        {
            if (spec == null) throw new ArgumentException("Content pack export specification is required.");
            if (!spec.distributionPermissionConfirmed || spec.license == null || string.IsNullOrWhiteSpace(spec.license.name) || spec.license.name == "REQUIRED")
                throw new ArgumentException("Declare the content license and confirm permission to distribute this pack before export. Asset Store ownership does not establish permission for every distribution method.");
            var manifest = new ContentPackManifest { providerId = spec.providerId, packId = spec.packId, version = spec.version,
                platform = spec.platform, unityVersion = Application.unityVersion, assets = spec.assets,
                license = spec.license, sha256 = new string('0', 64), byteLength = 1 };
            SandboxContentRules.ValidateManifest(manifest, spec.platform, Application.unityVersion);
            BuildTarget target = spec.platform == "Android" ? BuildTarget.Android : BuildTarget.StandaloneWindows64;
            if (EditorUserBuildSettings.activeBuildTarget != target)
                throw new ArgumentException("Open/run the exporter with build target " + target + ". It will not silently switch the active project target.");
            var paths = new string[spec.assets.Length];
            for (int i = 0; i < paths.Length; i++)
            {
                string path = ResolveAssetPath(spec.assets[i].prefabPath);
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null || PrefabUtility.GetPrefabAssetType(prefab) == PrefabAssetType.NotAPrefab)
                    throw new ArgumentException("Not a prefab asset: " + path);
                SandboxContentPrefabValidator.Validate(prefab);
                ValidateDependencies(path);
                paths[i] = path;
            }
            Directory.CreateDirectory(outputDirectory);
            string filename = (spec.providerId + "-" + spec.packId + "-" + spec.version + "-" + spec.platform + ".bundle").ToLowerInvariant();
            AssetBundleManifest built = BuildPipeline.BuildAssetBundles(outputDirectory, new[] { new AssetBundleBuild
            { assetBundleName = filename, assetNames = paths } }, BuildAssetBundleOptions.ChunkBasedCompression | BuildAssetBundleOptions.StrictMode, target);
            if (built == null || built.GetAllDependencies(filename).Length != 0) throw new InvalidOperationException("Content bundle export failed or introduced external bundle dependencies.");
            string bundlePath = Path.Combine(outputDirectory, filename);
            manifest.byteLength = new FileInfo(bundlePath).Length;
            using (SHA256 hash = SHA256.Create()) using (FileStream stream = File.OpenRead(bundlePath))
                manifest.sha256 = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            SandboxContentRules.ValidateManifest(manifest, spec.platform, Application.unityVersion);
            File.WriteAllText(Path.Combine(outputDirectory, "content-pack.json"), JsonUtility.ToJson(manifest, true));
            File.WriteAllText(Path.Combine(outputDirectory, "catalog.json"), JsonUtility.ToJson(new Catalog { assets = new[] { new CatalogAsset
            {
                assetId = spec.packId, version = spec.version, title = spec.packId, targetPlatform = spec.platform,
                sha256 = manifest.sha256, byteLength = manifest.byteLength, location = filename, license = spec.license,
                metadata = new CatalogMetadata { contentPack = manifest }
            } } }, true));
            Debug.Log("Exported content pack " + spec.packId + " " + spec.version + " for " + spec.platform + "; " + manifest.byteLength + " bytes; SHA256 " + manifest.sha256);
            return manifest;
        }

        private static string ResolveAssetPath(string lowercasePath)
        {
            string guid = AssetDatabase.AssetPathToGUID(lowercasePath);
            if (string.IsNullOrEmpty(guid)) throw new ArgumentException("Imported prefab was not found: " + lowercasePath);
            return AssetDatabase.GUIDToAssetPath(guid);
        }

        private static void ValidateDependencies(string prefabPath)
        {
            foreach (string path in AssetDatabase.GetDependencies(prefabPath, true))
            {
                string extension = Path.GetExtension(path).ToLowerInvariant();
                if (extension == ".cs" || extension == ".dll" || extension == ".asmdef" || extension == ".so" || extension == ".aar" || extension == ".jar" || extension == ".compute")
                    throw new ArgumentException("Content pack has executable/script dependency " + path + ". Rebuild the player for code changes.");
                foreach (Object dependency in AssetDatabase.LoadAllAssetsAtPath(path))
                    if (dependency is MonoScript || dependency is ScriptableObject)
                        throw new ArgumentException("Content pack has an unsupported script/ScriptableObject dependency: " + path);
            }
        }

        // A procedurally authored fixture. Run AFTER building the player to prove
        // the downloaded prefab was not baked into that player's bundled registry.
        public static void ExportFixtureFromArguments()
        {
            const string folder = "Assets/MatrixContentPackFixture";
            if (!AssetDatabase.IsValidFolder(folder)) AssetDatabase.CreateFolder("Assets", "MatrixContentPackFixture");
            var shell = new Material(Shader.Find("Standard")) { color = new Color(.12f, .16f, .22f) };
            var glow = new Material(Shader.Find("Unlit/Color")) { color = new Color(.05f, .95f, 1f) };
            string shellPath = folder + "/Shell.mat", glowPath = folder + "/Glow.mat";
            if (AssetDatabase.LoadAssetAtPath<Material>(shellPath) == null) AssetDatabase.CreateAsset(shell, shellPath);
            else { Object.DestroyImmediate(shell); shell = AssetDatabase.LoadAssetAtPath<Material>(shellPath); }
            if (AssetDatabase.LoadAssetAtPath<Material>(glowPath) == null) AssetDatabase.CreateAsset(glow, glowPath);
            else { Object.DestroyImmediate(glow); glow = AssetDatabase.LoadAssetAtPath<Material>(glowPath); }
            var root = new GameObject("Downloaded Sci-fi Beacon");
            try
            {
                AddCube(root.transform, "Armored base", new Vector3(0, .06f, 0), new Vector3(.32f, .12f, .32f), shell);
                AddCube(root.transform, "Energy core", new Vector3(0, .27f, 0), new Vector3(.13f, .3f, .13f), glow);
                AddCube(root.transform, "Top cap", new Vector3(0, .46f, 0), new Vector3(.24f, .08f, .24f), shell);
                for (int i = 0; i < 4; i++)
                {
                    float angle = i * Mathf.PI / 2f;
                    AddCube(root.transform, "Support " + i, new Vector3(Mathf.Cos(angle) * .12f, .28f, Mathf.Sin(angle) * .12f), new Vector3(.045f, .36f, .045f), shell);
                }
                string prefabPath = folder + "/Beacon.prefab";
                PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
                AssetDatabase.SaveAssets();
                string platform = EditorUserBuildSettings.activeBuildTarget == BuildTarget.Android ? "Android" : "StandaloneWindows64";
                var spec = new ExportSpec { providerId = "matrix-fixture", packId = "scifi-props", version = "1.0.0", platform = platform,
                    distributionPermissionConfirmed = true, license = new ContentLicense { name = "MIT", url = "https://opensource.org/license/mit", attribution = "Matrix Operator procedurally authored fixture" },
                    assets = new[] { new ContentPackAsset { assetId = "matrix-fixture:scifi-props:1.0.0:beacon", prefabPath = prefabPath.ToLowerInvariant(),
                        displayName = "Sci-fi Beacon", description = "Dark armored static beacon with a cyan energy core and four protective struts; base pivot on its supporting surface.", spawnScale = 1f } } };
                Export(spec, Argument("-contentPackOutput"));
            }
            finally { Object.DestroyImmediate(root); }
        }

        private static void AddCube(Transform parent, string name, Vector3 position, Vector3 scale, Material material)
        {
            GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = name; cube.transform.SetParent(parent, false); cube.transform.localPosition = position;
            cube.transform.localScale = scale; cube.GetComponent<Renderer>().sharedMaterial = material;
        }

        private static string Argument(string name)
        {
            string[] arguments = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < arguments.Length; i++) if (arguments[i] == name && !string.IsNullOrWhiteSpace(arguments[i + 1])) return arguments[i + 1];
            throw new ArgumentException("Missing required batch argument " + name);
        }
    }
}
