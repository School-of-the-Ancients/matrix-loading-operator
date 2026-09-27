using System;
using UnityEngine;
using Stopwatch = System.Diagnostics.Stopwatch;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>
    /// Explicit, bounded rendering from the center eye, or a calibrated physical
    /// camera frame acquired separately after an explicit mixed-capture request.
    /// Never reads the headset display framebuffer or passthrough compositor.
    /// Call on the main thread after camera and behavior presentation have updated.
    /// </summary>
    public sealed class SandboxSceneCapture
    {
        public const int Width = 960;
        public const int Height = 540;
        public const int MaximumBytes = 512 * 1024;
        public const double MinimumIntervalSeconds = 2;
        private double lastAttempt = double.NegativeInfinity;

        public sealed class PhysicalFrame : IDisposable
        {
            public Texture2D texture;
            public ScenePhysicalCamera metadata;
            public Pose pose;
            public void Dispose() { DestroyOwned(texture); texture = null; }
        }

        public static string Mode(SceneCaptureRequest request) => string.IsNullOrEmpty(request?.mode) ? "virtual" : request.mode;

        public static SceneCaptureResult Failure(SceneCaptureRequest request, string clientId, string error) =>
            new SceneCaptureResult { captureId = request?.captureId, revision = request?.revision ?? 0,
                clientId = clientId, mode = Mode(request), ok = false, error = error };

        public SceneCaptureResult Capture(SandboxApp app, SceneCaptureRequest request, string clientId, PhysicalFrame physical = null)
        {
            var result = new SceneCaptureResult
            {
                captureId = request?.captureId, revision = request?.revision ?? 0, clientId = clientId,
                mode = Mode(request),
                includesPassthrough = false
            };
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D pixels = null;
            RenderTexture previousActive = RenderTexture.active;
            try
            {
                if (request == null || string.IsNullOrWhiteSpace(request.captureId) || request.captureId.Length > 128 || request.revision < 0)
                    throw new InvalidOperationException("Invalid rendered-scene capture request.");
                if (result.mode != "virtual" && result.mode != "mixed") throw new InvalidOperationException("Capture mode must be virtual or mixed.");
                if (result.mode == "mixed" && (physical?.texture == null || physical.metadata == null))
                    throw new InvalidOperationException("Mixed capture requires an explicitly acquired physical-camera frame; virtual fallback is not allowed.");
                if (result.mode == "virtual" && physical != null) throw new InvalidOperationException("Virtual capture cannot include a physical-camera frame.");
                double now = Time.realtimeSinceStartupAsDouble;
                if (now - lastAttempt < MinimumIntervalSeconds)
                    throw new InvalidOperationException("Rendered-scene captures are limited to one every two seconds.");
                lastAttempt = now;
                if (app == null || app.World == null || app.RoomReloading || !app.isActiveAndEnabled)
                    throw new InvalidOperationException("The room is not available for a rendered-scene capture.");
                Camera source = app.CaptureCamera;
                if (source == null)
                    throw new InvalidOperationException("A current active viewer camera is required. Check headset focus and tracking.");
                if (app.RoomContext?.mode == "ar" && app.RoomContext.state != "ready")
                    throw new InvalidOperationException("Configured AR room data is not ready for capture.");
                if (SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null)
                    throw new InvalidOperationException("Rendered-scene capture requires a graphics device.");
                int width = Width, height = Height;
                if (physical != null)
                {
                    if (app.RoomContext?.mode != "ar") throw new InvalidOperationException("Mixed capture requires the native AR room.");
                    QuestCameraCapture.ValidateFrameAge(physical.metadata);
                    float scale = Mathf.Min(1f, (float)Width / Mathf.Max(physical.texture.width, physical.texture.height));
                    width = Mathf.Max(1, Mathf.RoundToInt(physical.texture.width * scale));
                    height = Mathf.Max(1, Mathf.RoundToInt(physical.texture.height * scale));
                }

                // Copy camera settings only: no XR rig, passthrough layer, or compositor
                // components are copied. Mono projection avoids a stereo eye's offset.
                cameraObject = new GameObject("On-demand rendered scene camera") { hideFlags = HideFlags.HideAndDontSave };
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.CopyFrom(source);
                camera.enabled = false;
                camera.transform.SetPositionAndRotation(source.transform.position, source.transform.rotation);
                camera.stereoTargetEye = StereoTargetEyeMask.None;
                camera.usePhysicalProperties = false;
                camera.aspect = (float)width / height;
                camera.rect = new Rect(0, 0, 1, 1);
                camera.allowHDR = false;
                camera.allowMSAA = false;
                camera.allowDynamicResolution = false;
                camera.ResetWorldToCameraMatrix();
                camera.ResetProjectionMatrix();
                camera.ResetCullingMatrix();
                if (physical != null)
                {
                    camera.transform.SetPositionAndRotation(physical.pose.position, physical.pose.rotation);
                    Matrix4x4 projection = QuestCameraCapture.Projection(physical.metadata, camera.nearClipPlane, camera.farClipPlane);
                    camera.fieldOfView = 2 * Mathf.Atan(1 / projection.m11) * Mathf.Rad2Deg;
                    camera.projectionMatrix = projection;
                    physical.metadata.projection = new float[16];
                    for (int row = 0; row < 4; row++) for (int column = 0; column < 4; column++)
                        physical.metadata.projection[row * 4 + column] = projection[row, column];
                    result.source = "quest_camera_composite";
                    result.includesPassthrough = true;
                    result.physicalCamera = physical.metadata;
                }
                // Passthrough is a separate XR compositor underlay. A solid backdrop
                // explicitly represents its absence in AR captures.
                if (app.RoomContext?.mode == "ar" || source.clearFlags == CameraClearFlags.Nothing || source.clearFlags == CameraClearFlags.Depth)
                {
                    camera.clearFlags = CameraClearFlags.SolidColor;
                    camera.backgroundColor = new Color(.08f, .09f, .12f, 1);
                }
                target = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Default, 1);
                camera.targetTexture = target;
                if (physical != null)
                {
                    // Seed color with the frozen camera image, then let ordinary
                    // virtual materials blend over it. Depth starts empty: physical
                    // surfaces do not occlude virtual content in this implementation.
                    Graphics.Blit(physical.texture, target);
                    camera.clearFlags = CameraClearFlags.Depth;
                }
                // XR can refine pose before render, after the controls' LateUpdate.
                // Pair viewer context with the exact copied camera used for these pixels.
                app.SetViewerPose(camera.transform.position, camera.transform.forward, source);
                try { result.snapshot = app.CaptureSnapshot(); }
                finally { if (physical != null) app.SetViewerPose(source.transform.position, source.transform.forward, source); }
                if (result.snapshot == null) throw new InvalidOperationException("The room became unavailable before capture.");
                int mrukAnchors = 0;
                foreach (var anchor in result.snapshot.anchors) if (anchor.source == "mruk") mrukAnchors++;
                result.spatialProvenance = new SceneSpatialProvenance { source = mrukAnchors > 0 ? "mruk_scene_model_v1" : "virtual",
                    roomId = result.snapshot.scene.roomId, anchorCount = result.snapshot.anchors.Count,
                    alignmentVerified = mrukAnchors > 0 && result.snapshot.roomContext?.alignmentVerified == true };
                result.camera = new SceneCaptureCamera
                {
                    position = SandboxApp.Vec(camera.transform.position), rotation = SandboxApp.Vec(camera.transform.eulerAngles),
                    forward = SandboxApp.Vec(camera.transform.forward), fieldOfView = camera.fieldOfView,
                    aspect = camera.aspect, nearClip = camera.nearClipPlane, farClip = camera.farClipPlane
                };
                if (physical != null) QuestCameraCapture.ValidateFrameAge(physical.metadata);
                result.capturedAtUtc = DateTime.UtcNow.ToString("O");
                result.capturedAtRuntimeSeconds = Time.realtimeSinceStartupAsDouble;
                result.frameCount = Time.frameCount;
                result.frameTimeMs = Time.unscaledDeltaTime * 1000d;
                var watch = Stopwatch.StartNew();
                camera.Render();
                RenderTexture.active = target;
                pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
                result.renderMs = watch.Elapsed.TotalMilliseconds;
                watch.Restart();
                byte[] encoded = pixels.EncodeToJPG(80);
                if (encoded.Length > MaximumBytes) encoded = pixels.EncodeToJPG(55);
                if (encoded.Length > MaximumBytes) encoded = pixels.EncodeToJPG(30);
                if (encoded.Length == 0 || encoded.Length > MaximumBytes)
                    throw new InvalidOperationException("Rendered scene exceeds the 512 KiB image limit.");
                result.dataBase64 = Convert.ToBase64String(encoded);
                result.encodeMs = watch.Elapsed.TotalMilliseconds;
                result.mimeType = "image/jpeg";
                result.width = width;
                result.height = height;
                result.byteLength = encoded.Length;
                result.ok = true;
            }
            catch (Exception exception)
            {
                result.ok = false;
                result.error = exception.Message;
                result.dataBase64 = null;
                result.snapshot = null;
                result.physicalCamera = null;
                result.includesPassthrough = false;
            }
            finally
            {
                RenderTexture.active = previousActive;
                if (cameraObject != null) cameraObject.GetComponent<Camera>().targetTexture = null;
                if (target != null) RenderTexture.ReleaseTemporary(target);
                DestroyOwned(pixels);
                DestroyOwned(cameraObject);
            }
            return result;
        }

        private static void DestroyOwned(Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Object.Destroy(value);
            else Object.DestroyImmediate(value);
        }
    }
}
