using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEngine;

namespace ArSandbox
{
    [Serializable]
    public sealed class ContentSourceReference
    {
        public string providerId, packId, version, sha256, platform, unityVersion;
    }

    [Serializable]
    public sealed class ContentPackAsset
    {
        public string assetId, prefabPath, displayName, description;
        public float spawnScale = 1f;
    }

    [Serializable]
    public sealed class ContentLicense
    {
        public string name, url, attribution;
    }

    [Serializable]
    public sealed class ContentPackManifest
    {
        public int schemaVersion = 1;
        public string packId, providerId, version, platform, unityVersion, sha256;
        public long byteLength;
        public ContentLicense license;
        public string[] dependencies = Array.Empty<string>();
        public ContentPackAsset[] assets;
    }

    [Serializable]
    public sealed class ContentInstallRequest
    {
        public string requestId;
        public ContentPackManifest manifest;
    }

    [Serializable]
    public sealed class ContentInstallReceipt
    {
        public string requestId, packId, version, sha256;
        public bool ok, alreadyInstalled;
        public string error;
        public string[] assetIds;
    }

    /// <summary>Portable contract shared by the exporter and the runtime loader.</summary>
    public static class SandboxContentRules
    {
        public const long MaximumBundleBytes = 128L * 1024 * 1024;
        public const int MaximumPackAssets = 32;
        public const int MaximumRegisteredAssets = 512;
        private static readonly Regex Part = new Regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$");
        private static readonly Regex Digest = new Regex("^[a-f0-9]{64}$");

        public static string RuntimePlatformName => Application.platform == RuntimePlatform.Android ? "Android" :
            (Application.platform == RuntimePlatform.WindowsPlayer || Application.platform == RuntimePlatform.WindowsEditor ? "StandaloneWindows64" : "unsupported");

        public static void ValidateManifest(ContentPackManifest manifest, string platform, string unityVersion)
        {
            if (manifest == null || manifest.schemaVersion != 1) throw new ArgumentException("Content pack schemaVersion must be 1.");
            ValidatePart(manifest.providerId, "providerId");
            ValidatePart(manifest.packId, "packId");
            ValidatePart(manifest.version, "version");
            if (manifest.platform != "Android" && manifest.platform != "StandaloneWindows64")
                throw new ArgumentException("Content pack platform must be Android or StandaloneWindows64.");
            if (manifest.platform != platform) throw new ArgumentException("Content pack targets " + manifest.platform + "; this runtime requires " + platform + ".");
            if (manifest.unityVersion != unityVersion) throw new ArgumentException("Content pack Unity version must match the player exactly: " + unityVersion + ".");
            if (manifest.sha256 == null || !Digest.IsMatch(manifest.sha256)) throw new ArgumentException("Content pack sha256 must be a lowercase SHA-256 digest.");
            if (manifest.byteLength < 1 || manifest.byteLength > MaximumBundleBytes) throw new ArgumentException("Content packs must be between 1 byte and 128 MiB.");
            if (manifest.dependencies != null && manifest.dependencies.Length != 0)
                throw new ArgumentException("This runtime requires self-contained packs; external bundle dependencies are unsupported.");
            if (manifest.assets == null || manifest.assets.Length < 1 || manifest.assets.Length > MaximumPackAssets)
                throw new ArgumentException("Content packs require 1 to 32 prefab entries.");
            string prefix = Prefix(manifest.providerId, manifest.packId, manifest.version);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var paths = new HashSet<string>(StringComparer.Ordinal);
            foreach (ContentPackAsset asset in manifest.assets)
            {
                if (asset == null || asset.assetId == null || !asset.assetId.StartsWith(prefix, StringComparison.Ordinal) || asset.assetId.Length > 128)
                    throw new ArgumentException("Content asset IDs must be providerId:packId:version:localId and at most 128 characters.");
                ValidatePart(asset.assetId.Substring(prefix.Length), "asset localId");
                if (!ids.Add(asset.assetId)) throw new ArgumentException("Duplicate content assetId: " + asset.assetId);
                if (asset.prefabPath == null || asset.prefabPath.Length > 256 || !asset.prefabPath.StartsWith("assets/", StringComparison.Ordinal) ||
                    !asset.prefabPath.EndsWith(".prefab", StringComparison.Ordinal) || asset.prefabPath.Contains("..") || asset.prefabPath.Contains("\\") ||
                    asset.prefabPath != asset.prefabPath.ToLowerInvariant() || !paths.Add(asset.prefabPath))
                    throw new ArgumentException("Content prefab paths must be unique lowercase assets/... .prefab paths without traversal.");
                if (string.IsNullOrWhiteSpace(asset.displayName) || asset.displayName.Length > 100 || (asset.description?.Length ?? 0) > 500)
                    throw new ArgumentException("Content displayName requires 1 to 100 characters; description is limited to 500.");
                if (!Finite(asset.spawnScale) || asset.spawnScale < SandboxWorld.MinimumScale || asset.spawnScale > SandboxWorld.MaximumScale)
                    throw new ArgumentException("Content spawnScale must be finite and between 0.01 and 20.");
            }
        }

        public static string Prefix(string provider, string pack, string version) => provider + ":" + pack + ":" + version + ":";
        public static void ValidatePart(string value, string name)
        {
            if (value == null || !Part.IsMatch(value)) throw new ArgumentException(name + " must be 1 to 32 letters, digits, periods, underscores or hyphens, beginning with a letter or digit.");
        }

        public static ContentSourceReference Source(ContentPackManifest manifest) => new ContentSourceReference
        { providerId = manifest.providerId, packId = manifest.packId, version = manifest.version,
          sha256 = manifest.sha256, platform = manifest.platform, unityVersion = manifest.unityVersion };

        public static ContentSourceReference Clone(ContentSourceReference value) => value == null ? null : new ContentSourceReference
        { providerId = value.providerId, packId = value.packId, version = value.version, sha256 = value.sha256,
          platform = value.platform, unityVersion = value.unityVersion };

        // JsonUtility materializes absent optional nested objects as empty objects in
        // some builds. Treat only an entirely empty reference as legacy/bundled.
        public static bool HasSource(ContentSourceReference value) => value != null &&
            (!string.IsNullOrEmpty(value.providerId) || !string.IsNullOrEmpty(value.packId) || !string.IsNullOrEmpty(value.version) ||
             !string.IsNullOrEmpty(value.sha256) || !string.IsNullOrEmpty(value.platform) || !string.IsNullOrEmpty(value.unityVersion));

        public static bool SameSource(ContentSourceReference a, ContentSourceReference b)
        {
            if (!HasSource(a) || !HasSource(b)) return !HasSource(a) && !HasSource(b);
            return a.providerId == b.providerId && a.packId == b.packId && a.version == b.version && a.sha256 == b.sha256 &&
                a.platform == b.platform && a.unityVersion == b.unityVersion;
        }

        public static void ValidateSource(string assetId, ContentSourceReference source)
        {
            if (!HasSource(source)) return;
            ValidatePart(source.providerId, "providerId"); ValidatePart(source.packId, "packId"); ValidatePart(source.version, "version");
            string prefix = Prefix(source.providerId, source.packId, source.version);
            if (assetId == null || !assetId.StartsWith(prefix, StringComparison.Ordinal)) throw new ArgumentException("Content source does not match its namespaced assetId.");
            ValidatePart(assetId.Substring(prefix.Length), "asset localId");
            if (source.sha256 == null || !Digest.IsMatch(source.sha256) ||
                (source.platform != "Android" && source.platform != "StandaloneWindows64") || string.IsNullOrWhiteSpace(source.unityVersion))
                throw new ArgumentException("Content source requires bundle digest, supported platform and Unity version.");
        }

        public static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
    }

    /// <summary>Static visual props only. This is an authoring/runtime policy, not a sandbox for hostile bundles.</summary>
    public static class SandboxContentPrefabValidator
    {
        public static void Validate(GameObject prefab)
        {
            if (prefab == null) throw new ArgumentException("Content prefab is missing.");
            Component[] components = prefab.GetComponentsInChildren<Component>(true);
            if (components.Length > 1024) throw new ArgumentException("A content prefab exceeds 1024 components.");
            int transforms = 0, vertices = 0, renderers = 0;
            var meshes = new HashSet<Mesh>(); var materials = new HashSet<Material>(); var textures = new HashSet<Texture>();
            foreach (Component component in components)
            {
                if (component == null) throw new ArgumentException("Content prefab contains a missing script.");
                Type type = component.GetType();
                if (type != typeof(Transform) && type != typeof(MeshFilter) && type != typeof(MeshRenderer) &&
                    type != typeof(BoxCollider) && type != typeof(SphereCollider) && type != typeof(CapsuleCollider))
                    throw new ArgumentException("Unsupported content component " + type.Name + ". Export static props without scripts, animation, audio, cameras, lights or physics bodies; compiled behavior changes require rebuilding the player.");
                if (component is Transform transform)
                {
                    transforms++;
                    Vector3 p = transform.localPosition, s = transform.localScale; Quaternion q = transform.localRotation;
                    if (!Finite(p) || !Finite(s) || !SandboxContentRules.Finite(q.x) || !SandboxContentRules.Finite(q.y) || !SandboxContentRules.Finite(q.z) || !SandboxContentRules.Finite(q.w) ||
                        p.magnitude > 100 || s.magnitude > 100 || Mathf.Abs(s.x) < .00001f || Mathf.Abs(s.y) < .00001f || Mathf.Abs(s.z) < .00001f)
                        throw new ArgumentException("Content transforms must be finite, nonzero scale and within 100 metres/scale units.");
                }
                if (component is MeshFilter filter)
                {
                    if (filter.sharedMesh == null) throw new ArgumentException("Content MeshFilter has no mesh.");
                    if (meshes.Add(filter.sharedMesh)) vertices += filter.sharedMesh.vertexCount;
                }
                if (component is MeshRenderer renderer)
                {
                    renderers++;
                    if (renderer.GetComponent<MeshFilter>() == null) throw new ArgumentException("Content MeshRenderer needs a MeshFilter.");
                    if (renderer.lightProbeProxyVolumeOverride != null || (renderer.probeAnchor != null && renderer.probeAnchor != prefab.transform && !renderer.probeAnchor.IsChildOf(prefab.transform)))
                        throw new ArgumentException("Content renderer cannot reference an external probe object.");
                    foreach (Material material in renderer.sharedMaterials)
                    {
                        if (material == null || material.shader == null) throw new ArgumentException("Content renderer has a missing material/shader.");
                        string shader = material.shader.name;
                        if (shader != "Standard" && shader != "Unlit/Color" && shader != "Unlit/Texture")
                            throw new ArgumentException("Content shaders must be Standard, Unlit/Color or Unlit/Texture for the built-in player renderer.");
                        if (!materials.Add(material)) continue;
                        foreach (string property in material.GetTexturePropertyNames())
                        {
                            Texture texture = material.GetTexture(property);
                            if (texture == null) continue;
                            if (!(texture is Texture2D) || texture.width > 4096 || texture.height > 4096)
                                throw new ArgumentException("Content textures must be Texture2D with dimensions at most 4096.");
                            textures.Add(texture);
                        }
                    }
                }
            }
            if (transforms > 256 || vertices > 200000 || renderers < 1 || renderers > 64 || materials.Count > 32 || textures.Count > 32)
                throw new ArgumentException("Content prefab limit exceeded: 256 transforms, 200k vertices, 1-64 renderers, 32 materials/textures.");
        }

        private static bool Finite(Vector3 value) => SandboxContentRules.Finite(value.x) && SandboxContentRules.Finite(value.y) && SandboxContentRules.Finite(value.z);
    }
}
