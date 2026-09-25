using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>Turns a staged, verified Poly Haven FBX into one static Matrix prefab pack.</summary>
    public static class PolyHavenPrefabExporter
    {
        [Serializable] private sealed class SourceFile
        {
            public string filename, sha256;
            public long byteLength;
        }

        [Serializable] private sealed class SourceManifest
        {
            public int schemaVersion;
            public string providerId, assetId, title, sourceVersion, sourceUrl, category, fbx, diffuse;
            public float[] dimensions;
            public ContentLicense license;
            public SourceFile[] files;
        }

        // Batch: -executeMethod ArSandbox.PolyHavenPrefabExporter.ExportFromArguments
        // -polyHavenSource <absolute polyhaven-source.json> -contentPackOutput <directory>
        public static void ExportFromArguments()
        {
            Export(Argument("-polyHavenSource"), Argument("-contentPackOutput"));
        }

        // Batch one platform at a time. Each model produces its own immutable
        // bundle, so a failed or oversize model does not block other entries.
        // -polyHavenSourceRoot <directory> -contentPackOutputRoot <directory>
        public static void ExportAvailableBatchFromArguments()
        {
            string sourceRoot = Path.GetFullPath(Argument("-polyHavenSourceRoot"));
            string outputRoot = Path.GetFullPath(Argument("-contentPackOutputRoot"));
            if (!Directory.Exists(sourceRoot) || sourceRoot == outputRoot)
                throw new ArgumentException("Use distinct existing source and output roots for Poly Haven batch export.");
            Directory.CreateDirectory(outputRoot);
            string[] categoryRoots = new[] { "Models", "HDRIs", "Textures" }.Select(name => Path.Combine(sourceRoot, name))
                .Where(Directory.Exists).ToArray();
            if (categoryRoots.Length == 0) categoryRoots = new[] { sourceRoot };
            if (categoryRoots.Any(path => outputRoot == path || outputRoot.StartsWith(path + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)))
                throw new ArgumentException("Pack output cannot be inside a Poly Haven source category.");
            string[] manifests = categoryRoots.SelectMany(path => Directory.GetFiles(path, "polyhaven-source.json", SearchOption.AllDirectories)).ToArray();
            Array.Sort(manifests, StringComparer.OrdinalIgnoreCase);
            string platform = EditorUserBuildSettings.activeBuildTarget == BuildTarget.Android ? "Android" : "StandaloneWindows64";
            string journal = Path.Combine(outputRoot, "batch-results.jsonl");
            foreach (string manifestPath in manifests)
            {
                string assetId = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(manifestPath)));
                if (!Regex.IsMatch(assetId ?? "", "^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")) continue;
                string output = Path.Combine(outputRoot, assetId);
                string packId = "m" + HexSha256(Encoding.UTF8.GetBytes(assetId)).Substring(0, 12);
                try
                {
                    var source = JsonUtility.FromJson<SourceManifest>(File.ReadAllText(manifestPath));
                    string version = "p" + source.sourceVersion.Substring(0, 12);
                    string bundleName = ("polyhaven-" + packId + "-" + version + "-" + platform + ".bundle").ToLowerInvariant();
                    string existingManifest = Path.Combine(output, "content-pack.json");
                    if (File.Exists(existingManifest))
                    {
                        var ready = JsonUtility.FromJson<ContentPackManifest>(File.ReadAllText(existingManifest));
                        string bundlePath = Path.Combine(output, bundleName);
                        if (ready != null && ready.packId == packId && ready.version == version && ready.platform == platform &&
                            File.Exists(bundlePath) && new FileInfo(bundlePath).Length == ready.byteLength && Digest(bundlePath) == ready.sha256)
                        {
                            File.AppendAllText(journal, "{\"assetId\":\"" + assetId + "\",\"status\":\"reused\"}\n");
                            continue;
                        }
                    }
                    ContentPackManifest exported = Export(manifestPath, output);
                    File.AppendAllText(journal, "{\"assetId\":\"" + assetId + "\",\"status\":\"exported\",\"byteLength\":" + exported.byteLength + "}\n");
                }
                catch (Exception exception)
                {
                    File.AppendAllText(journal, "{\"assetId\":\"" + assetId + "\",\"status\":\"failed\",\"error\":" +
                        JsonUtility.ToJson(new BatchError { message = exception.GetType().Name + ": " + exception.Message }).Replace("{\"message\":", "") .TrimEnd('}') + "}\n");
                    Debug.LogWarning("Poly Haven batch skipped " + assetId + ": " + exception.Message);
                }
                finally
                {
                    if (AssetDatabase.IsValidFolder("Assets/MatrixPolyHaven/" + packId))
                        AssetDatabase.DeleteAsset("Assets/MatrixPolyHaven/" + packId);
                    EditorUtility.UnloadUnusedAssetsImmediate();
                }
            }
            Debug.Log("Poly Haven batch complete: " + manifests.Length + " staged assets inspected; see " + journal);
        }

        [Serializable] private sealed class BatchError { public string message; }

        public static ContentPackManifest Export(string sourceManifestPath, string outputDirectory)
        {
            string sourcePath = Path.GetFullPath(sourceManifestPath);
            var source = JsonUtility.FromJson<SourceManifest>(File.ReadAllText(sourcePath));
            if (source == null || source.schemaVersion != 1 || source.providerId != "polyhaven" ||
                !Regex.IsMatch(source.assetId ?? "", "^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$") ||
                !Regex.IsMatch(source.sourceVersion ?? "", "^[a-f0-9]{40}$") ||
                source.license == null || source.license.name != "CC0" ||
                source.license.url != "https://polyhaven.com/license" ||
                source.sourceUrl != "https://polyhaven.com/a/" + Uri.EscapeDataString(source.assetId) ||
                source.files == null || source.files.Length < 1 || source.files.Length > 33 ||
                string.IsNullOrWhiteSpace(source.title) || source.title.Length > 100)
                throw new ArgumentException("Invalid staged Poly Haven source manifest.");
            string sourceDirectory = Path.GetDirectoryName(sourcePath);
            foreach (SourceFile item in source.files)
            {
                if (item == null || !Regex.IsMatch(item.filename ?? "", "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$") ||
                    !Regex.IsMatch(item.sha256 ?? "", "^[a-f0-9]{64}$") || item.byteLength < 1 || item.byteLength > 768L * 1024 * 1024)
                    throw new ArgumentException("Invalid staged Poly Haven file entry.");
                string path = Path.Combine(sourceDirectory, item.filename);
                if (!File.Exists(path) || new FileInfo(path).Length != item.byteLength || Digest(path) != item.sha256)
                    throw new ArgumentException("Staged Poly Haven file changed: " + item.filename);
            }
            if (source.category == "HDRIs" || source.category == "Textures")
                return ExportVisual(source, sourceDirectory, outputDirectory);
            if (!source.files.Any(item => item.filename == source.fbx && Path.GetExtension(item.filename).Equals(".fbx", StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(source.diffuse) && !source.files.Any(item => item.filename == source.diffuse &&
                    (item.filename.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || item.filename.EndsWith(".png", StringComparison.OrdinalIgnoreCase)))))
                throw new ArgumentException("The staged source has no valid FBX or diffuse texture.");

            string packId = "m" + HexSha256(Encoding.UTF8.GetBytes(source.assetId)).Substring(0, 12);
            string version = "p" + source.sourceVersion.Substring(0, 12);
            string folder = "Assets/MatrixPolyHaven/" + packId + "/" + version;
            if (AssetDatabase.IsValidFolder("Assets/MatrixPolyHaven/" + packId))
                AssetDatabase.DeleteAsset("Assets/MatrixPolyHaven/" + packId);
            EnsureFolder("Assets/MatrixPolyHaven"); EnsureFolder("Assets/MatrixPolyHaven/" + packId); EnsureFolder(folder);
            foreach (SourceFile item in source.files)
            {
                string path = folder + "/" + item.filename;
                File.Copy(Path.Combine(sourceDirectory, item.filename), Path.GetFullPath(path), true);
            }
            // Import the FBX and its image dependencies once. Importing each
            // image separately can reparse a large FBX dozens of times.
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            string modelPath = folder + "/" + source.fbx;
            GameObject model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (model == null) throw new ArgumentException("Unity could not import the staged FBX model.");
            if (model.GetComponentsInChildren<MeshFilter>(true).Any(filter => filter.sharedMesh != null && !filter.sharedMesh.isReadable) ||
                model.GetComponentsInChildren<SkinnedMeshRenderer>(true).Any(renderer => renderer.sharedMesh != null && !renderer.sharedMesh.isReadable))
            {
                ModelImporter importer = AssetImporter.GetAtPath(modelPath) as ModelImporter;
                if (importer == null) throw new ArgumentException("Unity did not create an FBX model importer.");
                importer.isReadable = true;
                importer.SaveAndReimport();
                model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
                if (model == null) throw new ArgumentException("Unity could not reimport the readable FBX model.");
            }
            Shader shader = Shader.Find("Standard");
            if (shader == null) throw new InvalidOperationException("Built-in Standard shader is unavailable.");
            var materials = new Dictionary<string, Material>();
            foreach (SourceFile item in source.files.Where(file => Regex.IsMatch(file.filename,
                "(?:diff|diffuse|basecolor|albedo).*(?:\\.jpg|\\.png)$", RegexOptions.IgnoreCase)))
            {
                Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(folder + "/" + item.filename);
                if (texture == null) throw new ArgumentException("Unity could not import a staged diffuse texture.");
                var mapped = new Material(shader) { mainTexture = texture };
                string materialPath = folder + "/mat-" + HexSha256(Encoding.UTF8.GetBytes(item.filename)).Substring(0, 12) + ".mat";
                if (AssetDatabase.LoadAssetAtPath<Material>(materialPath) != null) AssetDatabase.DeleteAsset(materialPath);
                AssetDatabase.CreateAsset(mapped, materialPath);
                string stem = Regex.Replace(Path.GetFileNameWithoutExtension(item.filename),
                    "_(?:diff|diffuse|basecolor|albedo)_?(?:1k|2k)?$", "", RegexOptions.IgnoreCase);
                materials[NormalizeMaterialName(stem)] = mapped;
            }
            Material fallback = materials.Values.FirstOrDefault();
            if (fallback == null)
            {
                fallback = new Material(shader);
                AssetDatabase.CreateAsset(fallback, folder + "/matrix-standard.mat");
            }
            var root = new GameObject(source.title.Length > 0 ? source.title : source.assetId);
            try
            {
                GameObject instance = PrefabUtility.InstantiatePrefab(model) as GameObject;
                if (instance == null) throw new ArgumentException("Unity could not instantiate the staged FBX.");
                instance.transform.SetParent(root.transform, false);
                PrefabUtility.UnpackPrefabInstance(instance, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                FlattenImportedLods(root);
                ConvertSkinnedMeshesToStatic(root, folder);
                SimplifyOversizedMeshes(root, folder);
                TrimImportedRenderers(root);
                CollapseEmptyTransforms(root, instance.transform);
                SplitImportedUnitScales(root);
                RemoveSpatialOutliers(root);
                MeshRenderer[] renderers = root.GetComponentsInChildren<MeshRenderer>(true);
                if (renderers.Length == 0) throw new ArgumentException("The model has no static mesh renderers.");
                foreach (MeshRenderer renderer in renderers)
                {
                    Material[] assigned = renderer.sharedMaterials;
                    for (int i = 0; i < assigned.Length; i++)
                    {
                        string name = NormalizeMaterialName(assigned[i] == null ? "" : assigned[i].name);
                        string match = materials.Keys.FirstOrDefault(key => key.Length >= 4 && (name.Contains(key) || key.Contains(name) && name.Length >= 4));
                        assigned[i] = match == null ? fallback : materials[match];
                    }
                    renderer.sharedMaterials = assigned;
                }
                Bounds bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
                float expectedMetres = source.dimensions != null && source.dimensions.Length == 3 &&
                    source.dimensions.All(value => SandboxContentRules.Finite(value) && value > 0 && value <= 200000)
                    ? source.dimensions.Max() / 1000f : 0f;
                float measuredMetres = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
                bool unusualCoordinates = Mathf.Abs(bounds.min.y) > 90 || bounds.center.magnitude > 90 || bounds.size.magnitude > 90 ||
                    expectedMetres > 0 && (measuredMetres > expectedMetres * 2.5f || measuredMetres < expectedMetres / 5f) ||
                    root.GetComponentsInChildren<Transform>(true).Any(transform => transform.localPosition.magnitude > 90 ||
                        transform.localScale.magnitude > 90 || Mathf.Abs(transform.localScale.x) < .00001f ||
                        Mathf.Abs(transform.localScale.y) < .00001f || Mathf.Abs(transform.localScale.z) < .00001f);
                if (unusualCoordinates)
                {
                    BakeStaticHierarchy(root, instance, renderers, folder, bounds, expectedMetres);
                    renderers = root.GetComponentsInChildren<MeshRenderer>(true);
                    bounds = renderers[0].bounds;
                    for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
                }
                else
                {
                    instance.transform.localPosition -= new Vector3(0, bounds.min.y, 0);
                    bounds.center -= new Vector3(0, bounds.min.y, 0);
                }
                BoxCollider collider = root.AddComponent<BoxCollider>();
                collider.center = bounds.center;
                collider.size = new Vector3(Mathf.Max(.01f, bounds.size.x), Mathf.Max(.01f, bounds.size.y), Mathf.Max(.01f, bounds.size.z));
                foreach (Transform transform in root.GetComponentsInChildren<Transform>(true))
                    if (transform.localPosition.magnitude > 100 || transform.localScale.magnitude > 100 ||
                        Mathf.Abs(transform.localScale.x) < .00001f || Mathf.Abs(transform.localScale.y) < .00001f || Mathf.Abs(transform.localScale.z) < .00001f)
                        Debug.LogWarning("Poly Haven transform outside static prefab limits: " + transform.name +
                            " position=" + transform.localPosition + " scale=" + transform.localScale);
                Debug.Log("Poly Haven prefab metrics " + source.assetId + ": transforms=" + root.GetComponentsInChildren<Transform>(true).Length +
                    " renderers=" + root.GetComponentsInChildren<MeshRenderer>(true).Length +
                    " vertices=" + root.GetComponentsInChildren<MeshFilter>(true).Where(filter => filter.sharedMesh != null)
                        .Select(filter => filter.sharedMesh).Distinct().Sum(mesh => mesh.vertexCount) +
                    " materials=" + root.GetComponentsInChildren<MeshRenderer>(true).SelectMany(renderer => renderer.sharedMaterials).Distinct().Count());
                SandboxContentPrefabValidator.Validate(root);
                string prefabPath = folder + "/model.prefab";
                if (PrefabUtility.SaveAsPrefabAsset(root, prefabPath) == null)
                    throw new InvalidOperationException("Unity could not save the Poly Haven prefab.");
                AssetDatabase.SaveAssets();
                string platform = EditorUserBuildSettings.activeBuildTarget == BuildTarget.Android ? "Android" : "StandaloneWindows64";
                var spec = new SandboxContentPackExporter.ExportSpec
                {
                    providerId = "polyhaven", packId = packId, version = version, platform = platform,
                    license = new ContentLicense { name = "CC0", url = "https://polyhaven.com/license", attribution = "" },
                    distributionPermissionConfirmed = true,
                    assets = new[] { new ContentPackAsset
                    {
                        assetId = "polyhaven:" + packId + ":" + version + ":model",
                        prefabPath = prefabPath.ToLowerInvariant(), displayName = root.name,
                        description = "Poly Haven model " + source.assetId + " · " + source.sourceUrl,
                        spawnScale = 1f
                    } }
                };
                return SandboxContentPackExporter.Export(spec, outputDirectory);
            }
            finally { Object.DestroyImmediate(root); }
        }

        private static ContentPackManifest ExportVisual(SourceManifest source, string sourceDirectory, string outputDirectory)
        {
            bool hdri = source.category == "HDRIs";
            SourceFile visual = source.files.FirstOrDefault(item => hdri
                ? item.filename.EndsWith(".hdr", StringComparison.OrdinalIgnoreCase)
                : Regex.IsMatch(item.filename, "(?:diff|diffuse).*(?:\\.jpg|\\.png)$", RegexOptions.IgnoreCase));
            if (visual == null && !hdri)
                visual = source.files.FirstOrDefault(item => item.filename.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) ||
                    item.filename.EndsWith(".png", StringComparison.OrdinalIgnoreCase));
            if (visual == null) throw new ArgumentException("Staged visual asset lacks a supported panorama or diffuse image.");
            string packId = "m" + HexSha256(Encoding.UTF8.GetBytes(source.assetId)).Substring(0, 12);
            string version = "p" + source.sourceVersion.Substring(0, 12);
            string folder = "Assets/MatrixPolyHaven/" + packId + "/" + version;
            if (AssetDatabase.IsValidFolder("Assets/MatrixPolyHaven/" + packId))
                AssetDatabase.DeleteAsset("Assets/MatrixPolyHaven/" + packId);
            EnsureFolder("Assets/MatrixPolyHaven"); EnsureFolder("Assets/MatrixPolyHaven/" + packId); EnsureFolder(folder);
            string imagePath = folder + "/" + visual.filename;
            File.Copy(Path.Combine(sourceDirectory, visual.filename), Path.GetFullPath(imagePath), true);
            AssetDatabase.ImportAsset(imagePath, ImportAssetOptions.ForceSynchronousImport);
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(imagePath);
            if (texture == null) throw new ArgumentException("Unity could not import the staged Poly Haven image.");
            Shader shader = Shader.Find(hdri ? "Unlit/Texture" : "Standard");
            if (shader == null) throw new InvalidOperationException("Built-in visual shader is unavailable.");
            var material = new Material(shader) { mainTexture = texture };
            string materialPath = folder + "/matrix-visual.mat";
            if (AssetDatabase.LoadAssetAtPath<Material>(materialPath) != null) AssetDatabase.DeleteAsset(materialPath);
            AssetDatabase.CreateAsset(material, materialPath);
            var root = new GameObject((hdri ? "Panorama: " : "Material: ") + source.title);
            try
            {
                GameObject visualObject = GameObject.CreatePrimitive(hdri ? PrimitiveType.Sphere : PrimitiveType.Cube);
                visualObject.name = hdri ? "Inward panorama dome" : "Material sample tile";
                visualObject.transform.SetParent(root.transform, false);
                if (hdri)
                {
                    Object.DestroyImmediate(visualObject.GetComponent<Collider>());
                    Mesh original = visualObject.GetComponent<MeshFilter>().sharedMesh;
                    Mesh inward = Object.Instantiate(original);
                    inward.name = "Inward panorama mesh";
                    int[] triangles = inward.triangles;
                    for (int i = 0; i < triangles.Length; i += 3)
                    {
                        int first = triangles[i]; triangles[i] = triangles[i + 2]; triangles[i + 2] = first;
                    }
                    Vector3[] normals = inward.normals;
                    for (int i = 0; i < normals.Length; i++) normals[i] = -normals[i];
                    inward.normals = normals; inward.triangles = triangles;
                    AssetDatabase.CreateAsset(inward, folder + "/inward-panorama.asset");
                    visualObject.GetComponent<MeshFilter>().sharedMesh = inward;
                    visualObject.transform.localScale = Vector3.one * 40f;
                }
                else visualObject.transform.localScale = new Vector3(1f, 1f, .02f);
                visualObject.GetComponent<MeshRenderer>().sharedMaterial = material;
                SandboxContentPrefabValidator.Validate(root);
                string prefabPath = folder + "/visual.prefab";
                if (PrefabUtility.SaveAsPrefabAsset(root, prefabPath) == null)
                    throw new InvalidOperationException("Unity could not save the visual prefab.");
                AssetDatabase.SaveAssets();
                string platform = EditorUserBuildSettings.activeBuildTarget == BuildTarget.Android ? "Android" : "StandaloneWindows64";
                var spec = new SandboxContentPackExporter.ExportSpec
                {
                    providerId = "polyhaven", packId = packId, version = version, platform = platform,
                    license = new ContentLicense { name = "CC0", url = "https://polyhaven.com/license", attribution = "" },
                    distributionPermissionConfirmed = true,
                    assets = new[] { new ContentPackAsset
                    {
                        assetId = "polyhaven:" + packId + ":" + version + (hdri ? ":panorama" : ":material"),
                        prefabPath = prefabPath.ToLowerInvariant(), displayName = root.name,
                        description = (hdri ? "Panorama dome from " : "Material sample from ") + source.sourceUrl,
                        spawnScale = 1f
                    } }
                };
                return SandboxContentPackExporter.Export(spec, outputDirectory);
            }
            finally { Object.DestroyImmediate(root); }
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int separator = path.LastIndexOf('/');
            AssetDatabase.CreateFolder(path.Substring(0, separator), path.Substring(separator + 1));
        }

        private static string Digest(string path)
        {
            using (var sha = SHA256.Create()) using (var stream = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }

        private static string HexSha256(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        private static string NormalizeMaterialName(string value) => Regex.Replace((value ?? "").ToLowerInvariant(), "[^a-z0-9]", "");

        // A static bundle cannot carry Unity's LODGroup component. Keep the
        // lightest authored visible mesh set for Quest instead of rendering
        // every LOD level at once.
        private static void FlattenImportedLods(GameObject root)
        {
            foreach (LODGroup group in root.GetComponentsInChildren<LODGroup>(true))
            {
                LOD[] levels = group.GetLODs();
                Renderer[] chosen = levels.Reverse().Select(level => level.renderers).FirstOrDefault(renderers => renderers != null && renderers.Length > 0);
                if (chosen == null) throw new ArgumentException("Imported LODGroup has no renderable level.");
                var keep = new HashSet<Renderer>(chosen);
                foreach (Renderer renderer in levels.SelectMany(level => level.renderers ?? Array.Empty<Renderer>()).Distinct())
                {
                    if (renderer == null || keep.Contains(renderer)) continue;
                    MeshFilter filter = renderer.GetComponent<MeshFilter>();
                    if (filter != null) Object.DestroyImmediate(filter);
                    Object.DestroyImmediate(renderer);
                }
                Object.DestroyImmediate(group);
            }
        }

        private static void TrimImportedRenderers(GameObject root)
        {
            MeshRenderer[] all = root.GetComponentsInChildren<MeshRenderer>(true);
            int vertices = root.GetComponentsInChildren<MeshFilter>(true).Where(filter => filter.sharedMesh != null)
                .Select(filter => filter.sharedMesh).Distinct().Sum(mesh => mesh.vertexCount);
            if (all.Length <= 64 && vertices <= 200000) return;
            var keep = new HashSet<MeshRenderer>();
            var meshes = new HashSet<Mesh>();
            int keptVertices = 0;
            foreach (MeshRenderer renderer in all.OrderByDescending(item => item.enabled).ThenByDescending(item => item.bounds.size.sqrMagnitude))
            {
                Mesh mesh = renderer.GetComponent<MeshFilter>()?.sharedMesh;
                int extra = mesh != null && !meshes.Contains(mesh) ? mesh.vertexCount : 0;
                if (mesh == null || keep.Count >= 64 || keptVertices + extra > 195000) continue;
                keep.Add(renderer); meshes.Add(mesh); keptVertices += extra;
            }
            if (keep.Count == 0) throw new ArgumentException("No Quest-sized static mesh subset fits the content prefab limits.");
            foreach (MeshRenderer renderer in all)
            {
                if (keep.Contains(renderer)) continue;
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                if (filter != null) Object.DestroyImmediate(filter);
                Object.DestroyImmediate(renderer);
            }
            Debug.Log("Trimmed Poly Haven model to " + keep.Count + " static renderers and " + keptVertices + " unique vertices.");
        }

        // Some FBX props use a SkinnedMeshRenderer even though Matrix only
        // supports static geometry. Capture the imported rest pose as a mesh.
        private static void ConvertSkinnedMeshesToStatic(GameObject root, string folder)
        {
            int index = 0;
            foreach (SkinnedMeshRenderer skinned in root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (skinned.sharedMesh == null) { Object.DestroyImmediate(skinned); continue; }
                var baked = new Mesh { name = "Static imported mesh " + index };
                skinned.BakeMesh(baked);
                if (baked.vertexCount == 0) { Object.DestroyImmediate(baked); Object.DestroyImmediate(skinned); continue; }
                string meshPath = folder + "/static-mesh-" + index++ + ".asset";
                AssetDatabase.CreateAsset(baked, meshPath);
                MeshFilter filter = skinned.gameObject.AddComponent<MeshFilter>();
                filter.sharedMesh = baked;
                MeshRenderer renderer = skinned.gameObject.AddComponent<MeshRenderer>();
                renderer.sharedMaterials = skinned.sharedMaterials;
                renderer.enabled = skinned.enabled;
                Object.DestroyImmediate(skinned);
            }
            foreach (Animator animator in root.GetComponentsInChildren<Animator>(true)) Object.DestroyImmediate(animator);
            foreach (Animation animation in root.GetComponentsInChildren<Animation>(true)) Object.DestroyImmediate(animation);
        }

        private static void SimplifyOversizedMeshes(GameObject root, string folder)
        {
            var replacements = new Dictionary<Mesh, Mesh>();
            int index = 0;
            foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
            {
                Mesh original = filter.sharedMesh;
                if (original == null || original.vertexCount <= 190000) continue;
                if (!replacements.TryGetValue(original, out Mesh compact))
                {
                    var sourceVertices = original.vertices;
                    var sourceUv = original.uv;
                    Bounds bounds = original.bounds;
                    int[] remap = null;
                    List<Vector3> sums = null;
                    List<int> weights = null;
                    List<Vector2> uvs = null;
                    int grid = 0;
                    foreach (int cells in new[] { 128, 112, 96, 80, 64, 48, 32 })
                    {
                        var clusters = new Dictionary<long, int>();
                        var candidates = new int[sourceVertices.Length];
                        var positions = new List<Vector3>();
                        var counts = new List<int>();
                        var textureCoordinates = new List<Vector2>();
                        Vector3 minimum = bounds.min, size = bounds.size;
                        for (int vertex = 0; vertex < sourceVertices.Length; vertex++)
                        {
                            Vector3 point = sourceVertices[vertex];
                            int x = Mathf.Clamp(Mathf.FloorToInt((point.x - minimum.x) / Mathf.Max(size.x, .000001f) * cells), 0, cells - 1);
                            int y = Mathf.Clamp(Mathf.FloorToInt((point.y - minimum.y) / Mathf.Max(size.y, .000001f) * cells), 0, cells - 1);
                            int z = Mathf.Clamp(Mathf.FloorToInt((point.z - minimum.z) / Mathf.Max(size.z, .000001f) * cells), 0, cells - 1);
                            long key = ((long)x * cells + y) * cells + z;
                            if (!clusters.TryGetValue(key, out int replacement))
                            {
                                replacement = clusters.Count;
                                clusters.Add(key, replacement);
                                positions.Add(point); counts.Add(1);
                                textureCoordinates.Add(sourceUv.Length == sourceVertices.Length ? sourceUv[vertex] : Vector2.zero);
                            }
                            else { positions[replacement] += point; counts[replacement]++; }
                            candidates[vertex] = replacement;
                            if (clusters.Count > 190000) break;
                        }
                        if (clusters.Count > 190000) continue;
                        remap = candidates; sums = positions; weights = counts; uvs = textureCoordinates; grid = cells;
                        break;
                    }
                    if (remap == null || sums.Count == 0)
                        throw new ArgumentException("Model could not be reduced to the Quest static mesh budget.");
                    var selected = new List<int>[original.subMeshCount];
                    var seen = new HashSet<long>[original.subMeshCount];
                    for (int submesh = 0; submesh < selected.Length; submesh++)
                    { selected[submesh] = new List<int>(); seen[submesh] = new HashSet<long>(); }
                    const int maxTriangles = 250000;
                    int accepted = 0;
                    var random = new System.Random(17);
                    var reservoir = new List<TriangleSample>(maxTriangles);
                    long baseValue = sums.Count;
                    for (int submesh = 0; submesh < selected.Length; submesh++)
                    {
                        int[] part = original.GetTriangles(submesh);
                        for (int offset = 0; offset + 2 < part.Length; offset += 3)
                        {
                            int a = remap[part[offset]], b = remap[part[offset + 1]], c = remap[part[offset + 2]];
                            if (a == b || b == c || a == c) continue;
                            int lo = Math.Min(a, Math.Min(b, c)), hi = Math.Max(a, Math.Max(b, c));
                            int middle = a + b + c - lo - hi;
                            long key = ((long)lo * baseValue + middle) * baseValue + hi;
                            if (!seen[submesh].Add(key)) continue;
                            accepted++;
                            var sample = new TriangleSample { submesh = submesh, a = a, b = b, c = c };
                            if (reservoir.Count < maxTriangles) reservoir.Add(sample);
                            else
                            {
                                int replacement = random.Next(accepted);
                                if (replacement < maxTriangles) reservoir[replacement] = sample;
                            }
                        }
                    }
                    if (reservoir.Count == 0)
                        throw new ArgumentException("Model has no triangles after Quest mesh reduction.");
                    foreach (TriangleSample triangle in reservoir)
                    {
                        selected[triangle.submesh].Add(triangle.a);
                        selected[triangle.submesh].Add(triangle.b);
                        selected[triangle.submesh].Add(triangle.c);
                    }
                    compact = new Mesh { name = "Quest static mesh " + index,
                        indexFormat = sums.Count > 65535 ? UnityEngine.Rendering.IndexFormat.UInt32 : UnityEngine.Rendering.IndexFormat.UInt16 };
                    compact.vertices = sums.Select((point, i) => point / weights[i]).ToArray();
                    if (sourceUv.Length == sourceVertices.Length) compact.uv = uvs.ToArray();
                    compact.subMeshCount = selected.Length;
                    for (int submesh = 0; submesh < selected.Length; submesh++) compact.SetTriangles(selected[submesh], submesh);
                    compact.RecalculateNormals();
                    compact.RecalculateBounds();
                    AssetDatabase.CreateAsset(compact, folder + "/quest-mesh-" + index++ + ".asset");
                    replacements.Add(original, compact);
                    Debug.Log("Reduced Poly Haven mesh from " + original.vertexCount + " to " + compact.vertexCount +
                        " vertices on a " + grid + " cell grid with " + reservoir.Count + " triangles.");
                }
                filter.sharedMesh = compact;
            }
        }

        private struct TriangleSample { public int submesh, a, b, c; }

        private static void RemoveSpatialOutliers(GameObject root)
        {
            MeshRenderer[] renderers = root.GetComponentsInChildren<MeshRenderer>(true);
            if (renderers.Length < 3) return;
            float Median(IEnumerable<float> values)
            {
                float[] sorted = values.OrderBy(value => value).ToArray();
                return sorted[sorted.Length / 2];
            }
            Vector3 center = new Vector3(Median(renderers.Select(renderer => renderer.bounds.center.x)),
                Median(renderers.Select(renderer => renderer.bounds.center.y)),
                Median(renderers.Select(renderer => renderer.bounds.center.z)));
            float spread = Median(renderers.Select(renderer => Vector3.Distance(renderer.bounds.center, center)));
            float cutoff = Mathf.Max(20f, spread * 20f);
            if (spread > 1000f)
            {
                MeshRenderer nearest = renderers.OrderBy(renderer => renderer.bounds.center.magnitude).First();
                if (nearest.bounds.center.magnitude < spread * .1f)
                {
                    center = nearest.bounds.center;
                    cutoff = Mathf.Max(100f, nearest.bounds.size.magnitude * 10f);
                }
            }
            int removed = 0;
            foreach (MeshRenderer renderer in renderers)
            {
                float distance = Vector3.Distance(renderer.bounds.center, center);
                if (distance <= cutoff || renderer.bounds.size.magnitude >= distance * .5f) continue;
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                if (filter != null) Object.DestroyImmediate(filter);
                Object.DestroyImmediate(renderer);
                removed++;
            }
            if (removed > 0) Debug.Log("Removed " + removed + " remote imported mesh parts outside the model's main cluster.");
        }

        private static void BakeStaticHierarchy(GameObject root, GameObject imported, MeshRenderer[] renderers, string folder,
            Bounds sourceBounds, float expectedMetres)
        {
            Vector3 origin = new Vector3(sourceBounds.center.x, sourceBounds.min.y, sourceBounds.center.z);
            float largest = Mathf.Max(sourceBounds.size.x, sourceBounds.size.y, sourceBounds.size.z);
            float target = expectedMetres > 0 ? Mathf.Clamp(expectedMetres, .05f, 80f) : Mathf.Min(largest, 20f);
            float sizeFactor = target / Mathf.Max(largest, .000001f);
            for (int index = 0; index < renderers.Length; index++)
            {
                MeshRenderer renderer = renderers[index];
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null) continue;
                Mesh baked = Object.Instantiate(filter.sharedMesh);
                baked.name = "Rebased static mesh " + index;
                Matrix4x4 matrix = renderer.transform.localToWorldMatrix;
                Vector3[] vertices = baked.vertices;
                for (int vertex = 0; vertex < vertices.Length; vertex++)
                    vertices[vertex] = (matrix.MultiplyPoint3x4(vertices[vertex]) - origin) * sizeFactor;
                baked.vertices = vertices;
                Vector3[] normals = baked.normals;
                if (normals.Length == vertices.Length)
                {
                    Matrix4x4 normalMatrix = matrix.inverse.transpose;
                    for (int vertex = 0; vertex < normals.Length; vertex++)
                        normals[vertex] = normalMatrix.MultiplyVector(normals[vertex]).normalized;
                    baked.normals = normals;
                }
                if (matrix.determinant < 0)
                    for (int submesh = 0; submesh < baked.subMeshCount; submesh++)
                    {
                        int[] triangles = baked.GetTriangles(submesh);
                        for (int triangle = 0; triangle < triangles.Length; triangle += 3)
                        { int first = triangles[triangle]; triangles[triangle] = triangles[triangle + 2]; triangles[triangle + 2] = first; }
                        baked.SetTriangles(triangles, submesh);
                    }
                baked.RecalculateBounds();
                AssetDatabase.CreateAsset(baked, folder + "/rebased-" + index + ".asset");
                var part = new GameObject("Static part " + index);
                part.transform.SetParent(root.transform, false);
                part.AddComponent<MeshFilter>().sharedMesh = baked;
                part.AddComponent<MeshRenderer>().sharedMaterials = renderer.sharedMaterials;
            }
            Object.DestroyImmediate(imported);
            Debug.Log("Rebased imported Poly Haven hierarchy into " + renderers.Length + " static meshes at size factor " + sizeFactor + ".");
        }

        private static void CollapseEmptyTransforms(GameObject root, Transform importedRoot)
        {
            Transform[] hierarchy = root.GetComponentsInChildren<Transform>(true);
            for (int i = hierarchy.Length - 1; i >= 0; i--)
            {
                Transform node = hierarchy[i];
                if (node == null || node == root.transform || node == importedRoot || node.GetComponents<Component>().Length != 1) continue;
                Transform parent = node.parent;
                while (node.childCount > 0) node.GetChild(0).SetParent(parent, true);
                Object.DestroyImmediate(node.gameObject);
            }
        }

        // Preserve imported world geometry while keeping each transform inside
        // the runtime's finite local-scale bound (FBX often imports at 100x).
        private static void SplitImportedUnitScales(GameObject root)
        {
            foreach (Transform transform in root.GetComponentsInChildren<Transform>(true))
            {
                if (transform == root.transform || transform.localScale.magnitude <= 99f) continue;
                Vector3 originalScale = transform.localScale, originalPosition = transform.localPosition;
                Quaternion originalRotation = transform.localRotation;
                float factor = originalScale.magnitude / 80f;
                if (factor * Mathf.Sqrt(3f) > 99f || !SandboxContentRules.Finite(factor))
                    throw new ArgumentException("Imported FBX uses a scale outside the supported prefab range.");
                var bridge = new GameObject("FBX unit scale");
                bridge.transform.SetParent(transform.parent, false);
                bridge.transform.localPosition = originalPosition;
                bridge.transform.localRotation = originalRotation;
                bridge.transform.localScale = Vector3.one * factor;
                transform.SetParent(bridge.transform, false);
                transform.localPosition = Vector3.zero;
                transform.localRotation = Quaternion.identity;
                transform.localScale = originalScale / factor;
            }
        }

        private static string Argument(string name)
        {
            string[] arguments = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < arguments.Length; i++) if (arguments[i] == name && !string.IsNullOrWhiteSpace(arguments[i + 1])) return arguments[i + 1];
            throw new ArgumentException("Missing required batch argument " + name);
        }
    }
}
