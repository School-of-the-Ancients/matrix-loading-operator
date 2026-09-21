using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace ArSandbox
{
    /// <summary>Deterministic protocol/projection checks, not camera hardware validation.</summary>
    public static class QuestCameraCaptureChecks
    {
        [Serializable] private sealed class CheckResult { public string name; public bool passed; }
        [Serializable] private sealed class Report
        {
            public string source = "Editor protocol and calibrated-projection checks; no Quest 3 camera was used";
            public string completedUtc;
            public int passed, failed;
            public string error;
            public List<CheckResult> checks = new List<CheckResult>();
        }
        private static Report report;

        public static void Run()
        {
            report = new Report();
            string path = Path.GetFullPath("Validation/quest-camera-capture-results.json");
            string[] args = Environment.GetCommandLineArgs();
            for (int index = 0; index + 1 < args.Length; index++)
                if (args[index] == "-validationOutput") path = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[index + 1])), "quest-camera-capture-results.json");
            try
            {
                Check("missing mode preserves virtual default", SandboxSceneCapture.Mode(new SceneCaptureRequest()) == "virtual");
                var request = new SceneCaptureRequest { captureId = "mixed-test", revision = 4, mode = "mixed" };
                SceneCaptureResult missing = new SandboxSceneCapture().Capture(null, request, "check-session");
                Check("mixed request without physical frame fails instead of virtual fallback", !missing.ok && missing.mode == "mixed" &&
                    !missing.includesPassthrough && missing.dataBase64 == null && missing.error.Contains("fallback"));
                Check("failure receipt retains requested mode and identity", JsonUtility.FromJson<SceneCaptureResult>(
                    JsonUtility.ToJson(SandboxSceneCapture.Failure(request, "check-session", "Denied"))).mode == "mixed");
                var host = new GameObject("Camera capability validation");
                try
                {
                    var capture = host.AddComponent<QuestCameraCapture>();
                    var capability = capture.Capabilities();
                    Check("Editor advertises virtual-only and explains unsupported physical camera", capability.modes.Length == 1 &&
                        capability.modes[0] == "virtual" && capability.mixedStatus == "unsupported" && !string.IsNullOrEmpty(capability.reason));
                    bool answered = false;
                    var preparation = capture.Prepare((frame, error) => answered = frame == null && !string.IsNullOrEmpty(error));
                    Check("unsupported prepare returns bounded failure without starting a sensor", !preparation.MoveNext() && answered && host.transform.childCount == 0);
                }
                finally { UnityEngine.Object.DestroyImmediate(host); }

                CheckProjection(1280, 960, "native 4:3 calibrated projection");
                CheckProjection(1280, 720, "wide stream uses center sensor crop");
                CheckProjection(1280, 1280, "square stream uses center sensor crop");
                var data = Intrinsics(1280, 960);
                data.intrinsics.fx = float.NaN;
                Check("nonfinite focal length rejected", Rejects(() => QuestCameraCapture.Projection(data, .05f, 50)));
                data.intrinsics.fx = .000001f;
                Check("unstable near-zero focal length rejected", Rejects(() => QuestCameraCapture.Projection(data, .05f, 50)));
                data = Intrinsics(1280, 960);
                Check("invalid clipping range rejected", Rejects(() => QuestCameraCapture.Projection(data, 50, .05f)));
                data.frameTimestampUtc = DateTime.UtcNow.AddMilliseconds(-20).ToString("O");
                QuestCameraCapture.ValidateFrameAge(data);
                Check("frame age derives from exposure timestamp", data.frameAgeMs >= 20 && data.frameAgeMs <= QuestCameraCapture.MaximumFrameAgeMs);
                data.frameTimestampUtc = DateTime.UtcNow.AddSeconds(-5).ToString("O");
                Check("stale physical frame rejected", Rejects(() => QuestCameraCapture.ValidateFrameAge(data)));
                data.frameTimestampUtc = DateTime.UtcNow.AddSeconds(5).ToString("O");
                Check("future physical frame rejected", Rejects(() => QuestCameraCapture.ValidateFrameAge(data)));
            }
            catch (Exception exception) { report.failed++; report.error = exception.ToString(); }
            report.completedUtc = DateTime.UtcNow.ToString("O");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, JsonUtility.ToJson(report, true));
            Debug.Log("QUEST_CAMERA_CHECKS " + report.passed + " passed, " + report.failed + " failed. " + path);
            if (report.failed > 0) throw new InvalidOperationException("Quest camera preparation checks failed: " + report.error);
        }

        private static ScenePhysicalCamera Intrinsics(int width, int height) => new ScenePhysicalCamera
        {
            imageWidth = width, imageHeight = height, sensorWidth = 1280, sensorHeight = 960,
            intrinsics = new SceneCameraIntrinsics { fx = 700, fy = 710, cx = 620, cy = 460 }
        };

        private static void CheckProjection(int width, int height, string name)
        {
            var metadata = Intrinsics(width, height);
            Matrix4x4 projection = QuestCameraCapture.Projection(metadata, .05f, 50);
            // Independently derive a crop rectangle from aspect ratios, then check
            // that calibrated rays land at their expected rendered pixel coordinates.
            float imageAspect = (float)width / height;
            float cropWidth = Mathf.Min(1280, 960 * imageAspect);
            float cropHeight = Mathf.Min(960, 1280 / imageAspect);
            float left = (1280 - cropWidth) * .5f, bottom = (960 - cropHeight) * .5f;
            bool aligned = true;
            foreach (float u in new[] { 0f, .5f, 1f }) foreach (float v in new[] { 0f, .5f, 1f })
            {
                var local = new Vector4((left + cropWidth * u - 620) / 700, (bottom + cropHeight * v - 460) / 710, -1, 1);
                Vector4 clip = projection * local;
                aligned &= Mathf.Abs(clip.x / clip.w * .5f + .5f - u) < .00001f && Mathf.Abs(clip.y / clip.w * .5f + .5f - v) < .00001f;
            }
            Check(name, aligned);
        }

        private static bool Rejects(Action action) { try { action(); return false; } catch (InvalidOperationException) { return true; } }
        private static void Check(string name, bool passed)
        {
            report.checks.Add(new CheckResult { name = name, passed = passed });
            if (passed) report.passed++; else report.failed++;
            if (!passed) Debug.LogError("FAIL " + name);
        }
    }
}
