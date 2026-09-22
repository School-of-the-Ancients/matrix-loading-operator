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
        [Serializable] private sealed class ContentCapabilities { public bool supported = true; public string platform = SandboxContentRules.RuntimePlatformName; public string unityVersion = Application.unityVersion; }
        [Serializable] private sealed class Exchange { public string clientId; public SandboxSnapshot snapshot; public RoomContextData runtime; public List<CommandResult> results; public bool captureSupported = true; public SceneCaptureCapabilities captureCapabilities; public SceneCaptureResult capture; public ContentCapabilities contentCapabilities = new ContentCapabilities(); public ContentInstallReceipt contentReceipt; }
        [Serializable] private sealed class Incoming { public List<SandboxCommand> commands; public LessonGuideData lesson; public SceneCaptureRequest capture; public ContentInstallRequest contentInstall; }
        public SandboxApp app;
        public string ConnectionStatus { get; private set; } = "PC service not connected.";
        public bool IsConnected { get; private set; }
        public string ClientId => clientId;
        public LessonGuideData CurrentGuide { get; private set; }
        public Settings settings = new Settings();
        private readonly string clientId = Guid.NewGuid().ToString("N");
        private readonly SandboxCommandInbox inbox = new SandboxCommandInbox();
        private bool executingCommands;
        private UnityWebRequest activeRequest;
        private readonly SandboxSceneCapture sceneCapture = new SandboxSceneCapture();
        private SceneCaptureResult pendingCapture;
        private SceneCaptureResult lastCapture;
        private const int MaximumExchangeBytes = 3 * 1024 * 1024;
        private long frameStartTimestamp;
        private string activeCaptureId;
        private Coroutine captureRoutine;
        private QuestCameraCapture physicalCapture;
        private SandboxContentLoader contentLoader;
        private ContentInstallReceipt pendingContent, lastContent;
        private string activeContentId;

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
            contentLoader = app.GetComponent<SandboxContentLoader>() ?? app.gameObject.AddComponent<SandboxContentLoader>();
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
                    results = inbox.Results(), capture = pendingCapture,
                    captureCapabilities = QuestCameraCapture.GetCapabilities(app), contentReceipt = pendingContent };
                byte[] body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(exchange));
                if (body.Length > MaximumExchangeBytes && pendingCapture != null)
                {
                    RejectPendingCapture("Image and paired scene exceed the 3 MiB exchange limit. Reduce scene complexity and capture again.");
                    exchange.capture = pendingCapture;
                    body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(exchange));
                }
                SceneCaptureRequest captureRequest = null;
                ContentInstallRequest contentRequest = null;
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
                        if (request.responseCode == 413 && ReferenceEquals(pendingCapture, exchange.capture) && !string.IsNullOrEmpty(pendingCapture?.dataBase64))
                            RejectPendingCapture("PC service rejected the image upload size. Update the PC service or reduce scene complexity and capture again.");
                        IsConnected = false;
                        ConnectionStatus = request.responseCode == 409 ? "PC service is paired with another running app." : "PC service offline. Quest USB: run adb reverse tcp:8765 tcp:8765.";
                    }
                    else
                    {
                        Incoming incoming = null;
                        try { incoming = JsonUtility.FromJson<Incoming>(request.downloadHandler.text); }
                        catch (Exception) { ConnectionStatus = "PC returned invalid command data."; }
                        IsConnected = incoming != null;
                        if (incoming != null)
                        {
                            // Async cached restore can finish while this request is
                            // in flight. Acknowledge only receipts actually uploaded.
                            inbox.Acknowledge(exchange.results);
                            // Keep encoded pixels across failed uploads. A successful
                            // parsed exchange acknowledges this exact capture receipt.
                            // A background physical-camera capture can finish while
                            // this HTTP request is in flight. Ack only what was sent.
                            if (ReferenceEquals(pendingCapture, exchange.capture)) pendingCapture = null;
                            captureRequest = incoming.capture;
                            if (ReferenceEquals(pendingContent, exchange.contentReceipt)) pendingContent = null;
                            contentRequest = incoming.contentInstall;
                            ConnectionStatus = snapshot == null ? "PC connected — waiting for configured room data." : "PC connected — scene state synchronized.";
                            ReceiveGuide(incoming.lesson);
                            inbox.Receive(incoming.commands);
                            if (!executingCommands && inbox.Next != null) StartCoroutine(ExecuteCommands());
                        }
                    }
                    activeRequest = null;
                }
                if (captureRequest != null && !string.IsNullOrEmpty(captureRequest.captureId))
                {
                    if (lastCapture != null && lastCapture.captureId == captureRequest.captureId)
                        pendingCapture = lastCapture;
                    else if (activeCaptureId != captureRequest.captureId)
                    {
                        if (captureRoutine != null) StopCoroutine(captureRoutine);
                        physicalCapture?.CancelCapture();
                        activeCaptureId = captureRequest.captureId;
                        captureRoutine = StartCoroutine(CaptureScene(captureRequest));
                    }
                }
                if (contentRequest != null && !string.IsNullOrEmpty(contentRequest.requestId))
                {
                    if (lastContent != null && lastContent.requestId == contentRequest.requestId) pendingContent = lastContent;
                    else if (string.IsNullOrEmpty(activeContentId))
                    {
                        activeContentId = contentRequest.requestId;
                        StartCoroutine(InstallContent(contentRequest));
                    }
                }
                yield return pause;
            }
        }

        private IEnumerator InstallContent(ContentInstallRequest request)
        {
            // Download asynchronously while the normal heartbeat keeps its lease.
            yield return contentLoader.Install(request, settings.url, settings.token,
                receipt => { pendingContent = lastContent = receipt; });
            activeContentId = null;
        }

        private IEnumerator ExecuteCommands()
        {
            executingCommands = true;
            try
            {
                while (inbox.Next != null)
                {
                    SandboxCommand command = inbox.Next;
                    CommandResult result = null;
                    SandboxWorld completedWorld = null;
                    RoomContextData completedRoom = null;
                    long completedRevision = 0;
                    if (command.op == "load")
                        yield return contentLoader.Restore(command, value => {
                            result = value ?? new CommandResult { requestId = command.requestId, error = "Cached restore returned no receipt." };
                            // Record in the same call stack as the scene mutation.
                            // Disable/teardown before this parent resumes must not
                            // lose the dedup receipt for an already-applied load.
                            inbox.Complete(result);
                            if (!result.ok) inbox.RejectPending("Earlier restore failed. Review and submit these commands again.");
                            completedWorld = app.World; completedRoom = app.RoomContext;
                            completedRevision = completedWorld != null ? completedWorld.EditRevision : 0;
                        });
                    else { result = app.Execute(command); inbox.Complete(result); }
                    if (result == null) inbox.Complete(new CommandResult { requestId = command.requestId,
                        error = "Command did not finish; current scene was not confirmed restored." });
                    // A failed restore must not release its following edits onto
                    // another room/scene. Also guard the frame between completion
                    // of the nested coroutine and this queue resuming.
                    if (command.op == "load" && (result == null || !result.ok || app.World != completedWorld ||
                        app.RoomContext != completedRoom || app.RoomReloading || !app.RoomEditingAllowed ||
                        completedWorld == null || completedWorld.EditRevision != completedRevision))
                        inbox.RejectPending("Earlier restore failed or the scene changed while restoring. Review and submit these commands again.");
                }
            }
            finally { executingCommands = false; }
        }

        private IEnumerator CaptureScene(SceneCaptureRequest request)
        {
            SandboxSceneCapture.PhysicalFrame frame = null;
            try
            {
                if (SandboxSceneCapture.Mode(request) == "mixed")
                {
                    physicalCapture = app != null ? app.GetComponent<QuestCameraCapture>() : null;
                    if (physicalCapture == null)
                    {
                        pendingCapture = lastCapture = SandboxSceneCapture.Failure(request, clientId, QuestCameraCapture.GetCapabilities(app).reason);
                        yield break;
                    }
                    string preparationError = null;
                    yield return physicalCapture.Prepare((prepared, error) => { frame = prepared; preparationError = error; });
                    if (preparationError != null || frame == null)
                    {
                        pendingCapture = lastCapture = SandboxSceneCapture.Failure(request, clientId, preparationError ?? "No physical-camera frame was acquired.");
                        yield break;
                    }
                }
                // Keep heartbeat/commands running while permission or startup waits.
                // Render after tracked camera and behavior presentation updates.
                if (SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null)
                    yield return new WaitForEndOfFrame();
                long captureFrameStart = frameStartTimestamp;
                SceneCaptureResult result = sceneCapture.Capture(app, request, clientId, frame);
                frame?.Dispose();
                frame = null;
                if (result.ok)
                {
                    yield return null;
                    if (captureFrameStart > 0 && frameStartTimestamp > captureFrameStart)
                        result.captureFrameTimeMs = (frameStartTimestamp - captureFrameStart) * (1000d / Stopwatch.Frequency);
                }
                pendingCapture = lastCapture = result;
            }
            finally
            {
                frame?.Dispose();
                physicalCapture?.CancelCapture();
                activeCaptureId = null;
                captureRoutine = null;
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
                clientId = pendingCapture.clientId, revision = pendingCapture.revision, mode = pendingCapture.mode, ok = false, error = error };
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

        private void OnDisable() { IsConnected = false; activeRequest?.Abort(); StopAllCoroutines(); inbox.CancelPending(); executingCommands = false; physicalCapture?.CancelCapture(); contentLoader?.CancelInstall(); activeContentId = null; activeCaptureId = null; captureRoutine = null; pendingCapture = lastCapture = null; }
    }

    /// <summary>Bounded ordered inbox shared by synchronous edits and asynchronous cached restore.</summary>
    public sealed class SandboxCommandInbox
    {
        private readonly Queue<SandboxCommand> pending = new Queue<SandboxCommand>();
        private readonly HashSet<string> active = new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, CommandResult> completed = new Dictionary<string, CommandResult>(StringComparer.Ordinal);
        private readonly Queue<string> completionOrder = new Queue<string>();
        private readonly List<CommandResult> receipts = new List<CommandResult>();
        public SandboxCommand Next => pending.Count == 0 ? null : pending.Peek();
        public List<CommandResult> Results() => new List<CommandResult>(receipts);
        public void Acknowledge(List<CommandResult> sent) { foreach (CommandResult result in sent) receipts.Remove(result); }
        public void Receive(List<SandboxCommand> commands)
        {
            if (commands == null) return;
            foreach (SandboxCommand command in commands)
            {
                if (command == null || string.IsNullOrEmpty(command.requestId)) continue;
                if (completed.TryGetValue(command.requestId, out CommandResult result)) { AddReceipt(result); continue; }
                if (active.Contains(command.requestId)) continue;
                if (pending.Count >= 512) { Record(new CommandResult { requestId = command.requestId, error = "Runtime command queue is full." }); continue; }
                pending.Enqueue(command); active.Add(command.requestId);
            }
        }
        public void Complete(CommandResult result)
        {
            if (Next == null || result.requestId != Next.requestId) throw new InvalidOperationException("Command receipt is out of order.");
            pending.Dequeue(); active.Remove(result.requestId); Record(result);
        }
        private void Record(CommandResult result)
        {
            completed.Add(result.requestId, result); completionOrder.Enqueue(result.requestId); AddReceipt(result);
            while (completionOrder.Count > 512) completed.Remove(completionOrder.Dequeue());
        }
        private void AddReceipt(CommandResult result)
        {
            if (!receipts.Contains(result)) receipts.Add(result);
            if (receipts.Count > 1024) receipts.RemoveAt(0);
        }
        public void CancelPending() { pending.Clear(); active.Clear(); }
        public void RejectPending(string reason)
        {
            while (Next != null) Complete(new CommandResult { requestId = Next.requestId, error = reason });
        }
    }
}
