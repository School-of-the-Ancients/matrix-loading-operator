using System;
using System.Reflection;
using UnityEngine;

namespace ArSandbox
{
    public static class LessonGuideChecks
    {
        public static void Run()
        {
            var root = new GameObject("Guide contract checks");
            try
            {
                var bridge = root.AddComponent<PcBridge>();
                var receive = typeof(PcBridge).GetMethod("ReceiveGuide", BindingFlags.NonPublic | BindingFlags.Instance);
                Action<LessonGuideData> send = value => receive.Invoke(bridge, new object[] { value });
                Func<string, int, LessonGuideData> guide = (id, revision) => new LessonGuideData {
                    sessionId = id, revision = revision, title = "Observation", body = "One\n  two", progressIndex = 1, progressTotal = 6
                };
                send(guide("session-a", 2));
                Require(bridge.CurrentGuide != null && bridge.CurrentGuide.body == "One two", "valid plain-text guide");
                send(guide("session-a", 1));
                Require(bridge.CurrentGuide.revision == 2, "stale same-session guide rejected");
                send(guide("session-b", 0));
                Require(bridge.CurrentGuide.sessionId == "session-b" && bridge.CurrentGuide.revision == 0, "restored session accepted");
                var invalid = guide("session-b", 1); invalid.progressIndex = 7; send(invalid);
                Require(bridge.CurrentGuide == null, "invalid progress rejected");
                var oversized = guide("session-c", 1); oversized.body = new string('x', 8193); send(oversized);
                Require(bridge.CurrentGuide == null, "oversized input rejected");
                var longText = guide("session-c", 1); longText.body = new string('x', 1500); send(longText);
                Require(bridge.CurrentGuide.body.Length == 1200, "normal long text bounded");
                send(null); Require(bridge.CurrentGuide == null, "old service clears guide");
                Debug.Log("LESSON_GUIDE_CHECKS_OK: 7 checks");
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("Lesson guide check failed: " + message);
        }
    }
}
