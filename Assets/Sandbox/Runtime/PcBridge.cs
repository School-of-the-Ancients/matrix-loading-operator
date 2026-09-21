using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
using Stopwatch = System.Diagnostics.Stopwatch;

namespace ArSandbox
{
    public sealed class PcBridge : MonoBehaviour
    {
        [Serializable] public sealed class Settings { public string url = "http://127.0.0.1:8765"; public string token = ""; }
        [Serializable] private sealed class Exchange { public string clientId; public SandboxSnapshot snapshot; public RoomContextData runtime; public List<CommandResult> results; public bool captureSupported = true; public SceneCaptureResult capture; }
        [Serializable] private sealed class Incoming { public List<SandboxCommand> commands; public LessonGuideData lesson; public SceneCaptureRequest capture; }
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
        private readonly SandboxSceneCapture sceneCapture = new SandboxSceneCapture();
        private SceneCaptureResult pendingCapture;
        private SceneCaptureResult lastCapture;
        private const int MaximumExchangeBytes = 3 * 1024 * 1024;
        private long frameStartTimestamp;

        // Use a monotonic wall clock. XR can report predicted display cadence in
        // Unity deltaTime even when synchronous capture stalls the application.
        private void Update() { frameStartTimestamp = Stopwatch.GetTimestamp(); }

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
                if ((app.World == null || app.RoomReloading) && app.RoomContext?.mode != "ar") { IsConnected = false; yield return pause; continue; }
                var snapshot = app.CaptureSnapshot();
                var exchange = new Exchange { clientId = clientId, snapshot = snapshot, runtime = app.RoomContext,
                    results = new List<CommandResult>(pendingResults), capture = pendingCapture };
                byte[] body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(exchange));
                if (body.Length > MaximumExchangeBytes && pendingCapture != null)
                {
                    RejectPendingCapture("Image and paired scene exceed the 3 MiB exchange limit. Reduce scene complexity and capture again.");
                    exchange.capture = pendingCapture;
                    body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(exchange));
                }
                SceneCaptureRequest captureRequest = null;
                using (var request = new UnityWebRequest(settings.url.TrimEnd('/') + "/api/exchange", "POST"))
                {
                    activeRequest = request;
                    request.uploadHandler = new UploadHandlerRaw(body);
                    request.downloadHandler = new DownloadHandlerBuffer();
                    request.timeout = 5;
                    request.SetRequestHeader("Content-Type", "application/json");
                    if (!string.IsNullOrEmpty(settings.token)) request.SetRequestHeader("Authorization", "Bearer " + settings.token);
                    yield return request.SendWebRequest();
                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        // Older services may still enforce a smaller body cap. Retire
                        // the image, preserving a small failure receipt and live polling.
                        if (request.responseCode == 413 && !string.IsNullOrEmpty(pendingCapture?.dataBase64))
                            RejectPendingCapture("PC service rejected the image upload size. Update the PC service or reduce scene complexity and capture again.");
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
                            // Keep encoded pixels across failed uploads. A successful
                            // parsed exchange acknowledges this exact capture receipt.
                            pendingCapture = null;
                            captureRequest = incoming.capture;
                            ConnectionStatus = snapshot == null ? "PC connected — waiting for configured room data." : "PC connected — scene state synchronized.";
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
                if (captureRequest != null && !string.IsNullOrEmpty(captureRequest.captureId))
                {
                    if (lastCapture != null && lastCapture.captureId == captureRequest.captureId)
                        pendingCapture = lastCapture;
                    else
                    {
                        // LateUpdate has completed for tracked cameras and Update has
                        // applied current rotate/bob offsets before pixels and state pair.
                        // Headless players may never signal end-of-frame; let the
                        // capture return its explicit graphics-unavailable receipt.
                        if (SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null)
                            yield return new WaitForEndOfFrame();
                        long captureFrameStart = frameStartTimestamp;
                        pendingCapture = lastCapture = sceneCapture.Capture(app, captureRequest, clientId);
                        if (pendingCapture.ok)
                        {
                            // Normal coroutines resume after Update in the next frame.
                            // Bracket the capture frame with this component's Update
                            // timestamps, including capture work, other frame work and
                            // scheduling waits. Pixels, pose and snapshot stay frozen.
                            yield return null;
                            if (captureFrameStart > 0 && frameStartTimestamp > captureFrameStart)
                                pendingCapture.captureFrameTimeMs = (frameStartTimestamp - captureFrameStart) *
                                    (1000d / Stopwatch.Frequency);
                        }
                    }
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

        private void RejectPendingCapture(string error)
        {
            pendingCapture = new SceneCaptureResult { captureId = pendingCapture.captureId,
                clientId = pendingCapture.clientId, revision = pendingCapture.revision, ok = false, error = error };
            lastCapture = pendingCapture;
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

        private void OnDisable() { IsConnected = false; activeRequest?.Abort(); StopAllCoroutines(); pendingCapture = lastCapture = null; }
    }
}
