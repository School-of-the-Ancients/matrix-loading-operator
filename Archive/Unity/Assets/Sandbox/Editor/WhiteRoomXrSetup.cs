#if WHITE_ROOM_OPENXR
using System;
using System.Reflection;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.Rendering;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;

namespace ArSandbox
{
    public static class WhiteRoomXrSetup
    {
        public static void CreateRig(SandboxApp app)
        {
            app.simulatedRoom = false;
            var origin = new GameObject("OpenXR floor tracking origin");
            origin.transform.SetParent(app.transform, false);
            var camera = new GameObject("XR Main Camera").AddComponent<Camera>();
            camera.transform.SetParent(origin.transform, false);
            camera.tag = "MainCamera";
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.white;
            camera.nearClipPlane = .05f; camera.farClipPlane = 100f; camera.allowHDR = false;
            camera.gameObject.AddComponent<AudioListener>();
            var tracking = camera.gameObject.AddComponent<TrackedPoseDriver>();
            tracking.trackingType = TrackedPoseDriver.TrackingType.RotationAndPosition;
            tracking.updateType = TrackedPoseDriver.UpdateType.UpdateAndBeforeRender;
            tracking.ignoreTrackingState = false;
            tracking.positionInput = new InputActionProperty(new InputAction("Head position", InputActionType.Value, "<XRHMD>/centerEyePosition"));
            tracking.rotationInput = new InputActionProperty(new InputAction("Head rotation", InputActionType.Value, "<XRHMD>/centerEyeRotation"));
            tracking.trackingStateInput = new InputActionProperty(new InputAction("Head tracking", InputActionType.Value, "<XRHMD>/trackingState"));
            var controls = app.gameObject.AddComponent<WhiteRoomXrControls>();
            controls.app = app; controls.trackingOrigin = origin.transform; controls.headCamera = camera;
        }

        public static void ConfigureProject()
        {
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.matt.matrixoperator.whiteroom");
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
            var player = new SerializedObject(Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings"));
            player.FindProperty("activeInputHandler").intValue = 1;
            player.ApplyModifiedPropertiesWithoutUndo();

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
            general.InitManagerOnStart = true; general.Manager.automaticLoading = true; general.Manager.automaticRunning = true;
            if (!XRPackageMetadataStore.AssignLoader(general.Manager, "UnityEngine.XR.OpenXR.OpenXRLoader", BuildTargetGroup.Android))
                throw new InvalidOperationException("Could not configure the standard Android OpenXR loader.");

            // The package settings type is internal in Unity OpenXR 1.18; only its creation needs reflection.
            var settingsType = typeof(FeatureHelpers).Assembly.GetType("UnityEditor.XR.OpenXR.OpenXRPackageSettings", true);
            settingsType.GetMethod("GetOrCreateInstance", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
            FeatureHelpers.RefreshFeatures(BuildTargetGroup.Android);
            var openxr = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Android);
            if (openxr == null) throw new InvalidOperationException("OpenXR Android settings were not created.");
            openxr.renderMode = OpenXRSettings.RenderMode.SinglePassInstanced;
            EnableFeature("com.unity.openxr.feature.metaquest");
            EnableFeature("com.unity.openxr.feature.input.oculustouch");
            EnableFeature("com.unity.openxr.feature.input.metaquestpro");
            var quest = FeatureHelpers.GetFeatureWithIdForBuildTarget(BuildTargetGroup.Android, "com.unity.openxr.feature.metaquest");
            var serialized = new SerializedObject(quest);
            var devices = serialized.FindProperty("targetDevices");
            if (devices == null || devices.arraySize == 0) throw new InvalidOperationException("Unity OpenXR Quest target device list is unavailable.");
            var proFound = false;
            for (var i = 0; i < devices.arraySize; i++)
            {
                var device = devices.GetArrayElementAtIndex(i);
                var name = device.FindPropertyRelative("manifestName").stringValue;
                device.FindPropertyRelative("enabled").boolValue = name == "cambria" || name == "eureka";
                proFound |= name == "cambria";
            }
            if (!proFound) throw new InvalidOperationException("Unity OpenXR does not list Quest Pro support.");
            var internet = serialized.FindProperty("forceRemoveInternetPermission");
            if (internet != null) internet.boolValue = false;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(allSettings); EditorUtility.SetDirty(general); EditorUtility.SetDirty(general.Manager); EditorUtility.SetDirty(openxr);
            AssetDatabase.SaveAssets();
        }

        private static void EnableFeature(string id)
        {
            var feature = FeatureHelpers.GetFeatureWithIdForBuildTarget(BuildTargetGroup.Android, id);
            if (feature == null) throw new InvalidOperationException("Required Unity OpenXR feature unavailable: " + id);
            feature.enabled = true;
            EditorUtility.SetDirty(feature);
        }
    }
}
#endif
