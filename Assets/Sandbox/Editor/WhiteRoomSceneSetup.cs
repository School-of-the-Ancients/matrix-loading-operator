using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ArSandbox
{
    public static class WhiteRoomSceneSetup
    {
        private const string Root = "Assets/Sandbox/WhiteRoom";
        [MenuItem("Sandbox/White room/Generate desktop scene")]
        public static void GenerateDesktop() { Generate(false); }
#if WHITE_ROOM_OPENXR
        [MenuItem("Sandbox/White room/Generate Quest scene")]
        public static void GenerateQuest() { Generate(true); }
#endif
        private static void Generate(bool quest)
        {
            Directory.CreateDirectory(Root + "/Scenes");
            var assets = CreateBundledCatalog();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var app = new GameObject("Matrix Operator").AddComponent<SandboxApp>();
            app.prefabs = assets; app.simulatedRoom = false;
            app.placementMaterial = Material("placement", new Color(.05f,.8f,.45f));
            var bridge = app.gameObject.AddComponent<PcBridge>(); bridge.app = app;
            var voice = app.gameObject.AddComponent<SandboxVoiceInput>(); voice.app = app; voice.bridge = bridge;
            var room = app.gameObject.AddComponent<WhiteRoomAdapter>(); room.app = app;
            room.floorOrigin = new GameObject("White room coordinate origin").transform;
            // The floor and save origin remain fixed when the viewer moves or tracking recentres.
            var floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
            floor.name = "White floor"; floor.transform.position = new Vector3(0, -.05f, 0);
            floor.transform.localScale = new Vector3(200, .1f, 200);
            floor.GetComponent<Renderer>().sharedMaterial = Material("floor", new Color(.93f,.94f,.95f));
            var light = new GameObject("Soft key light").AddComponent<Light>();
            light.type = LightType.Directional; light.intensity = .85f; light.shadows = LightShadows.Soft;
            light.shadowStrength = .35f; light.transform.rotation = Quaternion.Euler(50, -30, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.75f,.77f,.8f);
            RenderSettings.fog = true; RenderSettings.fogColor = Color.white;
            RenderSettings.fogMode = FogMode.Linear; RenderSettings.fogStartDistance = 25; RenderSettings.fogEndDistance = 70;
            if (quest)
            {
#if WHITE_ROOM_OPENXR
                WhiteRoomXrSetup.ConfigureProject();
                WhiteRoomXrSetup.CreateRig(app);
#else
                throw new InvalidOperationException("Build Quest using Build-WhiteRoom.ps1 -Target Quest.");
#endif
            }
            else
            {
                var camera = new GameObject("Main Camera").AddComponent<Camera>(); camera.tag = "MainCamera";
                camera.transform.position = new Vector3(3, 2.2f, -4);
                camera.transform.LookAt(new Vector3(0, .6f, 2));
                camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.white;
                camera.nearClipPlane = .05f; camera.farClipPlane = 100;
                camera.gameObject.AddComponent<AudioListener>();
                var controls = app.gameObject.AddComponent<WhiteRoomDesktopControls>();
                controls.app = app; controls.bridge = bridge; controls.view = camera;
            }
            PlayerSettings.companyName = "School of the Ancients";
            PlayerSettings.productName = "Matrix Operator";
            // A validation-only desktop product owns a separate persistent cache.
            // This never changes the shipped application's control.json or saves.
            var arguments = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < arguments.Length; i++) if (arguments[i] == "-sandboxValidationId")
            {
                if (quest || !System.Text.RegularExpressions.Regex.IsMatch(arguments[i + 1], "^[A-Za-z0-9_-]{1,48}$"))
                    throw new ArgumentException("A validation profile requires Desktop and a bounded simple ID.");
                PlayerSettings.productName = "Matrix Operator Validation " + arguments[i + 1];
            }
            PlayerSettings.runInBackground = true;
            PlayerSettings.defaultScreenWidth = 1440; PlayerSettings.defaultScreenHeight = 900;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
            var serialized = new SerializedObject(Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings"));
            var input = serialized.FindProperty("activeInputHandler");
            if (input != null) { input.intValue = 1; serialized.ApplyModifiedProperties(); }
            var path = Root + "/Scenes/" + (quest ? "WhiteRoomQuest" : "WhiteRoomDesktop") + ".unity";
            EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), path);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(path, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("WHITE_ROOM_SETUP_OK " + path);
        }

        // Both device modes use the same IDs, geometry, pivots, and asset metadata.
        // Calling this creates only catalog assets; it does not replace the open scene.
        public static PrefabEntry[] CreateBundledCatalog()
        {
            Directory.CreateDirectory(Root + "/Prefabs");
            Directory.CreateDirectory(Root + "/Materials");
            return new[] { Furniture("chair", "Chair"), Furniture("table", "Table"), Furniture("wall", "Wall"), Furniture("pedestal", "Pedestal"),
                Primitive("block", "Terracotta block", PrimitiveType.Cube, new Color(.75f,.3f,.17f)),
                Primitive("orb", "Jade orb", PrimitiveType.Sphere, new Color(.08f,.58f,.43f)),
                Primitive("column", "Stone column", PrimitiveType.Cylinder, new Color(.67f,.64f,.56f)) };
        }

        public static Material CreatePlacementMaterial()
        {
            Directory.CreateDirectory(Root + "/Materials");
            return Material("placement", new Color(.05f,.8f,.45f));
        }

        private static PrefabEntry Primitive(string id, string name, PrimitiveType type, Color color)
        {
            var root = new GameObject(name);
            var child = GameObject.CreatePrimitive(type); child.transform.SetParent(root.transform, false);
            child.transform.localPosition = Vector3.up * .5f;
            child.transform.localScale = type == PrimitiveType.Cylinder ? new Vector3(.55f,.5f,.55f) : Vector3.one;
            child.GetComponent<Renderer>().sharedMaterial = Material(id, color);
            return Save(root, id, name, .2f);
        }
        private static PrefabEntry Furniture(string id, string name)
        {
            var root = new GameObject(name);
            var wood = Material("oak", new Color(.57f,.38f,.21f));
            var metal = Material("graphite", new Color(.1f,.12f,.14f));
            if (id == "chair")
            {
                Part(root, "Seat", new Vector3(0,.46f,0), new Vector3(.5f,.08f,.5f), wood);
                Part(root, "Back", new Vector3(0,.77f,.21f), new Vector3(.5f,.54f,.08f), wood);
                Legs(root, .2f, .2f, .42f, metal);
            }
            else if (id == "table")
            {
                Part(root, "Top", new Vector3(0,.75f,0), new Vector3(1.4f,.08f,.8f), wood);
                Legs(root, .61f, .31f, .71f, metal);
            }
            else if (id == "wall") Part(root, "Panel", new Vector3(0,1.25f,0), new Vector3(2.5f,2.5f,.12f), Material("wall", new Color(.7f,.76f,.8f)));
            else
            {
                Part(root, "Base", new Vector3(0,.06f,0), new Vector3(.65f,.12f,.65f), metal);
                Part(root, "Stand", new Vector3(0,.52f,0), new Vector3(.36f,.8f,.36f), Material("stone", new Color(.64f,.65f,.66f)));
                Part(root, "Top", new Vector3(0,.96f,0), new Vector3(.65f,.08f,.65f), metal);
            }
            var entry = Save(root, id, name, 1);
            if (id == "chair") entry.description = "Seat faces local -Z; backrest is on local +Z.";
            return entry;
        }
        private static void Legs(GameObject root, float x, float z, float height, Material material)
        {
            foreach (var sx in new[] { -1, 1 }) foreach (var sz in new[] { -1, 1 })
                Part(root, "Leg", new Vector3(sx*x, height/2, sz*z), new Vector3(.065f,height,.065f), material);
        }
        private static void Part(GameObject root, string name, Vector3 position, Vector3 size, Material material)
        {
            var part = GameObject.CreatePrimitive(PrimitiveType.Cube); part.name = name;
            part.transform.SetParent(root.transform, false); part.transform.localPosition = position; part.transform.localScale = size;
            part.GetComponent<Renderer>().sharedMaterial = material;
        }
        private static PrefabEntry Save(GameObject root, string id, string name, float scale)
        {
            var prefab = PrefabUtility.SaveAsPrefabAsset(root, Root + "/Prefabs/" + id + ".prefab");
            UnityEngine.Object.DestroyImmediate(root);
            return new PrefabEntry { assetId = id, displayName = name, prefab = prefab, spawnScale = scale };
        }
        private static Material Material(string id, Color color)
        {
            var path = Root + "/Materials/" + id + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null) { material = new Material(Shader.Find("Standard")); AssetDatabase.CreateAsset(material, path); }
            material.color = color; material.SetFloat("_Glossiness", .18f); EditorUtility.SetDirty(material);
            return material;
        }
        public static void BuildDesktop() { Generate(false); Build(false); }
        public static void BuildQuest() { Generate(true); Build(true); }
        private static void Build(bool quest)
        {
            SandboxCoreChecks.Run();
            var output = quest ? "Builds/WhiteRoomQuest/MatrixOperator.apk" : "Builds/WhiteRoomDesktop/MatrixOperator.exe";
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i + 1 < args.Length; i++) if (args[i] == "-sandboxBuildOutput") output = args[i+1];
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var scene = Root + "/Scenes/" + (quest ? "WhiteRoomQuest" : "WhiteRoomDesktop") + ".unity";
            var report = BuildPipeline.BuildPlayer(new[] { scene }, output, quest ? BuildTarget.Android : BuildTarget.StandaloneWindows64, BuildOptions.Development);
            if (report.summary.result != BuildResult.Succeeded) throw new Exception("White room build failed: " + report.summary.result);
            Debug.Log("WHITE_ROOM_BUILD_OK " + Path.GetFullPath(output));
        }
    }
}
