using System;
using System.Collections.Generic;
using UnityEngine;

namespace ArSandbox
{
    public sealed class SandboxApp : MonoBehaviour
    {
        public PrefabEntry[] prefabs;
        public Material placementMaterial;
        public bool simulatedRoom;
        public SandboxWorld World { get; private set; }
        public bool RoomReloading { get; set; }
        public RoomContextData RoomContext { get; private set; }
        public bool RoomEditingAllowed => RoomContext == null || RoomContext.mode != "ar" ||
            (RoomContext.state == "ready" && RoomContext.alignmentVerified);
        public string Status { get; private set; } = "Waiting for room permission and room data.";
        public string SelectedObjectId { get; private set; }
        public string SelectedAnchorId { get; private set; }
        public Vector3 Placement { get; private set; }
        public string SelectedAssetId => prefabs != null && prefabs.Length > 0 ? prefabs[assetIndex].assetId : "";
        public string SelectedAssetName => prefabs != null && prefabs.Length > 0 ? prefabs[assetIndex].displayName : "None";
        public float SelectedAssetScale => prefabs != null && prefabs.Length > 0 ? prefabs[assetIndex].spawnScale : 0.2f;
        public IReadOnlyList<RoomTarget> Targets => targets;
        private RoomTarget[] targets = Array.Empty<RoomTarget>();
        private int assetIndex;
        private Transform objectRoot;
        private GameObject marker;
        private Material markerMaterial;
        private bool hasViewerPose;
        private Vector3 viewerPosition, viewerForward, viewerLookDirection;
        private PointingData pointing;
        private double pointingTime;
        private double viewerPoseTime;
        private Camera viewerCamera;
        private const double ViewerPoseLifetime = 1.0;

        private void Start()
        {
            if (simulatedRoom) CreateFixture();
        }

        public void InitializeWorld(string roomId, RoomTarget[] roomTargets)
        {
            // Validate replacement registries before disposing the working room and its objects.
            var replacementRoot = new GameObject("Sandbox objects").transform;
            replacementRoot.SetParent(transform, false);
            SandboxWorld replacement;
            try { replacement = new SandboxWorld(roomId, replacementRoot, prefabs, roomTargets); }
            catch { DestroyOwned(replacementRoot.gameObject); throw; }

            // A new room never inherits old world coordinates. Rebinding needs an explicit load.
            World?.Dispose();
            if (objectRoot != null) DestroyOwned(objectRoot.gameObject);
            if (marker != null) marker.SetActive(false);
            objectRoot = replacementRoot;
            targets = (RoomTarget[])roomTargets.Clone();
            World = replacement;
            ClearViewerPose();
            ClearPointingTarget();
            SelectedObjectId = null;
            SelectedAnchorId = null;
            Placement = Vector3.zero;
            foreach (var target in targets)
                if (target.source != "mruk" || target.surface?.kind == "support") { SetPlacement(target.anchorId, Vector3.zero); break; }
            Status = simulatedRoom ? "SIMULATED ROOM — desktop fixture" : "Room loaded. Aim at a surface and press trigger, then A to add a prop.";
        }

        public void ReportStatus(string message) { Status = message; }

        public void RegisterContentAssets(PrefabEntry[] additions)
        {
            if (World == null || RoomReloading) throw new InvalidOperationException("Wait for room localization before installing content; the current room is unavailable.");
            if (additions == null) throw new ArgumentNullException(nameof(additions));
            var combined = new PrefabEntry[(prefabs?.Length ?? 0) + additions.Length];
            if (prefabs != null) Array.Copy(prefabs, combined, prefabs.Length);
            for (int i = 0; i < additions.Length; i++)
            {
                PrefabEntry item = additions[i];
                if (item == null) throw new ArgumentException("Content registry contains a null entry.");
                combined[(prefabs?.Length ?? 0) + i] = new PrefabEntry { assetId = item.assetId, displayName = item.displayName,
                    description = item.description, spawnScale = item.spawnScale, prefab = item.prefab, source = SandboxContentRules.Clone(item.source) };
            }
            World.RegisterAssets(additions);
            prefabs = combined;
            // Keep selection, placed instances, undo/redo and anchor ownership unchanged.
        }

        public void SetRoomContext(string state, string message, bool verified = false)
        {
            RoomContext = new RoomContextData { mode = "ar", state = state, message = message, alignmentVerified = verified && state == "ready" };
            Status = message;
        }

        public SandboxSnapshot CaptureSnapshot()
        {
            if (World == null || RoomReloading) return null;
            bool readOnly = RoomContext?.mode == "ar" && RoomContext.state != "ready";
            var snapshot = World.Capture();
            snapshot.readOnly = readOnly;
            snapshot.selection = new SelectionData { anchorId = SelectedAnchorId, objectId = SelectedObjectId, position = Vec(Placement) };
            snapshot.viewer = readOnly ? new ViewerData() : CaptureViewer() ?? new ViewerData();
            snapshot.pointing = readOnly ? new PointingData() : CapturePointing() ?? new PointingData();
            if (RoomContext != null) snapshot.roomContext = new RoomContextData { mode = RoomContext.mode,
                state = RoomContext.state, message = RoomContext.message, alignmentVerified = RoomContext.alignmentVerified };
            return snapshot;
        }

        public void SetPointingTarget(string anchorId, string objectId, Vector3 localHit, Vector3 localNormal, Vector3 localRayOrigin, Vector3 localRayDirection)
        {
            if (World == null || RoomReloading || !Finite(localHit) || !Finite(localNormal) || !Finite(localRayOrigin) ||
                !Finite(localRayDirection) || localNormal.sqrMagnitude < .0001f || localRayDirection.sqrMagnitude < .0001f)
            { ClearPointingTarget(); return; }
            pointing = new PointingData { anchorId = anchorId, objectId = objectId ?? "", position = Vec(localHit),
                normal = Vec(localNormal.normalized), origin = Vec(localRayOrigin), direction = Vec(localRayDirection.normalized) };
            pointingTime = Time.realtimeSinceStartupAsDouble;
        }

        public void ClearPointingTarget() { pointing = null; pointingTime = 0; }

        public PointingData CapturePointing()
        {
            if (pointing == null || Time.realtimeSinceStartupAsDouble - pointingTime >= 1 || World == null || RoomReloading) return null;
            if (!World.TryGetTarget(pointing.anchorId, out var target)) return null;
            if (!string.IsNullOrEmpty(pointing.objectId) &&
                (!World.TryGetObject(pointing.objectId, out var value) || !value.transform.IsChildOf(target.origin))) return null;
            return JsonUtility.FromJson<PointingData>(JsonUtility.ToJson(pointing));
        }

        public void InvalidateRoom(string message)
        {
            // Room adapters call this before removing anchors, after guarding against unsaved objects.
            World?.Dispose();
            World = null;
            ClearViewerPose();
            ClearPointingTarget();
            if (objectRoot != null) DestroyOwned(objectRoot.gameObject);
            objectRoot = null;
            if (marker != null) DestroyOwned(marker);
            marker = null;
            if (markerMaterial != null) DestroyOwned(markerMaterial);
            markerMaterial = null;
            targets = Array.Empty<RoomTarget>();
            SelectedObjectId = null;
            SelectedAnchorId = null;
            Placement = Vector3.zero;
            Status = message;
        }

        public void SetPlacement(string anchorId, Vector3 localPosition)
        {
            foreach (var target in targets)
            {
                if (target.anchorId != anchorId || target.origin == null || !target.origin.gameObject.activeInHierarchy) continue;
                SelectedAnchorId = anchorId;
                Placement = localPosition;
                if (marker == null)
                {
                    marker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    marker.name = "Selected placement";
                    DestroyOwned(marker.GetComponent<Collider>());
                    if (placementMaterial == null) { DestroyOwned(marker); marker = null; Status = "Placement material is missing."; return; }
                    if (markerMaterial != null) DestroyOwned(markerMaterial);
                    markerMaterial = new Material(placementMaterial);
                    markerMaterial.color = new Color(0.1f, 1f, 0.75f);
                    marker.GetComponent<Renderer>().sharedMaterial = markerMaterial;
                }
                marker.transform.SetParent(target.origin, false);
                marker.transform.localPosition = localPosition;
                marker.transform.localScale = Vector3.one * 0.035f;
                marker.SetActive(true);
                return;
            }
            Status = "The selected room target is unavailable.";
        }

        public void CycleAsset() { if (prefabs != null && prefabs.Length > 0) assetIndex = (assetIndex + 1) % prefabs.Length; }

        public void SetViewerPose(Vector3 worldPosition, Vector3 worldForward, Camera camera = null)
        {
            if (World == null || RoomReloading || !isActiveAndEnabled || !Finite(worldPosition) || !Finite(worldForward))
            { ClearViewerPose(); return; }
            // A vertical gaze cannot ground horizontal placement, but remains a valid
            // tracked camera for an explicit rendered-scene capture.
            bool horizontal = TryHorizontalDirection(worldForward, out Vector3 direction);
            viewerPosition = worldPosition;
            viewerForward = direction;
            viewerLookDirection = worldForward.normalized;
            viewerPoseTime = Time.realtimeSinceStartupAsDouble;
            hasViewerPose = horizontal;
            viewerCamera = camera;
        }

        public Camera CaptureCamera
        {
            get
            {
                double age = Time.realtimeSinceStartupAsDouble - viewerPoseTime;
                return isActiveAndEnabled && World != null && !RoomReloading && age >= 0 && age < ViewerPoseLifetime &&
                    viewerCamera != null && viewerCamera.isActiveAndEnabled ? viewerCamera : null;
            }
        }

        public void ClearViewerPose()
        {
            hasViewerPose = false;
            viewerCamera = null;
            viewerPosition = viewerForward = viewerLookDirection = Vector3.zero;
            viewerPoseTime = 0;
        }

        public ViewerData CaptureViewer()
        {
            double age = Time.realtimeSinceStartupAsDouble - viewerPoseTime;
            if (!hasViewerPose || World == null || RoomReloading || !isActiveAndEnabled || age < 0 || age >= ViewerPoseLifetime)
                return null;
            var frames = new List<ViewerFrame>();
            foreach (RoomTarget target in targets)
            {
                Transform origin = target.origin;
                if (origin == null || !origin.gameObject.activeInHierarchy) continue;
                Matrix4x4 matrix = origin.localToWorldMatrix;
                float determinant = matrix.determinant;
                if (float.IsNaN(determinant) || float.IsInfinity(determinant) || Mathf.Abs(determinant) < .00000001f) continue;
                Vector3 right = origin.TransformVector(Vector3.right).normalized;
                Vector3 up = origin.TransformVector(Vector3.up).normalized;
                Vector3 ahead = origin.TransformVector(Vector3.forward).normalized;
                // This identifies horizontal placement frames, not semantic floor
                // labels. Table frames can also qualify; the planner sees their IDs.
                if (!Finite(right) || !Finite(up) || !Finite(ahead) || right.sqrMagnitude < .99f || ahead.sqrMagnitude < .99f ||
                    Vector3.Dot(up, Vector3.up) < .999f ||
                    Mathf.Abs(right.y) > .01f || Mathf.Abs(ahead.y) > .01f) continue;
                Vector3 position = origin.InverseTransformPoint(viewerPosition);
                Vector3 direction = origin.InverseTransformVector(viewerForward);
                direction.y = 0f;
                if (!Finite(position) || Mathf.Abs(position.x) > 10000 || Mathf.Abs(position.y) > 10000 || Mathf.Abs(position.z) > 10000 ||
                    !TryHorizontalDirection(direction, out Vector3 normalized)) continue;
                frames.Add(new ViewerFrame { anchorId = target.anchorId, position = Vec(position), forward = Vec(normalized),
                    lookDirection = Vec(origin.InverseTransformDirection(viewerLookDirection).normalized) });
            }
            frames.Sort((a, b) => string.CompareOrdinal(a.anchorId, b.anchorId));
            return frames.Count == 0 ? null : new ViewerData { frames = frames };
        }

        private static bool Finite(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) && !float.IsNaN(value.y) &&
                !float.IsInfinity(value.y) && !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        }

        private static bool TryHorizontalDirection(Vector3 value, out Vector3 direction)
        {
            direction = Vector3.zero;
            if (!Finite(value)) return false;
            float maximum = Mathf.Max(Mathf.Abs(value.x), Mathf.Abs(value.y), Mathf.Abs(value.z));
            if (maximum <= 0) return false;
            // Normalize safely even for finite components whose squared magnitude overflows.
            Vector3 unit = (value / maximum).normalized;
            unit.y = 0;
            if (unit.sqrMagnitude < .0001f) return false; // Near-vertical gaze has no stable horizontal heading.
            direction = unit.normalized;
            return true;
        }

        public void SpawnSelected()
        {
            if (World == null || string.IsNullOrEmpty(SelectedAnchorId)) { Status = "Select an available room surface first."; return; }
            Execute(new SandboxCommand { op = "spawn", assetId = SelectedAssetId, anchorId = SelectedAnchorId,
                transform = Pose(Placement, Vector3.zero, Vector3.one * SelectedAssetScale),
                placement = World.TryGetTarget(SelectedAnchorId, out var target) && target.source == "mruk" ? "surface" : null });
        }

        public CommandResult Execute(SandboxCommand command)
        {
            if (command?.op == "confirm_room")
            {
                if (RoomReloading || World == null || RoomContext?.mode != "ar" || RoomContext.state != "ready")
                    return new CommandResult { requestId = command.requestId, ok = false, error = "Load a configured real room before confirming alignment." };
                SetRoomContext("ready", "Room alignment confirmed. Select a surface or ask the Operator to place a prop.", true);
                return new CommandResult { requestId = command.requestId, ok = true };
            }
            if (!RoomEditingAllowed && command != null && command.op != "clear" &&
                !(command.op == "select" && RoomContext?.state == "ready") &&
                command.op != "get_scene" && command.op != "list_assets" && command.op != "list_targets")
                return new CommandResult { requestId = command.requestId, ok = false, error = RoomContext?.state == "ready" ?
                    "Verify the labeled room outlines and confirm alignment in the PC Operator first." :
                    "Room is unavailable. Save or clear the retained scene before reloading room data." };
            if (RoomReloading) return new CommandResult { requestId = command?.requestId, ok = false, error = "Room reload in progress." };
            if (World == null) return new CommandResult { requestId = command?.requestId, ok = false, error = "Room is not ready." };
            var result = World.Execute(command);
            if (result.ok)
            {
                if (command.op == "spawn" || command.op == "set_transform" || command.op == "select" || command.op == "duplicate" ||
                    command.op == "set_behavior" || command.op == "remove_behavior")
                    SelectedObjectId = result.objectId;
                if (command.op == "clear" || (command.op == "delete" && command.objectId == SelectedObjectId)) SelectedObjectId = null;
                if ((command.op == "load" || command.op == "undo" || command.op == "redo") &&
                    !World.TryGetObject(SelectedObjectId, out _)) SelectedObjectId = null;
            }
            Status = result.ok ? command.op + " complete" : result.error;
            return result;
        }

        public void SelectObject(string id)
        {
            if (string.IsNullOrEmpty(id)) { SelectedObjectId = null; return; }
            Execute(new SandboxCommand { op = "select", objectId = id });
        }

        public void EditSelected(Vector3 delta, float yaw, float sizeFactor)
        {
            if (World == null) return;
            foreach (var item in World.Capture().scene.objects)
            {
                if (item.objectId != SelectedObjectId) continue;
                var pose = item.transform;
                pose.position.x += delta.x; pose.position.y += delta.y; pose.position.z += delta.z;
                pose.rotation.y += yaw;
                pose.scale.x *= sizeFactor; pose.scale.y *= sizeFactor; pose.scale.z *= sizeFactor;
                Execute(new SandboxCommand { op = "set_transform", objectId = item.objectId, transform = pose });
                return;
            }
            Status = "Select an object to edit.";
        }

        public static TransformData Pose(Vector3 position, Vector3 rotation, Vector3 scale)
        {
            return new TransformData { position = Vec(position), rotation = Vec(rotation), scale = Vec(scale) };
        }
        public static Float3 Vec(Vector3 value) { return new Float3 { x = value.x, y = value.y, z = value.z }; }

        private void CreateFixture()
        {
            var floor = new GameObject("Simulated floor target").transform;
            floor.SetParent(transform, false);
            var table = new GameObject("Simulated table target").transform;
            table.SetParent(transform, false); table.localPosition = new Vector3(0, 0.8f, 0);
            InitializeWorld("simulated-room-v1", new[] {
                new RoomTarget { anchorId = "sim-floor", displayName = "Floor (simulated)", origin = floor },
                new RoomTarget { anchorId = "sim-table", displayName = "Table (simulated)", origin = table }
            });
            SetPlacement("sim-table", Vector3.zero);
        }

        private void OnDestroy()
        {
            World?.Dispose();
            if (marker != null) DestroyOwned(marker);
            if (markerMaterial != null) DestroyOwned(markerMaterial);
        }

        private void OnDisable() { ClearViewerPose(); }

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
