using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>An arranged Editor gallery, not the startup scene or headset evidence.</summary>
    public static class WhiteRoomPreview
    {
        public static void Render()
        {
            const int width = 1280, height = 800;
            string output = Path.GetFullPath("Validation/white-room-preview.bmp");
            string[] args = Environment.GetCommandLineArgs();
            for (int index = 0; index + 1 < args.Length; index++)
                if (args[index] == "-previewOutput") output = Path.GetFullPath(args[index + 1]);

            WhiteRoomSceneSetup.GenerateDesktop();
            var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            string scenePath = Path.GetFullPath(scene.path);
            string originalScene = Convert.ToBase64String(File.ReadAllBytes(scenePath));
            var app = Object.FindFirstObjectByType<SandboxApp>();
            Camera camera = Camera.main;
            if (app == null || camera == null || app.prefabs == null || app.prefabs.Length < 7)
                throw new InvalidOperationException("Expected the empty desktop scene and original authored prefabs.");

            var positions = new Dictionary<string, Vector3>
            {
                { "chair", new Vector3(-2.1f, 0, .8f) },
                { "table", new Vector3(0, 0, 1f) },
                { "wall", new Vector3(2.5f, 0, 2.5f) },
                { "pedestal", new Vector3(2.2f, 0, -.7f) },
                { "block", new Vector3(-1.4f, 0, -1.6f) },
                { "orb", new Vector3(-.55f, 0, -1.6f) },
                { "column", new Vector3(.3f, 0, -1.6f) }
            };
            var instances = new List<GameObject>();
            Vector3 originalPosition = camera.transform.position;
            Quaternion originalRotation = camera.transform.rotation;
            float originalFov = camera.fieldOfView, originalAspect = camera.aspect;
            RenderTexture originalTarget = camera.targetTexture, originalActive = RenderTexture.active;
            RenderTexture target = null;
            Texture2D pixels = null;
            try
            {
                camera.transform.position = new Vector3(4.8f, 3.6f, -7f);
                camera.transform.LookAt(new Vector3(0, .9f, .6f));
                camera.fieldOfView = 43f;
                camera.aspect = (float)width / height;
                foreach (PrefabEntry asset in app.prefabs)
                {
                    // Keep this historical seven-prop gallery stable as the catalog grows.
                    if (!positions.ContainsKey(asset.assetId)) continue;
                    GameObject instance = Object.Instantiate(asset.prefab);
                    instances.Add(instance);
                    instance.name = "Preview only - " + asset.assetId;
                    instance.transform.position = positions[asset.assetId];
                    instance.transform.localScale = Vector3.one * asset.spawnScale;
                    Renderer[] renderers = instance.GetComponentsInChildren<Renderer>();
                    if (renderers.Length == 0) throw new InvalidOperationException(asset.assetId + " has no renderers.");
                    Bounds bounds = renderers[0].bounds;
                    foreach (Renderer renderer in renderers)
                    {
                        if (renderer.sharedMaterial == null || renderer.sharedMaterial.shader == null ||
                            !renderer.sharedMaterial.shader.isSupported)
                            throw new InvalidOperationException(asset.assetId + " has an unsupported material.");
                        bounds.Encapsulate(renderer.bounds);
                    }
                    if (bounds.size.x <= 0 || bounds.size.y <= 0 || bounds.size.z <= 0 || Math.Abs(bounds.min.y) > .001f)
                        throw new InvalidOperationException(asset.assetId + " has invalid bounds or is not resting on the floor.");
                    Vector3 minimum = new Vector3(1, 1, float.MaxValue), maximum = Vector3.zero;
                    foreach (int x in new[] { -1, 1 }) foreach (int y in new[] { -1, 1 }) foreach (int z in new[] { -1, 1 })
                    {
                        Vector3 corner = bounds.center + Vector3.Scale(bounds.extents, new Vector3(x, y, z));
                        Vector3 viewport = camera.WorldToViewportPoint(corner);
                        minimum = Vector3.Min(minimum, viewport); maximum = Vector3.Max(maximum, viewport);
                    }
                    if (minimum.x < .015f || minimum.y < .015f || minimum.z < camera.nearClipPlane ||
                        maximum.x > .985f || maximum.y > .985f ||
                        (maximum.x - minimum.x) * width < 8 || (maximum.y - minimum.y) * height < 8)
                        throw new InvalidOperationException(asset.assetId + " is clipped or too small in the preview.");
                    Debug.Log("WHITE_ROOM_PREVIEW_BOUNDS " + asset.assetId + " size=" + bounds.size.ToString("F3") +
                        " viewportMin=" + minimum.ToString("F3") + " viewportMax=" + maximum.ToString("F3"));
                }
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
                target.Create();
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                pixels.Apply();
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                WriteBitmap(output, width, height, pixels.GetPixels32());
            }
            finally
            {
                camera.targetTexture = originalTarget;
                RenderTexture.active = originalActive;
                camera.transform.SetPositionAndRotation(originalPosition, originalRotation);
                camera.fieldOfView = originalFov; camera.aspect = originalAspect;
                foreach (GameObject instance in instances) if (instance != null) Object.DestroyImmediate(instance);
                if (pixels != null) Object.DestroyImmediate(pixels);
                if (target != null) { target.Release(); Object.DestroyImmediate(target); }
                // The saved startup scene must remain empty; never save the temporary gallery.
                if (Convert.ToBase64String(File.ReadAllBytes(scenePath)) != originalScene)
                    throw new InvalidOperationException("Preview rendering unexpectedly changed the saved scene.");
                EditorSceneManager.OpenScene(scene.path, OpenSceneMode.Single);
            }
            Debug.Log("WHITE_ROOM_PREVIEW_OK " + output + " (arranged Editor gallery; startup scene remains empty)");
        }

        private static void WriteBitmap(string path, int width, int height, Color32[] pixels)
        {
            int stride = (width * 3 + 3) & ~3;
            using (var writer = new BinaryWriter(File.Create(path)))
            {
                writer.Write((byte)'B'); writer.Write((byte)'M');
                writer.Write(54 + stride * height); writer.Write(0); writer.Write(54);
                writer.Write(40); writer.Write(width); writer.Write(height);
                writer.Write((short)1); writer.Write((short)24); writer.Write(0);
                writer.Write(stride * height); writer.Write(2835); writer.Write(2835); writer.Write(0); writer.Write(0);
                // Unity pixel arrays and positive-height BMP rows both begin at the bottom.
                for (int y = 0; y < height; y++)
                {
                    for (int x = 0; x < width; x++)
                    {
                        Color32 pixel = pixels[y * width + x];
                        writer.Write(pixel.b); writer.Write(pixel.g); writer.Write(pixel.r);
                    }
                    for (int padding = width * 3; padding < stride; padding++) writer.Write((byte)0);
                }
            }
        }
    }
}
