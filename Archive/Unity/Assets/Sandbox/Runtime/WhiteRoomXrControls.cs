#if WHITE_ROOM_OPENXR
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.InputSystem.XR;
using UnityEngine.UI;
using UnityEngine.XR;

namespace ArSandbox
{
    /// <summary>Standard OpenXR controls for the authored virtual room. No physical-room data.</summary>
    public sealed class WhiteRoomXrControls : MonoBehaviour
    {
        public SandboxApp app;
        public Transform trackingOrigin;
        public Camera headCamera;
        private readonly List<XRInputSubsystem> subsystems = new List<XRInputSubsystem>();
        private LineRenderer pointer;
        private Material pointerMaterial;
        private Text hud;
        private GameObject hudObject;
        private PcBridge bridge;
        private SandboxVoiceInput voice;
        private bool floorReady, armed, leftArmed, triggerHeld, primaryHeld, secondaryHeld, deleteHeld;
        private bool voiceArmed, voiceTriggerHeld, applyHeld, undoHeld;
        private bool moveLatched, editLatched;
        private float nextOriginCheck, nextHudUpdate;
        private string trackingStatus = "Waiting for OpenXR tracking.";

        private void Start()
        {
            if (app == null || trackingOrigin == null || headCamera == null || app.placementMaterial == null)
            {
                Debug.LogError("White room XR controls need the app, tracking origin, camera and placement material.", this);
                enabled = false;
                return;
            }
            bridge = app.GetComponent<PcBridge>();
            voice = app.GetComponent<SandboxVoiceInput>();
            // Existing Unity Hub scenes can acquire voice without rewriting user scene assets.
            if (voice == null) voice = app.gameObject.AddComponent<SandboxVoiceInput>();
            voice.app = app; voice.bridge = bridge;
            pointer = new GameObject("Right controller pointer").AddComponent<LineRenderer>();
            pointer.transform.SetParent(trackingOrigin, false);
            pointer.positionCount = 2;
            pointer.startWidth = pointer.endWidth = 0.003f;
            pointerMaterial = new Material(app.placementMaterial);
            pointer.sharedMaterial = pointerMaterial;
            pointer.enabled = false;
            CreateHud();
        }

        private void Update()
        {
            if (pointer == null) return;
            if (Time.unscaledTime >= nextOriginCheck)
            {
                nextOriginCheck = Time.unscaledTime + 1f;
                SubsystemManager.GetSubsystems(subsystems);
                floorReady = false;
                foreach (var subsystem in subsystems)
                {
                    if (!subsystem.running) continue;
                    if (subsystem.GetTrackingOriginMode() != TrackingOriginModeFlags.Floor)
                        subsystem.TrySetTrackingOriginMode(TrackingOriginModeFlags.Floor);
                    floorReady |= subsystem.GetTrackingOriginMode() == TrackingOriginModeFlags.Floor;
                }
            }
            var head = InputSystem.GetDevice<XRHMD>();
            var right = XRController.rightHand;
            var left = XRController.leftHand;
            var rightPosition = right?.TryGetChildControl<Vector3Control>("pointerPosition");
            var rightRotation = right?.TryGetChildControl<QuaternionControl>("pointerRotation");
            var ready = floorReady && Application.isFocused && Tracked(head) && Tracked(right) &&
                rightPosition != null && rightRotation != null && app.World != null && !app.RoomReloading;
            pointer.enabled = ready;
            trackingStatus = ready ? "Floor tracking ready." : !floorReady ? "Waiting for floor-level OpenXR tracking; editing paused." : "Headset/controller tracking unavailable; editing paused.";

            var trigger = Pressed(right, "triggerPressed");
            var primary = Pressed(right, "primaryButton");
            var secondary = Pressed(right, "secondaryButton");
            var leftTracked = Tracked(left);
            var leftPrimary = Pressed(left, "primaryButton");
            var voiceTrigger = Pressed(left, "triggerPressed");
            var apply = Pressed(left, "secondaryButton");
            var undo = Pressed(left, "gripPressed");
            var leftAxis = Axis(left, "thumbstick");
            if (!leftTracked || !ready) { leftArmed = false; moveLatched = true; }
            else if (!leftArmed && !leftPrimary && leftAxis.sqrMagnitude < .04f) leftArmed = true;
            var remove = leftArmed && leftPrimary;
            var move = leftArmed ? leftAxis : Vector2.zero;
            var edit = Axis(right, "thumbstick");
            if (!ready) { armed = false; editLatched = true; }
            else
            {
                var origin = trackingOrigin.TransformPoint(rightPosition.ReadValue());
                var direction = trackingOrigin.rotation * rightRotation.ReadValue() * Vector3.forward;
                var ray = new Ray(origin, direction);
                var end = ray.GetPoint(12f);
                var floor = FindFloor();
                var plane = new Plane(Vector3.up, Vector3.zero);
                var distance = 0f;
                var hitsFloor = floor != null && plane.Raycast(ray, out distance) && distance <= 20f;
                if (hitsFloor) end = ray.GetPoint(distance);
                var hitsObject = Physics.Raycast(ray, out var hit, 20f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
                string objectId = null;
                if (hitsObject)
                {
                    foreach (var item in app.World.Capture().scene.objects)
                    {
                        if (!app.World.TryGetObject(item.objectId, out var instance) || !hit.transform.IsChildOf(instance.transform)) continue;
                        objectId = item.objectId;
                        end = hit.point;
                        break;
                    }
                }
                pointer.startColor = pointer.endColor = objectId != null || hitsFloor ? new Color(.05f, .5f, .85f) : Color.gray;
                pointer.SetPosition(0, origin);
                pointer.SetPosition(1, end);
                // Require released controls after tracking resumes; held inputs never cause surprise edits.
                if (!armed)
                {
                    armed = !trigger && !primary && !secondary && !remove && move.sqrMagnitude < .04f && edit.sqrMagnitude < .04f;
                }
                else
                {
                    if (trigger && !triggerHeld)
                    {
                        if (objectId != null) app.SelectObject(objectId);
                        else if (hitsFloor) app.SetPlacement(floor.anchorId, floor.origin.InverseTransformPoint(ray.GetPoint(distance)));
                    }
                    if (primary && !primaryHeld) app.SpawnSelected();
                    if (secondary && !secondaryHeld) app.CycleAsset();
                    if (remove && !deleteHeld && !string.IsNullOrEmpty(app.SelectedObjectId))
                        app.Execute(new SandboxCommand { op = "delete", objectId = app.SelectedObjectId });
                    // One deliberate edit per stick gesture keeps undo useful. Release to neutral to repeat.
                    if (move.sqrMagnitude < .04f) moveLatched = false;
                    if (edit.sqrMagnitude < .04f) editLatched = false;
                    if (!string.IsNullOrEmpty(app.SelectedObjectId) && move.sqrMagnitude > .36f && !moveLatched)
                    {
                        var delta = Mathf.Abs(move.x) >= Mathf.Abs(move.y) ? Vector3.right * Mathf.Sign(move.x) : Vector3.forward * Mathf.Sign(move.y);
                        app.EditSelected(delta * .1f, 0, 1);
                        moveLatched = true;
                    }
                    if (!string.IsNullOrEmpty(app.SelectedObjectId) && edit.sqrMagnitude > .36f && !editLatched)
                    {
                        if (Mathf.Abs(edit.x) >= Mathf.Abs(edit.y)) app.EditSelected(Vector3.zero, Mathf.Sign(edit.x) * 15f, 1);
                        else app.EditSelected(Vector3.zero, 0, edit.y > 0 ? 1.2f : 1f / 1.2f);
                        editLatched = true;
                    }
                }
            }
            bool voiceReady = ready && leftTracked;
            if (voice != null)
            {
                voice.SetInputReady(voiceReady && bridge != null && bridge.IsConnected);
                if (!voiceReady) voiceArmed = false;
                else if (!voiceArmed) voiceArmed = !voiceTrigger && !apply && !undo;
                else
                {
                    // Release after tracking resumes or a permission prompt before recording.
                    if (voiceTrigger && !voiceTriggerHeld) voice.BeginRecording();
                    if (!voiceTrigger && voiceTriggerHeld) voice.FinishRecording();
                    if (apply && !applyHeld && !voiceTrigger) voice.ApplyProposal();
                    if (undo && !undoHeld && !voiceTrigger && !apply && !voice.IsBusy)
                    {
                        if (voice.HasProposal) voice.Cancel("Proposal cancelled by undo. Hold left trigger to ask again.");
                        app.Execute(new SandboxCommand { op = "undo" });
                    }
                }
            }
            voiceTriggerHeld = voiceTrigger; applyHeld = apply; undoHeld = undo;
            triggerHeld = trigger; primaryHeld = primary; secondaryHeld = secondary; deleteHeld = remove;
            if (Time.unscaledTime >= nextHudUpdate)
            {
                nextHudUpdate = Time.unscaledTime + .2f;
                hud.text = "MATRIX OPERATOR · VIRTUAL WHITE ROOM\n" + trackingStatus + "  Asset: " + app.SelectedAssetName +
                    "\nTrigger: select object / floor   A: add   B: next asset   X: delete selected" +
                    "\nStick gestures: move 10 cm / turn 15° / resize 1.2×. Return to neutral to repeat." +
                    "\nSelected object: " + SelectionLabel() +
                    "\n" + app.Status + "\n" + (bridge != null ? bridge.ConnectionStatus : "PC bridge unavailable.") +
                    (voice != null ? "\nLeft trigger: hold to talk   Y: apply reviewed AI proposal   Left grip: undo" + "\n" + voice.HudText : "");
            }
        }

        private void LateUpdate()
        {
            if (app == null) return;
            // Viewer context depends on tracked head pose, never on controller availability.
            if (floorReady && Application.isFocused && headCamera != null && headCamera.isActiveAndEnabled &&
                Tracked(InputSystem.GetDevice<XRHMD>()))
                app.SetViewerPose(headCamera.transform.position, headCamera.transform.forward, headCamera);
            else app.ClearViewerPose();
        }

        private RoomTarget FindFloor()
        {
            foreach (var target in app.Targets)
                if (target.anchorId == "white-floor" && target.origin != null && target.origin.gameObject.activeInHierarchy) return target;
            return null;
        }

        private string SelectionLabel()
        {
            string id = app.SelectedObjectId;
            if (string.IsNullOrEmpty(id) || app.World == null || !app.World.TryGetObject(id, out var selected)) return "none";
            string label = selected.name;
            if (label.Length > 36) label = label.Substring(0, 36);
            return label + " [" + (id.Length > 8 ? id.Substring(0, 8) : id) + "] — say ‘this’ after selecting.";
        }

        private static bool Tracked(TrackedDevice device)
        {
            if (device == null || !device.added || !device.isTracked.isPressed) return false;
            return (device.trackingState.ReadValue() & 3) == 3;
        }
        private static bool Pressed(XRController device, string control) => device?.TryGetChildControl<ButtonControl>(control)?.isPressed == true;
        private static Vector2 Axis(XRController device, string control) => device?.TryGetChildControl<Vector2Control>(control)?.ReadValue() ?? Vector2.zero;

        private void CreateHud()
        {
            hudObject = new GameObject("White room controls", typeof(Canvas));
            hudObject.transform.SetParent(headCamera.transform, false);
            hudObject.transform.localPosition = new Vector3(0, -.28f, .85f);
            hudObject.transform.localScale = Vector3.one * .00065f;
            var canvas = hudObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace; canvas.worldCamera = headCamera;
            ((RectTransform)canvas.transform).sizeDelta = new Vector2(1080, 460);
            var background = new GameObject("Background", typeof(Image));
            background.transform.SetParent(canvas.transform, false);
            Stretch((RectTransform)background.transform);
            background.GetComponent<Image>().color = new Color(.04f, .06f, .08f, .9f);
            background.GetComponent<Image>().raycastTarget = false;
            var label = new GameObject("Controls and status", typeof(Text));
            label.transform.SetParent(canvas.transform, false);
            var rect = (RectTransform)label.transform;
            Stretch(rect); rect.offsetMin = new Vector2(20, 10); rect.offsetMax = new Vector2(-20, -10);
            hud = label.GetComponent<Text>();
            hud.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            hud.fontSize = 22; hud.color = Color.white; hud.alignment = TextAnchor.MiddleCenter;
            hud.supportRichText = false; hud.raycastTarget = false;
        }
        private static void Stretch(RectTransform rect)
        {
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero; rect.offsetMax = Vector2.zero;
        }
        private void OnDisable()
        {
            armed = leftArmed = voiceArmed = false; moveLatched = editLatched = true;
            if (pointer != null) pointer.enabled = false;
            if (app != null) app.ClearViewerPose();
            if (voice != null) voice.SetInputReady(false);
        }
        private void OnApplicationFocus(bool focused) { if (!focused && app != null) app.ClearViewerPose(); }
        private void OnDestroy()
        {
            if (pointer != null) Destroy(pointer.gameObject);
            if (pointerMaterial != null) Destroy(pointerMaterial);
            if (hudObject != null) Destroy(hudObject);
        }
    }
}
#endif
