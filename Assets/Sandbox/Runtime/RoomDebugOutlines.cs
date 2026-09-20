using System.Collections.Generic;
using Meta.XR.MRUtilityKit;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace ArSandbox
{
    /// <summary>Read-only visualization of configured scene geometry, never a replacement room.</summary>
    public sealed class RoomDebugOutlines : MonoBehaviour
    {
        private readonly List<GameObject> visuals = new List<GameObject>();
        private readonly List<Transform> labels = new List<Transform>();
        private readonly Dictionary<Color, Material> lineMaterials = new Dictionary<Color, Material>();
        private Material materialTemplate;
        private Transform viewer;
        public bool Visible { get; private set; } = true;

        public void ShowRoom(MRUKRoom room, Transform head, Material material)
        {
            Clear();
            viewer = head;
            if (room == null || material == null) return;
            materialTemplate = material;
            foreach (var anchor in room.Anchors)
            {
                if (anchor == null || (!anchor.PlaneRect.HasValue && !anchor.VolumeBounds.HasValue)) continue;
                var root = new GameObject("Room outline " + anchor.Label);
                root.transform.SetParent(anchor.transform, false);
                visuals.Add(root);
                Color color = ColorFor(anchor.Label);
                if (anchor.PlaneRect.HasValue)
                {
                    var points = new List<Vector3>();
                    if (anchor.PlaneBoundary2D != null && anchor.PlaneBoundary2D.Count >= 3)
                        foreach (Vector2 point in anchor.PlaneBoundary2D) points.Add(new Vector3(point.x, point.y, .002f));
                    else
                    {
                        Rect rect = anchor.PlaneRect.Value;
                        points.Add(new Vector3(rect.xMin, rect.yMin, .002f));
                        points.Add(new Vector3(rect.xMax, rect.yMin, .002f));
                        points.Add(new Vector3(rect.xMax, rect.yMax, .002f));
                        points.Add(new Vector3(rect.xMin, rect.yMax, .002f));
                    }
                    AddLine(root.transform, points.ToArray(), color, true);
                }
                if (anchor.VolumeBounds.HasValue)
                {
                    Bounds bounds = anchor.VolumeBounds.Value;
                    var corners = new Vector3[8];
                    for (int index = 0; index < 8; index++) corners[index] = new Vector3(
                        (index & 1) == 0 ? bounds.min.x : bounds.max.x,
                        (index & 2) == 0 ? bounds.min.y : bounds.max.y,
                        (index & 4) == 0 ? bounds.min.z : bounds.max.z);
                    // Three line strips draw all twelve edges without allocating in Update.
                    AddLine(root.transform, new[] { corners[0], corners[1], corners[3], corners[2], corners[0], corners[4], corners[5], corners[7], corners[6], corners[4] }, color, false);
                    AddLine(root.transform, new[] { corners[1], corners[5] }, color, false);
                    AddLine(root.transform, new[] { corners[2], corners[6], corners[7], corners[3] }, color, false);
                }
                AddLabel(root.transform, anchor, color);
                root.SetActive(Visible);
            }
        }

        public void SetVisible(bool visible)
        {
            Visible = visible;
            foreach (GameObject visual in visuals) if (visual != null) visual.SetActive(visible);
        }

        public void Clear()
        {
            foreach (GameObject visual in visuals) if (visual != null) Destroy(visual);
            visuals.Clear(); labels.Clear();
            foreach (Material material in lineMaterials.Values) if (material != null) Destroy(material);
            lineMaterials.Clear();
            materialTemplate = null;
        }

        private void AddLine(Transform parent, Vector3[] points, Color color, bool loop)
        {
            var line = new GameObject("Configured boundary").AddComponent<LineRenderer>();
            line.transform.SetParent(parent, false);
            line.useWorldSpace = false;
            line.loop = loop;
            if (!lineMaterials.TryGetValue(color, out var material))
            {
                material = new Material(materialTemplate) { color = color };
                // The sandbox uses Standard materials, whose color does not consume
                // LineRenderer vertex colors. Four shared semantic materials suffice.
                if (material.HasProperty("_EmissionColor"))
                {
                    material.EnableKeyword("_EMISSION");
                    material.SetColor("_EmissionColor", color);
                }
                lineMaterials.Add(color, material);
            }
            line.sharedMaterial = material;
            line.startColor = line.endColor = color;
            line.startWidth = line.endWidth = .006f;
            line.positionCount = points.Length;
            line.SetPositions(points);
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
        }

        private void AddLabel(Transform parent, MRUKAnchor anchor, Color color)
        {
            var labelObject = new GameObject("Semantic label", typeof(Canvas));
            labelObject.transform.SetParent(parent, false);
            labelObject.transform.position = anchor.GetAnchorCenter() + Vector3.up * .07f;
            labelObject.transform.localScale = Vector3.one * .001f;
            ((RectTransform)labelObject.transform).sizeDelta = new Vector2(460, 105);
            var canvas = labelObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = viewer != null ? viewer.GetComponent<Camera>() : null;
            var panel = new GameObject("Label background", typeof(Image));
            panel.transform.SetParent(labelObject.transform, false);
            Stretch((RectTransform)panel.transform);
            var background = panel.GetComponent<Image>();
            background.color = new Color(.015f, .02f, .03f, .88f);
            background.raycastTarget = false;
            var textObject = new GameObject("Label", typeof(Text));
            textObject.transform.SetParent(labelObject.transform, false);
            Stretch((RectTransform)textObject.transform);
            var text = textObject.GetComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = 26;
            text.alignment = TextAnchor.MiddleCenter;
            text.color = color;
            text.supportRichText = false;
            text.raycastTarget = false;
            string id = anchor.Anchor.Uuid.ToString("D");
            string dimensions = anchor.VolumeBounds.HasValue ? anchor.VolumeBounds.Value.size.ToString("F2") + " m" :
                anchor.PlaneRect.Value.width.ToString("F2") + " × " + anchor.PlaneRect.Value.height.ToString("F2") + " m";
            text.text = anchor.Label + "  [" + id.Substring(0, 8) + "]\n" + dimensions;
            labels.Add(labelObject.transform);
        }

        private void LateUpdate()
        {
            if (!Visible || viewer == null) return;
            foreach (Transform label in labels)
            {
                if (label == null) continue;
                Vector3 direction = label.position - viewer.position;
                if (direction.sqrMagnitude > .001f) label.rotation = Quaternion.LookRotation(direction, Vector3.up);
            }
        }

        private static Color ColorFor(MRUKAnchor.SceneLabels label)
        {
            if ((label & MRUKAnchor.SceneLabels.FLOOR) != 0) return new Color(.15f, 1f, .55f);
            if ((label & (MRUKAnchor.SceneLabels.WALL_FACE | MRUKAnchor.SceneLabels.INVISIBLE_WALL_FACE | MRUKAnchor.SceneLabels.INNER_WALL_FACE)) != 0)
                return new Color(.2f, .75f, 1f);
            if ((label & MRUKAnchor.SceneLabels.CEILING) != 0) return new Color(.9f, .6f, 1f);
            return new Color(1f, .75f, .2f);
        }

        private static void Stretch(RectTransform rect)
        {
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero; rect.offsetMax = Vector2.zero;
        }

        private void OnDestroy() => Clear();
    }
}
