using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ArSandbox
{
    public static class SandboxProjectSetup
    {
        private const string Root = "Assets/Sandbox";
        [MenuItem("Sandbox/Generate scenes and bundled props")]
        public static void Generate()
        {
            Directory.CreateDirectory(Root + "/Prefabs");
            Directory.CreateDirectory(Root + "/Materials");
            Directory.CreateDirectory(Root + "/Scenes");
            var assets = new[] {
                MakeProp("block", "Terracotta block", PrimitiveType.Cube, new Color(.8f,.34f,.19f)),
                MakeProp("orb", "Jade orb", PrimitiveType.Sphere, new Color(.12f,.68f,.51f)),
                MakeProp("column", "Stone column", PrimitiveType.Cylinder, new Color(.82f,.77f,.62f))
            };
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var app = CreateApp(assets, true);
            var controls = app.gameObject.AddComponent<DesktopControls>();
            controls.app = app; controls.bridge = app.GetComponent<PcBridge>();
            var camera = new GameObject("Main Camera").AddComponent<Camera>();
            camera.tag = "MainCamera";
            camera.transform.position = new Vector3(2.5f, 2.5f, -3.2f);
            camera.transform.LookAt(new Vector3(-.3f, .6f, 0));
            camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.07f,.09f,.11f);
            camera.gameObject.AddComponent<AudioListener>();
            AddLight();
            Surface("Fixture floor", new Vector3(0,-.05f,0), new Vector3(6,.1f,6), new Color(.13f,.18f,.2f));
            Surface("Fixture table", new Vector3(0,.75f,0), new Vector3(1.8f,.1f,1.1f), new Color(.4f,.3f,.23f));
            EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Root + "/Scenes/DesktopFixture.unity");
#if !SANDBOX_CORE_FIXTURE
            QuestBuildSetup.ConfigureProject();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            app = CreateApp(assets, false);
            AddLight();
            QuestBuildSetup.CreateRig(app);
            EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Root + "/Scenes/QuestSandbox.unity");
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(Root + "/Scenes/QuestSandbox.unity", true) };
#endif
            PlayerSettings.companyName = "AR Sandbox";
            PlayerSettings.productName = "AR Sandbox";
            PlayerSettings.runInBackground = true;
            PlayerSettings.defaultScreenWidth = 1280; PlayerSettings.defaultScreenHeight = 800;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed; // Local USB-forwarded PC service.
            var serialized = new SerializedObject(Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings"));
            var input = serialized.FindProperty("activeInputHandler");
            if (input != null) { input.intValue = 1; serialized.ApplyModifiedProperties(); }
            AssetDatabase.SaveAssets();
            Debug.Log("SANDBOX_SETUP_OK");
        }

        private static SandboxApp CreateApp(PrefabEntry[] assets, bool fixture)
        {
            var app = new GameObject("AR Sandbox").AddComponent<SandboxApp>();
            app.prefabs = assets; app.simulatedRoom = fixture;
            app.placementMaterial = Material("placement", new Color(.1f, 1f, .75f));
            var bridge = app.gameObject.AddComponent<PcBridge>(); bridge.app = app;
            return app;
        }

        private static PrefabEntry MakeProp(string id, string name, PrimitiveType type, Color color)
        {
            var root = new GameObject(name);
            var shape = GameObject.CreatePrimitive(type);
            shape.transform.SetParent(root.transform, false);
            shape.transform.localScale = type == PrimitiveType.Cylinder ? new Vector3(.55f,.5f,.55f) : Vector3.one;
            shape.transform.localPosition = Vector3.up * .5f;
            shape.GetComponent<Renderer>().sharedMaterial = Material(id, color);
            var prefab = PrefabUtility.SaveAsPrefabAsset(root, Root + "/Prefabs/" + id + ".prefab");
            UnityEngine.Object.DestroyImmediate(root);
            return new PrefabEntry { assetId = id, displayName = name, prefab = prefab };
        }

        private static Material Material(string id, Color color)
        {
            var path = Root + "/Materials/" + id + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null) { material = new Material(Shader.Find("Standard")); AssetDatabase.CreateAsset(material, path); }
            material.color = color; material.SetFloat("_Glossiness", .25f); EditorUtility.SetDirty(material);
            return material;
        }
        private static void Surface(string name, Vector3 position, Vector3 size, Color color)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name; go.transform.position = position; go.transform.localScale = size;
            go.GetComponent<Renderer>().sharedMaterial = Material(name.Replace(" ", "-"), color);
        }
        private static void AddLight()
        {
            var light = new GameObject("Sandbox lighting").AddComponent<Light>(); light.type = LightType.Directional;
            light.transform.rotation = Quaternion.Euler(50, -30, 0); light.intensity = 1.1f;
            RenderSettings.ambientLight = new Color(.6f,.6f,.6f);
        }

        public static void BuildDesktop()
        {
            Generate();
            Build(Root + "/Scenes/DesktopFixture.unity", BuildTarget.StandaloneWindows64, "Builds/Desktop/AR-Sandbox.exe");
        }
        public static void BuildQuest()
        {
#if !SANDBOX_CORE_FIXTURE
            SandboxCoreChecks.Run();
            Generate();
            Build(Root + "/Scenes/QuestSandbox.unity", BuildTarget.Android, "Builds/Quest/AR-Sandbox.apk");
#else
            throw new InvalidOperationException("The independent core fixture cannot build Quest.");
#endif
        }
        private static void Build(string scene, BuildTarget target, string defaultOutput)
        {
            var output = defaultOutput;
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i + 1 < args.Length; i++) if (args[i] == "-sandboxBuildOutput") output = args[i + 1];
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var report = BuildPipeline.BuildPlayer(new[] { scene }, output, target, BuildOptions.Development);
            if (report.summary.result != BuildResult.Succeeded) throw new Exception("Sandbox build failed: " + report.summary.result);
            Debug.Log("SANDBOX_BUILD_OK " + Path.GetFullPath(output));
        }
    }
}
