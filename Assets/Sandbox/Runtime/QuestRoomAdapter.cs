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
        private RoomDebugOutlines outlines;
        private LineRenderer pointer;
        private Material pointerMaterial;
        private Text hud;
        private GameObject guidePanel;
        private Text guideText;
        private PcBridge bridge;
        private Camera viewerCamera;
        private SandboxVoiceInput voice;
        private GameObject hudObject;
        private bool loading;
        private bool destroyed;
        private bool controlsArmed, voiceArmed, triggerHeld, primaryHeld, secondaryHeld, deleteHeld;
        private bool voiceTriggerHeld, applyHeld, undoHeld, reloadHeld, debugHeld, moveLatched, editLatched;
        private bool undoUsedAsModifier;
        private TaskCompletionSource<bool> permissionRequest;
        private float nextHudUpdate;
        private const string ScenePermission = "com.oculus.permission.USE_SCENE";
        private const MRUKAnchor.SceneLabels PlacementLabels = MRUKAnchor.SceneLabels.FLOOR | MRUKAnchor.SceneLabels.TABLE |
            MRUKAnchor.SceneLabels.COUCH | MRUKAnchor.SceneLabels.BED | MRUKAnchor.SceneLabels.STORAGE;

        private void Start()
        {
            if (app == null || rig == null || mruk == null || app.placementMaterial == null)
            {
                Debug.LogError("Quest room setup is missing its app, camera rig, MRUK, or placement material.", this);
                if (app != null) ReportRoom("error", "AR scene configuration is incomplete. Check camera rig, MRUK, and placement material references.");
                enabled = false;
                return;
            }
            bridge = app.GetComponent<PcBridge>();
            viewerCamera = rig.centerEyeAnchor.GetComponent<Camera>();
            voice = app.GetComponent<SandboxVoiceInput>();
            if (voice == null) voice = app.gameObject.AddComponent<SandboxVoiceInput>();
            voice.app = app; voice.bridge = bridge;
            outlines = gameObject.AddComponent<RoomDebugOutlines>();
            mruk.RoomUpdatedEvent.AddListener(RoomGeometryChanged);
            mruk.RoomRemovedEvent.AddListener(RoomGeometryChanged);
            CreatePresentation();
            ReloadRoom();
        }

        public void ReloadRoom() => LoadRoom(false);

        public void SetupRoom() => LoadRoom(true);

        private async void LoadRoom(bool runSpaceSetup)
        {
            if (loading || destroyed || !isActiveAndEnabled || app == null || mruk == null || outlines == null) return;
            if (app.World != null && app.World.Capture().scene.objects.Count > 0)
            {
                app.ReportStatus("Save the scene on the PC, then clear its objects before reloading room data. Existing objects have been kept.");
                return;
            }
            loading = true;
            app.RoomReloading = true;
            voice?.BeginRoomLoading();
            try
            {
                ReportRoom("loading", "Loading device room. Allow spatial data access; use manual Space Setup on Quest Pro.");
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
                    bool allowed = await completion.Task;
                    if (destroyed || !isActiveAndEnabled) return;
                    if (!allowed)
                    {
                        if (!destroyed) ReportRoom("missing", "Spatial data permission denied. Enable it in headset app permissions, then click the left stick to retry.");
                        return;
                    }
                }
#endif
                if (destroyed || !isActiveAndEnabled) return;
                if (runSpaceSetup)
                {
                    if (Application.platform != RuntimePlatform.Android)
                    {
                        ReportRoom("missing", "Space Setup runs on the standalone headset. Configure its floor and table there, then click the left stick to reload.");
                        return;
                    }
                    ReportRoom("loading", "Complete Space Setup on the headset. On Quest Pro, outline the floor and table manually.");
                    // Same request-then-reload flow used by Meta's ImmersiveSceneDebugger.
                    // A true return only means the system flow closed, not that a room was created.
                    var setupCompleted = await OVRScene.RequestSpaceSetup();
                    if (destroyed || !isActiveAndEnabled) return;
                    if (!setupCompleted)
                    {
                        ReportRoom("missing", "Space Setup could not open. Use headset Settings > Environment Setup, then click the left stick.");
                        return;
                    }
                }
                // MRUK may replace anchor GameObjects even if a new discovery later fails.
                // Never leave the PC bridge editing a world backed by stale room transforms.
                app.InvalidateRoom("Loading configured floor and table anchors...");
                UnsubscribeRoomAnchors();
                room = null;
                targets.Clear();
                outlines.Clear();
                foreach (var frame in targetFrames) if (frame != null) Destroy(frame);
                targetFrames.Clear();
                // Never interrupt the user with a capture flow just because no room exists.
                // The explicit grip + stick action above owns the system Space Setup prompt.
                var result = await mruk.LoadSceneFromDevice(false, true, MRUK.SceneModel.V1);
                if (destroyed || !isActiveAndEnabled) return;
                if (result != MRUK.LoadDeviceResult.Success)
                {
                    ReportRoom("missing", "Room unavailable: " + result + ". Hold left grip and click left stick for manual Space Setup; left-stick click retries.");
                    return;
                }
                var loadedRoom = mruk.GetCurrentRoom();
                // Discovery can finish before headset tracking localizes the current room.
                for (var attempt = 0; loadedRoom == null && attempt < 50 && !destroyed && isActiveAndEnabled; attempt++)
                {
                    ReportRoom("loading", "Room data loaded. Look around the configured room while it localizes...");
                    await Task.Delay(200);
                    if (!destroyed && isActiveAndEnabled) loadedRoom = mruk.GetCurrentRoom();
                }
                if (destroyed || !isActiveAndEnabled) return;
                if (loadedRoom == null || loadedRoom.Anchor.Uuid == Guid.Empty)
                {
                    ReportRoom("missing", "No localized room with a stable ID. Look around and click left stick, or hold left grip while clicking for Space Setup.");
                    return;
                }
                BindRoom(loadedRoom);
            }
            catch (Exception exception)
            {
                if (!destroyed && isActiveAndEnabled) ReportRoom("error", "Room load failed: " + exception.Message);
                Debug.LogException(exception);
            }
            finally
            {
                permissionRequest = null;
                loading = false;
                if (!destroyed && app != null)
                {
                    app.RoomReloading = false;
                    voice?.EndRoomLoading(app.RoomContext?.state == "ready");
                }
            }
        }

        private void BindRoom(MRUKRoom loadedRoom)
        {
            var nextTargets = new List<RoomTarget>();
            var nextFrames = new List<GameObject>();
            int supportCount = 0;
            foreach (var anchor in loadedRoom.Anchors)
            {
                if (anchor == null || anchor.Anchor.Uuid == Guid.Empty ||
                    (!anchor.PlaneRect.HasValue && !anchor.VolumeBounds.HasValue)) continue;
                Vector3 center = anchor.VolumeBounds.HasValue ? anchor.GetAnchorCenter() :
                    anchor.transform.TransformPoint(new Vector3(anchor.PlaneRect.Value.center.x, anchor.PlaneRect.Value.center.y, 0));
                RaycastHit hit = default;
                bool supports = anchor.HasAnyLabel(PlacementLabels) &&
                    anchor.Raycast(new Ray(center + Vector3.up * 5f, Vector3.down), 10f, out hit) &&
                    Vector3.Dot(hit.normal, Vector3.up) > .7f;
                if (!anchor.VolumeBounds.HasValue && anchor.HasAnyLabel(PlacementLabels) &&
                    anchor.PlaneBoundary2D != null && anchor.PlaneBoundary2D.Count >= 3 &&
                    Vector3.Dot(anchor.transform.forward, Vector3.up) > .7f)
                {
                    // The bounds center of a concave floor may lie outside the room.
                    // Its coordinate frame can still originate there; every placement
                    // is checked against the actual polygon and MRUK raycast below.
                    supports = true;
                    hit.point = center;
                    hit.normal = anchor.transform.forward;
                }
                // Scene planes use XY/+Z. All surface frames use XZ/+Y instead, so the
                // same executor can place prefab bases without a device-specific branch.
                Vector3 normal = supports ? hit.normal.normalized : anchor.transform.forward.normalized;
                Vector3 forward = Vector3.ProjectOnPlane(anchor.transform.up, normal);
                if (forward.sqrMagnitude < .001f) forward = Vector3.ProjectOnPlane(anchor.transform.right, normal);
                if (forward.sqrMagnitude < .001f) continue;
                var frame = new GameObject("Placement frame " + anchor.Label);
                frame.transform.SetParent(anchor.transform, false);
                frame.transform.SetPositionAndRotation(supports ? hit.point : center, Quaternion.LookRotation(forward.normalized, normal));
                nextFrames.Add(frame);
                var id = anchor.Anchor.Uuid.ToString("D");
                var target = new RoomTarget
                {
                    anchorId = id,
                    displayName = anchor.Label.ToString(),
                    origin = frame.transform,
                    source = "mruk",
                    semanticLabels = anchor.Label.ToString().Split(new[] { ", " }, StringSplitOptions.RemoveEmptyEntries),
                    surface = new RoomSurfaceData
                    {
                        kind = supports ? "support" : anchor.HasAnyLabel(MRUKAnchor.SceneLabels.WALL_FACE |
                            MRUKAnchor.SceneLabels.INVISIBLE_WALL_FACE | MRUKAnchor.SceneLabels.INNER_WALL_FACE) ? "wall" : "other",
                        boundary = SurfaceBoundary(anchor, frame.transform, supports),
                        localBounds = GeometryBounds(anchor, frame.transform)
                    },
                    roomPose = SandboxApp.Pose(loadedRoom.transform.InverseTransformPoint(frame.transform.position),
                        (Quaternion.Inverse(loadedRoom.transform.rotation) * frame.transform.rotation).eulerAngles, Vector3.one)
                };
                if (supports)
                {
                    supportCount++;
                    var capturedAnchor = anchor;
                    var capturedFrame = frame.transform;
                    target.surfaceValidator = point => ValidateSurfacePoint(capturedAnchor, capturedFrame, point);
                }
                nextTargets.Add(target);
            }
            if (nextTargets.Count == 0)
            {
                foreach (var frame in nextFrames) Destroy(frame);
                ReportRoom("missing", "The room has no usable planes or furniture. Hold left grip and click left stick for manual Space Setup.");
                return;
            }
            nextTargets.Sort((left, right) =>
            {
                int priority = SurfacePriority(left).CompareTo(SurfacePriority(right));
                return priority != 0 ? priority : string.CompareOrdinal(left.anchorId, right.anchorId);
            });
            app.InitializeWorld(loadedRoom.Anchor.Uuid.ToString("D"), nextTargets.ToArray());
            foreach (var frame in targetFrames) if (frame != null) Destroy(frame);
            targetFrames.Clear(); targetFrames.AddRange(nextFrames);
            targets.Clear();
            foreach (var target in nextTargets) targets.Add(target.anchorId, target);
            UnsubscribeRoomAnchors();
            room = loadedRoom;
            room.AnchorCreatedEvent.AddListener(AnchorGeometryChanged);
            room.AnchorUpdatedEvent.AddListener(AnchorGeometryChanged);
            room.AnchorRemovedEvent.AddListener(AnchorGeometryChanged);
            outlines.SetVisible(true);
            outlines.ShowRoom(room, rig.centerEyeAnchor, app.placementMaterial);
            ReportRoom(supportCount > 0 ? "ready" : "missing", supportCount > 0 ?
                "Device room: " + targets.Count + " anchors, " + supportCount + " support surfaces. Check outlines against reality, then Confirm alignment on the PC." :
                "Room outlines loaded but no usable floor/table support exists. Configure these in Space Setup; editing is paused.");
        }

        private static int SurfacePriority(RoomTarget target)
        {
            if (Array.IndexOf(target.semanticLabels, "FLOOR") >= 0 && target.surface.kind == "support") return 0;
            return target.surface.kind == "support" ? 1 : 2;
        }

        private static List<Float3> SurfaceBoundary(MRUKAnchor anchor, Transform frame, bool support)
        {
            var points = new List<Vector3>();
            if (anchor.VolumeBounds.HasValue)
            {
                // A support frame is aligned to the MRUK top face. Retain its four
                // contact corners; do not replace an actual room with a bounding room.
                Bounds bounds = anchor.VolumeBounds.Value;
                float maximum = float.NegativeInfinity;
                foreach (Vector3 corner in Corners(bounds))
                {
                    Vector3 point = frame.InverseTransformPoint(anchor.transform.TransformPoint(corner));
                    points.Add(point); maximum = Mathf.Max(maximum, point.y);
                }
                if (support)
                {
                    points.RemoveAll(point => Mathf.Abs(point.y - maximum) > .005f);
                    points.Sort((left, right) => Mathf.Atan2(left.z, left.x).CompareTo(Mathf.Atan2(right.z, right.x)));
                }
                else points.Clear(); // Full volume is described by localBounds.
            }
            else if (anchor.PlaneRect.HasValue)
            {
                if (anchor.PlaneBoundary2D != null && anchor.PlaneBoundary2D.Count >= 3)
                    foreach (Vector2 point in anchor.PlaneBoundary2D)
                        points.Add(frame.InverseTransformPoint(anchor.transform.TransformPoint(new Vector3(point.x, point.y, 0))));
                else
                {
                    Rect rect = anchor.PlaneRect.Value;
                    foreach (var point in new[] { new Vector2(rect.xMin, rect.yMin), new Vector2(rect.xMax, rect.yMin),
                        new Vector2(rect.xMax, rect.yMax), new Vector2(rect.xMin, rect.yMax) })
                        points.Add(frame.InverseTransformPoint(anchor.transform.TransformPoint(new Vector3(point.x, point.y, 0))));
                }
            }
            var result = new List<Float3>(points.Count);
            foreach (Vector3 point in points) result.Add(new Float3(point.x, 0, point.z));
            return result;
        }

        private static BoundsData GeometryBounds(MRUKAnchor anchor, Transform frame)
        {
            Bounds native = anchor.VolumeBounds ?? new Bounds(new Vector3(anchor.PlaneRect.Value.center.x, anchor.PlaneRect.Value.center.y, 0),
                new Vector3(anchor.PlaneRect.Value.width, anchor.PlaneRect.Value.height, 0));
            var result = new Bounds();
            bool initialized = false;
            foreach (Vector3 corner in Corners(native))
            {
                Vector3 point = frame.InverseTransformPoint(anchor.transform.TransformPoint(corner));
                if (!initialized) { result = new Bounds(point, Vector3.zero); initialized = true; }
                else result.Encapsulate(point);
            }
            return new BoundsData { center = SandboxApp.Vec(result.center), size = SandboxApp.Vec(result.size) };
        }

        private static IEnumerable<Vector3> Corners(Bounds bounds)
        {
            for (int index = 0; index < 8; index++) yield return new Vector3(
                (index & 1) == 0 ? bounds.min.x : bounds.max.x,
                (index & 2) == 0 ? bounds.min.y : bounds.max.y,
                (index & 4) == 0 ? bounds.min.z : bounds.max.z);
        }

        private bool ValidateSurfacePoint(MRUKAnchor anchor, Transform frame, Vector3 localPoint)
        {
            if (room == null || anchor == null || frame == null || !anchor.isActiveAndEnabled || !frame.gameObject.activeInHierarchy ||
                loading || Mathf.Abs(localPoint.y) > .02f) return false;
            Vector3 expected = frame.TransformPoint(localPoint);
            return anchor.Raycast(new Ray(expected + frame.up * .25f, -frame.up), .5f, out var hit) &&
                Vector3.Dot(hit.normal, frame.up) > .98f && Vector3.Distance(expected, hit.point) < .02f;
        }

        private void Update()
        {
            if (app == null || rig == null || pointer == null) return;
            bool headTracked = HeadTracked();
            bool rightTracked = ControllerTracked(OVRInput.Controller.RTouch);
            bool leftTracked = ControllerTracked(OVRInput.Controller.LTouch);
            bool ready = headTracked && rightTracked && app.World != null && !loading && app.RoomContext?.state == "ready";
            bool trigger = Pressed(OVRInput.Button.PrimaryIndexTrigger, OVRInput.Controller.RTouch);
            bool primary = Pressed(OVRInput.Button.One, OVRInput.Controller.RTouch);
            bool secondary = Pressed(OVRInput.Button.Two, OVRInput.Controller.RTouch);
            bool remove = leftTracked && Pressed(OVRInput.Button.One, OVRInput.Controller.LTouch);
            bool voiceTrigger = Pressed(OVRInput.Button.PrimaryIndexTrigger, OVRInput.Controller.LTouch);
            bool apply = Pressed(OVRInput.Button.Two, OVRInput.Controller.LTouch);
            bool undo = Pressed(OVRInput.Button.PrimaryHandTrigger, OVRInput.Controller.LTouch);
            bool reload = Pressed(OVRInput.Button.PrimaryThumbstick, OVRInput.Controller.LTouch);
            bool debug = Pressed(OVRInput.Button.PrimaryThumbstick, OVRInput.Controller.RTouch);
            if (undo && !undoHeld) undoUsedAsModifier = false;
            Vector2 move = leftTracked ? OVRInput.Get(OVRInput.Axis2D.PrimaryThumbstick, OVRInput.Controller.LTouch) : Vector2.zero;
            Vector2 edit = rightTracked ? OVRInput.Get(OVRInput.Axis2D.PrimaryThumbstick, OVRInput.Controller.RTouch) : Vector2.zero;
            pointer.enabled = ready;
            // Setup/retry works when there is no room, but never from a held button on focus return.
            if (headTracked && leftTracked && reload && !reloadHeld && !loading && !voiceTrigger)
            {
                if (undo) { undoUsedAsModifier = true; SetupRoom(); } else ReloadRoom();
            }
            if (headTracked && rightTracked && debug && !debugHeld && outlines != null) outlines.SetVisible(!outlines.Visible);
            reloadHeld = reload || !headTracked || !leftTracked;
            debugHeld = debug || !headTracked || !rightTracked;
            if (!ready)
            {
                controlsArmed = false; moveLatched = editLatched = true;
                app.ClearPointingTarget();
            }
            else
            {
                var ray = new Ray(rig.rightHandAnchor.position, rig.rightHandAnchor.forward);
                Vector3 end = ray.GetPoint(5f);
                bool hitRoom = room.Raycast(ray, 5f, out var roomHit, out var anchor);
                string objectId = null;
                RoomTarget pointedTarget = null;
                Vector3 hitPoint = hitRoom ? roomHit.point : end;
                Vector3 hitNormal = hitRoom ? roomHit.normal : Vector3.up;
                if (Physics.Raycast(ray, out var propHit, 5f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore) &&
                    (!hitRoom || propHit.distance <= roomHit.distance + .01f) && app.World.TryGetObjectId(propHit.transform, out objectId))
                {
                    foreach (var candidate in app.Targets)
                        if (candidate.origin != null && propHit.transform.IsChildOf(candidate.origin)) { pointedTarget = candidate; break; }
                    hitPoint = propHit.point; hitNormal = propHit.normal;
                }
                else if (hitRoom && anchor != null) targets.TryGetValue(anchor.Anchor.Uuid.ToString("D"), out pointedTarget);
                if (pointedTarget != null)
                {
                    Transform frame = pointedTarget.origin;
                    app.SetPointingTarget(pointedTarget.anchorId, objectId, frame.InverseTransformPoint(hitPoint),
                        frame.InverseTransformDirection(hitNormal), frame.InverseTransformPoint(ray.origin), frame.InverseTransformDirection(ray.direction));
                    end = hitPoint;
                }
                else app.ClearPointingTarget();
                bool support = pointedTarget != null && pointedTarget.surface.kind == "support" && Vector3.Dot(hitNormal, pointedTarget.origin.up) > .7f;
                pointer.startColor = pointer.endColor = objectId != null ? Color.cyan : support ? Color.green : pointedTarget != null ? Color.yellow : Color.white;
                pointerMaterial.color = pointer.startColor;
                pointer.SetPosition(0, ray.origin); pointer.SetPosition(1, end);
                if (!controlsArmed) controlsArmed = !trigger && !primary && !secondary && !remove && move.sqrMagnitude < .04f && edit.sqrMagnitude < .04f;
                else
                {
                    if (trigger && !triggerHeld)
                    {
                        if (!string.IsNullOrEmpty(objectId)) app.SelectObject(objectId);
                        else if (support)
                        {
                            app.SelectObject(null);
                            Vector3 placement = pointedTarget.origin.InverseTransformPoint(hitPoint);
                            // This is a measured hit on the support plane, not a
                            // requested clearance. Remove transform roundoff only.
                            placement.y = 0f;
                            app.SetPlacement(pointedTarget.anchorId, placement);
                            app.ReportStatus("Selected " + pointedTarget.displayName + " [" + pointedTarget.anchorId.Substring(0, 8) + "].");
                        }
                        else if (pointedTarget != null) app.ReportStatus(pointedTarget.displayName + " is context geometry; select a floor or furniture top for placement.");
                    }
                    if (primary && !primaryHeld) app.SpawnSelected();
                    if (secondary && !secondaryHeld) app.CycleAsset();
                    if (remove && !deleteHeld && !string.IsNullOrEmpty(app.SelectedObjectId))
                        app.Execute(new SandboxCommand { op = "delete", objectId = app.SelectedObjectId });
                    if (move.sqrMagnitude < .04f) moveLatched = false;
                    if (edit.sqrMagnitude < .04f) editLatched = false;
                    if (!reload && !string.IsNullOrEmpty(app.SelectedObjectId) && move.sqrMagnitude > .36f && !moveLatched)
                    {
                        Vector3 delta = Mathf.Abs(move.x) >= Mathf.Abs(move.y) ? Vector3.right * Mathf.Sign(move.x) : Vector3.forward * Mathf.Sign(move.y);
                        app.EditSelected(delta * .1f, 0, 1); moveLatched = true;
                    }
                    if (!debug && !string.IsNullOrEmpty(app.SelectedObjectId) && edit.sqrMagnitude > .36f && !editLatched)
                    {
                        if (Mathf.Abs(edit.x) >= Mathf.Abs(edit.y)) app.EditSelected(Vector3.zero, Mathf.Sign(edit.x) * 15f, 1);
                        else app.EditSelected(Vector3.zero, 0, edit.y > 0 ? 1.2f : 1f / 1.2f);
                        editLatched = true;
                    }
                }
            }
            bool voiceReady = ready && leftTracked;
            voice.SetInputReady(voiceReady && bridge != null && bridge.IsConnected);
            if (!voiceReady) voiceArmed = false;
            else if (!voiceArmed) voiceArmed = !voiceTrigger && !apply && !undo && !reload;
            else
            {
                if (voiceTrigger && !voiceTriggerHeld) voice.BeginRecording();
                if (!voiceTrigger && voiceTriggerHeld) voice.FinishRecording();
                if (apply && !applyHeld && !voiceTrigger) voice.ApplyProposal();
                // Release-to-undo leaves grip available as the explicit Space Setup
                // modifier without an accidental undo before the stick click arrives.
                if (!undo && undoHeld && !undoUsedAsModifier && !voiceTrigger && !apply && !reload && !voice.IsBusy)
                {
                    if (voice.HasProposal) voice.Cancel("Proposal cancelled by undo. Hold left trigger to ask again.");
                    app.Execute(new SandboxCommand { op = "undo" });
                }
            }
            voiceTriggerHeld = voiceTrigger; applyHeld = apply; undoHeld = undo;
            triggerHeld = trigger; primaryHeld = primary; secondaryHeld = secondary; deleteHeld = remove;
            if (Time.unscaledTime >= nextHudUpdate)
            {
                nextHudUpdate = Time.unscaledTime + .2f;
                string alignment = app.RoomContext?.alignmentVerified == true ? "Alignment confirmed." : "Check labeled outlines, then Confirm alignment on PC.";
                hud.text = "MATRIX OPERATOR · QUEST PRO / PASSTHROUGH\n" + alignment + "\n" + app.Status +
                    "\nAsset: " + app.SelectedAssetName + "   Trigger: select prop / surface   A: add   B: next   X: delete" +
                    "\nLeft trigger: speak   Y: apply   Left grip: undo   Sticks: move / turn / resize" +
                    "\nClick left stick: reload   Grip + left-stick click: Space Setup   Right-stick click: outlines" +
                    "\n" + (bridge != null ? bridge.ConnectionStatus : "PC bridge missing") + "\n" + voice.HudText;
                UpdateGuidePresentation();
            }
        }

        private static bool Pressed(OVRInput.Button button, OVRInput.Controller controller) => OVRInput.Get(button, controller);
        private static bool ControllerTracked(OVRInput.Controller controller) =>
            OVRInput.GetControllerPositionTracked(controller) && OVRInput.GetControllerOrientationTracked(controller);
        private static bool HeadTracked() => Application.isFocused && OVRManager.hasVrFocus &&
            OVRPlugin.GetNodePositionTracked(OVRPlugin.Node.EyeCenter) && OVRPlugin.GetNodeOrientationTracked(OVRPlugin.Node.EyeCenter);

        private void LateUpdate()
        {
            if (app == null) return;
            if (rig != null && HeadTracked() && !loading && room != null && app.RoomContext?.state == "ready")
                app.SetViewerPose(rig.centerEyeAnchor.position, rig.centerEyeAnchor.forward, viewerCamera);
            else app.ClearViewerPose();
        }

        private void ReportRoom(string state, string message)
        {
            app.SetRoomContext(state, message, false);
            app.ReportStatus(message);
        }

        private void RoomGeometryChanged(MRUKRoom changed)
        {
            if (loading || destroyed || !isActiveAndEnabled || room == null || changed == null || changed.Anchor.Uuid != room.Anchor.Uuid) return;
            InvalidateGeometry();
        }

        private void AnchorGeometryChanged(MRUKAnchor changed)
        {
            if (loading || destroyed || !isActiveAndEnabled || room == null || changed == null) return;
            // MRUK 205 raises AnchorUpdatedEvent for significant geometry/semantic
            // changes only. Ordinary world-lock pose refinement does not enter here.
            // Removal is reported before the anchor (and its children) is destroyed.
            InvalidateGeometry();
        }

        private void InvalidateGeometry()
        {
            // Preserve stored local poses for PC saving. Do not silently rebuild frames
            // beneath existing props when the user recaptures or removes the room.
            app.ClearViewerPose(); app.ClearPointingTarget();
            voice?.Cancel("Room geometry changed. Save and clear objects, then reload the room and verify outlines.");
            ReportRoom("error", "Room geometry changed or was removed. Save and clear props, then click left stick to reload and verify outlines.");
        }

        private void UnsubscribeRoomAnchors()
        {
            if (room == null) return;
            room.AnchorCreatedEvent.RemoveListener(AnchorGeometryChanged);
            room.AnchorUpdatedEvent.RemoveListener(AnchorGeometryChanged);
            room.AnchorRemovedEvent.RemoveListener(AnchorGeometryChanged);
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
            hudObject = canvasObject;
            canvasObject.transform.SetParent(rig.centerEyeAnchor, false);
            canvasObject.transform.localPosition = new Vector3(0f, -0.32f, 1.05f);
            canvasObject.transform.localScale = Vector3.one * 0.00065f;
            var canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = rig.centerEyeAnchor.GetComponent<Camera>();
            var rect = (RectTransform)canvasObject.transform;
            rect.sizeDelta = new Vector2(1100f, 520f);
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
            hud.supportRichText = false;
            hud.alignment = TextAnchor.MiddleCenter;
            hud.color = Color.white;
            hud.raycastTarget = false;
            CreateGuidePresentation();
        }

        private void CreateGuidePresentation()
        {
            guidePanel = new GameObject("Learning guide", typeof(Canvas));
            guidePanel.transform.SetParent(rig.centerEyeAnchor, false);
            guidePanel.transform.localPosition = new Vector3(0f, 0.22f, 1.4f);
            guidePanel.transform.localScale = Vector3.one * 0.0008f;
            var canvas = guidePanel.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = rig.centerEyeAnchor.GetComponent<Camera>();
            ((RectTransform)guidePanel.transform).sizeDelta = new Vector2(1000f, 760f);
            var background = new GameObject("Background", typeof(Image));
            background.transform.SetParent(guidePanel.transform, false);
            Stretch((RectTransform)background.transform);
            var image = background.GetComponent<Image>();
            image.color = new Color(0.02f, 0.07f, 0.09f, 0.94f);
            image.raycastTarget = false;
            var textObject = new GameObject("Lesson brief", typeof(Text));
            textObject.transform.SetParent(guidePanel.transform, false);
            var textRect = (RectTransform)textObject.transform;
            Stretch(textRect);
            textRect.offsetMin = new Vector2(30f, 24f);
            textRect.offsetMax = new Vector2(-30f, -24f);
            guideText = textObject.GetComponent<Text>();
            guideText.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            guideText.fontSize = 25;
            guideText.alignment = TextAnchor.UpperLeft;
            guideText.horizontalOverflow = HorizontalWrapMode.Wrap;
            guideText.verticalOverflow = VerticalWrapMode.Truncate;
            guideText.supportRichText = false;
            guideText.color = Color.white;
            guideText.raycastTarget = false;
            guidePanel.SetActive(false);
        }

        private void UpdateGuidePresentation()
        {
            if (guidePanel == null) return;
            var guide = bridge != null ? bridge.CurrentGuide : null;
            guidePanel.SetActive(guide != null);
            if (guide == null) return;
            var text = new System.Text.StringBuilder();
            text.Append("LEARNING GUIDE\n").Append(GuideExcerpt(guide.title, 90)).Append('\n');
            text.Append(GuideExcerpt(guide.stageLabel, 64));
            if (guide.progressTotal > 0) text.Append("  ·  ").Append(guide.progressIndex).Append(" / ").Append(guide.progressTotal);
            text.Append('\n');
            if (!bridge.IsConnected) text.Append("PC offline / paused — last received guide\n");
            if (!string.IsNullOrEmpty(guide.status)) text.Append(GuideExcerpt(guide.status, 80)).Append('\n');
            if (!string.IsNullOrEmpty(guide.body)) text.Append('\n').Append(GuideExcerpt(guide.body, 300)).Append('\n');
            if (!string.IsNullOrEmpty(guide.prompt)) text.Append('\n').Append(GuideExcerpt(guide.prompt, 220)).Append('\n');
            if (!string.IsNullOrEmpty(guide.hint)) text.Append("Hint: ").Append(GuideExcerpt(guide.hint, 100)).Append('\n');
            text.Append("\nFull lesson, responses and Continue: PC learning panel.");
            guideText.text = text.ToString();
        }

        private static string GuideExcerpt(string value, int limit)
        {
            if (string.IsNullOrEmpty(value)) return "";
            return value.Length <= limit ? value : value.Substring(0, limit - 1).TrimEnd() + "…";
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
            UnsubscribeRoomAnchors();
            if (mruk != null)
            {
                mruk.RoomUpdatedEvent.RemoveListener(RoomGeometryChanged);
                mruk.RoomRemovedEvent.RemoveListener(RoomGeometryChanged);
            }
            if (pointer != null) Destroy(pointer.gameObject);
            if (pointerMaterial != null) Destroy(pointerMaterial);
            if (hudObject != null) Destroy(hudObject);
            if (guidePanel != null) Destroy(guidePanel);
            foreach (var frame in targetFrames) if (frame != null) Destroy(frame);
        }

        private void OnDisable()
        {
            controlsArmed = voiceArmed = false;
            if (pointer != null) pointer.enabled = false;
            voice?.SetInputReady(false);
            app?.ClearViewerPose(); app?.ClearPointingTarget();
            if (loading && app != null) ReportRoom("error", "Room loading was interrupted. Enable room AR and click the left stick to retry.");
            permissionRequest?.TrySetResult(false);
        }

        private void OnApplicationFocus(bool focused)
        {
            if (focused) return;
            controlsArmed = voiceArmed = false;
            voice?.SetInputReady(false);
            app?.ClearViewerPose(); app?.ClearPointingTarget();
        }
    }
}
