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
            public SandboxBehaviorVisual behaviorVisual;
        }

        private readonly string roomId;
        private readonly Transform objectRoot;
        private readonly Dictionary<string, PrefabEntry> assets =
            new Dictionary<string, PrefabEntry>(StringComparer.Ordinal);
        private readonly Dictionary<string, BoundsData> assetBounds =
            new Dictionary<string, BoundsData>(StringComparer.Ordinal);
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

            var boundsByPrefab = new Dictionary<GameObject, BoundsData>();
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
                if (asset.description != null && asset.description.Length > 500)
                    throw new ArgumentException("Asset '" + asset.assetId + "' description must be at most 500 characters.", nameof(assets));
                if (this.assets.ContainsKey(asset.assetId))
                    throw new ArgumentException("Duplicate assetId '" + asset.assetId + "'.", nameof(assets));
                this.assets.Add(asset.assetId, new PrefabEntry
                {
                    assetId = asset.assetId,
                    displayName = asset.displayName ?? asset.assetId,
                    description = asset.description ?? "",
                    spawnScale = asset.spawnScale,
                    prefab = asset.prefab
                });
                if (!boundsByPrefab.TryGetValue(asset.prefab, out BoundsData localBounds))
                {
                    localBounds = MeasureStaticBounds(asset.prefab);
                    boundsByPrefab.Add(asset.prefab, localBounds);
                }
                assetBounds.Add(asset.assetId, localBounds);
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
                    origin = target.origin,
                    source = target.source,
                    semanticLabels = Clone(target.semanticLabels),
                    surface = Clone(target.surface),
                    roomPose = target.roomPose == null ? null : Clone(target.roomPose),
                    surfaceValidator = target.surfaceValidator
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
                if (!string.IsNullOrEmpty(command.placement) &&
                    (command.placement != "surface" || (command.op != "spawn" && command.op != "set_transform")))
                    throw new ArgumentException("placement accepts only 'surface' on spawn or set_transform.");
                if (command.op != "set_behavior" && HasBehaviorPayload(command.behavior))
                    throw new ArgumentException("behavior is accepted only by set_behavior.");
                if (command.op != "remove_behavior" && !string.IsNullOrEmpty(command.behaviorKind))
                    throw new ArgumentException("behaviorKind is accepted only by remove_behavior.");
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
                    case "set_behavior":
                        SetBehavior(command);
                        result.objectId = command.objectId;
                        break;
                    case "remove_behavior":
                        RemoveBehavior(command);
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
                        throw new ArgumentException("Unknown operation. Allowed: get_scene, list_assets, list_targets, spawn, select, duplicate, set_transform, set_behavior, remove_behavior, delete, clear, load, undo, redo.");
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
                assetInfos.Add(new AssetInfo { assetId = asset.assetId, displayName = asset.displayName,
                    description = asset.description, spawnScale = asset.spawnScale, localBounds = Clone(assetBounds[asset.assetId]) });
            assetInfos.Sort((a, b) => string.CompareOrdinal(a.assetId, b.assetId));

            var anchorInfos = new List<AnchorInfo>(targets.Count);
            foreach (RoomTarget target in targets.Values)
                anchorInfos.Add(new AnchorInfo { anchorId = target.anchorId, displayName = target.displayName,
                    source = target.source, semanticLabels = Clone(target.semanticLabels), surface = Clone(target.surface),
                    roomPose = target.roomPose == null ? null : Clone(target.roomPose) });
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

        // Pointer queries avoid building full snapshots every frame. Returned target
        // metadata belongs to this world and must be treated as read-only by adapters.
        public bool TryGetTarget(string id, out RoomTarget target)
        {
            target = null;
            return !disposed && id != null && targets.TryGetValue(id, out target) &&
                target.origin != null && target.origin.gameObject.activeInHierarchy;
        }

        public bool TryGetObjectId(Transform hit, out string objectId)
        {
            objectId = null;
            if (disposed || hit == null) return false;
            foreach (var entry in instances)
            {
                GameObject value = entry.Value.gameObject;
                if (value != null && value.activeInHierarchy && (hit == value.transform || hit.IsChildOf(value.transform)))
                {
                    objectId = entry.Key;
                    return true;
                }
            }
            return false;
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

        private string Spawn(SandboxCommand command, List<BehaviorData> behaviors = null)
        {
            if (!string.IsNullOrEmpty(command.objectId))
                throw new ArgumentException("spawn assigns objectId; omit objectId from the command.");
            if (instances.Count >= MaximumObjects)
                throw new ArgumentException("The scene is limited to " + MaximumObjects + " objects.");
            PrefabEntry asset = RequireAsset(command.assetId);
            RoomTarget target = RequireTarget(command.anchorId);
            ValidateTransform(command.transform);
            ValidateBehaviors(behaviors);

            var data = new SceneObjectData
            {
                objectId = Guid.NewGuid().ToString("N"),
                assetId = command.assetId,
                anchorId = command.anchorId,
                transform = ResolvePlacement(asset.assetId, target, command.transform, command.placement),
                behaviors = Clone(behaviors)
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
            }, original.data.behaviors);
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
                operation == "set_behavior" || operation == "remove_behavior" ||
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

        private static bool HasBehaviorPayload(BehaviorData value)
        {
            if (value == null) return false;
            // JsonUtility materializes an omitted inline DTO using field initializers
            // on some supported versions and all-zero values on others. Neither is
            // distinguishable from absence here; HTTP validation checks field presence.
            // A kind or any non-default payload remains an invalid foreign field.
            if (!string.IsNullOrEmpty(value.kind) || value.paused) return true;
            bool zero = !value.enabled && string.IsNullOrEmpty(value.axis) &&
                value.speedDegreesPerSecond == 0f && value.amplitudeMeters == 0f && value.frequencyHz == 0f;
            bool defaults = value.enabled && value.axis == "y" && value.speedDegreesPerSecond == 30f &&
                value.amplitudeMeters == .05f && value.frequencyHz == .5f;
            return !zero && !defaults;
        }

        private static void ValidateBehaviors(List<BehaviorData> values)
        {
            if (values == null) return;
            if (values.Count > 2) throw new ArgumentException("At most two behaviors are supported, one rotate and one bob.");
            var kinds = new HashSet<string>(StringComparer.Ordinal);
            foreach (BehaviorData value in values)
            {
                ValidateBehavior(value);
                if (!kinds.Add(value.kind)) throw new ArgumentException("Duplicate behavior kind '" + value.kind + "'.");
            }
        }

        private static void ValidateBehavior(BehaviorData value)
        {
            if (value == null || (value.kind != "rotate" && value.kind != "bob"))
                throw new ArgumentException("behavior.kind must be rotate or bob.");
            if (value.axis != "x" && value.axis != "y" && value.axis != "z")
                throw new ArgumentException("behavior.axis must be x, y, or z.");
            if (!InRange(value.speedDegreesPerSecond, -180f, 180f))
                throw new ArgumentException("behavior.speedDegreesPerSecond must be finite and between -180 and 180.");
            if (!InRange(value.amplitudeMeters, 0f, .25f))
                throw new ArgumentException("behavior.amplitudeMeters must be finite and between 0 and 0.25.");
            if (!InRange(value.frequencyHz, .05f, 2f))
                throw new ArgumentException("behavior.frequencyHz must be finite and between 0.05 and 2.");
        }

        private void SetBehavior(SandboxCommand command)
        {
            ValidateObjectOnlyCommand(command);
            Instance instance = RequireInstance(command.objectId);
            RequireTarget(instance.data.anchorId);
            ValidateBehavior(command.behavior);
            List<BehaviorData> next = Clone(instance.data.behaviors);
            int index = next.FindIndex(value => value.kind == command.behavior.kind);
            if (index < 0) next.Add(Clone(command.behavior));
            else next[index] = Clone(command.behavior);
            ValidateBehaviors(next);
            instance.behaviorVisual.Configure(next);
            instance.data.behaviors = next;
        }

        private void RemoveBehavior(SandboxCommand command)
        {
            ValidateObjectOnlyCommand(command);
            Instance instance = RequireInstance(command.objectId);
            RequireTarget(instance.data.anchorId);
            if (command.behaviorKind != "rotate" && command.behaviorKind != "bob" && command.behaviorKind != "all")
                throw new ArgumentException("behaviorKind must be rotate, bob, or all.");
            List<BehaviorData> next = Clone(instance.data.behaviors);
            if (command.behaviorKind == "all") next.Clear();
            else next.RemoveAll(value => value.kind == command.behaviorKind);
            instance.behaviorVisual.Configure(next);
            instance.data.behaviors = next;
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
            TransformData transform = ResolvePlacement(instance.data.assetId, target, command.transform, command.placement);

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
                RoomTarget target = RequireTarget(data.anchorId);
                ValidateTransform(data.transform);
                ValidateBehaviors(data.behaviors);
                // Saved transforms have already had their surface clearance resolved.
                // Revalidate them against current geometry without shifting them again.
                ResolvePlacement(data.assetId, target, data.transform, null);
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
                instance = new GameObject(asset.displayName + " [" + data.objectId + "]");
                instance.SetActive(false);
                instance.transform.SetParent(staging, false);
                GameObject visual = Object.Instantiate(asset.prefab, instance.transform, false);
                visual.name = "Visual";
                visual.transform.localPosition = Vector3.zero;
                visual.transform.localRotation = Quaternion.identity;
                visual.transform.localScale = Vector3.one;
                visual.SetActive(true);
                SandboxBehaviorVisual behaviorVisual = instance.AddComponent<SandboxBehaviorVisual>();
                behaviorVisual.Configure(visual.transform, data.behaviors);
                Apply(instance.transform, target.origin, data.transform);
                return new Instance { data = data, gameObject = instance, behaviorVisual = behaviorVisual };
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

        private TransformData ResolvePlacement(string assetId, RoomTarget target, TransformData requested, string placement)
        {
            TransformData pose = Clone(requested);
            bool physical = target.source == "mruk";
            if (!physical)
            {
                if (!string.IsNullOrEmpty(placement))
                    throw new ArgumentException("Surface placement requires a physical room support target.");
                return pose;
            }
            if (target.surface == null || target.surface.kind != "support")
                throw new ArgumentException("Anchor '" + target.anchorId + "' is not a usable support surface. Choose a floor or furniture top.");
            BoundsData bounds = assetBounds[assetId];
            if (bounds == null)
                throw new ArgumentException("Asset '" + assetId + "' has no known static bounds for physical room placement.");
            if (target.surfaceValidator == null)
                throw new InvalidOperationException("Anchor '" + target.anchorId + "' cannot validate its current MRUK surface. Reload room data.");
            List<Vector2> boundary = ReadSupportBoundary(target.surface);
            var rotation = Quaternion.Euler(ToVector3(pose.rotation));
            Vector3 scale = ToVector3(pose.scale);
            Vector3 center = ToVector3(bounds.center);
            Vector3 extent = ToVector3(bounds.size) * .5f;
            var corners = new Vector3[8];
            int index = 0;
            float minimumY = float.PositiveInfinity;
            for (int x = -1; x <= 1; x += 2)
                for (int y = -1; y <= 1; y += 2)
                    for (int z = -1; z <= 1; z += 2)
                    {
                        Vector3 point = rotation * Vector3.Scale(center + Vector3.Scale(extent, new Vector3(x, y, z)), scale);
                        if (!Finite(point))
                            throw new ArgumentException("The transformed prefab bounds are not finite.");
                        corners[index++] = point;
                        minimumY = Mathf.Min(minimumY, point.y);
                    }
            if (placement == "surface")
            {
                if (pose.position.y < 0f)
                    throw new ArgumentException("Surface placement clearance must be zero or positive.");
                pose.position.y -= minimumY;
                ValidateTransform(pose);
            }
            if (minimumY + pose.position.y < -.005f)
                throw new ArgumentException("The object would extend below its room support surface. Use surface placement or raise it.");

            Vector3 offset = ToVector3(pose.position);
            var footprint = new List<Vector2>(8);
            Vector3 projectedCenter = Vector3.zero;
            foreach (Vector3 corner in corners)
            {
                Vector3 point = corner + offset;
                point.y = 0f;
                projectedCenter += point / corners.Length;
                var planar = new Vector2(point.x, point.z);
                if (!InsideOrOnBoundary(planar, boundary))
                    throw new ArgumentException("The object's footprint extends beyond anchor '" + target.anchorId + "'. Use a smaller object or another position.");
                if (!target.surfaceValidator(point))
                    throw new ArgumentException("MRUK could not confirm the object's footprint on anchor '" + target.anchorId + "'. Reload or choose a valid surface point.");
                if (!footprint.Exists(value => (value - planar).sqrMagnitude < 1e-10f)) footprint.Add(planar);
            }
            if (!InsideOrOnBoundary(new Vector2(projectedCenter.x, projectedCenter.z), boundary) || !target.surfaceValidator(projectedCenter))
                throw new ArgumentException("The object's center is outside the current MRUK support surface.");
            // The projected render bounds form a convex footprint. Checking every
            // corner pair includes its entire outer hull, even for a tilted object.
            // Split each segment at polygon edges: corner-only tests miss concave
            // notches, and a single midpoint can miss narrow gaps near an endpoint.
            for (int a = 0; a < footprint.Count; a++)
                for (int b = a + 1; b < footprint.Count; b++)
                    if (!SegmentInsideBoundary(footprint[a], footprint[b], boundary))
                        throw new ArgumentException("The object's footprint crosses an edge of the room surface. Choose a position fully supported by the anchor.");
            return pose;
        }

        private static List<Vector2> ReadSupportBoundary(RoomSurfaceData surface)
        {
            BoundsData bounds = surface.localBounds;
            if (bounds == null || bounds.center == null || bounds.size == null ||
                !Finite(ToVector3(bounds.center)) || !Finite(ToVector3(bounds.size)) ||
                bounds.size.x <= 0f || bounds.size.y < 0f || bounds.size.z <= 0f ||
                surface.boundary == null || surface.boundary.Count < 3 || surface.boundary.Count > 512)
                throw new ArgumentException("The room support surface has missing or invalid geometry. Reload room data.");
            var polygon = new List<Vector2>(surface.boundary.Count);
            foreach (Float3 raw in surface.boundary)
            {
                if (raw == null || !Finite(ToVector3(raw)) || Mathf.Abs(raw.y) > .005f)
                    throw new ArgumentException("The room support boundary must contain finite points on its local surface plane.");
                var point = new Vector2(raw.x, raw.z);
                if (polygon.Count == 0 || (polygon[polygon.Count - 1] - point).sqrMagnitude > 1e-10f)
                    polygon.Add(point);
            }
            if (polygon.Count > 1 && (polygon[0] - polygon[polygon.Count - 1]).sqrMagnitude <= 1e-10f)
                polygon.RemoveAt(polygon.Count - 1);
            float area = 0f;
            for (int i = 0; i < polygon.Count; i++) area += Cross(polygon[i], polygon[(i + 1) % polygon.Count]);
            if (polygon.Count < 3 || !InRange(area, -float.MaxValue, float.MaxValue) || Mathf.Abs(area) <= 1e-6f)
                throw new ArgumentException("The room support boundary has no usable area.");
            for (int a = 0; a < polygon.Count; a++)
            {
                int nextA = (a + 1) % polygon.Count;
                for (int b = a + 1; b < polygon.Count; b++)
                {
                    int nextB = (b + 1) % polygon.Count;
                    if (b == nextA || nextB == a) continue;
                    if (SegmentsIntersect(polygon[a], polygon[nextA], polygon[b], polygon[nextB]))
                        throw new ArgumentException("The room support boundary intersects itself. Reload room data.");
                }
            }
            return polygon;
        }

        private static float Cross(Vector2 a, Vector2 b) { return a.x * b.y - a.y * b.x; }

        private static bool PointOnSegment(Vector2 point, Vector2 a, Vector2 b)
        {
            Vector2 edge = b - a;
            float squared = edge.sqrMagnitude;
            if (squared < 1e-10f) return (point - a).sqrMagnitude < 1e-10f;
            float t = Mathf.Clamp01(Vector2.Dot(point - a, edge) / squared);
            return (point - (a + edge * t)).sqrMagnitude <= 1e-10f;
        }

        private static bool InsideOrOnBoundary(Vector2 point, List<Vector2> polygon)
        {
            bool inside = false;
            for (int i = 0, j = polygon.Count - 1; i < polygon.Count; j = i++)
            {
                Vector2 a = polygon[j], b = polygon[i];
                if (PointOnSegment(point, a, b)) return true;
                if ((a.y > point.y) != (b.y > point.y) &&
                    point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
                    inside = !inside;
            }
            return inside;
        }

        private static bool SegmentsIntersect(Vector2 a, Vector2 b, Vector2 c, Vector2 d)
        {
            if (PointOnSegment(a, c, d) || PointOnSegment(b, c, d) || PointOnSegment(c, a, b) || PointOnSegment(d, a, b)) return true;
            float first = Cross(b - a, c - a), second = Cross(b - a, d - a);
            float third = Cross(d - c, a - c), fourth = Cross(d - c, b - c);
            return (first < 0f) != (second < 0f) && (third < 0f) != (fourth < 0f);
        }

        private static bool SegmentInsideBoundary(Vector2 a, Vector2 b, List<Vector2> polygon)
        {
            Vector2 direction = b - a;
            var cuts = new List<float> { 0f, 1f };
            for (int i = 0; i < polygon.Count; i++)
            {
                Vector2 c = polygon[i], edge = polygon[(i + 1) % polygon.Count] - c;
                float divisor = Cross(direction, edge);
                if (Mathf.Abs(divisor) > 1e-8f)
                {
                    float t = Cross(c - a, edge) / divisor;
                    float u = Cross(c - a, direction) / divisor;
                    if (t > 0f && t < 1f && u >= 0f && u <= 1f) cuts.Add(t);
                }
                else if (Mathf.Abs(Cross(c - a, direction)) <= 1e-8f)
                {
                    cuts.Add(Mathf.Clamp01(Vector2.Dot(c - a, direction) / direction.sqrMagnitude));
                    cuts.Add(Mathf.Clamp01(Vector2.Dot(c + edge - a, direction) / direction.sqrMagnitude));
                }
            }
            cuts.Sort();
            for (int i = 1; i < cuts.Count; i++)
                if (cuts[i] - cuts[i - 1] > 1e-7f && !InsideOrOnBoundary(a + direction * ((cuts[i] + cuts[i - 1]) * .5f), polygon))
                    return false;
            return true;
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

        private static BoundsData MeasureStaticBounds(GameObject prefab)
        {
            // Read mesh metadata once when registering a room, never instantiate a
            // prefab or traverse hierarchies during the bridge's frequent Capture.
            bool found = false;
            Bounds combined = default;
            Transform root = prefab.transform;
            foreach (Renderer renderer in prefab.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer.enabled) continue;
                Transform current = renderer.transform;
                Matrix4x4 toRoot = Matrix4x4.identity;
                bool visible = true;
                while (current != root)
                {
                    if (!current.gameObject.activeSelf) { visible = false; break; }
                    toRoot = Matrix4x4.TRS(current.localPosition, current.localRotation, current.localScale) * toRoot;
                    current = current.parent;
                }
                if (!visible) continue;
                // Spawn overwrites the root pose and activates the root. Its current
                // parent, pose, scale and active state therefore do not enter bounds.
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                if (!(renderer is MeshRenderer) || filter == null || filter.sharedMesh == null)
                    return null; // Do not advertise partial bounds for animated/procedural geometry.
                Bounds mesh = filter.sharedMesh.bounds;
                if (!Finite(mesh.center) || !Finite(mesh.size) || mesh.size.x < 0 || mesh.size.y < 0 || mesh.size.z < 0)
                    return null;
                for (int x = -1; x <= 1; x += 2)
                    for (int y = -1; y <= 1; y += 2)
                        for (int z = -1; z <= 1; z += 2)
                        {
                            Vector3 point = toRoot.MultiplyPoint3x4(mesh.center + Vector3.Scale(mesh.extents, new Vector3(x, y, z)));
                            if (!Finite(point)) return null;
                            if (found) combined.Encapsulate(point);
                            else { combined = new Bounds(point, Vector3.zero); found = true; }
                        }
            }
            if (!found || !Finite(combined.center) || !Finite(combined.size) ||
                combined.size.x <= 0 || combined.size.y <= 0 || combined.size.z <= 0)
                return null;
            return new BoundsData { center = new Float3(combined.center.x, combined.center.y, combined.center.z),
                size = new Float3(combined.size.x, combined.size.y, combined.size.z) };
        }

        private static bool Finite(Vector3 value)
        {
            return InRange(value.x, -float.MaxValue, float.MaxValue) &&
                InRange(value.y, -float.MaxValue, float.MaxValue) && InRange(value.z, -float.MaxValue, float.MaxValue);
        }

        private static Vector3 ToVector3(Float3 value)
        {
            return new Vector3(value.x, value.y, value.z);
        }

        private static Float3 Clone(Float3 value)
        {
            return value == null ? null : new Float3(value.x, value.y, value.z);
        }

        private static BoundsData Clone(BoundsData value)
        {
            return value == null ? null : new BoundsData { center = Clone(value.center), size = Clone(value.size) };
        }

        private static string[] Clone(string[] value)
        {
            return value == null ? null : (string[])value.Clone();
        }

        private static RoomSurfaceData Clone(RoomSurfaceData value)
        {
            if (value == null) return null;
            List<Float3> boundary = null;
            if (value.boundary != null)
            {
                boundary = new List<Float3>(value.boundary.Count);
                foreach (Float3 point in value.boundary) boundary.Add(point == null ? null : Clone(point));
            }
            return new RoomSurfaceData { kind = value.kind, boundary = boundary, localBounds = Clone(value.localBounds) };
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
                transform = Clone(value.transform),
                behaviors = Clone(value.behaviors)
            };
        }

        private static BehaviorData Clone(BehaviorData value)
        {
            return new BehaviorData { kind = value.kind, enabled = value.enabled, paused = value.paused,
                axis = value.axis, speedDegreesPerSecond = value.speedDegreesPerSecond,
                amplitudeMeters = value.amplitudeMeters, frequencyHz = value.frequencyHz };
        }

        private static List<BehaviorData> Clone(List<BehaviorData> values)
        {
            var result = new List<BehaviorData>(values == null ? 0 : values.Count);
            if (values != null) foreach (BehaviorData value in values) result.Add(Clone(value));
            return result;
        }
    }
}
