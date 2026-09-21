using System;
using System.IO;
using System.Security.Cryptography;
using UnityEngine;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>Observable registry, integrity, compatibility and save/restore checks using real Unity objects.</summary>
    public static class SandboxContentChecks
    {
        public static void Run(Action<string, bool> check)
        {
            ContentPackManifest manifest = Manifest();
            SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion);
            check("valid namespaced content manifest accepted", true);
            check("content rejects wrong target platform", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "Android", Application.unityVersion)));
            check("content rejects different Unity runtime version", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", "6000.0.0f1")));
            manifest.byteLength = SandboxContentRules.MaximumBundleBytes + 1;
            check("content rejects bundles above compressed byte limit", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion)));
            manifest = Manifest(); manifest.dependencies = new[] { "hidden-bundle" };
            check("content rejects external bundle dependencies", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion)));
            manifest = Manifest(); manifest.assets[0].assetId = "other:pack:1.0.0:prop";
            check("content rejects provenance namespace mismatch", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion)));
            manifest = Manifest(); manifest.assets[0].prefabPath = "assets/../secret.prefab";
            check("content rejects prefab path traversal", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion)));
            manifest = Manifest(); manifest.assets[0].spawnScale = float.NaN;
            check("content rejects nonfinite spawn scale", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion)));
            manifest = Manifest(); manifest.assets = new[] { manifest.assets[0], manifest.assets[0] };
            check("content rejects duplicate manifest identities", Rejects(() => SandboxContentRules.ValidateManifest(manifest, "StandaloneWindows64", Application.unityVersion)));
            manifest = Manifest();
            check("content URL stays on existing service origin", SandboxContentLoader.BundleUri("http://127.0.0.1:8765", manifest.sha256).AbsoluteUri == "http://127.0.0.1:8765/api/content/files/" + manifest.sha256);
            check("content rejects service credentials", Rejects(() => SandboxContentLoader.BundleUri("http://user:password@localhost:8765", manifest.sha256)));
            check("content rejects download path injection", Rejects(() => SandboxContentLoader.BundleUri("http://localhost:8765", "../../other")));
            CheckRegistry(check, manifest);
            CheckIntegrity(check, manifest);
        }

        private static void CheckRegistry(Action<string, bool> check, ContentPackManifest manifest)
        {
            var root = new GameObject("Content check root");
            GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = "Content static source"; cube.SetActive(false);
            var material = new Material(Shader.Find("Standard")); cube.GetComponent<Renderer>().sharedMaterial = material;
            SandboxWorld world = null, withoutPack = null;
            try
            {
                var target = new RoomTarget { anchorId = "floor", origin = root.transform };
                world = new SandboxWorld("content-room", root.transform, new[] { new PrefabEntry { assetId = "builtin", prefab = cube } }, new[] { target });
                var first = world.Execute(new SandboxCommand { op = "spawn", assetId = "builtin", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                if (!first.ok) throw new Exception(first.error);
                world.TryGetObject(first.objectId, out GameObject original);
                string before = JsonUtility.ToJson(world.Capture().scene);
                int history = world.UndoCount;
                PrefabEntry entry = Entry(manifest, cube);
                PrefabEntry invalid = Entry(manifest, cube); invalid.assetId = "bad identity";
                check("content registry registration failure is atomic", Rejects(() => world.RegisterAssets(new[] { entry, invalid })) && world.Capture().assets.Count == 1);
                check("failed content registration preserves object identity and history", world.TryGetObject(first.objectId, out var stillOriginal) && stillOriginal == original && world.UndoCount == history && JsonUtility.ToJson(world.Capture().scene) == before);
                world.RegisterAssets(new[] { entry });
                check("content registration preserves live world and undo history", world.Capture().assets.Count == 2 && world.UndoCount == history && JsonUtility.ToJson(world.Capture().scene) == before && world.TryGetObject(first.objectId, out stillOriginal) && stillOriginal == original);
                check("content exposes measured prefab bounds", world.Capture().assets.Find(a => a.assetId == entry.assetId).localBounds.size.x == 1f);
                check("content duplicate identity cannot replace an installed version", Rejects(() => world.RegisterAssets(new[] { entry })) && world.Capture().assets.Count == 2);
                entry.source.version = "mutated";
                check("content registry clones caller-owned provenance", world.Capture().assets.Find(a => a.assetId == entry.assetId).source.version == "1.0.0");
                var spawned = world.Execute(new SandboxCommand { op = "spawn", assetId = manifest.assets[0].assetId, anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                check("downloaded asset spawns through existing command executor", spawned.ok && world.Capture().scene.objects.Count == 2);
                SceneData saved = world.Capture().scene;
                SceneObjectData savedContent = saved.objects.Find(o => o.objectId == spawned.objectId);
                check("saved scene retains exact provider pack version and digest", SandboxContentRules.SameSource(savedContent.source, SandboxContentRules.Source(manifest)));
                var move = SandboxWorld.DefaultTransform(); move.position.x = .75f;
                check("downloaded instance accepts ordinary transform edits", world.Execute(new SandboxCommand { op = "set_transform", objectId = spawned.objectId, transform = move }).ok);
                check("downloaded instance undo restores its original pose", world.Execute(new SandboxCommand { op = "undo" }).ok && world.Capture().scene.objects.Find(o => o.objectId == spawned.objectId).transform.position.x == 0);
                check("downloaded scene clear and restore preserve exact IDs and provenance", world.Execute(new SandboxCommand { op = "clear" }).ok && world.Execute(new SandboxCommand { op = "load", scene = saved }).ok && JsonUtility.ToJson(world.Capture().scene) == JsonUtility.ToJson(saved));
                savedContent.source.sha256 = new string('a', 64);
                string current = JsonUtility.ToJson(world.Capture().scene);
                check("restore rejects a replaced bundle with same version and preserves scene", !world.Execute(new SandboxCommand { op = "load", scene = saved }).ok && JsonUtility.ToJson(world.Capture().scene) == current);
                saved = world.Capture().scene;
                withoutPack = new SandboxWorld("content-room", root.transform, new[] { new PrefabEntry { assetId = "builtin", prefab = cube } }, new[] { target });
                withoutPack.Execute(new SandboxCommand { op = "spawn", assetId = "builtin", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                string withoutBefore = JsonUtility.ToJson(withoutPack.Capture().scene);
                check("missing content version fails restore without disturbing existing scene", !withoutPack.Execute(new SandboxCommand { op = "load", scene = saved }).ok && JsonUtility.ToJson(withoutPack.Capture().scene) == withoutBefore);
                var light = cube.AddComponent<Light>();
                check("content rejects executable or nonstatic component policy before registration", Rejects(() => SandboxContentPrefabValidator.Validate(cube)));
                Object.DestroyImmediate(light);
                var script = cube.AddComponent<SandboxBehaviorVisual>();
                check("content rejects arbitrary already-compiled MonoBehaviours", Rejects(() => SandboxContentPrefabValidator.Validate(cube)));
                Object.DestroyImmediate(script);
                SandboxContentPrefabValidator.Validate(cube);
                check("static mesh material collider prefab passes content policy", true);
            }
            finally { world?.Dispose(); withoutPack?.Dispose(); Object.DestroyImmediate(cube); Object.DestroyImmediate(material); Object.DestroyImmediate(root); }
        }

        private static void CheckIntegrity(Action<string, bool> check, ContentPackManifest manifest)
        {
            string file = Path.GetTempFileName();
            try
            {
                byte[] bytes = { 1, 8, 22, 90, 50 }; File.WriteAllBytes(file, bytes);
                manifest.byteLength = bytes.Length;
                using (SHA256 hash = SHA256.Create()) manifest.sha256 = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                check("content verifies exact downloaded bytes", SandboxContentLoader.VerifyFile(file, manifest));
                bytes[0] = 7; File.WriteAllBytes(file, bytes);
                check("content detects same-length bundle corruption", !SandboxContentLoader.VerifyFile(file, manifest));
                File.WriteAllBytes(file, new byte[] { 1 });
                check("content detects truncated bundle", !SandboxContentLoader.VerifyFile(file, manifest));
            }
            finally { File.Delete(file); }
        }

        private static ContentPackManifest Manifest() => new ContentPackManifest { providerId = "test", packId = "props", version = "1.0.0",
            platform = "StandaloneWindows64", unityVersion = Application.unityVersion, sha256 = new string('0', 64), byteLength = 10,
            assets = new[] { new ContentPackAsset { assetId = "test:props:1.0.0:cube", prefabPath = "assets/content/cube.prefab", displayName = "Cube", spawnScale = 1f } } };
        private static PrefabEntry Entry(ContentPackManifest manifest, GameObject prefab) => new PrefabEntry { assetId = manifest.assets[0].assetId,
            displayName = "Downloaded cube", prefab = prefab, spawnScale = 1f, source = SandboxContentRules.Source(manifest) };
        private static bool Rejects(Action action) { try { action(); return false; } catch (ArgumentException) { return true; } }
    }
}
