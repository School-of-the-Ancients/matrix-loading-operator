using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Rendering;
#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
using Meta.XR;
using UnityEngine.Android;
#endif

namespace ArSandbox
{
    /// <summary>
    /// Starts the physical camera only for an explicit mixed capture. One frozen
    /// frame is retained while composing; native streaming then stops immediately.
    /// This is not the headset's depth-warped passthrough compositor output.
    /// </summary>
    public sealed class QuestCameraCapture : MonoBehaviour
    {
        public const string CameraPermission = "horizonos.permission.HEADSET_CAMERA";
        public const double MaximumFrameAgeMs = 500;
        public SandboxApp app;
        private int generation;
        private SandboxSceneCapture.PhysicalFrame preparedFrame = null;
#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
        private string failureStatus, failureReason;
        private PassthroughCameraAccess sensor;
        private GameObject sensorObject;
        private PermissionCallbacks permissionCallbacks;
        private bool permissionAnswered, permissionGranted;
#endif

        public static SceneCaptureCapabilities GetCapabilities(SandboxApp app)
        {
            var owner = app != null ? app.GetComponent<QuestCameraCapture>() : null;
            return owner != null ? owner.Capabilities() : new SceneCaptureCapabilities
            {
                device = SystemInfo.deviceModel,
                reason = "Physical-camera composition is available only in the native room AR build on Quest 3 or Quest 3S."
            };
        }

        public SceneCaptureCapabilities Capabilities()
        {
            var result = new SceneCaptureCapabilities { device = SystemInfo.deviceModel };
#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
            try
            {
                var device = OVRPlugin.GetSystemHeadsetType();
                result.device = device.ToString();
                if (device != OVRPlugin.SystemHeadset.Meta_Quest_3 && device != OVRPlugin.SystemHeadset.Meta_Quest_3S)
                { result.reason = "Physical-camera access requires Quest 3 or Quest 3S. Quest Pro remains virtual-only."; return result; }
                if (!PassthroughCameraAccess.IsSupported)
                { result.reason = "Physical-camera access requires Horizon OS v74 or later."; return result; }
                if (!SystemInfo.supportsAsyncGPUReadback)
                { result.reason = "This graphics device does not support the asynchronous camera readback required for frame alignment."; return result; }
                result.modes = new[] { "virtual", "mixed" };
                bool permitted = Permission.HasUserAuthorizedPermission(CameraPermission);
                result.mixedStatus = permitted ? "available" : failureStatus == "denied" ? "denied" : "permission_required";
                result.reason = permitted ? "Physical camera plus virtual content; no physical depth or real-world occlusion. Quest 3 hardware validation is pending." :
                    failureStatus == "denied" ? failureReason : "An explicit mixed capture requests headset-camera permission; camera remains off otherwise.";
                if (failureStatus == "error") { result.mixedStatus = "error"; result.reason = failureReason; }
            }
            catch (Exception exception)
            { result.reason = "Camera capability check failed: " + exception.Message; }
#else
            result.reason = "Physical-camera composition requires a standalone Quest 3 or Quest 3S native AR build; Editor, desktop, and white-room builds are virtual-only.";
#endif
            return result;
        }

        public IEnumerator Prepare(Action<SandboxSceneCapture.PhysicalFrame, string> complete)
        {
            CancelCapture();
            var capability = Capabilities();
            if (Array.IndexOf(capability.modes, "mixed") < 0)
            { complete(null, capability.reason); yield break; }
#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
            int attempt = generation;
            try
            {
                if (app == null || app.RoomContext?.mode != "ar" || app.RoomContext.state != "ready" || app.RoomReloading)
                { complete(null, "Configured AR room data must be ready before physical-camera capture."); yield break; }
                string error = RequestPermission();
                if (error != null) { complete(null, error); yield break; }
                double deadline = Time.realtimeSinceStartupAsDouble + 25;
                while (!permissionAnswered && attempt == generation && Time.realtimeSinceStartupAsDouble < deadline)
                    yield return null;
                ClearPermissionCallbacks();
                if (attempt != generation) { complete(null, "Physical-camera capture was cancelled."); yield break; }
                if (!permissionAnswered || !permissionGranted)
                {
                    failureStatus = "denied";
                    failureReason = permissionAnswered ? "Headset-camera permission was denied. Enable it in app permissions to use mixed capture." :
                        "Headset-camera permission timed out. Approve permission, then explicitly capture again.";
                    complete(null, failureReason); yield break;
                }
                // Permission dialogs can temporarily remove tracking/focus. Do not
                // open the sensor until the ordinary viewer camera is usable again.
                deadline = Time.realtimeSinceStartupAsDouble + 8;
                while ((app.CaptureCamera == null || !Application.isFocused) && attempt == generation && Time.realtimeSinceStartupAsDouble < deadline)
                    yield return null;
                if (attempt != generation || app.CaptureCamera == null || !Application.isFocused)
                { complete(null, "Camera capture needs active headset focus and tracking."); yield break; }
                error = StartSensor();
                if (error != null) { complete(null, error); yield break; }
                deadline = Time.realtimeSinceStartupAsDouble + 5;
                while (sensor != null && sensor.enabled && !sensor.IsPlaying && attempt == generation && Time.realtimeSinceStartupAsDouble < deadline)
                    yield return null;
                if (attempt != generation || sensor == null || !sensor.enabled || !sensor.IsPlaying)
                { complete(null, "Physical camera did not start within five seconds. Check device/OS support and other camera users."); yield break; }
                // The SDK schedules its native texture update on the render thread.
                // AsyncGPUReadback is the documented path to that frame; a blocking
                // Blit/GetTexture copy can instead sample the previous frame.
                yield return new WaitForEndOfFrame();
                AsyncGPUReadbackRequest readback;
                ScenePhysicalCamera metadata;
                Pose pose;
                error = BeginReadback(out readback, out metadata, out pose);
                if (error != null) { complete(null, error); yield break; }
                deadline = Time.realtimeSinceStartupAsDouble + 3;
                while (!readback.done && attempt == generation && Time.realtimeSinceStartupAsDouble < deadline)
                    yield return null;
                if (attempt != generation || !readback.done || readback.hasError)
                { complete(null, "Physical camera GPU readback failed, timed out, or was cancelled."); yield break; }
                error = FreezeFrame(readback, metadata, pose);
                if (error != null) { complete(null, error); yield break; }
                failureStatus = failureReason = null;
                complete(preparedFrame, null);
            }
            finally { StopSensor(); ClearPermissionCallbacks(); }
#else
            complete(null, capability.reason);
            yield break;
#endif
        }

#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
        private string RequestPermission()
        {
            try
            {
                permissionGranted = Permission.HasUserAuthorizedPermission(CameraPermission);
                permissionAnswered = permissionGranted;
                if (permissionGranted) return null;
                permissionCallbacks = new PermissionCallbacks();
                permissionCallbacks.PermissionGranted += PermissionGranted;
                permissionCallbacks.PermissionDenied += PermissionDenied;
                permissionCallbacks.PermissionDeniedAndDontAskAgain += PermissionDenied;
                Permission.RequestUserPermission(CameraPermission, permissionCallbacks);
                return null;
            }
            catch (Exception exception) { return "Could not request headset-camera permission: " + exception.Message; }
        }

        private void PermissionGranted(string permission) { permissionGranted = permissionAnswered = true; }
        private void PermissionDenied(string permission) { permissionGranted = false; permissionAnswered = true; }

        private void ClearPermissionCallbacks()
        {
            if (permissionCallbacks == null) return;
            permissionCallbacks.PermissionGranted -= PermissionGranted;
            permissionCallbacks.PermissionDenied -= PermissionDenied;
            permissionCallbacks.PermissionDeniedAndDontAskAgain -= PermissionDenied;
            permissionCallbacks = null;
        }

        private string StartSensor()
        {
            try
            {
                sensorObject = new GameObject("Explicit one-frame physical camera") { hideFlags = HideFlags.HideAndDontSave };
                sensorObject.SetActive(false);
                sensor = sensorObject.AddComponent<PassthroughCameraAccess>();
                sensor.enabled = false;
                sensor.CameraPosition = PassthroughCameraAccess.CameraPositionType.Left;
                sensor.RequestedResolution = new Vector2Int(1280, 960);
                sensor.MaxFramerate = 15;
                sensorObject.SetActive(true);
                sensor.enabled = true;
                return null;
            }
            catch (Exception exception) { return "Could not start physical camera: " + exception.Message; }
        }

        private string BeginReadback(out AsyncGPUReadbackRequest readback, out ScenePhysicalCamera metadata, out Pose pose)
        {
            readback = default; metadata = null; pose = default;
            try
            {
                if (sensor == null || !sensor.IsPlaying || !Application.isFocused || app.CaptureCamera == null)
                    return "Physical camera lost focus, tracking, or its current frame.";
                var size = sensor.CurrentResolution;
                if (size.x <= 0 || size.y <= 0 || (long)size.x * size.y > 4 * 1024 * 1024)
                    return "Camera returned an unsupported image size.";
                var texture = sensor.GetTexture();
                if (texture == null) return "Physical camera has no GPU frame.";
                var intrinsics = sensor.Intrinsics;
                pose = sensor.GetCameraPose();
                ValidatePose(pose);
                metadata = new ScenePhysicalCamera
                {
                    frameTimestampUtc = sensor.Timestamp.ToUniversalTime().ToString("O"),
                    imageWidth = size.x, imageHeight = size.y,
                    sensorWidth = intrinsics.SensorResolution.x, sensorHeight = intrinsics.SensorResolution.y,
                    intrinsics = new SceneCameraIntrinsics { fx = intrinsics.FocalLength.x, fy = intrinsics.FocalLength.y,
                        cx = intrinsics.PrincipalPoint.x, cy = intrinsics.PrincipalPoint.y },
                    pose = new SceneCameraPose { position = SandboxApp.Vec(pose.position), rotation = SandboxApp.Vec(pose.rotation.eulerAngles),
                        forward = SandboxApp.Vec(pose.rotation * Vector3.forward) }
                };
                ValidateFrameAge(metadata);
                Projection(metadata, .05f, 50f);
                readback = AsyncGPUReadback.Request(texture, 0, TextureFormat.RGBA32);
                return null;
            }
            catch (Exception exception) { return "Could not acquire aligned camera frame: " + exception.Message; }
        }

        private string FreezeFrame(AsyncGPUReadbackRequest readback, ScenePhysicalCamera metadata, Pose pose)
        {
            try
            {
                ValidateFrameAge(metadata);
                var pixels = readback.GetData<Color32>();
                if (pixels.Length != metadata.imageWidth * metadata.imageHeight) return "Physical camera readback size does not match metadata.";
                preparedFrame = new SandboxSceneCapture.PhysicalFrame { metadata = metadata, pose = pose };
                preparedFrame.texture = new Texture2D(metadata.imageWidth, metadata.imageHeight, TextureFormat.RGBA32, false);
                preparedFrame.texture.SetPixelData(pixels, 0);
                preparedFrame.texture.Apply(false, false);
                return null;
            }
            catch (Exception exception) { return "Could not freeze physical camera frame: " + exception.Message; }
        }

        private void StopSensor()
        {
            if (sensor != null) sensor.enabled = false;
            sensor = null;
            if (sensorObject != null) Destroy(sensorObject);
            sensorObject = null;
        }
#endif

        public static void ValidateFrameAge(ScenePhysicalCamera metadata)
        {
            if (!DateTime.TryParse(metadata?.frameTimestampUtc, null, System.Globalization.DateTimeStyles.RoundtripKind, out var stamp))
                throw new InvalidOperationException("Camera frame timestamp is unavailable.");
            double age = (DateTime.UtcNow - stamp.ToUniversalTime()).TotalMilliseconds;
            if (age < 0 || age > MaximumFrameAgeMs) throw new InvalidOperationException("Physical camera frame is stale or its clock is invalid; capture again.");
            metadata.frameAgeMs = age;
        }

        public static Matrix4x4 Projection(ScenePhysicalCamera metadata, float near, float far)
        {
            var intrinsics = metadata?.intrinsics;
            if (intrinsics == null || !Positive(intrinsics.fx) || !Positive(intrinsics.fy) || intrinsics.fx < .01f || intrinsics.fy < .01f ||
                intrinsics.fx > 100000 || intrinsics.fy > 100000 || !Finite(intrinsics.cx) || !Finite(intrinsics.cy) ||
                intrinsics.cx < 0 || intrinsics.cy < 0 || intrinsics.cx > metadata.sensorWidth || intrinsics.cy > metadata.sensorHeight ||
                metadata.sensorWidth <= 0 || metadata.sensorHeight <= 0 || metadata.imageWidth <= 0 || metadata.imageHeight <= 0 ||
                metadata.imageWidth > 8192 || metadata.imageHeight > 8192 ||
                (long)metadata.imageWidth * metadata.imageHeight > 4 * 1024 * 1024 ||
                metadata.sensorWidth > 8192 || metadata.sensorHeight > 8192 || !Positive(near) || !Finite(far) || far <= near)
                throw new InvalidOperationException("Camera intrinsics or clipping planes are invalid.");
            // Same center crop as MRUK 205 PassthroughCameraAccess.CalcSensorCropRegion.
            float sx = (float)metadata.imageWidth / metadata.sensorWidth, sy = (float)metadata.imageHeight / metadata.sensorHeight;
            float largest = Mathf.Max(sx, sy);
            float width = metadata.sensorWidth * sx / largest, height = metadata.sensorHeight * sy / largest;
            float x = (metadata.sensorWidth - width) * .5f, y = (metadata.sensorHeight - height) * .5f;
            Matrix4x4 projection = Matrix4x4.Frustum((x - intrinsics.cx) / intrinsics.fx * near, (x + width - intrinsics.cx) / intrinsics.fx * near,
                (y - intrinsics.cy) / intrinsics.fy * near, (y + height - intrinsics.cy) / intrinsics.fy * near, near, far);
            for (int index = 0; index < 16; index++) if (!Finite(projection[index]) || Mathf.Abs(projection[index]) > 100000)
                throw new InvalidOperationException("Camera projection is not finite and bounded.");
            return projection;
        }

        private static void ValidatePose(Pose pose)
        {
            if (!Finite(pose.position.x) || !Finite(pose.position.y) || !Finite(pose.position.z) || pose.position.sqrMagnitude > 10000000000f ||
                !Finite(pose.rotation.x) || !Finite(pose.rotation.y) || !Finite(pose.rotation.z) || !Finite(pose.rotation.w) ||
                Mathf.Abs(Quaternion.Dot(pose.rotation, pose.rotation) - 1) > .01f)
                throw new InvalidOperationException("Exposure-time camera pose is unavailable.");
        }

        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        private static bool Positive(float value) => Finite(value) && value > 0;

        public void CancelCapture()
        {
            generation++;
#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
            StopSensor(); ClearPermissionCallbacks();
#endif
            preparedFrame?.Dispose();
            preparedFrame = null;
        }

        private void OnApplicationFocus(bool focused)
        {
#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
            if (!focused && sensor != null) CancelCapture();
#endif
        }
        private void OnApplicationPause(bool paused)
        {
#if UNITY_ANDROID && !UNITY_EDITOR && !SANDBOX_CORE_FIXTURE
            if (paused && sensor != null) CancelCapture();
#endif
        }
        private void OnDisable() { CancelCapture(); }
        private void OnDestroy() { CancelCapture(); }
    }
}
