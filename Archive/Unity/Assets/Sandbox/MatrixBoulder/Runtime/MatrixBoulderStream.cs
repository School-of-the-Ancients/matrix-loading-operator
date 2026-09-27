using System;
using System.IO;
using CesiumForUnity;
using UnityEngine;

namespace ArSandbox.MatrixBoulder
{
    /// <summary>Supplies local credentials only when the Boulder scene enters Play Mode.</summary>
    public sealed class MatrixBoulderStream : MonoBehaviour
    {
        public const string TokenEnvironmentVariable = "MATRIX_BOULDER_CESIUM_ION_TOKEN";
        public const string TokenFileName = ".matrix-boulder-token";

        [SerializeField] private Cesium3DTileset tileset;
        private string status;

        public void SetTileset(Cesium3DTileset value) { tileset = value; }

        private void Awake()
        {
            if (tileset == null)
            {
                status = "Boulder tileset reference is missing.";
                Debug.LogError(status, this);
                return;
            }

            // Application.dataPath is Assets in the Editor and <name>_Data in a player.
            // The sibling token file is ignored by Git and never serialized into a scene.
            string token = Environment.GetEnvironmentVariable(TokenEnvironmentVariable);
            if (string.IsNullOrWhiteSpace(token))
            {
                string path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", TokenFileName));
                if (File.Exists(path)) token = File.ReadAllText(path);
            }

            if (string.IsNullOrWhiteSpace(token))
            {
                status = "Cesium ion token missing. See Docs/Matrix-Boulder-MB0.md.";
                Debug.LogWarning(status, this);
                return;
            }

            // The tileset is inactive in the saved scene, so it cannot start streaming
            // before its runtime-only token has been assigned.
            tileset.ionAccessToken = token.Trim();
            CesiumCreditSystem.GetDefaultCreditSystem();
            tileset.gameObject.SetActive(true);
            status = "Streaming Boulder through Cesium ion";
        }

        private void OnGUI()
        {
            GUI.Box(new Rect(12, 12, 360, 64), "Matrix Boulder  |  MB-0");
            GUI.Label(new Rect(22, 37, 340, 22), status ?? "Preparing tileset");
        }
    }
}
