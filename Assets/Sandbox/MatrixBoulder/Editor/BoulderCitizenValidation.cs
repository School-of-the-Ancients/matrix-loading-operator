using System;
using UnityEngine;

namespace ArSandbox.MatrixBoulder.Editor
{
    internal static class BoulderCitizenValidation
    {
        public static void Run()
        {
            var seed = BoulderCitizenClock.CreateSeed();
            var clock = new BoulderCitizenClock(seed);
            GeoPose initial = seed.citizens[0].pose;
            bool choseWork = false;
            bool choseCafe = false;
            for (int i = 0; i < 60; i++)
            {
                clock.Tick(1);
                choseWork |= seed.citizens[0].targetId == seed.citizens[0].workId;
                choseCafe |= seed.citizens[0].targetId == "cafe";
            }
            if (GeoPose.DistanceMeters(initial, seed.citizens[0].pose) < 10 ||
                seed.citizens[0].entityId != "boulder_ada" || !choseWork || !choseCafe)
                throw new InvalidOperationException("Citizen did not choose work and food while moving.");

            string json = JsonUtility.ToJson(seed);
            if (!json.Contains("WGS84_ELLIPSOID") || !json.Contains("longitudeDegrees") ||
                json.Contains("localPosition"))
                throw new InvalidOperationException("Citizen save is not a geodetic record.");
            var restored = JsonUtility.FromJson<BoulderCitizenSave>(json);
            if (!BoulderCitizenClock.IsValid(restored) ||
                restored.citizens[0].pose.latitudeDegrees != seed.citizens[0].pose.latitudeDegrees ||
                restored.citizens[0].pose.longitudeDegrees != seed.citizens[0].pose.longitudeDegrees ||
                restored.citizens[0].entityId != seed.citizens[0].entityId)
                throw new InvalidOperationException("Citizen save did not round-trip identity and position.");

            restored.citizens[0].pose.heightReference = "UNKNOWN";
            if (BoulderCitizenClock.IsValid(restored))
                throw new InvalidOperationException("Unknown height reference was accepted.");
            restored.citizens[0].pose.heightReference = null;
            if (BoulderCitizenClock.IsValid(restored))
                throw new InvalidOperationException("Missing height reference was accepted.");
            restored.citizens[0].pose.heightReference = "WGS84_ELLIPSOID";
            restored.schemaVersion = 0;
            if (BoulderCitizenClock.IsValid(restored))
                throw new InvalidOperationException("Missing save schema was accepted.");
            string withoutDatum = json.Replace("\"heightReference\":\"WGS84_ELLIPSOID\",", "");
            if (BoulderCitizenClock.IsValid(JsonUtility.FromJson<BoulderCitizenSave>(withoutDatum)))
                throw new InvalidOperationException("Save without height reference was accepted.");
            Debug.Log("MATRIX_BOULDER_CITIZEN_VALIDATION_OK");
        }
    }
}
