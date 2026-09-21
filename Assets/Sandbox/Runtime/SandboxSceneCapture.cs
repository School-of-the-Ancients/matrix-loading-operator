using System;
using UnityEngine;
using Stopwatch = System.Diagnostics.Stopwatch;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>
    /// Explicit, bounded rendering of Unity content from the current center eye.
    /// Does not read the display framebuffer, compositor, or physical passthrough.
    /// Call on the main thread after camera and behavior presentation have updated.
    /// </summary>
    public sealed class SandboxSceneCapture
    {
        public const int Width = 960;
        public const int Height = 540;
        public const int MaximumBytes = 512 * 1024;
        public const double MinimumIntervalSeconds = 2;
        private double lastAttempt = double.NegativeInfinity;

        public SceneCaptureResult Capture(SandboxApp app, SceneCaptureRequest request, string clientId)
        {
            var result = new SceneCaptureResult
            {
                captureId = request?.captureId, revision = request?.revision ?? 0, clientId = clientId,
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
                camera.aspect = (float)Width / Height;
                camera.rect = new Rect(0, 0, 1, 1);
                camera.allowHDR = false;
                camera.allowMSAA = false;
                camera.allowDynamicResolution = false;
                camera.ResetWorldToCameraMatrix();
                camera.ResetProjectionMatrix();
                camera.ResetCullingMatrix();
                // Passthrough is a separate XR compositor underlay. A solid backdrop
                // explicitly represents its absence in AR captures.
                if (app.RoomContext?.mode == "ar" || source.clearFlags == CameraClearFlags.Nothing || source.clearFlags == CameraClearFlags.Depth)
                {
                    camera.clearFlags = CameraClearFlags.SolidColor;
                    camera.backgroundColor = new Color(.08f, .09f, .12f, 1);
                }
                target = RenderTexture.GetTemporary(Width, Height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Default, 1);
                camera.targetTexture = target;
                // XR can refine pose before render, after the controls' LateUpdate.
                // Pair viewer context with the exact copied camera used for these pixels.
                app.SetViewerPose(camera.transform.position, camera.transform.forward, source);
                result.snapshot = app.CaptureSnapshot();
                if (result.snapshot == null) throw new InvalidOperationException("The room became unavailable before capture.");
                result.camera = new SceneCaptureCamera
                {
                    position = SandboxApp.Vec(camera.transform.position), rotation = SandboxApp.Vec(camera.transform.eulerAngles),
                    forward = SandboxApp.Vec(camera.transform.forward), fieldOfView = camera.fieldOfView,
                    aspect = camera.aspect, nearClip = camera.nearClipPlane, farClip = camera.farClipPlane
                };
                result.capturedAtUtc = DateTime.UtcNow.ToString("O");
                result.capturedAtRuntimeSeconds = Time.realtimeSinceStartupAsDouble;
                result.frameCount = Time.frameCount;
                result.frameTimeMs = Time.unscaledDeltaTime * 1000d;
                var watch = Stopwatch.StartNew();
                camera.Render();
                RenderTexture.active = target;
                pixels = new Texture2D(Width, Height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, Width, Height), 0, 0, false);
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
                result.width = Width;
                result.height = Height;
                result.byteLength = encoded.Length;
                result.ok = true;
            }
            catch (Exception exception)
            {
                result.ok = false;
                result.error = exception.Message;
                result.dataBase64 = null;
                result.snapshot = null;
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
