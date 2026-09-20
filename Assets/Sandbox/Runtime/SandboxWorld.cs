using System;
using System.Collections.Generic;
using UnityEngine;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>
    /// Owns the whitelisted prefab instances and their portable scene state.
    /// Call every method on Unity's main thread. File and network access belong to callers.
    /// </summary>
    public sealed class SandboxWorld : IDisposable
    {
        public const int MaximumObjects = 100;
        public const float MaximumPosition = 100f;
        public const float MinimumScale = 0.01f;
        public const float MaximumScale = 20f;
        public const int MaximumHistory = 32;

        private const int MaximumIdLength = 128;
        private const float MaximumRotation = 36000f;

        private sealed class Instance
        {
            public SceneObjectData data;
            public GameObject gameObject;
        }

        private readonly string roomId;
        private readonly Transform objectRoot;
        private readonly Dictionary<string, PrefabEntry> assets =
            new Dictionary<string, PrefabEntry>(StringComparer.Ordinal);
        private readonly Dictionary<string, RoomTarget> targets =
            new Dictionary<string, RoomTarget>(StringComparer.Ordinal);
        private Dictionary<string, Instance> instances =
            new Dictionary<string, Instance>(StringComparer.Ordinal);
        private readonly List<SceneData> undoHistory = new List<SceneData>();
        private readonly List<SceneData> redoHistory = new List<SceneData>();
        private bool disposed;

        public int UndoCount => undoHistory.Count;
        public int RedoCount => redoHistory.Count;

        public SandboxWorld(string roomId, Transform objectRoot, PrefabEntry[] assets, RoomTarget[] targets)
        {
            ValidateId(roomId, "roomId");
            if (objectRoot == null)
                throw new ArgumentException("An object root is required.", nameof(objectRoot));
            if (assets == null)
                throw new ArgumentNullException(nameof(assets));
            if (targets == null)
                throw new ArgumentNullException(nameof(targets));

            this.roomId = roomId;
            this.objectRoot = objectRoot;

            foreach (PrefabEntry asset in assets)
            {
                if (asset == null)
                    throw new ArgumentException("The asset registry contains a null entry.", nameof(assets));
                ValidateId(asset.assetId, "assetId");
                if (asset.prefab == null)
                    throw new ArgumentException("Asset '" + asset.assetId + "' has no prefab.", nameof(assets));
                if (!InRange(asset.spawnScale, MinimumScale, MaximumScale))
                    throw new ArgumentException("Asset '" + asset.assetId + "' spawnScale must be finite and between " +
                        MinimumScale + " and " + MaximumScale + ".", nameof(assets));
                if (this.assets.ContainsKey(asset.assetId))
                    throw new ArgumentException("Duplicate assetId '" + asset.assetId + "'.", nameof(assets));
                this.assets.Add(asset.assetId, new PrefabEntry
                {
                    assetId = asset.assetId,
                    displayName = asset.displayName ?? asset.assetId,
                    spawnScale = asset.spawnScale,
                    prefab = asset.prefab
                });
            }

            foreach (RoomTarget target in targets)
            {
                if (target == null)
                    throw new ArgumentException("The target registry contains a null entry.", nameof(targets));
                ValidateId(target.anchorId, "anchorId");
                if (target.origin == null)
                    throw new ArgumentException("Target '" + target.anchorId + "' has no origin.", nameof(targets));
                if (this.targets.ContainsKey(target.anchorId))
                    throw new ArgumentException("Duplicate anchorId '" + target.anchorId + "'.", nameof(targets));
                this.targets.Add(target.anchorId, new RoomTarget
                {
                    anchorId = target.anchorId,
                    displayName = target.displayName ?? target.anchorId,
                    origin = target.origin
                });
            }
        }

        public CommandResult Execute(SandboxCommand command)
        {
            var result = new CommandResult { requestId = command == null ? null : command.requestId };
            try
            {
                ThrowIfDisposed();
                if (command == null)
                    throw new ArgumentException("A command is required.");
                ValidateRequestId(command.requestId);
                SceneData before = IsMutation(command.op) ? Capture().scene : null;

                switch (command.op)
                {
                    case "get_scene":
                    case "list_assets":
                    case "list_targets":
                        // The caller returns Capture() alongside this acknowledgement.
                        break;
                    case "spawn":
                        result.objectId = Spawn(command);
                        break;
                    case "select":
                        ValidateObjectOnlyCommand(command);
                        RequireInstance(command.objectId);
                        result.objectId = command.objectId;
                        break;
                    case "duplicate":
                        ValidateObjectOnlyCommand(command);
                        result.objectId = Duplicate(command.objectId);
                        break;
                    case "set_transform":
                        SetTransform(command);
                        result.objectId = command.objectId;
                        break;
                    case "delete":
                        Delete(command.objectId);
                        result.objectId = command.objectId;
                        break;
                    case "clear":
                        ClearInstances();
                        break;
                    case "load":
                        Load(command.scene);
                        break;
                    case "undo":
                        ValidateHistoryCommand(command);
                        Replay(undoHistory, redoHistory, "undo");
                        break;
                    case "redo":
                        ValidateHistoryCommand(command);
                        Replay(redoHistory, undoHistory, "redo");
                        break;
                    default:
                        throw new ArgumentException("Unknown operation. Allowed: get_scene, list_assets, list_targets, spawn, select, duplicate, set_transform, delete, clear, load, undo, redo.");
                }
                if (before != null)
                {
                    PushHistory(undoHistory, before);
                    redoHistory.Clear();
                }
                result.ok = true;
            }
            catch (Exception exception)
            {
                result.ok = false;
                result.error = exception.Message;
            }
            return result;
        }

        public SandboxSnapshot Capture()
        {
            ThrowIfDisposed();
            var scene = new SceneData
            {
                schemaVersion = 1,
                roomId = roomId,
                objects = new List<SceneObjectData>(instances.Count)
            };
            foreach (Instance instance in instances.Values)
                scene.objects.Add(Clone(instance.data));
            scene.objects.Sort((a, b) => string.CompareOrdinal(a.objectId, b.objectId));

            var assetInfos = new List<AssetInfo>(assets.Count);
            foreach (PrefabEntry asset in assets.Values)
                assetInfos.Add(new AssetInfo { assetId = asset.assetId, displayName = asset.displayName, spawnScale = asset.spawnScale });
            assetInfos.Sort((a, b) => string.CompareOrdinal(a.assetId, b.assetId));

            var anchorInfos = new List<AnchorInfo>(targets.Count);
            foreach (RoomTarget target in targets.Values)
                anchorInfos.Add(new AnchorInfo { anchorId = target.anchorId, displayName = target.displayName });
            anchorInfos.Sort((a, b) => string.CompareOrdinal(a.anchorId, b.anchorId));

            return new SandboxSnapshot { scene = scene, assets = assetInfos, anchors = anchorInfos };
        }

        public bool TryGetObject(string id, out GameObject value)
        {
            value = null;
            if (disposed || id == null || !instances.TryGetValue(id, out Instance instance) || instance.gameObject == null)
                return false;
            value = instance.gameObject;
            return true;
        }

        public void Dispose()
        {
            if (disposed)
                return;
            ClearInstances();
            undoHistory.Clear();
            redoHistory.Clear();
            disposed = true;
        }

        public static TransformData DefaultTransform()
        {
            return new TransformData
            {
                position = new Float3(0f, 0f, 0f),
                rotation = new Float3(0f, 0f, 0f),
                scale = new Float3(1f, 1f, 1f)
            };
        }

        private string Spawn(SandboxCommand command)
        {
            if (!string.IsNullOrEmpty(command.objectId))
                throw new ArgumentException("spawn assigns objectId; omit objectId from the command.");
            if (instances.Count >= MaximumObjects)
                throw new ArgumentException("The scene is limited to " + MaximumObjects + " objects.");
            PrefabEntry asset = RequireAsset(command.assetId);
            RoomTarget target = RequireTarget(command.anchorId);
            ValidateTransform(command.transform);

            var data = new SceneObjectData
            {
                objectId = Guid.NewGuid().ToString("N"),
                assetId = command.assetId,
                anchorId = command.anchorId,
                transform = Clone(command.transform)
            };
            Instance instance = CreateInactive(data, asset, target, null);
            try
            {
                instance.gameObject.SetActive(true);
                instances.Add(data.objectId, instance);
                return data.objectId;
            }
            catch
            {
                DestroyOwned(instance.gameObject);
                throw;
            }
        }

        private string Duplicate(string objectId)
        {
            Instance original = RequireInstance(objectId);
            TransformData pose = Clone(original.data.transform);
            pose.position.x = Mathf.Min(MaximumPosition, pose.position.x + 0.3f);
            return Spawn(new SandboxCommand
            {
                op = "spawn",
                assetId = original.data.assetId,
                anchorId = original.data.anchorId,
                transform = pose
            });
        }

        private Instance RequireInstance(string objectId)
        {
            ValidateId(objectId, "objectId");
            if (!instances.TryGetValue(objectId, out Instance instance))
                throw new ArgumentException("Unknown objectId '" + objectId + "'.");
            if (instance.gameObject == null)
                throw new InvalidOperationException("The object is unavailable. Its room anchor may have been removed; reacquire the room before restoring it.");
            return instance;
        }

        private static bool IsMutation(string operation)
        {
            return operation == "spawn" || operation == "duplicate" || operation == "set_transform" ||
                operation == "delete" || operation == "clear" || operation == "load";
        }

        private static void ValidateObjectOnlyCommand(SandboxCommand command)
        {
            if (!string.IsNullOrEmpty(command.assetId) || !string.IsNullOrEmpty(command.anchorId) ||
                HasTransformPayload(command.transform) || HasScenePayload(command.scene))
                throw new ArgumentException(command.op + " accepts only objectId and an optional requestId.");
        }

        private static void ValidateHistoryCommand(SandboxCommand command)
        {
            if (!string.IsNullOrEmpty(command.objectId) || !string.IsNullOrEmpty(command.assetId) || !string.IsNullOrEmpty(command.anchorId) ||
                HasTransformPayload(command.transform) || HasScenePayload(command.scene))
                throw new ArgumentException(command.op + " accepts only an optional requestId.");
        }

        // JsonUtility can materialize omitted inline DTOs and strings as empty defaults.
        // The HTTP schema checks field presence; here reject meaningful extra payloads,
        // while accepting the indistinguishable defaults of a valid wire command.
        private static bool HasTransformPayload(TransformData value)
        {
            return value != null && (HasVectorPayload(value.position) || HasVectorPayload(value.rotation) || HasVectorPayload(value.scale));
        }

        private static bool HasVectorPayload(Float3 value)
        {
            return value != null && (value.x != 0f || value.y != 0f || value.z != 0f);
        }

        private static bool HasScenePayload(SceneData value)
        {
            return value != null && (!string.IsNullOrEmpty(value.roomId) || (value.objects != null && value.objects.Count > 0) ||
                (value.schemaVersion != 0 && value.schemaVersion != 1));
        }

        private static void PushHistory(List<SceneData> history, SceneData scene)
        {
            if (history.Count == MaximumHistory) history.RemoveAt(0);
            history.Add(scene);
        }

        private void Replay(List<SceneData> from, List<SceneData> to, string operation)
        {
            if (from.Count == 0)
                throw new InvalidOperationException("There is no scene change to " + operation + ".");
            SceneData current = Capture().scene;
            // Load stages and validates the complete replacement before removing any live object.
            // Retain both stacks when an anchor or prefab prevents the replay.
            Load(from[from.Count - 1]);
            from.RemoveAt(from.Count - 1);
            PushHistory(to, current);
        }

        private void SetTransform(SandboxCommand command)
        {
            ValidateId(command.objectId, "objectId");
            if (!instances.TryGetValue(command.objectId, out Instance instance))
                throw new ArgumentException("Unknown objectId '" + command.objectId + "'.");
            if (instance.gameObject == null)
                throw new InvalidOperationException("The object is unavailable. Its room anchor may have been removed; reacquire the room before restoring it.");
            string anchorId = string.IsNullOrEmpty(command.anchorId) ? instance.data.anchorId : command.anchorId;
            RoomTarget target = RequireTarget(anchorId);
            ValidateTransform(command.transform);
            TransformData transform = Clone(command.transform);

            Apply(instance.gameObject.transform, target.origin, transform);
            instance.data.anchorId = anchorId;
            instance.data.transform = transform;
        }

        private void Delete(string objectId)
        {
            ValidateId(objectId, "objectId");
            if (!instances.TryGetValue(objectId, out Instance instance))
                throw new ArgumentException("Unknown objectId '" + objectId + "'.");
            DestroyOwned(instance.gameObject);
            instances.Remove(objectId);
        }

        private void Load(SceneData scene)
        {
            // Finish validation and cloning before creating or removing any Unity object.
            List<SceneObjectData> validated = ValidateScene(scene);
            if (objectRoot == null)
                throw new InvalidOperationException("The sandbox object root is unavailable.");

            var replacement = new Dictionary<string, Instance>(StringComparer.Ordinal);
            GameObject staging = null;
            try
            {
                staging = new GameObject("Sandbox load staging");
                staging.SetActive(false);
                staging.transform.SetParent(objectRoot, false);
                foreach (SceneObjectData data in validated)
                {
                    Instance instance = CreateInactive(data, assets[data.assetId], targets[data.anchorId], staging.transform);
                    replacement.Add(data.objectId, instance);
                }
            }
            catch
            {
                foreach (Instance instance in replacement.Values)
                    DestroyOwned(instance.gameObject);
                throw;
            }
            finally
            {
                DestroyOwned(staging);
            }

            // Staged instances have already been parented and posed, but remain inactive.
            // A failed validation or instantiation above leaves all previous objects untouched.
            ClearInstances();
            instances = replacement;
            foreach (Instance instance in instances.Values)
                instance.gameObject.SetActive(true);
        }

        private List<SceneObjectData> ValidateScene(SceneData scene)
        {
            if (scene == null)
                throw new ArgumentException("load requires a scene document.");
            if (scene.schemaVersion != 1)
                throw new ArgumentException("Unsupported scene schemaVersion; expected 1.");
            ValidateId(scene.roomId, "roomId");
            if (!string.Equals(scene.roomId, roomId, StringComparison.Ordinal))
                throw new ArgumentException("The saved roomId does not match the current room. Current objects were preserved.");
            if (scene.objects == null)
                throw new ArgumentException("The scene must contain an objects array.");
            if (scene.objects.Count > MaximumObjects)
                throw new ArgumentException("The scene is limited to " + MaximumObjects + " objects.");

            var result = new List<SceneObjectData>(scene.objects.Count);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (SceneObjectData data in scene.objects)
            {
                if (data == null)
                    throw new ArgumentException("The scene contains a null object entry.");
                ValidateId(data.objectId, "objectId");
                if (!seen.Add(data.objectId))
                    throw new ArgumentException("Duplicate objectId '" + data.objectId + "'.");
                RequireAsset(data.assetId);
                RequireTarget(data.anchorId);
                ValidateTransform(data.transform);
                result.Add(Clone(data));
            }
            return result;
        }

        private Instance CreateInactive(SceneObjectData data, PrefabEntry asset, RoomTarget target, Transform staging)
        {
            GameObject instance = null;
            GameObject temporaryStaging = null;
            try
            {
                // An inactive parent prevents prefab OnEnable from running before its validated pose is applied.
                if (staging == null)
                {
                    if (objectRoot == null)
                        throw new InvalidOperationException("The sandbox object root is unavailable.");
                    temporaryStaging = new GameObject("Sandbox spawn staging");
                    temporaryStaging.SetActive(false);
                    temporaryStaging.transform.SetParent(objectRoot, false);
                    staging = temporaryStaging.transform;
                }
                instance = Object.Instantiate(asset.prefab, staging, false);
                instance.SetActive(false);
                instance.name = asset.displayName + " [" + data.objectId + "]";
                Apply(instance.transform, target.origin, data.transform);
                return new Instance { data = data, gameObject = instance };
            }
            catch
            {
                DestroyOwned(instance);
                throw;
            }
            finally
            {
                DestroyOwned(temporaryStaging);
            }
        }

        private PrefabEntry RequireAsset(string assetId)
        {
            ValidateId(assetId, "assetId");
            if (!assets.TryGetValue(assetId, out PrefabEntry asset))
                throw new ArgumentException("Unknown assetId '" + assetId + "'. Only registered prefabs are permitted.");
            if (asset.prefab == null)
                throw new InvalidOperationException("The prefab for assetId '" + assetId + "' is unavailable.");
            return asset;
        }

        private RoomTarget RequireTarget(string anchorId)
        {
            ValidateId(anchorId, "anchorId");
            if (!targets.TryGetValue(anchorId, out RoomTarget target))
                throw new ArgumentException("Unknown anchorId '" + anchorId + "'. Current objects were preserved.");
            if (target.origin == null || !target.origin.gameObject.activeInHierarchy)
                throw new InvalidOperationException("Anchor '" + anchorId + "' is unavailable. Reacquire the room before placing or restoring objects.");
            return target;
        }

        private static void Apply(Transform instance, Transform origin, TransformData data)
        {
            instance.SetParent(origin, false);
            instance.localPosition = ToVector3(data.position);
            instance.localRotation = Quaternion.Euler(ToVector3(data.rotation));
            instance.localScale = ToVector3(data.scale);
        }

        private void ClearInstances()
        {
            foreach (Instance instance in instances.Values)
                DestroyOwned(instance.gameObject);
            instances.Clear();
        }

        private static void DestroyOwned(GameObject value)
        {
            if (value == null)
                return;
            // Destroy is deferred in play mode; deactivate immediately to avoid one-frame duplicates.
            value.SetActive(false);
            if (Application.isPlaying)
                Object.Destroy(value);
            else
                Object.DestroyImmediate(value);
        }

        private void ThrowIfDisposed()
        {
            if (disposed)
                throw new ObjectDisposedException(nameof(SandboxWorld));
        }

        private static void ValidateId(string value, string name)
        {
            if (string.IsNullOrEmpty(value) || value.Length > MaximumIdLength)
                throw new ArgumentException(name + " must contain 1 to " + MaximumIdLength + " characters.");
            foreach (char character in value)
            {
                bool valid = (character >= 'a' && character <= 'z') ||
                             (character >= 'A' && character <= 'Z') ||
                             (character >= '0' && character <= '9') ||
                             character == '-' || character == '_' || character == '.' || character == ':';
                if (!valid)
                    throw new ArgumentException(name + " may contain only letters, digits, hyphens, underscores, periods, and colons.");
            }
        }

        private static void ValidateRequestId(string value)
        {
            if (value == null)
                return;
            if (value.Length > MaximumIdLength)
                throw new ArgumentException("requestId must be at most " + MaximumIdLength + " characters.");
            foreach (char character in value)
            {
                if (char.IsControl(character))
                    throw new ArgumentException("requestId cannot contain control characters.");
            }
        }

        private static void ValidateTransform(TransformData data)
        {
            if (data == null || data.position == null || data.rotation == null || data.scale == null)
                throw new ArgumentException("A full transform with position, rotation, and scale vectors is required.");
            ValidateVector(data.position, -MaximumPosition, MaximumPosition, "position");
            ValidateVector(data.rotation, -MaximumRotation, MaximumRotation, "rotation");
            ValidateVector(data.scale, MinimumScale, MaximumScale, "scale");
        }

        private static void ValidateVector(Float3 vector, float minimum, float maximum, string name)
        {
            if (!InRange(vector.x, minimum, maximum) || !InRange(vector.y, minimum, maximum) || !InRange(vector.z, minimum, maximum))
                throw new ArgumentException(name + " components must be finite and between " + minimum + " and " + maximum + ".");
        }

        private static bool InRange(float value, float minimum, float maximum)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value) && value >= minimum && value <= maximum;
        }

        private static Vector3 ToVector3(Float3 value)
        {
            return new Vector3(value.x, value.y, value.z);
        }

        private static Float3 Clone(Float3 value)
        {
            return new Float3(value.x, value.y, value.z);
        }

        private static TransformData Clone(TransformData value)
        {
            return new TransformData { position = Clone(value.position), rotation = Clone(value.rotation), scale = Clone(value.scale) };
        }

        private static SceneObjectData Clone(SceneObjectData value)
        {
            return new SceneObjectData
            {
                objectId = value.objectId,
                assetId = value.assetId,
                anchorId = value.anchorId,
                transform = Clone(value.transform)
            };
        }
    }
}
