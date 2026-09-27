using System;
using System.Collections.Generic;

namespace ArSandbox.MatrixBoulder
{
    [Serializable]
    public sealed class GeoPose
    {
        public double latitudeDegrees;
        public double longitudeDegrees;
        public double heightMeters;
        public string heightReference;
        public double headingDegrees;

        public GeoPose() { }

        public GeoPose(double latitude, double longitude, double height)
        {
            latitudeDegrees = latitude;
            longitudeDegrees = longitude;
            heightMeters = height;
            heightReference = "WGS84_ELLIPSOID";
        }

        public bool IsValid()
        {
            return !double.IsNaN(latitudeDegrees) && !double.IsInfinity(latitudeDegrees) &&
                !double.IsNaN(longitudeDegrees) && !double.IsInfinity(longitudeDegrees) &&
                !double.IsNaN(heightMeters) && !double.IsInfinity(heightMeters) &&
                !double.IsNaN(headingDegrees) && !double.IsInfinity(headingDegrees) &&
                latitudeDegrees >= -90 && latitudeDegrees <= 90 &&
                longitudeDegrees >= -180 && longitudeDegrees <= 180 &&
                heightReference == "WGS84_ELLIPSOID";
        }

        public static double DistanceMeters(GeoPose a, GeoPose b)
        {
            const double radians = Math.PI / 180.0;
            const double radius = 6378137.0;
            double north = (b.latitudeDegrees - a.latitudeDegrees) * radians * radius;
            double east = (b.longitudeDegrees - a.longitudeDegrees) * radians * radius *
                Math.Cos((a.latitudeDegrees + b.latitudeDegrees) * 0.5 * radians);
            return Math.Sqrt(north * north + east * east);
        }

        // Bounded demonstration routes are under 150 m; the geodetic pose remains authoritative.
        public static GeoPose MoveTowards(GeoPose from, GeoPose to, double meters)
        {
            double distance = DistanceMeters(from, to);
            if (distance < 0.01 || meters >= distance)
                return new GeoPose(to.latitudeDegrees, to.longitudeDegrees, to.heightMeters)
                    { headingDegrees = from.headingDegrees };
            double t = meters / distance;
            double north = to.latitudeDegrees - from.latitudeDegrees;
            double east = (to.longitudeDegrees - from.longitudeDegrees) *
                Math.Cos(from.latitudeDegrees * Math.PI / 180.0);
            return new GeoPose(
                from.latitudeDegrees + north * t,
                from.longitudeDegrees + (to.longitudeDegrees - from.longitudeDegrees) * t,
                from.heightMeters + (to.heightMeters - from.heightMeters) * t)
            {
                headingDegrees = (Math.Atan2(east, north) * 180.0 / Math.PI + 360.0) % 360.0
            };
        }
    }

    [Serializable]
    public sealed class BoulderCitizenState
    {
        public string entityId;
        public string displayName;
        public string homeId;
        public string workId;
        public string targetId;
        public GeoPose pose;
        public float hunger;
        public float energy;
        public string activity;
    }

    [Serializable]
    public sealed class BoulderCitizenSave
    {
        public int schemaVersion;
        public double simulationMinutes;
        public List<BoulderCitizenState> citizens = new List<BoulderCitizenState>();
    }

    /// <summary>A bounded local #29 prototype. It does not depend on camera or rendered tiles.</summary>
    public sealed class BoulderCitizenClock
    {
        private static readonly Dictionary<string, GeoPose> Locations = new Dictionary<string, GeoPose>
        {
            // Hand-authored elevated test points, not sampled from Google tiles or a road network.
            { "home_ada", new GeoPose(40.01500, -105.27065, 1740) },
            { "work_ada", new GeoPose(40.01528, -105.27020, 1740) },
            { "home_sol", new GeoPose(40.01535, -105.27065, 1740) },
            { "work_sol", new GeoPose(40.01494, -105.27012, 1740) },
            { "cafe", new GeoPose(40.01516, -105.27042, 1740) }
        };

        public BoulderCitizenSave State { get; }

        public BoulderCitizenClock(BoulderCitizenSave state)
        {
            if (!IsValid(state)) throw new ArgumentException("Invalid Boulder citizen save", nameof(state));
            State = state;
        }

        public static BoulderCitizenSave CreateSeed()
        {
            return new BoulderCitizenSave
            {
                schemaVersion = 1,
                simulationMinutes = 7 * 60 + 58,
                citizens = new List<BoulderCitizenState>
                {
                    new BoulderCitizenState { entityId = "boulder_ada", displayName = "Ada",
                        homeId = "home_ada", workId = "work_ada", targetId = "home_ada",
                        pose = new GeoPose(40.01500, -105.27065, 1740), hunger = .45f,
                        energy = .9f, activity = "at home" },
                    new BoulderCitizenState { entityId = "boulder_sol", displayName = "Sol",
                        homeId = "home_sol", workId = "work_sol", targetId = "home_sol",
                        pose = new GeoPose(40.01535, -105.27065, 1740), hunger = .65f,
                        energy = .8f, activity = "at home" }
                }
            };
        }

        public static bool IsValid(BoulderCitizenSave state)
        {
            if (state == null || state.schemaVersion != 1 || state.citizens == null ||
                state.citizens.Count < 1 || state.citizens.Count > 8 ||
                double.IsNaN(state.simulationMinutes) || double.IsInfinity(state.simulationMinutes) ||
                state.simulationMinutes < 0 || state.simulationMinutes >= 1440) return false;
            var ids = new HashSet<string>();
            foreach (BoulderCitizenState citizen in state.citizens)
            {
                if (citizen == null || string.IsNullOrWhiteSpace(citizen.entityId) ||
                    !ids.Add(citizen.entityId) || string.IsNullOrWhiteSpace(citizen.displayName) ||
                    !Locations.ContainsKey(citizen.homeId ?? "") ||
                    !Locations.ContainsKey(citizen.workId ?? "") ||
                    !Locations.ContainsKey(citizen.targetId ?? "") ||
                    citizen.pose == null || !citizen.pose.IsValid() ||
                    citizen.pose.latitudeDegrees < 40.014 || citizen.pose.latitudeDegrees > 40.016 ||
                    citizen.pose.longitudeDegrees < -105.272 || citizen.pose.longitudeDegrees > -105.269 ||
                    float.IsNaN(citizen.hunger) || citizen.hunger < 0 || citizen.hunger > 1 ||
                    float.IsNaN(citizen.energy) || citizen.energy < 0 || citizen.energy > 1)
                    return false;
            }
            return true;
        }

        public void Tick(double realSeconds)
        {
            if (realSeconds <= 0 || double.IsNaN(realSeconds) || double.IsInfinity(realSeconds)) return;
            realSeconds = Math.Min(realSeconds, 1.0);
            State.simulationMinutes = (State.simulationMinutes + realSeconds) % 1440.0;
            foreach (BoulderCitizenState citizen in State.citizens)
            {
                bool atCafe = citizen.targetId == "cafe" &&
                    GeoPose.DistanceMeters(citizen.pose, Locations["cafe"]) < 0.5;
                citizen.hunger = Clamp01(citizen.hunger + (float)(realSeconds * (atCafe ? -.05 : .008)));
                citizen.energy = Clamp01(citizen.energy + (float)(realSeconds *
                    (citizen.targetId == citizen.homeId ? .004 : -.002)));

                bool workHours = State.simulationMinutes >= 480 && State.simulationMinutes < 1020;
                string scheduled = workHours && citizen.energy > .2f ? citizen.workId : citizen.homeId;
                citizen.targetId = citizen.hunger >= .8f ||
                    (citizen.targetId == "cafe" && citizen.hunger > .2f)
                    ? "cafe" : scheduled;
                GeoPose destination = Locations[citizen.targetId];
                double remaining = GeoPose.DistanceMeters(citizen.pose, destination);
                if (remaining > .5)
                {
                    citizen.pose = GeoPose.MoveTowards(citizen.pose, destination, 2.0 * realSeconds);
                    citizen.activity = "traveling to " + citizen.targetId;
                }
                else
                {
                    citizen.activity = citizen.targetId == "cafe" ? "eating" :
                        citizen.targetId == citizen.homeId ? "at home" : "at work";
                }
            }
        }

        private static float Clamp01(float value) { return Math.Max(0, Math.Min(1, value)); }
    }
}
