using System;
using System.Collections.Generic;
using System.IO;
using CesiumForUnity;
using Unity.Mathematics;
using UnityEngine;

namespace ArSandbox.MatrixBoulder
{
    /// <summary>Projects saved citizen poses into Cesium and runs a small local simulation.</summary>
    public sealed class BoulderCitizenDemo : MonoBehaviour
    {
        [SerializeField] private CesiumGeoreference georeference;
        [SerializeField] private CesiumGlobeAnchor flyCamera;

        private readonly Dictionary<string, CesiumGlobeAnchor> visuals =
            new Dictionary<string, CesiumGlobeAnchor>();
        private BoulderCitizenClock clock;
        private string status;
        private string savePath;
        private float saveTimer;
        private float smokeElapsed;
        private bool paused;
        private bool smokeRun;

        public void SetReferences(CesiumGeoreference world, CesiumGlobeAnchor camera)
        {
            georeference = world;
            flyCamera = camera;
        }

        private void Start()
        {
            if (georeference == null || flyCamera == null)
            {
                status = "Citizen scene references are missing.";
                Debug.LogError(status, this);
                return;
            }

            smokeRun = Array.IndexOf(Environment.GetCommandLineArgs(), "-matrixBoulderSmoke") >= 0;
            savePath = Path.Combine(Application.persistentDataPath, "MatrixBoulder",
                smokeRun ? "citizens-smoke-v1.json" : "citizens-v1.json");
            if (File.Exists(savePath))
            {
                try
                {
                    BoulderCitizenSave saved = JsonUtility.FromJson<BoulderCitizenSave>(File.ReadAllText(savePath));
                    clock = new BoulderCitizenClock(saved);
                    status = "Restored citizens from local save";
                }
                catch (Exception error)
                {
                    status = "Citizen save is invalid; correct or move it before playing.";
                    Debug.LogError(status + " " + error.Message, this);
                    return; // Never overwrite an unrecognized or damaged save.
                }
            }
            else
            {
                clock = new BoulderCitizenClock(BoulderCitizenClock.CreateSeed());
                status = "Created two prototype residents";
                Save();
            }

            for (int i = 0; i < clock.State.citizens.Count; i++)
                CreateVisual(clock.State.citizens[i], i);
        }

        private void Update()
        {
            if (clock == null || paused) return;
            clock.Tick(Time.unscaledDeltaTime);
            foreach (BoulderCitizenState citizen in clock.State.citizens)
            {
                CesiumGlobeAnchor anchor = visuals[citizen.entityId];
                GeoPose pose = citizen.pose;
                anchor.longitudeLatitudeHeight = new double3(
                    pose.longitudeDegrees, pose.latitudeDegrees, pose.heightMeters);
                anchor.transform.localRotation = Quaternion.Euler(0, (float)pose.headingDegrees, 0);
            }
            saveTimer += Time.unscaledDeltaTime;
            if (saveTimer >= 15f)
            {
                Save();
                saveTimer = 0;
            }
            if (smokeRun)
            {
                smokeElapsed += Time.unscaledDeltaTime;
                if (smokeElapsed >= 3f)
                {
                    Save();
                    Debug.Log("MATRIX_BOULDER_CITIZEN_RUNTIME_OK " + status + " " +
                        clock.State.citizens[0].entityId);
                    smokeRun = false;
                    Application.Quit();
                }
            }
        }

        private void CreateVisual(BoulderCitizenState citizen, int index)
        {
            var root = new GameObject("Citizen " + citizen.entityId);
            root.transform.SetParent(georeference.transform, false);
            var anchor = root.AddComponent<CesiumGlobeAnchor>();
            anchor.longitudeLatitudeHeight = new double3(
                citizen.pose.longitudeDegrees, citizen.pose.latitudeDegrees, citizen.pose.heightMeters);
            visuals.Add(citizen.entityId, anchor);

            Color color = index % 2 == 0 ? new Color(.2f, .9f, 1f) : new Color(1f, .7f, .2f);
            GameObject body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            body.name = "Placeholder body";
            body.transform.SetParent(root.transform, false);
            body.transform.localPosition = new Vector3(0, 1.5f, 0);
            body.transform.localScale = new Vector3(2, 2, 2);
            body.GetComponent<Renderer>().material.color = color;
            Destroy(body.GetComponent<Collider>());

            GameObject beacon = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            beacon.name = "Visible demo beacon";
            beacon.transform.SetParent(root.transform, false);
            beacon.transform.localPosition = new Vector3(0, 14, 0);
            beacon.transform.localScale = new Vector3(.2f, 12, .2f);
            beacon.GetComponent<Renderer>().material.color = color;
            Destroy(beacon.GetComponent<Collider>());
        }

        private void Save()
        {
            if (clock == null || string.IsNullOrEmpty(savePath)) return;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(savePath));
                string temporary = savePath + ".tmp";
                File.WriteAllText(temporary, JsonUtility.ToJson(clock.State, true));
                if (File.Exists(savePath)) File.Replace(temporary, savePath, null);
                else File.Move(temporary, savePath);
            }
            catch (Exception error)
            {
                status = "Citizen save failed; see Unity log.";
                Debug.LogError(status + " " + error.Message, this);
            }
        }

        private void OnApplicationPause(bool isPaused)
        {
            if (isPaused) Save();
        }

        private void OnApplicationQuit() { Save(); }

        private void OnGUI()
        {
            GUILayout.BeginArea(new Rect(12, 88, 480, 245), GUI.skin.box);
            GUILayout.Label("Matrix Boulder | Citizen prototype");
            GUILayout.Label(status ?? "Starting simulation");
            if (clock != null)
            {
                int minute = (int)clock.State.simulationMinutes;
                GUILayout.Label(string.Format("Sim clock {0:00}:{1:00}  |  1 sim minute / second", minute / 60, minute % 60));
                if (GUILayout.Button(paused ? "Resume citizens" : "Pause citizens", GUILayout.Width(150)))
                {
                    paused = !paused;
                    Save();
                }
                foreach (BoulderCitizenState citizen in clock.State.citizens)
                {
                    GUILayout.BeginHorizontal();
                    GUILayout.Label(string.Format("{0} ({1})  {2}  H:{3:0.00} E:{4:0.00}",
                        citizen.displayName, citizen.entityId, citizen.activity,
                        citizen.hunger, citizen.energy), GUILayout.Width(382));
                    if (GUILayout.Button("Focus", GUILayout.Width(68))) Focus(citizen);
                    GUILayout.EndHorizontal();
                    GUILayout.Label(string.Format("  {0:F6} N, {1:F6} E, {2:F1} m WGS84",
                        citizen.pose.latitudeDegrees, citizen.pose.longitudeDegrees,
                        citizen.pose.heightMeters));
                }
            }
            GUILayout.EndArea();
        }

        private void Focus(BoulderCitizenState citizen)
        {
            GeoPose pose = citizen.pose;
            flyCamera.longitudeLatitudeHeight = new double3(
                pose.longitudeDegrees, pose.latitudeDegrees, pose.heightMeters + 100);
            flyCamera.transform.rotation = Quaternion.Euler(90, 0, 0);
        }
    }
}
