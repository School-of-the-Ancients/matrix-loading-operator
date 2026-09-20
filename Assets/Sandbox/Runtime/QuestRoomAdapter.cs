using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Meta.XR.MRUtilityKit;
using UnityEngine;
using UnityEngine.UI;
#if UNITY_ANDROID
using UnityEngine.Android;
#endif

namespace ArSandbox
{
    /// <summary>Uses captured device scene data; never substitutes a simulated room.</summary>
    public sealed class QuestRoomAdapter : MonoBehaviour
    {
        public SandboxApp app;
        public OVRCameraRig rig;
        public MRUK mruk;
        public bool IsLoading => loading;
        private readonly Dictionary<string, RoomTarget> targets = new Dictionary<string, RoomTarget>();
        private readonly List<GameObject> targetFrames = new List<GameObject>();
        private MRUKRoom room;
        private LineRenderer pointer;
        private Material pointerMaterial;
        private Text hud;
        private PcBridge bridge;
        private bool loading;
        private bool destroyed;
        private TaskCompletionSource<bool> permissionRequest;
        private float nextHudUpdate;
        private const string ScenePermission = "com.oculus.permission.USE_SCENE";
        private const MRUKAnchor.SceneLabels PlacementLabels = MRUKAnchor.SceneLabels.FLOOR | MRUKAnchor.SceneLabels.TABLE;

        private void Start()
        {
            if (app == null || rig == null || mruk == null || app.placementMaterial == null)
            {
                Debug.LogError("Quest room setup is missing its app, camera rig, MRUK, or placement material.", this);
                enabled = false;
                return;
            }
            bridge = app.GetComponent<PcBridge>();
            CreatePresentation();
            ReloadRoom();
        }

        public void ReloadRoom() => LoadRoom(false);

        public void SetupRoom() => LoadRoom(true);

        private async void LoadRoom(bool runSpaceSetup)
        {
            if (loading || destroyed) return;
            if (app.World != null && app.World.Capture().scene.objects.Count > 0)
            {
                app.ReportStatus("Save the scene on the PC, then clear its objects before reloading room data. Existing objects have been kept.");
                return;
            }
            loading = true;
            app.RoomReloading = true;
            try
            {
                app.ReportStatus("Loading device room. Allow spatial data access; use manual Space Setup on Quest Pro.");
#if UNITY_ANDROID && !UNITY_EDITOR
                if (!Permission.HasUserAuthorizedPermission(ScenePermission))
                {
                    permissionRequest = new TaskCompletionSource<bool>();
                    var callbacks = new PermissionCallbacks();
                    var completion = permissionRequest;
                    callbacks.PermissionGranted += _ => completion.TrySetResult(true);
                    callbacks.PermissionDenied += _ => completion.TrySetResult(false);
                    callbacks.PermissionDeniedAndDontAskAgain += _ => completion.TrySetResult(false);
                    Permission.RequestUserPermission(ScenePermission, callbacks);
                    if (!await completion.Task)
                    {
                        if (!destroyed) app.ReportStatus("Spatial data permission denied. Enable it in headset app permissions, then press Y to retry.");
                        return;
                    }
                }
#endif
                if (destroyed) return;
                if (runSpaceSetup)
                {
                    if (Application.platform != RuntimePlatform.Android)
                    {
                        app.ReportStatus("Space Setup runs on the standalone headset. Configure its floor and table there, then press Y to reload.");
                        return;
                    }
                    app.ReportStatus("Complete Space Setup on the headset. On Quest Pro, outline the floor and table manually.");
                    // Same request-then-reload flow used by Meta's ImmersiveSceneDebugger.
                    // A true return only means the system flow closed, not that a room was created.
                    var setupCompleted = await OVRScene.RequestSpaceSetup();
                    if (destroyed) return;
                    if (!setupCompleted)
                    {
                        app.ReportStatus("Space Setup could not open. Use headset Settings > Physical Space / Environment Setup, then press Y.");
                        return;
                    }
                }
                var requestCaptureIfMissing = !runSpaceSetup && Application.platform == RuntimePlatform.Android;
                // MRUK may replace anchor GameObjects even if a new discovery later fails.
                // Never leave the PC bridge editing a world backed by stale room transforms.
                app.InvalidateRoom("Loading configured floor and table anchors...");
                room = null;
                targets.Clear();
                foreach (var frame in targetFrames) if (frame != null) Destroy(frame);
                targetFrames.Clear();
                var result = await mruk.LoadSceneFromDevice(requestCaptureIfMissing, true, MRUK.SceneModel.V1);
                if (destroyed) return;
                if (result != MRUK.LoadDeviceResult.Success)
                {
                    app.ReportStatus("Room unavailable: " + result + ". Hold left grip + Y for manual Space Setup; Y retries. Link needs spatial data sharing.");
                    return;
                }
                var loadedRoom = mruk.GetCurrentRoom();
                // Discovery can finish before headset tracking localizes the current room.
                for (var attempt = 0; loadedRoom == null && attempt < 50 && !destroyed; attempt++)
                {
                    app.ReportStatus("Room data loaded. Look around the configured room while it localizes...");
                    await Task.Delay(200);
                    if (!destroyed) loadedRoom = mruk.GetCurrentRoom();
                }
                if (destroyed) return;
                if (loadedRoom == null || loadedRoom.Anchor.Uuid == Guid.Empty)
                {
                    app.ReportStatus("No localized room with a stable ID. Look around your configured room and press Y, or hold left grip + Y for Space Setup.");
                    return;
                }
                BindRoom(loadedRoom);
            }
            catch (Exception exception)
            {
                if (!destroyed) app.ReportStatus("Room load failed: " + exception.Message);
                Debug.LogException(exception);
            }
            finally
            {
                permissionRequest = null;
                loading = false;
                if (!destroyed && app != null) app.RoomReloading = false;
            }
        }

        private void BindRoom(MRUKRoom loadedRoom)
        {
            var nextTargets = new Dictionary<string, RoomTarget>();
            var nextFrames = new List<GameObject>();
            foreach (var anchor in loadedRoom.Anchors)
            {
                if (!anchor.HasAnyLabel(PlacementLabels) || anchor.Anchor.Uuid == Guid.Empty) continue;
                if (!anchor.PlaneRect.HasValue && !anchor.VolumeBounds.HasValue) continue;
                var center = anchor.GetAnchorCenter();
                var surfaceRay = new Ray(center + Vector3.up * 5f, Vector3.down);
                if (!anchor.Raycast(surfaceRay, 10f, out var hit) || Vector3.Dot(hit.normal, Vector3.up) < 0.7f) continue;

                // MRUK planes use XY and +Z normal. Store a stable, surface-relative
                // +Y-up frame so the sandbox's primitive bases sit on the surface.
                var normal = hit.normal.normalized;
                var forward = Vector3.ProjectOnPlane(anchor.transform.up, normal);
                if (forward.sqrMagnitude < 0.001f) forward = Vector3.ProjectOnPlane(anchor.transform.forward, normal);
                if (forward.sqrMagnitude < 0.001f) forward = Vector3.ProjectOnPlane(anchor.transform.right, normal);
                var frame = new GameObject("Placement frame " + anchor.Label);
                frame.transform.SetParent(anchor.transform, false);
                frame.transform.SetPositionAndRotation(hit.point, Quaternion.LookRotation(forward.normalized, normal));
                nextFrames.Add(frame);
                var id = anchor.Anchor.Uuid.ToString("D");
                nextTargets[id] = new RoomTarget { anchorId = id, displayName = anchor.Label.ToString(), origin = frame.transform };
            }
            if (nextTargets.Count == 0)
            {
                foreach (var frame in nextFrames) Destroy(frame);
                app.ReportStatus("Room has no usable floor/table. Hold left grip + Y and manually configure a floor and table in Space Setup.");
                return;
            }
            var available = new RoomTarget[nextTargets.Count];
            nextTargets.Values.CopyTo(available, 0);
            app.InitializeWorld(loadedRoom.Anchor.Uuid.ToString("D"), available);
            foreach (var frame in targetFrames) if (frame != null) Destroy(frame);
            targetFrames.Clear();
            targetFrames.AddRange(nextFrames);
            targets.Clear();
            foreach (var entry in nextTargets) targets.Add(entry.Key, entry.Value);
            room = loadedRoom;
            app.ReportStatus("Device room ready: " + targets.Count + " floor/table target(s). Aim at a surface and press trigger, then A to add.");
        }

        private void Update()
        {
            if (app == null || rig == null) return;
            if (OVRInput.GetDown(OVRInput.Button.Two, OVRInput.Controller.LTouch))
            {
                if (OVRInput.Get(OVRInput.Button.PrimaryHandTrigger, OVRInput.Controller.LTouch)) SetupRoom();
                else ReloadRoom();
            }
            if (OVRInput.GetDown(OVRInput.Button.Two, OVRInput.Controller.RTouch)) app.CycleAsset();
            var hand = rig.rightHandAnchor;
            var tracked = OVRInput.GetControllerPositionTracked(OVRInput.Controller.RTouch);
            pointer.enabled = tracked;
            if (tracked && hand != null)
            {
                var ray = new Ray(hand.position, hand.forward);
                var end = ray.GetPoint(3f);
                RaycastHit hit = default;
                MRUKAnchor anchor = null;
                var valid = room != null && room.Raycast(ray, 5f, LabelFilter.Included(PlacementLabels), out hit, out anchor);
                var triggerPressed = !loading && OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger, OVRInput.Controller.RTouch);
                var selectedObject = triggerPressed && SelectPointedObject(ray);
                if (valid)
                {
                    end = hit.point;
                    valid = anchor != null && Vector3.Dot(hit.normal, Vector3.up) > 0.7f && targets.TryGetValue(anchor.Anchor.Uuid.ToString("D"), out _);
                    if (valid && triggerPressed && !selectedObject)
                    {
                        var target = targets[anchor.Anchor.Uuid.ToString("D")];
                        app.SetPlacement(target.anchorId, target.origin.InverseTransformPoint(hit.point));
                    }
                }
                pointer.startColor = pointer.endColor = valid ? Color.green : Color.white;
                pointer.SetPosition(0, ray.origin);
                pointer.SetPosition(1, end);
            }
            if (app.World != null && !loading)
            {
                if (OVRInput.GetDown(OVRInput.Button.One, OVRInput.Controller.RTouch)) app.SpawnSelected();
                if (OVRInput.GetDown(OVRInput.Button.One, OVRInput.Controller.LTouch) && !string.IsNullOrEmpty(app.SelectedObjectId))
                    app.Execute(new SandboxCommand { op = "delete", objectId = app.SelectedObjectId });
                var move = OVRInput.Get(OVRInput.Axis2D.PrimaryThumbstick, OVRInput.Controller.LTouch);
                var edit = OVRInput.Get(OVRInput.Axis2D.PrimaryThumbstick, OVRInput.Controller.RTouch);
                if (move.sqrMagnitude > 0.08f || edit.sqrMagnitude > 0.08f)
                    app.EditSelected(new Vector3(move.x, 0f, move.y) * (0.3f * Time.deltaTime), edit.x * 60f * Time.deltaTime, Mathf.Exp(edit.y * 0.6f * Time.deltaTime));
            }
            if (hud != null && Time.unscaledTime >= nextHudUpdate)
            {
                nextHudUpdate = Time.unscaledTime + 0.2f;
                hud.text = "AR SANDBOX · QUEST PRO / DEVICE ROOM\n" + app.Status + "\nAsset: " + app.SelectedAssetName +
                    "\nTrigger: select prop / place here   A: add   B: next prop   X: delete   Y: reload room" +
                    "\nLeft grip + Y: Space Setup   Left stick: move   Right stick: rotate / resize\n" + (bridge != null ? bridge.ConnectionStatus : "PC bridge missing");
            }
        }

        private bool SelectPointedObject(Ray ray)
        {
            if (app.World == null || !Physics.Raycast(ray, out var hit, 5f)) return false;
            foreach (var item in app.World.Capture().scene.objects)
            {
                if (!app.World.TryGetObject(item.objectId, out var instance) || !hit.transform.IsChildOf(instance.transform)) continue;
                app.SelectObject(item.objectId);
                app.ReportStatus("Selected " + item.assetId + " (" + item.objectId + ")");
                return true;
            }
            return false;
        }

        private void CreatePresentation()
        {
            pointer = new GameObject("Controller placement ray").AddComponent<LineRenderer>();
            pointer.transform.SetParent(transform, false);
            pointer.positionCount = 2;
            pointer.startWidth = pointer.endWidth = 0.003f;
            pointerMaterial = new Material(app.placementMaterial);
            pointer.sharedMaterial = pointerMaterial;
            var canvasObject = new GameObject("Headset status", typeof(Canvas));
            canvasObject.transform.SetParent(rig.centerEyeAnchor, false);
            canvasObject.transform.localPosition = new Vector3(0f, -0.25f, 0.9f);
            canvasObject.transform.localScale = Vector3.one * 0.0008f;
            var canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = rig.centerEyeAnchor.GetComponent<Camera>();
            var rect = (RectTransform)canvasObject.transform;
            rect.sizeDelta = new Vector2(1000f, 330f);
            var background = new GameObject("Background", typeof(Image));
            background.transform.SetParent(canvasObject.transform, false);
            Stretch((RectTransform)background.transform);
            background.GetComponent<Image>().color = new Color(0.02f, 0.04f, 0.08f, 0.85f);
            var textObject = new GameObject("Status", typeof(Text));
            textObject.transform.SetParent(canvasObject.transform, false);
            Stretch((RectTransform)textObject.transform);
            hud = textObject.GetComponent<Text>();
            hud.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            hud.fontSize = 25;
            hud.alignment = TextAnchor.MiddleCenter;
            hud.color = Color.white;
            hud.raycastTarget = false;
        }

        private static void Stretch(RectTransform rect)
        {
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero; rect.offsetMax = Vector2.zero;
        }

        private void OnDestroy()
        {
            destroyed = true;
            permissionRequest?.TrySetResult(false);
            if (pointerMaterial != null) Destroy(pointerMaterial);
            foreach (var frame in targetFrames) if (frame != null) Destroy(frame);
        }
    }
}
