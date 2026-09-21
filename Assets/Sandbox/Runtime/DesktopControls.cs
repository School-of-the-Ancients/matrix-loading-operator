using UnityEngine;
using UnityEngine.InputSystem;

namespace ArSandbox
{
    public sealed class DesktopControls : MonoBehaviour
    {
        public SandboxApp app;
        public PcBridge bridge;
        private Vector2 scroll;
        private Vector2 guideScroll;
        private GUIStyle title, wrapped;
        private GUIStyle guideTitle, guideBody, guidePrompt, guideCaption;
        private string guideSession;
        private int guideRevision = -1;
        private Camera viewerCamera;

        private void Start() { viewerCamera = Camera.main; }

        private void LateUpdate()
        {
            if (app == null) return;
            if (viewerCamera != null && viewerCamera.isActiveAndEnabled)
                app.SetViewerPose(viewerCamera.transform.position, viewerCamera.transform.forward, viewerCamera);
            else app.ClearViewerPose();
        }

        private void OnDisable() { if (app != null) app.ClearViewerPose(); }

        private Rect GuideRect => new Rect(340f, 12f, Mathf.Max(140f, Mathf.Min(460f, Screen.width - 352f)), Mathf.Min(660f, Screen.height - 24f));

        private void Update()
        {
            if (Mouse.current == null || !Mouse.current.leftButton.wasPressedThisFrame || app.World == null) return;
            var point = Mouse.current.position.ReadValue();
            if (point.x < 340) return;
            if (bridge != null && bridge.CurrentGuide != null && GuideRect.Contains(new Vector2(point.x, Screen.height - point.y))) return;
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
            DrawGuide();
        }

        private void DrawGuide()
        {
            var guide = bridge != null ? bridge.CurrentGuide : null;
            if (guide == null) return;
            if (guideTitle == null)
            {
                guideTitle = new GUIStyle(GUI.skin.label) { fontSize = 22, fontStyle = FontStyle.Bold, wordWrap = true, richText = false };
                guideBody = new GUIStyle(GUI.skin.label) { fontSize = 16, wordWrap = true, richText = false };
                guidePrompt = new GUIStyle(guideBody) { fontStyle = FontStyle.Bold };
                guideCaption = new GUIStyle(guideBody) { fontSize = 14 };
            }
            if (guideSession != guide.sessionId || guideRevision != guide.revision)
            {
                guideSession = guide.sessionId;
                guideRevision = guide.revision;
                guideScroll = Vector2.zero;
            }
            var panel = GuideRect;
            GUI.Box(panel, "");
            GUILayout.BeginArea(new Rect(panel.x + 16, panel.y + 12, panel.width - 32, panel.height - 24));
            guideScroll = GUILayout.BeginScrollView(guideScroll);
            GUILayout.Label("LEARNING GUIDE", guideCaption);
            GUILayout.Label(guide.title, guideTitle);
            GUILayout.Label(guide.stageLabel + (guide.progressTotal > 0 ? "  ·  " + guide.progressIndex + " / " + guide.progressTotal : ""), guideCaption);
            if (!bridge.IsConnected) GUILayout.Label("PC connection paused — showing the last received guide.", guidePrompt);
            if (!string.IsNullOrEmpty(guide.status)) GUILayout.Label(guide.status, guideCaption);
            GUILayout.Space(10);
            if (!string.IsNullOrEmpty(guide.body)) GUILayout.Label(guide.body, guideBody);
            if (!string.IsNullOrEmpty(guide.prompt))
            {
                GUILayout.Space(10);
                GUILayout.Label(guide.prompt, guidePrompt);
            }
            if (!string.IsNullOrEmpty(guide.hint))
            {
                GUILayout.Space(8);
                GUILayout.Label("Hint: " + guide.hint, guideBody);
            }
            GUILayout.Space(12);
            GUILayout.Label("Read the full lesson, enter your observation, and continue on the PC learning panel.", guideCaption);
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }
    }
}
