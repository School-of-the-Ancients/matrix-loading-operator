using System;
using System.Collections.Generic;
using UnityEngine;

namespace ArSandbox
{
    /// <summary>
    /// Animates the prefab child without changing the placed root or portable scene state.
    /// Configuration is copied; transient animation phases are not persistence authority.
    /// </summary>
    public sealed class SandboxBehaviorVisual : MonoBehaviour
    {
        private Transform visual;
        private Vector3 baselinePosition;
        private Quaternion baselineRotation;
        private BehaviorData rotation;
        private BehaviorData bob;
        private double rotationDegrees;
        private double bobCycles;

        /// <summary>The placed wrapper must have one direct prefab child.</summary>
        public void Configure(List<BehaviorData> behaviors)
        {
            Transform child = visual;
            if (child == null)
            {
                if (transform.childCount != 1)
                    throw new InvalidOperationException("A behavior wrapper requires exactly one prefab child.");
                child = transform.GetChild(0);
            }
            Configure(child, behaviors);
        }

        /// <summary>
        /// Reconfiguration preserves phases for existing kinds, including pause/resume.
        /// Removing a kind resets its contribution and phase. Disabled kinds contribute
        /// nothing while retaining phase, so disabling and pausing remain distinct.
        /// </summary>
        public void Configure(Transform visualChild, List<BehaviorData> behaviors)
        {
            if (visualChild == null || visualChild.parent != transform)
                throw new ArgumentException("The animated visual must be a direct child of the placed root.", nameof(visualChild));

            BehaviorData nextRotation = null;
            BehaviorData nextBob = null;
            if (behaviors != null)
            {
                foreach (BehaviorData item in behaviors)
                {
                    Validate(item);
                    if (item.kind == "rotate")
                    {
                        if (nextRotation != null)
                            throw new ArgumentException("Only one rotate behavior is supported.", nameof(behaviors));
                        nextRotation = Copy(item);
                    }
                    else
                    {
                        if (nextBob != null)
                            throw new ArgumentException("Only one bob behavior is supported.", nameof(behaviors));
                        nextBob = Copy(item);
                    }
                }
            }

            // Capture the authored baseline only when binding a different visual, never
            // from an animated pose during edits, pause/resume, or a root transform change.
            if (visual != visualChild)
            {
                if (visual != null)
                {
                    visual.localPosition = baselinePosition;
                    visual.localRotation = baselineRotation;
                }
                visual = visualChild;
                baselinePosition = visual.localPosition;
                baselineRotation = visual.localRotation;
                rotationDegrees = 0d;
                bobCycles = 0d;
            }
            if (nextRotation == null || rotation == null)
                rotationDegrees = 0d;
            if (nextBob == null || bob == null)
                bobCycles = 0d;
            rotation = nextRotation;
            bob = nextBob;
            ApplyVisual();
        }

        private void Update()
        {
            Tick(Time.deltaTime);
        }

        /// <summary>Deterministic presentation step, also used by Unity runtime checks.</summary>
        public void Tick(float deltaSeconds)
        {
            if (float.IsNaN(deltaSeconds) || float.IsInfinity(deltaSeconds) || deltaSeconds < 0f)
                throw new ArgumentOutOfRangeException(nameof(deltaSeconds), "Animation time must be finite and nonnegative.");
            if (visual == null)
                return;

            if (rotation != null && rotation.enabled && !rotation.paused)
                rotationDegrees = (rotationDegrees + (double)rotation.speedDegreesPerSecond * deltaSeconds) % 360d;
            if (bob != null && bob.enabled && !bob.paused)
                bobCycles = (bobCycles + (double)bob.frequencyHz * deltaSeconds) % 1d;
            ApplyVisual();
        }

        private void ApplyVisual()
        {
            if (visual == null)
                return;

            Vector3 offset = Vector3.zero;
            if (bob != null && bob.enabled)
            {
                // Start at the authored surface position and float upward only. Convert a
                // world-meter displacement into root space so resizing a prop does not
                // multiply the requested height. Parent up is the supporting anchor's
                // normal, even when the placed prop itself has been tilted.
                float height = bob.amplitudeMeters * (0.5f - 0.5f * Mathf.Cos((float)bobCycles * Mathf.PI * 2f));
                Vector3 up = transform.parent == null ? Vector3.up : transform.parent.up;
                offset = transform.InverseTransformVector(up * height);
            }
            visual.localPosition = baselinePosition + offset;
            visual.localRotation = rotation != null && rotation.enabled
                ? baselineRotation * Quaternion.AngleAxis((float)rotationDegrees, Axis(rotation.axis))
                : baselineRotation;
        }

        private static Vector3 Axis(string axis)
        {
            if (axis == "x") return Vector3.right;
            if (axis == "z") return Vector3.forward;
            return Vector3.up;
        }

        private static void Validate(BehaviorData item)
        {
            if (item == null || (item.kind != "rotate" && item.kind != "bob"))
                throw new ArgumentException("Only rotate and bob visual behaviors are supported.");
            if (item.axis != "x" && item.axis != "y" && item.axis != "z")
                throw new ArgumentException("A behavior axis must be x, y, or z.");
            if (!InRange(item.speedDegreesPerSecond, -180f, 180f) ||
                !InRange(item.amplitudeMeters, 0f, 0.25f) ||
                !InRange(item.frequencyHz, 0.05f, 2f))
                throw new ArgumentException("Behavior parameters exceed the supported animation limits.");
        }

        private static bool InRange(float value, float minimum, float maximum)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value) && value >= minimum && value <= maximum;
        }

        private static BehaviorData Copy(BehaviorData item)
        {
            return new BehaviorData
            {
                kind = item.kind,
                enabled = item.enabled,
                paused = item.paused,
                axis = item.axis,
                speedDegreesPerSecond = item.speedDegreesPerSecond,
                amplitudeMeters = item.amplitudeMeters,
                frequencyHz = item.frequencyHz
            };
        }
    }
}
