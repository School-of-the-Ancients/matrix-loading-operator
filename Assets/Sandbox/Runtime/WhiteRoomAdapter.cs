using UnityEngine;

namespace ArSandbox
{
    /// <summary>A virtual, metre-based room. Its save coordinates do not depend on a physical room scan.</summary>
    public sealed class WhiteRoomAdapter : MonoBehaviour
    {
        public const string RoomId = "white-room-v1";
        public const string FloorId = "white-floor";
        public SandboxApp app;
        public Transform floorOrigin;

        private void Start()
        {
            if (app == null || floorOrigin == null)
            {
                Debug.LogError("White room requires a sandbox app and floor origin.", this);
                return;
            }
            app.InitializeWorld(RoomId, new[] {
                new RoomTarget { anchorId = FloorId, displayName = "White room floor", origin = floorOrigin }
            });
            app.SetPlacement(FloorId, new Vector3(0, 0, 2));
            app.ReportStatus("White room ready. Choose a prop and summon it at the green point.");
        }
    }
}
