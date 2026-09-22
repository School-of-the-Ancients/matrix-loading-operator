using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>
    /// Static studio thumbnails of trusted, already-imported prefabs. Preview scenes
    /// and instances are temporary; no scene, prefab, material or bundle is saved.
    /// This is Editor appearance evidence, not a runtime or headset screenshot.
    /// </summary>
    public static class SandboxPrefabPreview
    {
        public const int Size = 384;
        [Serializable] public sealed class Input { public string assetId, displayName, prefabPath; }
        [Serializable] public sealed class Spec { public Input[] assets; }
        [Serializable] public sealed class Result
        {
            public string assetId, displayName, prefabPath, status, path, sha256, sourceDependencyHash, error;
            public int width, height, rendererCount;
            public long byteLength;
            public Vector3 boundsCenter, boundsSize;
        }
        [Serializable] public sealed class Report
        {
            public string source = "Unity Editor studio render of actual prefab meshes and materials";
            public string unityVersion, completedUtc;
            public int passed, failed;
            public List<Result> previews = new List<Result>();
        }

        // -prefabPreviewSpec <trusted JSON> -prefabPreviewOutput <directory>
        public static void RenderFromArguments()
        {
            string input = Argument("-prefabPreviewSpec");
            if (new FileInfo(input).Length > 1024 * 1024) throw new InvalidOperationException("Preview spec is too large.");
            Report report = Render(JsonUtility.FromJson<Spec>(File.ReadAllText(input)), Argument("-prefabPreviewOutput"));
            if (report.failed != 0) throw new InvalidOperationException("Prefab thumbnails failed: " + report.failed + "; see preview-report.json.");
            Debug.Log("PREFAB_PREVIEW_OK " + report.passed + " actual prefab thumbnails at " + Size + "x" + Size);
        }

        public static Report Render(Spec spec, string outputDirectory)
        {
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
                throw new InvalidOperationException("Prefab previews require graphics; do not use -nographics.");
            if (spec?.assets == null || spec.assets.Length == 0 || spec.assets.Length > 128)
                throw new InvalidOperationException("Expected one to 128 trusted prefab inputs.");
            string output = Path.GetFullPath(outputDirectory);
            var identities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Input input in spec.assets)
            {
                if (input == null || string.IsNullOrEmpty(input.assetId) || !Regex.IsMatch(input.assetId, @"^[a-z0-9][a-z0-9_.:-]{0,127}$") || !identities.Add(input.assetId.Replace(':', '_')))
                    throw new InvalidOperationException("Preview asset IDs must be unique bounded lowercase IDs; colons map to underscores in filenames.");
                if (string.IsNullOrEmpty(input.prefabPath) || !input.prefabPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase) ||
                    !(input.prefabPath.StartsWith("Assets/", StringComparison.Ordinal) || input.prefabPath.StartsWith("Packages/", StringComparison.Ordinal)) ||
                    input.prefabPath.Contains("..") || input.prefabPath.Contains("\\"))
                    throw new InvalidOperationException("Use an imported project-relative prefab path: " + input.assetId);
            }
            Directory.CreateDirectory(output);
            var report = new Report { unityVersion = Application.unityVersion };
            foreach (Input input in spec.assets)
            {
                var result = new Result { assetId = input.assetId, prefabPath = input.prefabPath,
                    displayName = string.IsNullOrEmpty(input.displayName) ? PrefabName(input) : input.displayName,
                    path = input.assetId.Replace(':', '_') + ".png", status = "failed" };
                report.previews.Add(result);
                try { RenderOne(input, result, Path.Combine(output, result.path)); report.passed++; }
                catch (Exception exception)
                {
                    result.error = exception.GetType().Name + ": " + exception.Message;
                    report.failed++;
                    Debug.LogError("PREFAB_PREVIEW_FAILED " + input.assetId + ": " + result.error);
                }
            }
            report.completedUtc = DateTime.UtcNow.ToString("O");
            File.WriteAllText(Path.Combine(output, "preview-report.json"), JsonUtility.ToJson(report, true));
            return report;
        }

        private static string PrefabName(Input input) => Path.GetFileNameWithoutExtension(input.prefabPath);

        private static void RenderOne(Input input, Result result, string outputPath)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(input.prefabPath);
            if (prefab == null) throw new InvalidOperationException("Imported prefab is unavailable: " + input.prefabPath);
            result.sourceDependencyHash = AssetDatabase.GetAssetDependencyHash(input.prefabPath).ToString();
            var preview = new PreviewRenderUtility();
            Texture2D pixels = null;
            bool previewOpen = false;
            RenderTexture previousActive = RenderTexture.active;
            try
            {
                GameObject instance = preview.InstantiatePrefabInScene(prefab);
                if (instance == null) throw new InvalidOperationException("Could not instantiate prefab in preview scene.");
                instance.hideFlags = HideFlags.HideAndDontSave;
                instance.SetActive(true);
                var visible = new List<Renderer>();
                foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>())
                {
                    if (!renderer.enabled) continue;
                    foreach (Material material in renderer.sharedMaterials)
                        if (material == null || material.shader == null || !material.shader.isSupported || material.shader.name == "Hidden/InternalErrorShader")
                            throw new InvalidOperationException("Prefab has missing or unsupported materials: " + renderer.name);
                    visible.Add(renderer);
                }
                if (visible.Count == 0) throw new InvalidOperationException("Prefab has no visible renderers.");
                Bounds bounds = visible[0].bounds;
                foreach (Renderer renderer in visible) bounds.Encapsulate(renderer.bounds);
                if (!Finite(bounds.center) || !Finite(bounds.size) || bounds.size.sqrMagnitude < .00000001f || bounds.size.magnitude > 100000)
                    throw new InvalidOperationException("Prefab render bounds are empty, nonfinite, or excessive.");
                result.rendererCount = visible.Count;
                result.boundsCenter = bounds.center;
                result.boundsSize = bounds.size;

                Camera camera = preview.camera;
                camera.clearFlags = CameraClearFlags.SolidColor;
                // PreviewRenderUtility owns the preview target's color conversion.
                camera.backgroundColor = new Color(.32f, .36f, .42f, 1);
                camera.allowHDR = false;
                camera.allowMSAA = false;
                camera.orthographic = true;
                camera.aspect = 1;
                camera.transform.rotation = Quaternion.Euler(22, -32, 0);
                float radius = Mathf.Max(bounds.extents.magnitude, .001f);
                camera.transform.position = bounds.center - camera.transform.forward * (radius * 3 + .1f);
                camera.nearClipPlane = .01f;
                camera.farClipPlane = radius * 6 + 1;
                float halfFrame = 0;
                foreach (Vector3 corner in Corners(bounds))
                {
                    Vector3 relative = Quaternion.Inverse(camera.transform.rotation) * (corner - bounds.center);
                    halfFrame = Mathf.Max(halfFrame, Mathf.Abs(relative.x), Mathf.Abs(relative.y));
                }
                camera.orthographicSize = Mathf.Max(.001f, halfFrame * 1.18f);
                foreach (Vector3 corner in Corners(bounds))
                {
                    Vector3 viewport = camera.WorldToViewportPoint(corner);
                    if (viewport.x < .05f || viewport.x > .95f || viewport.y < .05f || viewport.y > .95f || viewport.z < camera.nearClipPlane)
                        throw new InvalidOperationException("Bounds do not fit the preview camera.");
                }
                preview.ambientColor = new Color(.35f, .35f, .35f, 1);
                Light[] lights = preview.lights;
                lights[0].transform.rotation = Quaternion.Euler(40, -35, 0);
                lights[0].color = new Color(1, .96f, .9f);
                lights[0].intensity = 1.1f;
                lights[1].transform.rotation = Quaternion.Euler(340, 145, 0);
                lights[1].color = new Color(.72f, .84f, 1);
                lights[1].intensity = .65f;
                preview.BeginStaticPreview(new Rect(0, 0, Size, Size));
                previewOpen = true;
                preview.Render(true, false);
                pixels = preview.EndStaticPreview();
                previewOpen = false;
                if (pixels == null || pixels.width != Size || pixels.height != Size)
                    throw new InvalidOperationException("Editor returned unexpected preview dimensions.");
                byte[] png = pixels.EncodeToPNG();
                if (png == null || png.Length < 100) throw new InvalidOperationException("Preview PNG encoding failed.");
                if (AssetDatabase.GetAssetDependencyHash(input.prefabPath).ToString() != result.sourceDependencyHash)
                    throw new InvalidOperationException("Prefab dependencies changed during preview.");
                File.WriteAllBytes(outputPath, png);
                using (var sha = SHA256.Create()) result.sha256 = BitConverter.ToString(sha.ComputeHash(png)).Replace("-", "").ToLowerInvariant();
                result.byteLength = png.Length;
                result.width = pixels.width; result.height = pixels.height; result.status = "passed";
                Debug.Log("PREFAB_PREVIEW_RENDERED " + input.assetId + " " + outputPath);
            }
            finally
            {
                if (previewOpen) { Texture2D unfinished = preview.EndStaticPreview(); if (unfinished != null) Object.DestroyImmediate(unfinished); }
                if (pixels != null) Object.DestroyImmediate(pixels);
                preview.Cleanup();
                RenderTexture.active = previousActive;
            }
        }

        private static IEnumerable<Vector3> Corners(Bounds bounds)
        {
            foreach (int x in new[] { -1, 1 }) foreach (int y in new[] { -1, 1 }) foreach (int z in new[] { -1, 1 })
                yield return bounds.center + Vector3.Scale(bounds.extents, new Vector3(x, y, z));
        }
        private static bool Finite(Vector3 value) => Finite(value.x) && Finite(value.y) && Finite(value.z);
        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        private static string Argument(string name)
        {
            string[] arguments = Environment.GetCommandLineArgs();
            for (int index = 0; index + 1 < arguments.Length; index++) if (arguments[index] == name) return arguments[index + 1];
            throw new InvalidOperationException("Missing " + name);
        }
    }
}
