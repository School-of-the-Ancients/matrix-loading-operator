using UnityEngine;
using UnityEngine.InputSystem;

namespace ArSandbox
{
    public sealed class DesktopControls : MonoBehaviour
    {
        public SandboxApp app;
        public PcBridge bridge;
        private Vector2 scroll;
        private GUIStyle title, wrapped;

        private void Update()
        {
            if (Mouse.current == null || !Mouse.current.leftButton.wasPressedThisFrame || app.World == null) return;
            var point = Mouse.current.position.ReadValue();
            if (point.x < 340) return;
            var ray = Camera.main.ScreenPointToRay(point);
            if (!Physics.Raycast(ray, out var hit, 100)) return;
            foreach (var item in app.World.Capture().scene.objects)
            {
                if (app.World.TryGetObject(item.objectId, out var go) && hit.transform.IsChildOf(go.transform))
                { app.SelectObject(item.objectId); return; }
            }
            var id = hit.point.y > 0.65f ? "sim-table" : "sim-floor";
            foreach (var target in app.Targets) if (target.anchorId == id) app.SetPlacement(id, target.origin.InverseTransformPoint(hit.point));
        }

        private void OnGUI()
        {
            if (title == null) { title = new GUIStyle(GUI.skin.label) { fontSize = 23, fontStyle = FontStyle.Bold }; wrapped = new GUIStyle(GUI.skin.label) { wordWrap = true }; }
            GUI.Box(new Rect(12, 12, 316, Screen.height - 24), "");
            GUILayout.BeginArea(new Rect(26, 25, 288, Screen.height - 50));
            GUILayout.Label("AR Sandbox", title);
            GUILayout.Label("SIMULATED ROOM", new GUIStyle(GUI.skin.label) { normal = { textColor = new Color(1, 0.72f, 0.3f) } });
            GUILayout.Label("Click the table or floor to choose a placement. Click a prop to select it.", wrapped);
            GUILayout.Space(12);
            GUILayout.Label("Bundled prop: " + app.SelectedAssetName);
            if (GUILayout.Button("Choose next prop", GUILayout.Height(28))) app.CycleAsset();
            if (GUILayout.Button("Add prop here", GUILayout.Height(34))) app.SpawnSelected();
            GUILayout.Space(10);
            if (app.World != null)
            {
                scroll = GUILayout.BeginScrollView(scroll, GUILayout.Height(130));
                foreach (var item in app.World.Capture().scene.objects)
                    if (GUILayout.Button((item.objectId == app.SelectedObjectId ? "> " : "") + item.assetId + "  " + item.objectId.Substring(0, Mathf.Min(8, item.objectId.Length)))) app.SelectObject(item.objectId);
                GUILayout.EndScrollView();
            }
            GUILayout.Label("Edit selected prop");
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Left")) app.EditSelected(Vector3.left * .1f, 0, 1);
            if (GUILayout.Button("Right")) app.EditSelected(Vector3.right * .1f, 0, 1);
            if (GUILayout.Button("Forward")) app.EditSelected(Vector3.forward * .1f, 0, 1);
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Turn 15°")) app.EditSelected(Vector3.zero, 15, 1);
            if (GUILayout.Button("Larger")) app.EditSelected(Vector3.zero, 0, 1.2f);
            if (GUILayout.Button("Smaller")) app.EditSelected(Vector3.zero, 0, 1 / 1.2f);
            GUILayout.EndHorizontal();
            if (GUILayout.Button("Delete selected")) app.Execute(new SandboxCommand { op = "delete", objectId = app.SelectedObjectId });
            GUILayout.Space(12);
            GUILayout.Label(app.Status, wrapped);
            GUILayout.Space(8);
            GUILayout.Label(bridge.ConnectionStatus, wrapped);
            GUILayout.Label("Open the PC control page for save/load, precise edits, and optional AI plans.", wrapped);
            GUILayout.EndArea();
        }
    }
}
