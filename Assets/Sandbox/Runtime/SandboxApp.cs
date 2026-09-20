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
        public string Status { get; private set; } = "Waiting for room permission and room data.";
        public string SelectedObjectId { get; private set; }
        public string SelectedAnchorId { get; private set; }
        public Vector3 Placement { get; private set; }
        public string SelectedAssetId => prefabs != null && prefabs.Length > 0 ? prefabs[assetIndex].assetId : "";
        public string SelectedAssetName => prefabs != null && prefabs.Length > 0 ? prefabs[assetIndex].displayName : "None";
        public IReadOnlyList<RoomTarget> Targets => targets;
        private RoomTarget[] targets = Array.Empty<RoomTarget>();
        private int assetIndex;
        private Transform objectRoot;
        private GameObject marker;
        private Material markerMaterial;

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
            SelectedObjectId = null;
            SelectedAnchorId = null;
            Placement = Vector3.zero;
            if (targets.Length > 0) SetPlacement(targets[0].anchorId, Vector3.zero);
            Status = simulatedRoom ? "SIMULATED ROOM — desktop fixture" : "Room loaded. Aim at a surface and press trigger, then A to add a prop.";
        }

        public void ReportStatus(string message) { Status = message; }

        public void InvalidateRoom(string message)
        {
            // Room adapters call this before removing anchors, after guarding against unsaved objects.
            World?.Dispose();
            World = null;
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

        public void SpawnSelected()
        {
            if (World == null || string.IsNullOrEmpty(SelectedAnchorId)) { Status = "Select an available room surface first."; return; }
            Execute(new SandboxCommand { op = "spawn", assetId = SelectedAssetId, anchorId = SelectedAnchorId,
                transform = Pose(Placement, Vector3.zero, Vector3.one * 0.2f) });
        }

        public CommandResult Execute(SandboxCommand command)
        {
            if (RoomReloading) return new CommandResult { requestId = command?.requestId, ok = false, error = "Room reload in progress." };
            if (World == null) return new CommandResult { requestId = command?.requestId, ok = false, error = "Room is not ready." };
            var result = World.Execute(command);
            if (result.ok)
            {
                if (command.op == "spawn" || command.op == "set_transform") SelectedObjectId = result.objectId;
                if (command.op == "clear" || (command.op == "delete" && command.objectId == SelectedObjectId)) SelectedObjectId = null;
                if (command.op == "load" && !World.TryGetObject(SelectedObjectId, out _)) SelectedObjectId = null;
            }
            Status = result.ok ? command.op + " complete" : result.error;
            return result;
        }

        public void SelectObject(string id)
        {
            if (string.IsNullOrEmpty(id)) { SelectedObjectId = null; return; }
            if (World == null || !World.TryGetObject(id, out _)) { Status = "The selected object is unavailable."; return; }
            SelectedObjectId = id;
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

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
