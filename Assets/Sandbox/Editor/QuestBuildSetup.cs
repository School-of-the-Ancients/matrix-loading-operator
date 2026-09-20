using System;
using System.Collections.Generic;
using System.Reflection;
using Meta.XR.MRUtilityKit;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;

namespace ArSandbox
{
    public static class QuestBuildSetup
    {
        public static void CreateRig(SandboxApp app)
        {
            app.simulatedRoom = false;
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Packages/com.meta.xr.sdk.core/Prefabs/OVRCameraRig.prefab");
            if (prefab == null) throw new InvalidOperationException("Meta OVRCameraRig prefab is unavailable.");
            var rigObject = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            rigObject.name = "Quest camera rig";
            var rig = rigObject.GetComponent<OVRCameraRig>();
            var manager = rigObject.GetComponent<OVRManager>();
            manager.isInsightPassthroughEnabled = true;
            manager.trackingOriginType = OVRManager.TrackingOrigin.FloorLevel;
            foreach (var camera in rigObject.GetComponentsInChildren<Camera>(true))
            {
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                camera.nearClipPlane = 0.05f;
                camera.farClipPlane = 50f;
                camera.allowHDR = false;
            }
            var passthrough = rigObject.AddComponent<OVRPassthroughLayer>();
            passthrough.overlayType = OVROverlay.OverlayType.Underlay;
            passthrough.hidden = false;
            var roomObject = new GameObject("Quest Pro device room (MRUK V1)");
            var mruk = roomObject.AddComponent<MRUK>();
            mruk.SceneSettings = new MRUK.MRUKSettings { DataSource = MRUK.SceneDataSource.Device, LoadSceneOnStartup = false, EnableHighFidelityScene = false };
            mruk.EnableWorldLock = true;
            var adapter = app.gameObject.AddComponent<QuestRoomAdapter>();
            adapter.app = app; adapter.rig = rig; adapter.mruk = mruk;
            EditorUtility.SetDirty(app);
            EditorUtility.SetDirty(manager);
            EditorUtility.SetDirty(mruk);
        }

        public static void ConfigureProject()
        {
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.matt.arsandbox");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel32;
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel34;
            PlayerSettings.Android.applicationEntry = AndroidApplicationEntry.GameActivity;
            PlayerSettings.Android.androidTVCompatibility = false;
            PlayerSettings.Android.forceInternetPermission = true;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });
            PlayerSettings.colorSpace = ColorSpace.Linear;
            QualitySettings.antiAliasing = 4;

            if (!AssetDatabase.IsValidFolder("Assets/XR")) AssetDatabase.CreateFolder("Assets", "XR");
            if (!EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.settingsKey, out XRGeneralSettingsPerBuildTarget allSettings))
            {
                allSettings = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                AssetDatabase.CreateAsset(allSettings, "Assets/XR/XRGeneralSettingsPerBuildTarget.asset");
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.settingsKey, allSettings, true);
            }
            if (!allSettings.HasManagerSettingsForBuildTarget(BuildTargetGroup.Android))
                allSettings.CreateDefaultManagerSettingsForBuildTarget(BuildTargetGroup.Android);
            var general = allSettings.SettingsForBuildTarget(BuildTargetGroup.Android);
            general.InitManagerOnStart = true;
            general.Manager.automaticLoading = true;
            general.Manager.automaticRunning = true;
            if (!XRPackageMetadataStore.AssignLoader(general.Manager, "UnityEngine.XR.OpenXR.OpenXRLoader", BuildTargetGroup.Android))
                throw new InvalidOperationException("Could not configure Android OpenXR loader.");

            // Unity keeps the package-settings creation API internal. Invoke that one
            // known editor API, then use public feature APIs for all configuration.
            var settingsType = typeof(FeatureHelpers).Assembly.GetType("UnityEditor.XR.OpenXR.OpenXRPackageSettings", true);
            settingsType.GetMethod("GetOrCreateInstance", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
            FeatureHelpers.RefreshFeatures(BuildTargetGroup.Android);
            var openxr = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Android);
            if (openxr == null) throw new InvalidOperationException("OpenXR Android settings were not created.");
            openxr.renderMode = OpenXRSettings.RenderMode.SinglePassInstanced;
            EnableFeature("com.unity.openxr.feature.metaquest");
            EnableFeature("com.meta.openxr.feature.metaxr");
            EnableFeature("com.unity.openxr.feature.input.oculustouch");
            EnableFeature("com.unity.openxr.feature.input.metaquestplus");
            EnableFeature("com.unity.openxr.feature.input.metaquestpro");
            var questFeature = FeatureHelpers.GetFeatureWithIdForBuildTarget(BuildTargetGroup.Android, "com.unity.openxr.feature.metaquest");
            var serializedFeature = new SerializedObject(questFeature);
            var devices = serializedFeature.FindProperty("targetDevices");
            if (devices != null)
            {
                for (var index = 0; index < devices.arraySize; index++)
                {
                    var entry = devices.GetArrayElementAtIndex(index);
                    var name = entry.FindPropertyRelative("manifestName").stringValue;
                    entry.FindPropertyRelative("enabled").boolValue = name == "eureka" || name == "cambria";
                }
                serializedFeature.ApplyModifiedPropertiesWithoutUndo();
            }
            var config = OVRProjectConfig.CachedProjectConfig;
            // Quest Pro's manually configured Scene Model V1 is the primary path.
            // Quest 3 is compatible without requiring its depth or high-fidelity features.
            config.targetDeviceTypes = new List<OVRProjectConfig.DeviceType> { OVRProjectConfig.DeviceType.QuestPro, OVRProjectConfig.DeviceType.Quest3 };
            config.sceneSupport = OVRProjectConfig.FeatureSupport.Required;
            config.insightPassthroughSupport = OVRProjectConfig.FeatureSupport.Required;
            config.anchorSupport = OVRProjectConfig.AnchorSupport.Enabled;
            config.handTrackingSupport = OVRProjectConfig.HandTrackingSupport.ControllersOnly;
            OVRProjectConfig.CommitProjectConfig(config);
            OVRManifestPreprocessor.GenerateOrUpdateAndroidManifest(Application.isBatchMode);
            EditorUtility.SetDirty(allSettings);
            EditorUtility.SetDirty(general);
            EditorUtility.SetDirty(general.Manager);
            EditorUtility.SetDirty(openxr);
            AssetDatabase.SaveAssets();
        }

        private static void EnableFeature(string id)
        {
            var feature = FeatureHelpers.GetFeatureWithIdForBuildTarget(BuildTargetGroup.Android, id);
            if (feature == null) throw new InvalidOperationException("Required OpenXR feature unavailable: " + id);
            feature.enabled = true;
            EditorUtility.SetDirty(feature);
        }
    }
}
