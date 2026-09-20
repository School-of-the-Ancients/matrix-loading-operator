using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ArSandbox
{
    public static class QuestSceneOpener
    {
        private const string ScenePath = "Assets/Sandbox/Scenes/QuestSandbox.unity";
        private const string RequestPath = "Library/OpenQuestScene.request";

        [InitializeOnLoadMethod]
        private static void OpenRequestedScene()
        {
            if (Application.isBatchMode || !File.Exists(RequestPath)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(RequestPath)) return;
                File.Delete(RequestPath);
                Open();
            };
        }

        [MenuItem("Sandbox/Open Quest scene")]
        public static void Open()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            Debug.Log("SANDBOX_QUEST_SCENE_OPENED " + ScenePath);
        }
    }
}
