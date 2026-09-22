using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
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
            CheckCachedDependencies(check);
            CheckCommandInbox(check);
            CheckDeferredRestoreQueue(check);
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
                long editRevision = world.EditRevision;
                PrefabEntry entry = Entry(manifest, cube);
                PrefabEntry invalid = Entry(manifest, cube); invalid.assetId = "bad identity";
                check("content registry registration failure is atomic", Rejects(() => world.RegisterAssets(new[] { entry, invalid })) && world.Capture().assets.Count == 1);
                check("failed content registration preserves object identity and history", world.TryGetObject(first.objectId, out var stillOriginal) && stillOriginal == original && world.UndoCount == history && JsonUtility.ToJson(world.Capture().scene) == before);
                world.RegisterAssets(new[] { entry });
                check("content registration leaves authored edit revision unchanged", world.EditRevision == editRevision);
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
                check("edit revision detects edits undone back to the same pose", world.EditRevision == editRevision + 3);
                check("downloaded scene clear and restore preserve exact IDs and provenance", world.Execute(new SandboxCommand { op = "clear" }).ok && world.Execute(new SandboxCommand { op = "load", scene = saved }).ok && JsonUtility.ToJson(world.Capture().scene) == JsonUtility.ToJson(saved));
                savedContent.source.sha256 = new string('a', 64);
                string current = JsonUtility.ToJson(world.Capture().scene);
                long failedRevision = world.EditRevision;
                check("restore rejects a replaced bundle with same version and preserves scene", !world.Execute(new SandboxCommand { op = "load", scene = saved }).ok && JsonUtility.ToJson(world.Capture().scene) == current);
                check("failed restore leaves authored revision unchanged", world.EditRevision == failedRevision);
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

        private static void CheckCachedDependencies(Action<string, bool> check)
        {
            string directory = Path.Combine(Path.GetTempPath(), "matrix-cache-check-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            try
            {
                ContentPackManifest manifest = Manifest();
                byte[] bytes = { 1, 5, 9 };
                manifest.byteLength = bytes.Length;
                using (SHA256 hash = SHA256.Create()) manifest.sha256 = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                string metadata = Path.Combine(directory, manifest.sha256 + ".json"), bundle = Path.Combine(directory, manifest.sha256 + ".bundle");
                var scene = new SceneData { roomId = "cache-room", objects = new List<SceneObjectData> {
                    new SceneObjectData { assetId = manifest.assets[0].assetId, source = SandboxContentRules.Source(manifest) } } };
                Func<List<ContentPackManifest>> resolve = () => SandboxContentLoader.ResolveCachedDependencies(scene, Array.Empty<PrefabEntry>(), directory, "StandaloneWindows64", Application.unityVersion);
                Action write = () => File.WriteAllText(metadata, JsonUtility.ToJson(manifest));
                check("cold restore rejects a missing cached manifest", Rejects(() => resolve()));
                write();
                check("cold restore rejects a missing cached bundle", Rejects(() => resolve()));
                File.WriteAllBytes(bundle, bytes);
                check("cold restore resolves exact cache without provider or service URL", resolve().Count == 1 && SandboxContentRules.SameSource(scene.objects[0].source, SandboxContentRules.Source(resolve()[0])));
                scene.objects.Add(scene.objects[0]);
                check("cold restore registers a shared pack only once", resolve().Count == 1);
                scene.objects.RemoveAt(1);
                var entry = new PrefabEntry { assetId = manifest.assets[0].assetId, source = SandboxContentRules.Source(manifest) };
                check("warm restore needs no cached files for matching registered assets", SandboxContentLoader.ResolveCachedDependencies(scene, new[] { entry }, directory + "-missing", "StandaloneWindows64", Application.unityVersion).Count == 0);
                entry.source.sha256 = new string('a', 64);
                check("cold restore rejects conflicting registered provenance", Rejects(() => SandboxContentLoader.ResolveCachedDependencies(scene, new[] { entry }, directory, "StandaloneWindows64", Application.unityVersion)));
                manifest.version = "2.0.0"; manifest.assets[0].assetId = "test:props:2.0.0:cube"; write();
                check("cold restore never substitutes a different cached version", Rejects(() => resolve()));
                manifest.version = "1.0.0"; manifest.assets[0].assetId = "test:props:1.0.0:cube";
                manifest.platform = "Android"; write();
                check("cold restore rejects wrong cached platform", Rejects(() => resolve()));
                manifest.platform = "StandaloneWindows64"; manifest.unityVersion = "6000.0.0f1"; write();
                check("cold restore rejects wrong cached Unity version", Rejects(() => resolve()));
                manifest.unityVersion = Application.unityVersion; manifest.dependencies = new[] { "external" }; write();
                check("cold restore rejects undeclared external bundle resolution", Rejects(() => resolve()));
                manifest.dependencies = Array.Empty<string>(); manifest.assets[0].assetId = "test:props:1.0.0:other"; write();
                check("cold restore rejects asset absent from cached manifest", Rejects(() => resolve()));
                manifest.assets[0].assetId = scene.objects[0].assetId; write();
                manifest.sha256 = new string('b', 64); write();
                check("cold restore rejects cached manifest stored under a different digest", Rejects(() => resolve()));
                manifest.sha256 = scene.objects[0].source.sha256; write();
                File.WriteAllBytes(bundle, new byte[] { 1 });
                check("cold restore rejects truncated cached bundle during preflight", Rejects(() => resolve()));
                File.WriteAllBytes(bundle, bytes); File.WriteAllText(metadata, new string('x', 65537));
                check("cold restore bounds cached metadata before parsing", Rejects(() => resolve()));
                File.WriteAllText(metadata, "not json");
                check("cold restore rejects malformed cached metadata", Rejects(() => resolve()));
                write(); scene.objects[0].source.sha256 = "../../outside";
                check("cold restore rejects source path traversal before file access", Rejects(() => resolve()));
                scene.objects[0].source = null;
                check("cold restore does not guess provenance for unknown legacy assets", Rejects(() => resolve()));
            }
            finally { Directory.Delete(directory, true); }
        }

        private static void CheckCommandInbox(Action<string, bool> check)
        {
            var inbox = new SandboxCommandInbox();
            var load = new SandboxCommand { requestId = "cached-load", op = "load" };
            var edit = new SandboxCommand { requestId = "after-load", op = "clear" };
            inbox.Receive(new List<SandboxCommand> { load, edit, load });
            check("cached restore stays before subsequent edits on repeated delivery", inbox.Next == load);
            var sentBeforeCompletion = inbox.Results();
            var loaded = new CommandResult { requestId = load.requestId, ok = true };
            inbox.Complete(loaded);
            inbox.Acknowledge(sentBeforeCompletion);
            check("in-flight heartbeat cannot acknowledge a later restore receipt", inbox.Results().Count == 1 && inbox.Results()[0] == loaded);
            inbox.Receive(new List<SandboxCommand> { load, edit });
            check("completed restore redelivery reuses receipt without reexecution", inbox.Next == edit && inbox.Results().Count == 1);
            inbox.Complete(new CommandResult { requestId = edit.requestId, ok = true });
            check("queued edit completes after cached restore exactly once", inbox.Next == null && inbox.Results().Count == 2);
            inbox.Acknowledge(inbox.Results());
            check("successful upload retires only sent command receipts", inbox.Results().Count == 0);
            inbox.Receive(new List<SandboxCommand> { new SandboxCommand { requestId = "cancelled", op = "load" } });
            inbox.CancelPending();
            inbox.Receive(new List<SandboxCommand> { new SandboxCommand { requestId = "cancelled", op = "load" } });
            check("cancelled preload can be redelivered without false completion", inbox.Next.requestId == "cancelled" && inbox.Results().Count == 0);
            inbox.CancelPending();
            var many = new List<SandboxCommand>();
            for (int i = 0; i < 513; i++) many.Add(new SandboxCommand { requestId = "bounded-" + i, op = "get_scene" });
            inbox.Receive(many);
            check("asynchronous command queue rejects overflow with a receipt", inbox.Results().Count == 1 && !inbox.Results()[0].ok && inbox.Results()[0].requestId == "bounded-512");
            for (int i = 0; i < 512; i++) inbox.Complete(new CommandResult { requestId = "bounded-" + i, ok = true });
            check("bounded queue preserves all accepted command order", inbox.Next == null && inbox.Results().Count == 513);
        }

        private static void CheckDeferredRestoreQueue(Action<string, bool> check)
        {
            // Drive the actual bridge/loader iterators at their suspension points,
            // with real Unity worlds. Bundled content makes these deterministic
            // without filesystem, network, or an Editor coroutine package.
            for (int scenario = 0; scenario < 4; scenario++)
            {
                var root = new GameObject("Deferred restore validation");
                var source = new GameObject("Bundled validation source"); source.SetActive(false);
                IEnumerator running = null;
                try
                {
                    var app = root.AddComponent<SandboxApp>();
                    app.prefabs = new[] { new PrefabEntry { assetId = "builtin", prefab = source } };
                    var targets = new[] { new RoomTarget { anchorId = "floor", origin = root.transform } };
                    app.InitializeWorld("before-room", targets);
                    var spawn = new SandboxCommand { op = "spawn", assetId = "builtin", anchorId = "floor", transform = SandboxWorld.DefaultTransform() };
                    app.Execute(spawn);
                    SceneData saved = app.World.Capture().scene;
                    var loader = root.AddComponent<SandboxContentLoader>();
                    var bridge = root.AddComponent<PcBridge>(); bridge.app = app;
                    var flags = BindingFlags.NonPublic | BindingFlags.Instance;
                    typeof(PcBridge).GetField("contentLoader", flags).SetValue(bridge, loader);
                    var inbox = (SandboxCommandInbox)typeof(PcBridge).GetField("inbox", flags).GetValue(bridge);
                    var load = new SandboxCommand { requestId = "deferred-load", op = "load", scene = saved };
                    inbox.Receive(new List<SandboxCommand> { load, new SandboxCommand { requestId = "following-clear", op = "clear" } });
                    running = (IEnumerator)typeof(PcBridge).GetMethod("ExecuteCommands", flags).Invoke(bridge, null);
                    if (!running.MoveNext() || !(running.Current is IEnumerator restore)) throw new Exception("Bridge did not defer restore.");
                    if (scenario == 0) { app.Execute(spawn); app.Execute(new SandboxCommand { op = "undo" }); }
                    if (scenario == 1) { app.InitializeWorld("replacement-room", targets); app.Execute(spawn); }
                    if (restore.MoveNext()) throw new Exception("Bundled restore unexpectedly requested I/O.");
                    if (scenario >= 2) app.Execute(spawn); // After successful load callback, before parent resumes.
                    string expected = JsonUtility.ToJson(app.World.Capture().scene);
                    if (scenario == 3)
                    {
                        // Teardown drops pending work, but not an already-applied
                        // command's receipt; re-delivery must not execute it again.
                        typeof(PcBridge).GetMethod("OnDisable", flags).Invoke(bridge, null);
                        inbox.Receive(new List<SandboxCommand> { load });
                        check("disable after restore callback retains dedup receipt before parent resumes", inbox.Next == null && inbox.Results().Exists(value => value.requestId == load.requestId && value.ok));
                    }
                    else
                    {
                        if (running.MoveNext()) throw new Exception("Retired deferred queue unexpectedly continued.");
                        var receipts = inbox.Results();
                        check("deferred restore retires following clear on " + (scenario == 0 ? "edit and Undo before start" : scenario == 1 ? "room replacement before start" : "edit after load callback"),
                            JsonUtility.ToJson(app.World.Capture().scene) == expected && inbox.Next == null &&
                            receipts.Count == 2 && receipts[0].ok == (scenario == 2) && !receipts[1].ok);
                    }
                }
                finally { (running as IDisposable)?.Dispose(); Object.DestroyImmediate(root); Object.DestroyImmediate(source); }
            }
        }

        private static ContentPackManifest Manifest() => new ContentPackManifest { providerId = "test", packId = "props", version = "1.0.0",
            platform = "StandaloneWindows64", unityVersion = Application.unityVersion, sha256 = new string('0', 64), byteLength = 10,
            assets = new[] { new ContentPackAsset { assetId = "test:props:1.0.0:cube", prefabPath = "assets/content/cube.prefab", displayName = "Cube", spawnScale = 1f } } };
        private static PrefabEntry Entry(ContentPackManifest manifest, GameObject prefab) => new PrefabEntry { assetId = manifest.assets[0].assetId,
            displayName = "Downloaded cube", prefab = prefab, spawnScale = 1f, source = SandboxContentRules.Source(manifest) };
        private static bool Rejects(Action action) { try { action(); return false; } catch (ArgumentException) { return true; } }
    }
}
