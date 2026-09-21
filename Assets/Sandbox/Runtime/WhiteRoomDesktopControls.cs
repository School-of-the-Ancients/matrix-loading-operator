using UnityEngine;
using UnityEngine.InputSystem;

namespace ArSandbox
{
    public sealed class WhiteRoomDesktopControls : MonoBehaviour
    {
        public SandboxApp app;
        public PcBridge bridge;
        public Camera view;
        private Vector2 scroll;
        private GUIStyle heading, wrapped;
        private float yaw, pitch;
        private bool looking;
        private const float PanelWidth = 326;

        private void Start()
        {
            if (view == null) view = Camera.main;
            if (view != null) { yaw = view.transform.eulerAngles.y; pitch = view.transform.eulerAngles.x; }
        }

        private void Update()
        {
            var mouse = Mouse.current;
            var keyboard = Keyboard.current;
            if (view == null || mouse == null || app.World == null) return;
            var point = mouse.position.ReadValue();
            if (mouse.rightButton.wasPressedThisFrame && point.x > PanelWidth)
            { looking = true; Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
            if (!mouse.rightButton.isPressed || (keyboard != null && keyboard.escapeKey.wasPressedThisFrame)) ReleaseLook();
            if (looking)
            {
                var delta = mouse.delta.ReadValue();
                yaw += delta.x * .12f; pitch = Mathf.Clamp(pitch - delta.y * .12f, -80, 80);
                view.transform.rotation = Quaternion.Euler(pitch, yaw, 0);
                if (keyboard != null)
                {
                    var motion = Vector3.zero;
                    if (keyboard.wKey.isPressed) motion += view.transform.forward;
                    if (keyboard.sKey.isPressed) motion -= view.transform.forward;
                    if (keyboard.aKey.isPressed) motion -= view.transform.right;
                    if (keyboard.dKey.isPressed) motion += view.transform.right;
                    if (keyboard.eKey.isPressed) motion += Vector3.up;
                    if (keyboard.qKey.isPressed) motion -= Vector3.up;
                    view.transform.position += motion.normalized * (keyboard.leftShiftKey.isPressed ? 5 : 2) * Time.unscaledDeltaTime;
                    var position = view.transform.position;
                    position.y = Mathf.Clamp(position.y, .2f, 15);
                    view.transform.position = position;
                }
            }
            if (looking || point.x <= PanelWidth || !mouse.leftButton.wasPressedThisFrame) return;
            if (!Physics.Raycast(view.ScreenPointToRay(point), out var hit, 100)) return;
            foreach (var item in app.World.Capture().scene.objects)
                if (app.World.TryGetObject(item.objectId, out var go) && hit.transform.IsChildOf(go.transform))
                { app.SelectObject(item.objectId); return; }
            foreach (var target in app.Targets)
                if (target.anchorId == WhiteRoomAdapter.FloorId)
                { app.SetPlacement(target.anchorId, target.origin.InverseTransformPoint(hit.point)); return; }
        }

        private void LateUpdate()
        {
            if (app == null) return;
            // The desktop camera remains a valid viewpoint while the PC Operator
            // browser has focus. XR instead requires active headset tracking/focus.
            if (view != null && view.isActiveAndEnabled)
                app.SetViewerPose(view.transform.position, view.transform.forward, view);
            else app.ClearViewerPose();
        }

        private void ReleaseLook() { looking = false; Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
        private void OnDisable() { ReleaseLook(); if (app != null) app.ClearViewerPose(); }
        private void OnApplicationFocus(bool focused)
        {
            if (!focused) ReleaseLook();
        }

        private void OnGUI()
        {
            if (heading == null)
            {
                heading = new GUIStyle(GUI.skin.label) { fontSize = 23, fontStyle = FontStyle.Bold };
                wrapped = new GUIStyle(GUI.skin.label) { wordWrap = true };
            }
            GUI.Box(new Rect(12, 12, PanelWidth - 12, Screen.height - 24), "");
            GUILayout.BeginArea(new Rect(26, 25, PanelWidth - 42, Screen.height - 50));
            scroll = GUILayout.BeginScrollView(scroll);
            GUILayout.Label("Matrix Operator", heading);
            GUILayout.Label("WHITE ROOM · DESKTOP");
            GUILayout.Label("Click the floor to place. Click a prop to select. Hold right mouse + WASD to explore; Q/E lowers/raises the camera.", wrapped);
            GUILayout.Space(10);
            GUILayout.Label("Summon: " + app.SelectedAssetName);
            if (GUILayout.Button("Choose next prop", GUILayout.Height(28))) app.CycleAsset();
            if (GUILayout.Button("Summon here", GUILayout.Height(34))) app.SpawnSelected();
            GUILayout.Label("Position: " + app.Placement.ToString("F2") + " m");
            GUILayout.Space(8);
            GUILayout.Label("Scene objects");
            if (app.World != null)
                foreach (var item in app.World.Capture().scene.objects)
                    if (GUILayout.Button((item.objectId == app.SelectedObjectId ? "> " : "") + item.assetId + " · " + item.objectId.Substring(0, Mathf.Min(6, item.objectId.Length))))
                        app.SelectObject(item.objectId);
            GUI.enabled = !string.IsNullOrEmpty(app.SelectedObjectId);
            GUILayout.Space(8);
            GUILayout.Label("Move selected · 10 cm");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Left")) app.EditSelected(Vector3.left * .1f, 0, 1);
            if (GUILayout.Button("Right")) app.EditSelected(Vector3.right * .1f, 0, 1);
            if (GUILayout.Button("Up")) app.EditSelected(Vector3.up * .1f, 0, 1);
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Forward")) app.EditSelected(Vector3.forward * .1f, 0, 1);
            if (GUILayout.Button("Back")) app.EditSelected(Vector3.back * .1f, 0, 1);
            if (GUILayout.Button("Down")) app.EditSelected(Vector3.down * .1f, 0, 1);
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Turn 15°")) app.EditSelected(Vector3.zero, 15, 1);
            if (GUILayout.Button("Bigger")) app.EditSelected(Vector3.zero, 0, 1.2f);
            if (GUILayout.Button("Smaller")) app.EditSelected(Vector3.zero, 0, 1 / 1.2f);
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Duplicate")) app.Execute(new SandboxCommand { op = "duplicate", objectId = app.SelectedObjectId });
            if (GUILayout.Button("Delete")) app.Execute(new SandboxCommand { op = "delete", objectId = app.SelectedObjectId });
            GUILayout.EndHorizontal();
            GUI.enabled = app.World != null;
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Undo")) app.Execute(new SandboxCommand { op = "undo" });
            if (GUILayout.Button("Redo")) app.Execute(new SandboxCommand { op = "redo" });
            if (GUILayout.Button("Clear")) app.Execute(new SandboxCommand { op = "clear" });
            GUILayout.EndHorizontal();
            GUI.enabled = true;
            GUILayout.Space(10);
            GUILayout.Label(app.Status, wrapped);
            GUILayout.Label(bridge.ConnectionStatus, wrapped);
            GUILayout.Label("Use the PC Operator panel for natural language, exact transforms, save and restore.", wrapped);
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }
    }
}
