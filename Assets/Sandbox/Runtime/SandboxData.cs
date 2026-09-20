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
    public sealed class AssetInfo
    {
        public string assetId;
        public string displayName;
        public float spawnScale = 0.2f;
    }

    [Serializable]
    public sealed class AnchorInfo
    {
        public string anchorId;
        public string displayName;
    }

    [Serializable]
    public sealed class SandboxSnapshot
    {
        public SceneData scene;
        public List<AssetInfo> assets;
        public List<AnchorInfo> anchors;
        public SelectionData selection;
    }

    [Serializable]
    public sealed class SelectionData
    {
        public string anchorId;
        public string objectId;
        public Float3 position;
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
