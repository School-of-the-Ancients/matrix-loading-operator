using System;
using System.IO;
using CesiumForUnity;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ArSandbox.MatrixBoulder.Editor
{
    public static class MatrixBoulderSceneSetup
    {
        public const string ScenePath = "Assets/Sandbox/MatrixBoulder/Scenes/MatrixBoulder.unity";
        public const long GooglePhotorealisticAssetId = 2275207;
        public const double BoulderLongitude = -105.2705;
        public const double BoulderLatitude = 40.0150;

        [MenuItem("Sandbox/Matrix Boulder/Generate desktop scene")]
        public static void GenerateDesktop()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var globe = new GameObject("Boulder georeference");
            var georeference = globe.AddComponent<CesiumGeoreference>();
            // WGS84 ellipsoid height. The camera starts above central Boulder.
            georeference.SetOriginLongitudeLatitudeHeight(BoulderLongitude, BoulderLatitude, 1700.0);

            var tilesObject = new GameObject("Google Photorealistic 3D Tiles (visual only)");
            tilesObject.SetActive(false);
            tilesObject.transform.SetParent(globe.transform, false);
            var tileset = tilesObject.AddComponent<Cesium3DTileset>();
            tileset.tilesetSource = CesiumDataSource.FromCesiumIon;
            tileset.ionAssetID = GooglePhotorealisticAssetId;
            tileset.showCreditsOnScreen = true;

            var prefab = Resources.Load<GameObject>("DynamicCamera");
            if (prefab == null) throw new InvalidOperationException("Cesium DynamicCamera prefab was not found.");
            var cameraObject = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            cameraObject.name = "Boulder fly camera";
            cameraObject.transform.SetParent(globe.transform, false);
            cameraObject.transform.localPosition = new Vector3(0, 450, -850);
            cameraObject.transform.localRotation = Quaternion.Euler(24, 0, 0);
            var camera = cameraObject.GetComponent<Camera>();
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = 100000f;

            var sunlight = new GameObject("Sun").AddComponent<Light>();
            sunlight.type = LightType.Directional;
            sunlight.intensity = 1.1f;
            sunlight.transform.rotation = Quaternion.Euler(45, -35, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.55f, 0.6f, 0.68f);

            var stream = new GameObject("Boulder stream configuration").AddComponent<MatrixBoulderStream>();
            stream.SetTileset(tileset);

            var citizens = new GameObject("Boulder citizen simulation").AddComponent<BoulderCitizenDemo>();
            citizens.SetReferences(georeference, cameraObject.GetComponent<CesiumGlobeAnchor>());

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            ValidateScene();
            Debug.Log("MATRIX_BOULDER_SCENE_OK " + ScenePath);
        }

        public static void ValidateScene()
        {
            var globe = UnityEngine.Object.FindFirstObjectByType<CesiumGeoreference>();
            if (globe == null || Math.Abs(globe.longitude - BoulderLongitude) > 0.000001 ||
                Math.Abs(globe.latitude - BoulderLatitude) > 0.000001)
                throw new InvalidOperationException("Boulder georeference is missing or misplaced.");
            var tileset = UnityEngine.Object.FindFirstObjectByType<Cesium3DTileset>(FindObjectsInactive.Include);
            if (tileset == null || tileset.ionAssetID != GooglePhotorealisticAssetId ||
                !string.IsNullOrEmpty(tileset.ionAccessToken) || tileset.gameObject.activeSelf ||
                !tileset.showCreditsOnScreen)
                throw new InvalidOperationException("Boulder tileset or credential boundary is invalid.");
            var camera = UnityEngine.Object.FindFirstObjectByType<CesiumCameraController>();
            if (camera == null || camera.GetComponent<CesiumOriginShift>() == null ||
                camera.GetComponent<CesiumGlobeAnchor>() == null)
                throw new InvalidOperationException("Boulder fly camera is missing Cesium components.");
            if (UnityEngine.Object.FindFirstObjectByType<MatrixBoulderStream>() == null)
                throw new InvalidOperationException("Boulder stream configuration is missing.");
            if (UnityEngine.Object.FindFirstObjectByType<BoulderCitizenDemo>() == null)
                throw new InvalidOperationException("Boulder citizen simulation is missing.");
        }

        public static void BuildDesktop()
        {
            GenerateDesktop();
            BoulderCitizenValidation.Run();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds/MatrixBoulder/MatrixBoulder.exe"));
            string[] arguments = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < arguments.Length; i++)
                if (arguments[i] == "-matrixBoulderBuildOutput") output = Path.GetFullPath(arguments[i + 1]);
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var report = BuildPipeline.BuildPlayer(new[] { ScenePath }, output,
                BuildTarget.StandaloneWindows64, BuildOptions.Development);
            if (report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("Matrix Boulder build failed: " + report.summary.result);
            Debug.Log("MATRIX_BOULDER_BUILD_OK " + output);
        }
    }
}
