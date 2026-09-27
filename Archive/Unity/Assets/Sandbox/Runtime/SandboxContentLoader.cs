using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace ArSandbox
{
    /// <summary>Installs trusted, self-contained static AssetBundles through the existing PC service.</summary>
    public sealed class SandboxContentLoader : MonoBehaviour
    {
        private readonly Dictionary<string, AssetBundle> bundles = new Dictionary<string, AssetBundle>(StringComparer.Ordinal);
        private readonly Dictionary<string, string[]> installedAssets = new Dictionary<string, string[]>(StringComparer.Ordinal);
        private bool busy;
        private Operation activeOperation;
        public bool Busy => busy;
        private string CacheDirectory => Path.Combine(Application.persistentDataPath, "content-packs-v1");

        private sealed class Operation : IDisposable
        {
            public string temporaryPath;
            public AssetBundle bundle;
            public UnityWebRequest request;
            public AssetBundleCreateRequest creating;
            public AssetBundleRequest loadingAsset;
            public FileStream verifying;
            public SHA256 verifier;
            public bool committed;
            private bool disposed;
            public void ThrowIfDisposed() { if (disposed) throw new OperationCanceledException("Content installation was cancelled because the loader became unavailable."); }
            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                verifying?.Dispose(); verifying = null;
                verifier?.Dispose(); verifier = null;
                if (request != null) { request.Abort(); request.Dispose(); request = null; }
                if (!committed)
                {
                    if (bundle != null)
                    {
                        AssetBundle owned = bundle;
                        if (loadingAsset != null && !loadingAsset.isDone) loadingAsset.completed += ignored => { if (owned != null) owned.Unload(true); };
                        else owned.Unload(true);
                    }
                    else if (creating != null)
                    {
                        // Unity cannot cancel a native bundle load already in flight.
                        // Take ownership of its eventual result even if the coroutine stops.
                        AssetBundleCreateRequest pending = creating;
                        if (pending.isDone) { if (pending.assetBundle != null) pending.assetBundle.Unload(true); }
                        else pending.completed += ignored => { if (pending.assetBundle != null) pending.assetBundle.Unload(true); };
                    }
                }
                if (!string.IsNullOrEmpty(temporaryPath)) { try { File.Delete(temporaryPath); } catch (IOException) { } }
            }
        }

        // A streaming limit is enforced before each write. A hostile Content-Length
        // header cannot cause an oversized allocation/download to complete.
        private sealed class BoundedFileDownload : DownloadHandlerScript
        {
            private readonly FileStream file;
            private readonly long limit;
            public long Bytes { get; private set; }
            public string Failure { get; private set; }
            public BoundedFileDownload(string path, long limit) : base(new byte[64 * 1024])
            { this.limit = limit; file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read); }
            protected override bool ReceiveData(byte[] data, int length)
            {
                if (!string.IsNullOrEmpty(Failure)) return false;
                if (length < 0 || data == null || Bytes + length > limit)
                { Failure = "Content download exceeded its declared byteLength."; return false; }
                try { file.Write(data, 0, length); Bytes += length; return true; }
                catch (IOException exception) { Failure = "Content download could not be stored: " + exception.Message; return false; }
            }
            protected override void ReceiveContentLengthHeader(ulong length)
            { if (length > (ulong)limit) Failure = "Content-Length exceeds the declared pack size."; }
            protected override void CompleteContent() { file.Flush(); }
            public void CloseFile() { file.Dispose(); }
            public override void Dispose() { file.Dispose(); base.Dispose(); }
        }

        public IEnumerator Install(ContentInstallRequest request, string serviceUrl, string token, Action<ContentInstallReceipt> completed)
        { return Install(request, serviceUrl, token, completed, false); }

        private IEnumerator Install(ContentInstallRequest request, string serviceUrl, string token, Action<ContentInstallReceipt> completed, bool cacheOnly)
        {
            var receipt = new ContentInstallReceipt { requestId = request?.requestId, packId = request?.manifest?.packId,
                version = request?.manifest?.version, sha256 = request?.manifest?.sha256 };
            if (busy) { receipt.error = "Another content pack is being installed."; completed?.Invoke(receipt); yield break; }
            busy = true;
            var operation = new Operation();
            activeOperation = operation;
            IEnumerator body = InstallCore(request?.manifest, serviceUrl, token, receipt, operation, cacheOnly);
            try
            {
                while (true)
                {
                    bool next = false; object current = null;
                    try { next = body.MoveNext(); if (next) current = body.Current; }
                    catch (Exception exception) { receipt.ok = false; receipt.error = exception.Message; }
                    if (!next) break;
                    yield return current;
                }
            }
            finally
            {
                (body as IDisposable)?.Dispose(); operation.Dispose();
                if (ReferenceEquals(activeOperation, operation)) { activeOperation = null; busy = false; }
            }
            completed?.Invoke(receipt);
        }

        public IEnumerator Install(ContentPackManifest manifest, string serviceUrl, string token, Action<ContentInstallReceipt> completed)
        { return Install(new ContentInstallRequest { manifest = manifest }, serviceUrl, token, completed); }

        private IEnumerator InstallCore(ContentPackManifest original, string serviceUrl, string token, ContentInstallReceipt receipt, Operation operation, bool cacheOnly)
        {
            // Freeze caller-owned metadata before the first yield.
            ContentPackManifest manifest = original == null ? null : JsonUtility.FromJson<ContentPackManifest>(JsonUtility.ToJson(original));
            SandboxContentRules.ValidateManifest(manifest, SandboxContentRules.RuntimePlatformName, Application.unityVersion);
            SandboxApp app = GetComponent<SandboxApp>();
            if (app == null || app.World == null || app.RoomReloading) throw new InvalidOperationException("Wait for room localization before installing content.");
            if (installedAssets.TryGetValue(manifest.sha256, out string[] existing))
            {
                if (existing.Length != manifest.assets.Length) throw new ArgumentException("Installed bundle metadata conflicts with this manifest.");
                for (int i = 0; i < existing.Length; i++) if (existing[i] != manifest.assets[i].assetId) throw new ArgumentException("Installed bundle asset IDs conflict with this manifest.");
                receipt.ok = true; receipt.alreadyInstalled = true; receipt.assetIds = (string[])existing.Clone(); yield break;
            }
            SandboxWorld expectedWorld = app.World;
            if (app.prefabs.Length + manifest.assets.Length > SandboxContentRules.MaximumRegisteredAssets) throw new ArgumentException("The runtime asset registry is limited to 512 entries.");
            // Reject identity collisions before any network or bundle work.
            foreach (ContentPackAsset item in manifest.assets)
                foreach (PrefabEntry registered in app.prefabs)
                    if (registered.assetId == item.assetId) throw new ArgumentException("Asset version already exists with a different bundle. Publish a new version: " + item.assetId);

            Directory.CreateDirectory(CacheDirectory);
            string cachedPath = Path.Combine(CacheDirectory, manifest.sha256 + ".bundle");
            bool cached;
            if (cacheOnly)
            {
                if (!File.Exists(cachedPath) || new FileInfo(cachedPath).Length != manifest.byteLength)
                    throw new ArgumentException("Required cached content bundle is missing or truncated. Reinstall the exact original pack; current objects were preserved.");
                // Hash in bounded chunks so a large cached pack cannot starve the
                // bridge heartbeat. Offline restore never downloads or deletes bytes.
                using (SHA256 hash = SHA256.Create()) using (FileStream stream = File.OpenRead(cachedPath))
                {
                    operation.verifying = stream; operation.verifier = hash;
                    var buffer = new byte[256 * 1024];
                    int count, sinceYield = 0;
                    long total = 0;
                    while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        total += count;
                        if (total > manifest.byteLength) throw new ArgumentException("Cached content bundle exceeded its declared byteLength.");
                        hash.TransformBlock(buffer, 0, count, buffer, 0);
                        sinceYield += count;
                        if (sinceYield >= 1024 * 1024) { sinceYield = 0; yield return null; operation.ThrowIfDisposed(); }
                    }
                    hash.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                    cached = stream.Length == manifest.byteLength &&
                        BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant() == manifest.sha256;
                    operation.verifying = null; operation.verifier = null;
                }
                if (!cached) throw new ArgumentException("Required cached content bundle failed SHA-256 verification. Reinstall the exact original pack; current objects were preserved.");
            }
            else cached = File.Exists(cachedPath) && VerifyFile(cachedPath, manifest);
            if (!cached)
            {
                if (File.Exists(cachedPath)) File.Delete(cachedPath);
                Uri uri = BundleUri(serviceUrl, manifest.sha256);
                operation.temporaryPath = Path.Combine(CacheDirectory, manifest.sha256 + "." + Guid.NewGuid().ToString("N") + ".part");
                var handler = new BoundedFileDownload(operation.temporaryPath, manifest.byteLength);
                operation.request = new UnityWebRequest(uri, "GET") { downloadHandler = handler, timeout = 120, redirectLimit = 0 };
                if (!string.IsNullOrEmpty(token)) operation.request.SetRequestHeader("Authorization", "Bearer " + token);
                yield return operation.request.SendWebRequest();
                operation.ThrowIfDisposed();
                handler.CloseFile();
                if (operation.request.result != UnityWebRequest.Result.Success || !string.IsNullOrEmpty(handler.Failure))
                    throw new IOException(handler.Failure ?? "Content download failed: HTTP " + operation.request.responseCode + ".");
                if (handler.Bytes != manifest.byteLength || !VerifyFile(operation.temporaryPath, manifest))
                    throw new IOException("Content bundle size or SHA-256 did not match its manifest; nothing was registered.");
                operation.request.Dispose(); operation.request = null;
                File.Move(operation.temporaryPath, cachedPath); operation.temporaryPath = null;
            }
            AssetBundleCreateRequest loading = AssetBundle.LoadFromFileAsync(cachedPath);
            operation.creating = loading;
            yield return loading;
            operation.ThrowIfDisposed();
            operation.bundle = loading.assetBundle;
            if (operation.bundle == null) throw new ArgumentException("Unity could not load this content bundle for the current player.");
            string[] names = operation.bundle.GetAllAssetNames();
            // The exporter emits only these prefab roots (their meshes/materials are dependencies).
            if (names.Length != manifest.assets.Length) throw new ArgumentException("Content bundle root assets do not match the manifest.");
            var named = new HashSet<string>(names, StringComparer.Ordinal);
            var entries = new PrefabEntry[manifest.assets.Length];
            for (int i = 0; i < manifest.assets.Length; i++)
            {
                ContentPackAsset item = manifest.assets[i];
                if (!named.Contains(item.prefabPath)) throw new ArgumentException("Content bundle is missing prefab " + item.prefabPath);
                AssetBundleRequest loadingPrefab = operation.bundle.LoadAssetAsync<GameObject>(item.prefabPath);
                operation.loadingAsset = loadingPrefab;
                yield return loadingPrefab;
                operation.ThrowIfDisposed();
                operation.loadingAsset = null;
                var prefab = loadingPrefab.asset as GameObject;
                // LoadAsset deserializes assets but never Instantiate before policy validation.
                SandboxContentPrefabValidator.Validate(prefab);
                entries[i] = new PrefabEntry { assetId = item.assetId, prefab = prefab, displayName = item.displayName,
                    description = item.description ?? "", spawnScale = item.spawnScale, source = SandboxContentRules.Source(manifest) };
            }
            if (app == null || app.World != expectedWorld || app.RoomReloading) throw new InvalidOperationException("The room changed during content installation. Retry after localization.");
            // Persist verified metadata for cache-only restoration after an app restart.
            if (!cacheOnly)
            {
                string metadataPath = Path.Combine(CacheDirectory, manifest.sha256 + ".json");
                File.WriteAllText(metadataPath, JsonUtility.ToJson(manifest, true));
            }
            app.RegisterContentAssets(entries);
            operation.committed = true;
            bundles.Add(manifest.sha256, operation.bundle);
            var ids = new string[entries.Length]; for (int i = 0; i < ids.Length; i++) ids[i] = entries[i].assetId;
            installedAssets.Add(manifest.sha256, ids);
            receipt.ok = true; receipt.assetIds = (string[])ids.Clone();
        }

        /// <summary>Preload only exact saved dependencies, then use the existing atomic scene executor.</summary>
        public IEnumerator Restore(SandboxCommand command, Action<CommandResult> completed)
        {
            SandboxApp app = GetComponent<SandboxApp>();
            SandboxWorld world = app != null ? app.World : null;
            RoomContextData room = app != null ? app.RoomContext : null;
            long revision = world != null ? world.EditRevision : 0;
            // Capture before returning the lazy iterator: the first coroutine
            // step may run after another local edit or room transition.
            return RestoreCore(command, completed, app, world, room, revision);
        }

        private IEnumerator RestoreCore(SandboxCommand command, Action<CommandResult> completed,
            SandboxApp app, SandboxWorld world, RoomContextData room, long revision)
        {
            var failure = new CommandResult { requestId = command?.requestId };
            List<ContentPackManifest> dependencies = null;
            try
            {
                if (command?.op != "load") throw new ArgumentException("Cached restore requires a load command.");
                if (app == null || world == null || app.RoomReloading || !app.RoomEditingAllowed)
                    throw new InvalidOperationException("Localize the room and confirm alignment before restoring.");
                if (app.World != world || app.RoomContext != room || world.EditRevision != revision)
                    throw new InvalidOperationException("The room or scene changed before cached restore started. Review and restore again.");
                if (busy) throw new InvalidOperationException("Wait for content installation before restoring.");
                command = JsonUtility.FromJson<SandboxCommand>(JsonUtility.ToJson(command));
                if (command.scene?.roomId != world.Capture().scene.roomId)
                    throw new ArgumentException("The saved roomId does not match the current room. Current objects were preserved.");
                dependencies = ResolveCachedDependencies(command.scene, app.prefabs, CacheDirectory,
                    SandboxContentRules.RuntimePlatformName, Application.unityVersion);
            }
            catch (Exception exception) { failure.error = exception.Message; }
            if (failure.error != null) { app?.ReportStatus(failure.error); completed?.Invoke(failure); yield break; }
            foreach (ContentPackManifest manifest in dependencies)
            {
                app.ReportStatus("Restoring cached content: " + manifest.packId + " " + manifest.version);
                ContentInstallReceipt receipt = null;
                // This overload cannot construct a provider/service request.
                yield return Install(new ContentInstallRequest { manifest = manifest }, null, null, value => receipt = value, true);
                if (receipt == null || !receipt.ok)
                { failure.error = receipt?.error ?? "Cached content installation did not finish."; break; }
            }
            if (failure.error == null && (app == null || app.World != world || app.RoomContext != room || app.RoomReloading ||
                !app.RoomEditingAllowed || world.EditRevision != revision))
                failure.error = "The room or scene changed while cached content was loading. Review and restore again; current objects were preserved.";
            if (failure.error != null) { app?.ReportStatus(failure.error); completed?.Invoke(failure); yield break; }
            completed?.Invoke(app.Execute(command));
        }

        // Metadata is bounded and preflighted for every dependency before any
        // registration. Bundle hashes and prefab policy are rechecked by Install.
        // Previously installed assets need no disk access; their source must match.
        public static List<ContentPackManifest> ResolveCachedDependencies(SceneData scene, PrefabEntry[] registered,
            string directory, string platform, string unityVersion)
        {
            if (scene == null || scene.schemaVersion != 1 || scene.objects == null || scene.objects.Count > SandboxWorld.MaximumObjects)
                throw new ArgumentException("Restore requires a schema-1 scene with at most 100 objects.");
            var available = new Dictionary<string, PrefabEntry>(StringComparer.Ordinal);
            foreach (PrefabEntry entry in registered ?? Array.Empty<PrefabEntry>()) available.Add(entry.assetId, entry);
            var packs = new Dictionary<string, ContentPackManifest>(StringComparer.Ordinal);
            var additions = new HashSet<string>(StringComparer.Ordinal);
            foreach (SceneObjectData item in scene.objects)
            {
                if (item == null || string.IsNullOrEmpty(item.assetId)) throw new ArgumentException("Saved scene contains an invalid asset reference.");
                SandboxContentRules.ValidateSource(item.assetId, item.source);
                if (available.TryGetValue(item.assetId, out PrefabEntry installed))
                {
                    if (!SandboxContentRules.SameSource(item.source, installed.source))
                        throw new ArgumentException("Saved content source conflicts with the installed asset: " + item.assetId);
                    continue;
                }
                if (!SandboxContentRules.HasSource(item.source)) throw new ArgumentException("Saved asset is not bundled or installed: " + item.assetId);
                if (!packs.TryGetValue(item.source.sha256, out ContentPackManifest manifest))
                {
                    string path = Path.Combine(directory, item.source.sha256 + ".json");
                    if (!File.Exists(path) || new FileInfo(path).Length > 64 * 1024)
                        throw new ArgumentException("Required cached content manifest is missing or oversized. Reinstall the exact original pack: " + item.source.packId);
                    // Bound the actual read as well as the initial file stat.
                    // A concurrent cache writer cannot grow an unbounded input.
                    using (FileStream stream = File.OpenRead(path))
                    {
                        var bytes = new byte[64 * 1024 + 1];
                        int length = 0, count;
                        while (length < bytes.Length && (count = stream.Read(bytes, length, bytes.Length - length)) > 0) length += count;
                        if (length > 64 * 1024) throw new ArgumentException("Cached content manifest exceeds 64 KiB.");
                        manifest = JsonUtility.FromJson<ContentPackManifest>(new UTF8Encoding(false, true).GetString(bytes, 0, length));
                    }
                    SandboxContentRules.ValidateManifest(manifest, platform, unityVersion);
                    if (manifest.sha256 != item.source.sha256) throw new ArgumentException("Cached manifest digest does not match its saved content reference.");
                    string bundlePath = Path.Combine(directory, manifest.sha256 + ".bundle");
                    if (!File.Exists(bundlePath) || new FileInfo(bundlePath).Length != manifest.byteLength)
                        throw new ArgumentException("Required cached bundle is missing or truncated. Reinstall the exact original pack: " + manifest.packId);
                    foreach (ContentPackAsset asset in manifest.assets)
                        if (available.ContainsKey(asset.assetId) || !additions.Add(asset.assetId))
                            throw new ArgumentException("Cached content conflicts with another installed or saved pack: " + asset.assetId);
                    if (available.Count + additions.Count > SandboxContentRules.MaximumRegisteredAssets)
                        throw new ArgumentException("Restoring these packs would exceed the 512-entry runtime registry.");
                    packs.Add(manifest.sha256, manifest);
                }
                if (!SandboxContentRules.SameSource(item.source, SandboxContentRules.Source(manifest)))
                    throw new ArgumentException("Cached manifest does not match the exact saved provider, pack, version, digest, platform and Unity version.");
                bool found = false;
                foreach (ContentPackAsset asset in manifest.assets) if (asset.assetId == item.assetId) found = true;
                if (!found) throw new ArgumentException("Saved asset is absent from its cached content manifest: " + item.assetId);
            }
            return new List<ContentPackManifest>(packs.Values);
        }

        public static Uri BundleUri(string serviceUrl, string digest)
        {
            if (!Uri.TryCreate(serviceUrl, UriKind.Absolute, out Uri service) ||
                (service.Scheme != "http" && service.Scheme != "https") || !string.IsNullOrEmpty(service.UserInfo) ||
                !string.IsNullOrEmpty(service.Query) || !string.IsNullOrEmpty(service.Fragment) || service.AbsolutePath.Trim('/') != "")
                throw new ArgumentException("Content downloads require the existing PC service origin without credentials, query or path.");
            if (digest == null || digest.Length != 64) throw new ArgumentException("Invalid bundle digest.");
            foreach (char c in digest) if (!((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9'))) throw new ArgumentException("Invalid bundle digest.");
            return new Uri(service, "/api/content/files/" + digest);
        }

        public static bool VerifyFile(string path, ContentPackManifest manifest)
        {
            if (new FileInfo(path).Length != manifest.byteLength) return false;
            using (SHA256 hash = SHA256.Create()) using (FileStream stream = File.OpenRead(path))
                return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() == manifest.sha256;
        }

        private void OnDestroy()
        {
            // Placed instances may be destroyed later in the same scene teardown.
            // Do not destroy their meshes/materials ahead of SandboxWorld disposal.
            foreach (AssetBundle bundle in bundles.Values) if (bundle != null) bundle.Unload(false);
            bundles.Clear(); installedAssets.Clear();
        }

        public void CancelInstall()
        {
            // Unity stops coroutines when a GameObject is disabled/destroyed, but
            // a bridge may also own this enumerator. Explicitly release its work.
            activeOperation?.Dispose(); activeOperation = null; busy = false;
        }

        private void OnDisable() { CancelInstall(); }
    }
}
