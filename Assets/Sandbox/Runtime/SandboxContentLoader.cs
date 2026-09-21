using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
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
            public bool committed;
            private bool disposed;
            public void ThrowIfDisposed() { if (disposed) throw new OperationCanceledException("Content installation was cancelled because the loader became unavailable."); }
            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
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
        {
            var receipt = new ContentInstallReceipt { requestId = request?.requestId, packId = request?.manifest?.packId,
                version = request?.manifest?.version, sha256 = request?.manifest?.sha256 };
            if (busy) { receipt.error = "Another content pack is being installed."; completed?.Invoke(receipt); yield break; }
            busy = true;
            var operation = new Operation();
            activeOperation = operation;
            IEnumerator body = InstallCore(request?.manifest, serviceUrl, token, receipt, operation);
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

        private IEnumerator InstallCore(ContentPackManifest original, string serviceUrl, string token, ContentInstallReceipt receipt, Operation operation)
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
            bool cached = File.Exists(cachedPath) && VerifyFile(cachedPath, manifest);
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
            // Persist verified metadata for explicit offline reinstallation after an app restart.
            string metadataPath = Path.Combine(CacheDirectory, manifest.sha256 + ".json");
            File.WriteAllText(metadataPath, JsonUtility.ToJson(manifest, true));
            app.RegisterContentAssets(entries);
            operation.committed = true;
            bundles.Add(manifest.sha256, operation.bundle);
            var ids = new string[entries.Length]; for (int i = 0; i < ids.Length; i++) ids[i] = entries[i].assetId;
            installedAssets.Add(manifest.sha256, ids);
            receipt.ok = true; receipt.assetIds = (string[])ids.Clone();
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
