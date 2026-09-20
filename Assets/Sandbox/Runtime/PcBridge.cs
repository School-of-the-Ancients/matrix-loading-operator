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
        [Serializable] private sealed class Incoming { public List<SandboxCommand> commands; }
        public SandboxApp app;
        public string ConnectionStatus { get; private set; } = "PC service not connected.";
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
                if (app.World == null || app.RoomReloading) { yield return pause; continue; }
                var snapshot = app.World.Capture();
                snapshot.selection = new SelectionData { anchorId = app.SelectedAnchorId, objectId = app.SelectedObjectId, position = SandboxApp.Vec(app.Placement) };
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
                        ConnectionStatus = request.responseCode == 409 ? "PC service is paired with another running app." : "PC service offline. Quest USB: run adb reverse tcp:8765 tcp:8765.";
                    }
                    else
                    {
                        pendingResults.Clear();
                        Incoming incoming = null;
                        try { incoming = JsonUtility.FromJson<Incoming>(request.downloadHandler.text); }
                        catch (Exception) { ConnectionStatus = "PC returned invalid command data."; }
                        if (incoming != null)
                        {
                            ConnectionStatus = "PC connected — scene state synchronized.";
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

        private void OnDisable() { activeRequest?.Abort(); StopAllCoroutines(); }
    }
}
