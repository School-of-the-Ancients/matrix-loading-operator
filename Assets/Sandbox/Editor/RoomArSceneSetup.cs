using System;
using System.IO;
using System.Xml;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ArSandbox
{
    /// <summary>Native MRUK mode, kept separate from the working Unity-only white-room build.</summary>
    public static class RoomArSceneSetup
    {
        public const string ScenePath = "Assets/Sandbox/RoomAR/Scenes/QuestRoomAR.unity";

        [MenuItem("Sandbox/Room AR/Generate Quest Pro scene")]
        public static void GenerateQuest()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            PrefabEntry[] catalog = WhiteRoomSceneSetup.CreateBundledCatalog();
            QuestBuildSetup.ConfigureProject();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var app = new GameObject("Matrix Operator AR").AddComponent<SandboxApp>();
            app.prefabs = catalog;
            app.simulatedRoom = false;
            app.placementMaterial = WhiteRoomSceneSetup.CreatePlacementMaterial();
            var bridge = app.gameObject.AddComponent<PcBridge>(); bridge.app = app;
            var voice = app.gameObject.AddComponent<SandboxVoiceInput>(); voice.app = app; voice.bridge = bridge;
            QuestBuildSetup.CreateRig(app);
            // No virtual floor, room shell, or fake surface data is rendered in AR.
            var light = new GameObject("AR prop key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = .85f;
            light.shadows = LightShadows.None;
            light.transform.rotation = Quaternion.Euler(50, -30, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.75f, .77f, .8f);
            RenderSettings.fog = false;
            PlayerSettings.companyName = "School of the Ancients";
            PlayerSettings.productName = "Matrix Operator AR";
            PlayerSettings.runInBackground = true;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
            var serialized = new SerializedObject(Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings"));
            var input = serialized.FindProperty("activeInputHandler");
            if (input != null) { input.intValue = 1; serialized.ApplyModifiedPropertiesWithoutUndo(); }
            EnsureMicrophoneManifest();
            EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("ROOM_AR_SETUP_OK " + ScenePath);
        }

        public static void BuildQuest()
        {
            GenerateQuest();
            SandboxCoreChecks.Run();
            string output = "Builds/RoomARQuest/MatrixOperatorAR.apk";
            string[] args = Environment.GetCommandLineArgs();
            for (int index = 0; index + 1 < args.Length; index++)
                if (args[index] == "-sandboxBuildOutput") output = args[index + 1];
            output = Path.GetFullPath(output);
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var report = BuildPipeline.BuildPlayer(new[] { ScenePath }, output, BuildTarget.Android, BuildOptions.Development);
            if (report.summary.result != BuildResult.Succeeded) throw new Exception("Room AR build failed: " + report.summary.result);
            Debug.Log("ROOM_AR_BUILD_OK " + output);
        }

        private static void EnsureMicrophoneManifest()
        {
            // Meta's supported generator owns scene/passthrough declarations. Add only
            // this app's microphone declaration; runtime consent remains in voice input.
            const string path = "Assets/Plugins/Android/AndroidManifest.xml";
            const string android = "http://schemas.android.com/apk/res/android";
            if (!File.Exists(path)) throw new InvalidOperationException("Meta did not generate its Android manifest.");
            var document = new XmlDocument();
            document.Load(path);
            XmlElement manifest = document.DocumentElement;
            bool found = false;
            foreach (XmlNode child in manifest.ChildNodes)
                if (child is XmlElement element && element.Name == "uses-permission" &&
                    element.GetAttribute("name", android) == "android.permission.RECORD_AUDIO") found = true;
            if (!found)
            {
                var permission = document.CreateElement("uses-permission");
                permission.SetAttribute("name", android, "android.permission.RECORD_AUDIO");
                manifest.AppendChild(permission);
                document.Save(path);
                AssetDatabase.ImportAsset(path);
            }
        }
    }
}
