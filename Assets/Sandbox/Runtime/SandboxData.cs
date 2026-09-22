using System;
using System.Collections.Generic;
using UnityEngine;

namespace ArSandbox
{
    [Serializable]
    public sealed class Float3
    {
        public float x;
        public float y;
        public float z;

        public Float3() { }

        public Float3(float x, float y, float z)
        {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    [Serializable]
    public sealed class TransformData
    {
        // Position is in metres in the selected room target's local coordinate frame.
        // Rotation is local Euler degrees; scale is a positive local multiplier.
        public Float3 position;
        public Float3 rotation;
        public Float3 scale;
    }

    [Serializable]
    public sealed class SceneObjectData
    {
        public string objectId;
        public string assetId;
        public string anchorId;
        public TransformData transform;
        // Optional for legacy schema-1 scenes. Animation phase is presentation only.
        public List<BehaviorData> behaviors;
        // Optional schema-1 provenance; absent for bundled/legacy assets.
        public ContentSourceReference source;
    }

    [Serializable]
    public sealed class BehaviorData
    {
        public string kind;
        public bool enabled = true;
        public bool paused;
        public string axis = "y";
        public float speedDegreesPerSecond = 30f;
        public float amplitudeMeters = .05f;
        public float frequencyHz = .5f;
    }

    [Serializable]
    public sealed class SceneData
    {
        public int schemaVersion = 1;
        public string roomId;
        public List<SceneObjectData> objects;
    }

    [Serializable]
    public sealed class BoundsData
    {
        // Metres in prefab-root coordinates at scale (1,1,1), before object rotation.
        // The root pivot is (0,0,0); center need not coincide with that pivot.
        public Float3 center;
        public Float3 size;
    }

    [Serializable]
    public sealed class AssetInfo
    {
        public string assetId;
        public string displayName;
        public string description = "";
        public float spawnScale = 0.2f;
        // Optional static render bounds. Unknown geometry is null; JsonUtility may
        // materialize that as an all-zero inline object, never a known positive size.
        public BoundsData localBounds;
        public ContentSourceReference source;
    }

    [Serializable]
    public sealed class AnchorInfo
    {
        public string anchorId;
        public string displayName;
        public string source;
        public string[] semanticLabels;
        public RoomSurfaceData surface;
        public TransformData roomPose;
    }

    [Serializable]
    public sealed class RoomSurfaceData
    {
        public string kind; // support, wall or other; only supports accept props.
        public List<Float3> boundary;
        public BoundsData localBounds;
    }

    [Serializable]
    public sealed class RoomContextData
    {
        public string mode;
        public string state;
        public string message;
        public bool alignmentVerified;
    }

    [Serializable]
    public sealed class PointingData
    {
        public string anchorId;
        public string objectId;
        public Float3 position, normal, origin, direction;
    }

    [Serializable]
    public sealed class ViewerFrame
    {
        public string anchorId;
        // Eye/camera position in anchor-local units, including height above its plane.
        public Float3 position;
        // Horizontal, normalized direction in the same frame; y is always zero.
        public Float3 forward;
        public Float3 lookDirection; // Optional full gaze direction, including pitch.
    }

    [Serializable]
    public sealed class ViewerData
    {
        public List<ViewerFrame> frames = new List<ViewerFrame>();
    }

    [Serializable]
    public sealed class SandboxSnapshot
    {
        public string[] behaviorKinds = new[] { "rotate", "bob" };
        // A retained AR scene may be saved or explicitly cleared after anchors
        // become unavailable. It must never be used for new placement or restore.
        public bool readOnly;
        public SceneData scene;
        public List<AssetInfo> assets;
        public List<AnchorInfo> anchors;
        public SelectionData selection;
        // Live context only. Never part of SceneData or a source for restoring viewer pose.
        public ViewerData viewer;
        public PointingData pointing;
        public RoomContextData roomContext;
    }

    [Serializable]
    public sealed class SelectionData
    {
        public string anchorId;
        public string objectId;
        public Float3 position;
    }

    // Presentation supplied by the PC. Scene edits and learning progress stay separate.
    [Serializable]
    public sealed class LessonGuideData
    {
        public string sessionId;
        public int revision;
        public string title;
        public string stageLabel;
        public string body;
        public string prompt;
        public string hint;
        public string status;
        public int progressIndex;
        public int progressTotal;
    }

    [Serializable]
    public sealed class SandboxCommand
    {
        public string requestId;
        public string op;
        public string assetId;
        public string objectId;
        public string anchorId;
        public TransformData transform;
        public SceneData scene;
        public string placement; // Optional "surface": position.y is clearance, resolve prefab pivot.
        public BehaviorData behavior;
        public string behaviorKind;
    }

    [Serializable]
    public sealed class CommandResult
    {
        public string requestId;
        public bool ok;
        public string error;
        public string objectId;
    }

    // Ephemeral bridge data, never part of a saved scene or undo history.
    [Serializable]
    public sealed class SceneCaptureRequest
    {
        public string captureId;
        public int revision;
        public string mode;
    }

    [Serializable]
    public sealed class SceneCaptureCapabilities
    {
        public string[] modes = new[] { "virtual" };
        public string device;
        public string mixedStatus = "unsupported";
        public string reason;
        public bool depthOcclusion;
    }

    [Serializable]
    public sealed class SceneCameraIntrinsics
    {
        public float fx, fy, cx, cy;
    }

    [Serializable]
    public sealed class SceneCameraPose
    {
        public Float3 position, rotation, forward;
    }

    [Serializable]
    public sealed class ScenePhysicalCamera
    {
        public string eye = "left";
        public string frameTimestampUtc;
        public double frameAgeMs;
        public int imageWidth, imageHeight, sensorWidth, sensorHeight;
        public SceneCameraIntrinsics intrinsics;
        public SceneCameraPose pose;
        public float[] projection;
        public string projectionConvention = "unity_camera_row_major";
        public string alignment = "camera_intrinsics_at_exposure";
    }

    [Serializable]
    public sealed class SceneSpatialProvenance
    {
        public string source, roomId;
        public int anchorCount;
        public bool alignmentVerified;
        public bool depthOcclusion;
        public bool physicalDepthIncluded;
    }

    [Serializable]
    public sealed class SceneCaptureCamera
    {
        // World-space metres and Euler degrees of the mono rendering camera.
        // Virtual uses center eye; mixed uses the physical camera at exposure.
        public Float3 position, rotation, forward;
        public float fieldOfView, aspect, nearClip, farClip;
    }

    [Serializable]
    public sealed class SceneCaptureResult
    {
        public string captureId, clientId;
        public int revision;
        public string mode = "virtual";
        public bool ok;
        public string error;
        public string mimeType;
        public string dataBase64;
        public int width, height, byteLength;
        public string capturedAtUtc;
        public double capturedAtRuntimeSeconds;
        public int frameCount;
        public string source = "unity_center_eye";
        public bool includesPassthrough;
        public ScenePhysicalCamera physicalCamera;
        public SceneSpatialProvenance spatialProvenance;
        public SceneCaptureCamera camera;
        public double renderMs, encodeMs, frameTimeMs;
        // Monotonic wall-clock interval between PcBridge.Update calls bracketing
        // capture; includes other frame work and scheduling, not isolated GPU time.
        // Zero means unavailable (for example a direct EditMode capture check).
        public double captureFrameTimeMs;
        public SandboxSnapshot snapshot;
    }

    [Serializable]
    public sealed class PrefabEntry
    {
        public string assetId;
        public string displayName;
        public string description = "";
        public float spawnScale = 0.2f;
        public GameObject prefab;
        public ContentSourceReference source;
    }

    [Serializable]
    public sealed class RoomTarget
    {
        public string anchorId;
        public string displayName;
        public Transform origin;
        public string source;
        public string[] semanticLabels;
        public RoomSurfaceData surface;
        public TransformData roomPose;
        [NonSerialized] public Func<Vector3, bool> surfaceValidator;
    }
}
