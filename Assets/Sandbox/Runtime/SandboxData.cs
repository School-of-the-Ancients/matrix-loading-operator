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
    }

    [Serializable]
    public sealed class AnchorInfo
    {
        public string anchorId;
        public string displayName;
    }

    [Serializable]
    public sealed class ViewerFrame
    {
        public string anchorId;
        // Eye/camera position in anchor-local units, including height above its plane.
        public Float3 position;
        // Horizontal, normalized direction in the same frame; y is always zero.
        public Float3 forward;
    }

    [Serializable]
    public sealed class ViewerData
    {
        public List<ViewerFrame> frames = new List<ViewerFrame>();
    }

    [Serializable]
    public sealed class SandboxSnapshot
    {
        public SceneData scene;
        public List<AssetInfo> assets;
        public List<AnchorInfo> anchors;
        public SelectionData selection;
        // Live context only. Never part of SceneData or a source for restoring viewer pose.
        public ViewerData viewer;
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
    }

    [Serializable]
    public sealed class CommandResult
    {
        public string requestId;
        public bool ok;
        public string error;
        public string objectId;
    }

    [Serializable]
    public sealed class PrefabEntry
    {
        public string assetId;
        public string displayName;
        public string description = "";
        public float spawnScale = 0.2f;
        public GameObject prefab;
    }

    [Serializable]
    public sealed class RoomTarget
    {
        public string anchorId;
        public string displayName;
        public Transform origin;
    }
}
