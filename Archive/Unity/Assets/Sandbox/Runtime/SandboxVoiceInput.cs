using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
#if UNITY_ANDROID && !UNITY_EDITOR
using UnityEngine.Android;
#endif

namespace ArSandbox
{
    /// <summary>Intentional headset recording; transcription and planning stay on the PC.</summary>
    public sealed class SandboxVoiceInput : MonoBehaviour
    {
        [Serializable] private sealed class VoiceRequest { public string clientId; public SandboxSnapshot snapshot; public string audioBase64; }
        [Serializable] private sealed class JobReply
        {
            public string jobId, phase, transcript, summary, planId, error;
            public bool requiresApply;
            public List<SandboxCommand> commands;
        }
        [Serializable] private sealed class CancelRequest { public string clientId, jobId; }
        [Serializable] private sealed class ApplyRequest { public string planId; }
        [Serializable] private sealed class ApplyReply { public bool saved; public List<SandboxCommand> commands; }
        [Serializable] private sealed class StateReply { public bool online; public List<CommandResult> results; }
        [Serializable] private sealed class ErrorReply { public string error; }

        public SandboxApp app;
        public PcBridge bridge;
        public string Phase { get; private set; } = "idle";
        public string Transcript { get; private set; } = "";
        public string Status { get; private set; } = ReadyInstructions;
        public bool IsRecording => Phase == "listening";
        public bool IsBusy => IsRecording || Phase == "transcribing" || Phase == "planning" || Phase == "applying";
        public bool HasProposal => Phase == "ready" && !string.IsNullOrEmpty(planId);
        public string HudText => Status + (string.IsNullOrEmpty(Transcript) ? "" : "\nHeard: “" + PlainText(Transcript, 150) + "”") +
            (HasProposal && !string.IsNullOrEmpty(summary) ? "\n" + PlainText(summary, 200) : "");
        public const int SampleRate = 16000;
        public const int MaximumSeconds = 15;
        private const string ReadyInstructions = "Hold left trigger to speak. Point and select first to edit ‘this’.";
        private const string PendingExecutionWarning = " Commands may already be queued; check PC results before retrying.";
        private bool roomLoadInterruptedApply;
        private bool inputReady;
        private AudioClip recording;
        private string microphoneDevice, jobId, planId, summary;
        private SandboxSnapshot capturedSnapshot;
        private double recordingStarted, proposalExpires;
        private Coroutine workflow;
        private UnityWebRequest activeRequest, cancellationRequest;
#if UNITY_ANDROID && !UNITY_EDITOR
        private PermissionCallbacks permissionCallbacks;
#endif

        public void SetInputReady(bool ready)
        {
            inputReady = ready;
            if (!ready && (IsBusy || HasProposal)) Cancel("Voice cancelled: tracking or PC connection unavailable. Hold left trigger to retry.");
        }

        public void BeginRoomLoading()
        {
            roomLoadInterruptedApply = Phase == "applying";
            Cancel("Room loading. Voice will be available after room localization.");
            Phase = "room_loading";
        }

        public void EndRoomLoading(bool roomReady)
        {
            // Room completion owns only its loading notice. A later microphone
            // error, permission response, cancellation or voice workflow wins.
            if (Phase != "room_loading") return;
            Phase = "idle";
            Status = (roomReady ? ReadyInstructions : "Voice needs a localized room. Check the room status above and reload when ready.") +
                (roomLoadInterruptedApply ? PendingExecutionWarning : "");
            roomLoadInterruptedApply = false;
        }

        public void BeginRecording()
        {
            if (!isActiveAndEnabled || !inputReady || app == null || app.World == null || app.RoomReloading || bridge == null || !bridge.IsConnected)
            { Fail("Voice needs tracked controllers and a connected PC service."); return; }
            if (IsBusy || Phase == "permission") return;
            Cancel(null);
            Transcript = "";
            summary = "";
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
            {
                Phase = "permission";
                Status = "Allow microphone access in the headset prompt, then release and hold left trigger again.";
                permissionCallbacks = new PermissionCallbacks();
                permissionCallbacks.PermissionGranted += MicrophoneGranted;
                permissionCallbacks.PermissionDenied += MicrophoneDenied;
                Permission.RequestUserPermission(Permission.Microphone, permissionCallbacks);
                return;
            }
#endif
            try
            {
                var devices = Microphone.devices;
                if (devices.Length == 0) { Fail("No microphone is available on this device."); return; }
                microphoneDevice = devices[0];
                // A spoken deictic reference uses the selection and view at recording start.
                capturedSnapshot = app.CaptureSnapshot();
                recording = Microphone.Start(microphoneDevice, false, MaximumSeconds, SampleRate);
                if (recording == null) { Fail("Microphone capture did not start. Release and try again."); return; }
                recordingStarted = Time.realtimeSinceStartupAsDouble;
                Phase = "listening";
                Status = "Listening… release left trigger to send (15 seconds maximum).";
            }
            catch (Exception) { ReleaseMicrophone(); Fail("Microphone capture failed. Check microphone permission and try again."); }
        }

        public void FinishRecording()
        {
            if (!IsRecording) return;
            if (!inputReady || bridge == null || !bridge.IsConnected) { Cancel("Voice cancelled: PC or tracking unavailable."); return; }
            byte[] wave = null;
            try
            {
                int frames = Microphone.GetPosition(microphoneDevice);
                double elapsed = Time.realtimeSinceStartupAsDouble - recordingStarted;
                // Non-looping devices may return zero after the entire clip is filled.
                if (frames <= 0 && elapsed >= MaximumSeconds) frames = recording.samples;
                frames = Math.Min(frames, recording.samples);
                Microphone.End(microphoneDevice);
                if (frames < recording.frequency * .3f) { Fail("Recording was too short. Hold left trigger while speaking."); return; }
                var samples = new float[frames * recording.channels];
                if (!recording.GetData(samples, 0)) { Fail("Could not read microphone audio. Please try again."); return; }
                float peak = 0;
                foreach (float sample in samples) if (!float.IsNaN(sample) && !float.IsInfinity(sample)) peak = Mathf.Max(peak, Mathf.Abs(sample));
                if (peak < .001f) { Fail("No audible speech was captured. Check the microphone and try again."); return; }
                wave = EncodePcm16Wave(samples, recording.channels, recording.frequency, frames);
            }
            catch (Exception) { Fail("Could not prepare microphone audio. Please try again."); }
            finally { ReleaseMicrophone(); }
            if (wave == null) return;
            Phase = "transcribing";
            Status = "Transcribing on the PC…";
            workflow = StartCoroutine(SubmitAndPoll(wave, capturedSnapshot));
        }

        public void ApplyProposal()
        {
            if (!HasProposal || !inputReady || bridge == null || !bridge.IsConnected) return;
            if (Time.realtimeSinceStartupAsDouble >= proposalExpires) { Cancel("Proposal expired. Hold left trigger to ask again."); return; }
            string approvedPlan = planId;
            planId = null; // One button press cannot apply the same proposal twice.
            Phase = "applying";
            Status = "Applying the reviewed proposal…";
            workflow = StartCoroutine(ApplyAndConfirm(approvedPlan));
        }

        public void Cancel(string message)
        {
            bool executionWasPending = Phase == "applying";
            activeRequest?.Abort();
            if (workflow != null) { StopCoroutine(workflow); workflow = null; }
            activeRequest?.Dispose(); activeRequest = null;
            ReleaseMicrophone();
            string cancelledJob = jobId;
            jobId = planId = null;
            capturedSnapshot = null;
            Phase = "idle";
            if (!string.IsNullOrEmpty(message)) Status = message +
                (executionWasPending ? PendingExecutionWarning : "");
            // Best effort invalidation is independent of the stopped workflow. No scene
            // edit is submitted by cancellation; unapplied server proposals also expire.
            if (!string.IsNullOrEmpty(cancelledJob) && bridge != null && bridge.settings != null)
                SendCancellation(cancelledJob);
        }

        private void Update()
        {
            if (IsRecording && Time.realtimeSinceStartupAsDouble - recordingStarted >= MaximumSeconds) FinishRecording();
            if (HasProposal && Time.realtimeSinceStartupAsDouble >= proposalExpires) Cancel("Proposal expired. Hold left trigger to ask again.");
        }

        private IEnumerator SubmitAndPoll(byte[] wave, SandboxSnapshot snapshot)
        {
            string json = JsonUtility.ToJson(new VoiceRequest { clientId = bridge.ClientId, snapshot = snapshot, audioBase64 = Convert.ToBase64String(wave) });
            string response = null, error = null;
            yield return Request("POST", "/api/voice", json, value => response = value, value => error = value);
            if (error != null) { Fail(error); yield break; }
            JobReply job = Parse<JobReply>(response);
            if (job == null || !ValidId(job.jobId)) { Fail("PC returned an invalid voice session."); yield break; }
            jobId = job.jobId;
            double deadline = Time.realtimeSinceStartupAsDouble + 180;
            var pause = new WaitForSecondsRealtime(.5f);
            while (Time.realtimeSinceStartupAsDouble < deadline)
            {
                yield return pause;
                response = error = null;
                yield return Request("GET", "/api/voice/" + Uri.EscapeDataString(jobId), null, value => response = value, value => error = value);
                if (error != null) { Fail(error); yield break; }
                job = Parse<JobReply>(response);
                if (job == null) { Fail("PC returned invalid voice progress."); yield break; }
                Transcript = PlainText(job.transcript, 2000);
                summary = PlainText(job.summary, 1200);
                if (job.phase == "transcribing") { Phase = "transcribing"; Status = "Transcribing on the PC…"; continue; }
                if (job.phase == "planning") { Phase = "planning"; Status = "AI is planning against your captured selection…"; continue; }
                if (job.phase == "needs_clarification")
                { Phase = "needs_clarification"; Status = string.IsNullOrEmpty(summary) ? "The AI needs more detail. Hold left trigger and clarify." : summary; yield break; }
                if (job.phase == "review_only")
                { Phase = "review_only"; Status = string.IsNullOrEmpty(summary) ? "Image review complete. No changes proposed." : summary; workflow = null; yield break; }
                if (job.phase == "error") { Fail(string.IsNullOrEmpty(job.error) ? "Voice planning failed. Check the PC operator panel." : job.error); yield break; }
                if (job.phase != "ready" || !job.requiresApply || !ValidId(job.planId) || job.commands == null || job.commands.Count == 0)
                { Fail("PC did not return a reviewable voice proposal."); yield break; }
                planId = job.planId;
                proposalExpires = Time.realtimeSinceStartupAsDouble + 90;
                Phase = "ready";
                Status = "Review: " + job.commands.Count + " command(s). Press Y to apply, or hold left trigger to replace.";
                workflow = null;
                yield break;
            }
            Cancel("Voice timed out. No proposal was applied. Hold left trigger to retry.");
        }

        private IEnumerator ApplyAndConfirm(string approvedPlan)
        {
            string response = null, error = null;
            yield return Request("POST", "/api/apply_plan", JsonUtility.ToJson(new ApplyRequest { planId = approvedPlan }), value => response = value, value => error = value);
            if (error != null) { Fail("Apply was not confirmed: " + error); yield break; }
            ApplyReply result = Parse<ApplyReply>(response);
            if (result == null) { Fail("Apply response was invalid. Check PC results before trying again."); yield break; }
            if (result.saved) { Complete("Scene saved on the PC."); yield break; }
            if (result.commands == null || result.commands.Count == 0) { Fail("No runtime commands were queued."); yield break; }
            var awaiting = new HashSet<string>(StringComparer.Ordinal);
            foreach (var command in result.commands) if (command != null && ValidId(command.requestId)) awaiting.Add(command.requestId);
            int total = awaiting.Count, succeeded = 0, failed = 0;
            if (total == 0) { Fail("Runtime command acknowledgements are unavailable. Check the PC panel."); yield break; }
            double deadline = Time.realtimeSinceStartupAsDouble + 30;
            var pause = new WaitForSecondsRealtime(.5f);
            while (Time.realtimeSinceStartupAsDouble < deadline)
            {
                Status = "Runtime confirmed " + succeeded + " of " + total + " commands; waiting…";
                yield return pause;
                response = error = null;
                yield return Request("GET", "/api/state", null, value => response = value, value => error = value);
                if (error != null) { Fail("Commands were queued; confirmation unavailable. Check PC results before retrying."); yield break; }
                StateReply state = Parse<StateReply>(response);
                if (state?.results != null) foreach (var command in state.results)
                {
                    if (command == null || !awaiting.Remove(command.requestId)) continue;
                    if (command.ok) succeeded++; else failed++;
                }
                if (awaiting.Count != 0) continue;
                if (failed == 0) Complete("Runtime confirmed all " + total + " commands. Left grip: undo one edit.");
                else Fail(succeeded + " of " + total + " commands succeeded; " + failed + " failed. Successful edits remain. Check PC results.");
                yield break;
            }
            Fail("Commands were queued, but some acknowledgements timed out. Check PC results before retrying.");
        }

        private IEnumerator Request(string method, string path, string json, Action<string> success, Action<string> failure)
        {
            using (var request = NewRequest(method, path, json))
            {
                activeRequest = request;
                yield return request.SendWebRequest();
                activeRequest = null;
                if (request.result != UnityWebRequest.Result.Success)
                {
                    var error = Parse<ErrorReply>(request.downloadHandler.text);
                    failure(string.IsNullOrEmpty(error?.error) ? "PC voice service unavailable. Check the PC operator panel." : PlainText(error.error, 400));
                }
                else success(request.downloadHandler.text);
            }
        }

        private UnityWebRequest NewRequest(string method, string path, string json)
        {
            var request = new UnityWebRequest(bridge.settings.url.TrimEnd('/') + path, method);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.timeout = 10;
            if (json != null)
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                request.SetRequestHeader("Content-Type", "application/json");
            }
            if (!string.IsNullOrEmpty(bridge.settings.token)) request.SetRequestHeader("Authorization", "Bearer " + bridge.settings.token);
            return request;
        }

        private void SendCancellation(string cancelledJob)
        {
            cancellationRequest?.Abort(); cancellationRequest?.Dispose();
            var request = NewRequest("POST", "/api/voice/cancel", JsonUtility.ToJson(new CancelRequest { clientId = bridge.ClientId, jobId = cancelledJob }));
            cancellationRequest = request;
            request.SendWebRequest().completed += _ =>
            {
                if (cancellationRequest == request) cancellationRequest = null;
                request.Dispose();
            };
        }

        private void Complete(string message) { Phase = "complete"; Status = message; workflow = null; jobId = planId = null; }
        private void Fail(string message) { Phase = "error"; Status = PlainText(message, 400); planId = null; }
        private static T Parse<T>(string json) where T : class
        { try { return string.IsNullOrWhiteSpace(json) ? null : JsonUtility.FromJson<T>(json); } catch (Exception) { return null; } }
        private static bool ValidId(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 128) return false;
            foreach (char character in value) if (!char.IsLetterOrDigit(character) && character != '-' && character != '_') return false;
            return true;
        }
        private static string PlainText(string value, int limit)
        {
            if (string.IsNullOrEmpty(value)) return "";
            var result = new StringBuilder(Math.Min(value.Length, limit));
            foreach (char character in value)
            {
                if (result.Length >= limit) break;
                if (char.IsWhiteSpace(character)) result.Append(' ');
                else if (!char.IsControl(character)) result.Append(character);
            }
            return result.ToString().Trim();
        }

        /// <summary>Downmix and resample a bounded recording into the PC's PCM16 mono WAV format.</summary>
        public static byte[] EncodePcm16Wave(float[] samples, int channels, int inputFrequency, int frameCount)
        {
            if (samples == null || channels < 1 || channels > 8 || inputFrequency < 8000 || inputFrequency > 192000 ||
                frameCount < 1 || frameCount > inputFrequency * MaximumSeconds || (long)frameCount * channels > samples.Length)
                throw new ArgumentException("Invalid microphone audio.");
            int outputFrames = (int)((long)frameCount * SampleRate / inputFrequency);
            if (outputFrames < 1) throw new ArgumentException("Microphone audio is empty.");
            using (var stream = new MemoryStream(44 + outputFrames * 2))
            using (var writer = new BinaryWriter(stream, Encoding.ASCII, true))
            {
                writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + outputFrames * 2);
                writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
                writer.Write((short)1); writer.Write((short)1); writer.Write(SampleRate); writer.Write(SampleRate * 2);
                writer.Write((short)2); writer.Write((short)16); writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(outputFrames * 2);
                for (int i = 0; i < outputFrames; i++)
                {
                    double source = (double)i * inputFrequency / SampleRate;
                    int first = Math.Min((int)source, frameCount - 1), next = Math.Min(first + 1, frameCount - 1);
                    float fraction = (float)(source - first), mixed = 0;
                    for (int channel = 0; channel < channels; channel++)
                    {
                        float a = AudioSample(samples[first * channels + channel]), b = AudioSample(samples[next * channels + channel]);
                        mixed += Mathf.Lerp(a, b, fraction) / channels;
                    }
                    writer.Write((short)Mathf.RoundToInt(Mathf.Clamp(mixed, -1f, 1f) * short.MaxValue));
                }
                writer.Flush();
                return stream.ToArray();
            }
        }

        private static float AudioSample(float sample) => float.IsNaN(sample) || float.IsInfinity(sample) ? 0f : Mathf.Clamp(sample, -1f, 1f);
        private void ReleaseMicrophone()
        {
            if (microphoneDevice != null) { try { Microphone.End(microphoneDevice); } catch (Exception) { } }
            microphoneDevice = null;
            if (recording != null) Destroy(recording);
            recording = null;
        }
#if UNITY_ANDROID && !UNITY_EDITOR
        private void MicrophoneGranted(string permission)
        {
            ClearPermissionCallbacks();
            Phase = "idle";
            Status = "Microphone allowed. Release, then hold left trigger while speaking.";
        }
        private void MicrophoneDenied(string permission)
        {
            ClearPermissionCallbacks();
            Fail("Microphone permission denied. Enable it in app permissions to use voice; PC text input still works.");
        }
        private void ClearPermissionCallbacks()
        {
            if (permissionCallbacks == null) return;
            permissionCallbacks.PermissionGranted -= MicrophoneGranted;
            permissionCallbacks.PermissionDenied -= MicrophoneDenied;
            permissionCallbacks = null;
        }
#endif
        private void OnApplicationFocus(bool focused) { if (!focused && (IsBusy || HasProposal)) Cancel("Voice cancelled when headset focus was lost. Hold left trigger to retry."); }
        private void OnApplicationPause(bool paused) { if (paused && (IsBusy || HasProposal)) Cancel("Voice cancelled when headset paused. Hold left trigger to retry."); }
        private void OnDisable()
        {
            inputReady = false;
            Cancel("Voice inactive.");
#if UNITY_ANDROID && !UNITY_EDITOR
            ClearPermissionCallbacks();
#endif
        }
        private void OnDestroy() { cancellationRequest?.Abort(); cancellationRequest?.Dispose(); cancellationRequest = null; }
    }
}
