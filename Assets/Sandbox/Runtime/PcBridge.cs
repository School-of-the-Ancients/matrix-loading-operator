using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace ArSandbox
{
    public sealed class PcBridge : MonoBehaviour
    {
        [Serializable] public sealed class Settings { public string url = "http://127.0.0.1:8765"; public string token = ""; }
        [Serializable] private sealed class Exchange { public string clientId; public SandboxSnapshot snapshot; public List<CommandResult> results; }
        [Serializable] private sealed class Incoming { public List<SandboxCommand> commands; public LessonGuideData lesson; }
        public SandboxApp app;
        public string ConnectionStatus { get; private set; } = "PC service not connected.";
        public bool IsConnected { get; private set; }
        public string ClientId => clientId;
        public LessonGuideData CurrentGuide { get; private set; }
        public Settings settings = new Settings();
        private readonly string clientId = Guid.NewGuid().ToString("N");
        private readonly List<CommandResult> pendingResults = new List<CommandResult>();
        private readonly Dictionary<string, CommandResult> completed = new Dictionary<string, CommandResult>();
        private readonly Queue<string> completionOrder = new Queue<string>();
        private UnityWebRequest activeRequest;

        private void Start()
        {
            var path = Path.Combine(Application.persistentDataPath, "control.json");
            if (File.Exists(path))
            {
                try { settings = JsonUtility.FromJson<Settings>(File.ReadAllText(path)) ?? new Settings(); }
                catch (Exception) { ConnectionStatus = "Invalid control.json; using localhost."; settings = new Settings(); }
            }
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i + 1 < args.Length; i++) if (args[i] == "-serviceUrl") settings.url = args[i + 1];
            if (!Uri.TryCreate(settings.url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https") || !string.IsNullOrEmpty(uri.UserInfo))
            { ConnectionStatus = "Invalid PC service URL."; return; }
            StartCoroutine(Poll());
        }

        private IEnumerator Poll()
        {
            var pause = new WaitForSecondsRealtime(0.25f);
            while (true)
            {
                if (app.World == null || app.RoomReloading) { IsConnected = false; yield return pause; continue; }
                var snapshot = app.World.Capture();
                snapshot.selection = new SelectionData { anchorId = app.SelectedAnchorId, objectId = app.SelectedObjectId, position = SandboxApp.Vec(app.Placement) };
                // Explicit empty frames avoid JsonUtility's inline-null class/list defaults.
                snapshot.viewer = app.CaptureViewer() ?? new ViewerData();
                var body = JsonUtility.ToJson(new Exchange { clientId = clientId, snapshot = snapshot, results = new List<CommandResult>(pendingResults) });
                using (var request = new UnityWebRequest(settings.url.TrimEnd('/') + "/api/exchange", "POST"))
                {
                    activeRequest = request;
                    request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
                    request.downloadHandler = new DownloadHandlerBuffer();
                    request.timeout = 5;
                    request.SetRequestHeader("Content-Type", "application/json");
                    if (!string.IsNullOrEmpty(settings.token)) request.SetRequestHeader("Authorization", "Bearer " + settings.token);
                    yield return request.SendWebRequest();
                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        IsConnected = false;
                        ConnectionStatus = request.responseCode == 409 ? "PC service is paired with another running app." : "PC service offline. Quest USB: run adb reverse tcp:8765 tcp:8765.";
                    }
                    else
                    {
                        pendingResults.Clear();
                        Incoming incoming = null;
                        try { incoming = JsonUtility.FromJson<Incoming>(request.downloadHandler.text); }
                        catch (Exception) { ConnectionStatus = "PC returned invalid command data."; }
                        IsConnected = incoming != null;
                        if (incoming != null)
                        {
                            ConnectionStatus = "PC connected — scene state synchronized.";
                            ReceiveGuide(incoming.lesson);
                            if (incoming.commands != null) foreach (var command in incoming.commands)
                            {
                                if (command == null || string.IsNullOrEmpty(command.requestId)) continue;
                                if (!completed.TryGetValue(command.requestId, out var result))
                                {
                                    result = app.Execute(command);
                                    completed.Add(command.requestId, result); completionOrder.Enqueue(command.requestId);
                                    while (completionOrder.Count > 512) completed.Remove(completionOrder.Dequeue());
                                }
                                pendingResults.Add(result);
                            }
                        }
                    }
                    activeRequest = null;
                }
                yield return pause;
            }
        }

        private void ReceiveGuide(LessonGuideData incoming)
        {
            // A missing field is also null, so older services and ended sessions clear the panel.
            if (incoming == null) { CurrentGuide = null; return; }
            if (!ValidGuide(incoming)) { CurrentGuide = null; return; }
            if (CurrentGuide != null && incoming.sessionId == CurrentGuide.sessionId && incoming.revision < CurrentGuide.revision) return;
            CurrentGuide = new LessonGuideData
            {
                sessionId = incoming.sessionId,
                revision = incoming.revision,
                title = GuideText(incoming.title, 120),
                stageLabel = GuideText(incoming.stageLabel, 80),
                body = GuideText(incoming.body, 1200),
                prompt = GuideText(incoming.prompt, 600),
                hint = GuideText(incoming.hint, 400),
                status = GuideText(incoming.status, 120),
                progressIndex = incoming.progressIndex,
                progressTotal = incoming.progressTotal
            };
        }

        private static bool ValidGuide(LessonGuideData guide)
        {
            if (string.IsNullOrWhiteSpace(guide.sessionId) || guide.sessionId.Length > 128 || guide.revision < 0 ||
                guide.progressTotal < 0 || guide.progressTotal > 1000 || guide.progressIndex < 0 || guide.progressIndex > guide.progressTotal ||
                string.IsNullOrWhiteSpace(guide.title)) return false;
            foreach (var value in guide.sessionId) if (char.IsControl(value) || char.IsWhiteSpace(value)) return false;
            // Refuse oversized raw fields before formatting; normal content is clipped below.
            return BoundedField(guide.title) && BoundedField(guide.stageLabel) && BoundedField(guide.body) &&
                BoundedField(guide.prompt) && BoundedField(guide.hint) && BoundedField(guide.status) && GuideText(guide.title, 120).Length > 0;
        }

        private static bool BoundedField(string value) => value == null || value.Length <= 8192;

        private static string GuideText(string value, int limit)
        {
            if (string.IsNullOrEmpty(value)) return "";
            var result = new StringBuilder(Math.Min(value.Length, limit));
            var space = false;
            foreach (var character in value)
            {
                if (char.IsWhiteSpace(character)) { space = result.Length > 0; continue; }
                if (char.IsControl(character)) continue;
                if (space && result.Length < limit) result.Append(' ');
                space = false;
                if (result.Length >= limit) break;
                result.Append(character);
            }
            return result.ToString().TrimEnd();
        }

        private void OnDisable() { IsConnected = false; activeRequest?.Abort(); StopAllCoroutines(); }
    }
}
