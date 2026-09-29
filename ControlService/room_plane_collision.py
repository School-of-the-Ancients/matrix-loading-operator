"""Finite measured-plane intersection for a bounded room-aware object edit.

Only a fresh WebXR snapshot may supply these session-local planes. A plane is
surface evidence, not a reconstruction of furniture or other room occupancy.
"""

import math


_EPSILON = .005
_AREA_EPSILON = 1e-10
_EDGES = ((0, 1), (0, 2), (0, 4), (1, 3), (1, 5), (2, 3),
          (2, 6), (3, 7), (4, 5), (4, 6), (5, 7), (6, 7))


def _rotate(point, rotation, inverse=False):
    x, y, z = point
    angles = [math.radians(rotation[axis]) for axis in ("x", "y", "z")]
    if inverse:
        angles = [-angle for angle in angles]
        order = (0, 1, 2)
    else:
        order = (2, 1, 0)  # Three.js Euler XYZ applies Z, then Y, then X.
    for axis in order:
        cosine, sine = math.cos(angles[axis]), math.sin(angles[axis])
        if axis == 0:
            y, z = y * cosine - z * sine, y * sine + z * cosine
        elif axis == 1:
            x, z = x * cosine + z * sine, -x * sine + z * cosine
        else:
            x, y = x * cosine - y * sine, x * sine + y * cosine
    return x, y, z


def _apply(point, pose):
    scaled = tuple(point[index] * pose["scale"][axis]
                   for index, axis in enumerate(("x", "y", "z")))
    rotated = _rotate(scaled, pose["rotation"])
    return tuple(rotated[index] + pose["position"][axis]
                 for index, axis in enumerate(("x", "y", "z")))


def _inverse(point, pose):
    shifted = tuple(point[index] - pose["position"][axis]
                    for index, axis in enumerate(("x", "y", "z")))
    rotated = _rotate(shifted, pose["rotation"], inverse=True)
    return tuple(rotated[index] / pose["scale"][axis]
                 for index, axis in enumerate(("x", "y", "z")))


def _cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def _orient(a, b, c):
    return _cross((b[0] - a[0], b[1] - a[1]),
                  (c[0] - a[0], c[1] - a[1]))


def _signed_area2(polygon):
    return sum(point[0] * polygon[(index + 1) % len(polygon)][1] -
               polygon[(index + 1) % len(polygon)][0] * point[1]
               for index, point in enumerate(polygon))


def _clean_polygon(boundary):
    points = []
    for point in boundary:
        if not points or math.dist(points[-1], point) >= 1e-9:
            points.append(point)
    if len(points) > 1 and math.dist(points[0], points[-1]) < 1e-9:
        points.pop()
    changed = True
    while changed and len(points) > 3:
        changed = False
        for index, current in enumerate(points):
            previous = points[index - 1]
            following = points[(index + 1) % len(points)]
            between = ((current[0] - previous[0]) *
                       (current[0] - following[0]) +
                       (current[1] - previous[1]) *
                       (current[1] - following[1]) <= 0)
            if abs(_orient(previous, current, following)) < 1e-12 and between:
                points.pop(index)
                changed = True
                break
    return points


def _triangulate(boundary):
    remaining = _clean_polygon(boundary)
    signed = _signed_area2(remaining) if len(remaining) >= 3 else 0
    winding = 1 if signed > 0 else -1 if signed < 0 else 0
    if len(remaining) < 3 or not winding:
        return None
    triangles = []
    while len(remaining) > 3:
        ear = False
        for index, point in enumerate(remaining):
            previous = remaining[index - 1]
            following = remaining[(index + 1) % len(remaining)]
            if winding * _orient(previous, point, following) <= _AREA_EPSILON:
                continue
            contains = any(
                other_index not in ((index - 1) % len(remaining), index,
                                    (index + 1) % len(remaining)) and
                winding * _orient(previous, point, other) >= -_AREA_EPSILON and
                winding * _orient(point, following, other) >= -_AREA_EPSILON and
                winding * _orient(following, previous, other) >= -_AREA_EPSILON
                for other_index, other in enumerate(remaining))
            if contains:
                continue
            triangles.append((previous, point, following))
            remaining.pop(index)
            ear = True
            break
        if not ear:
            return None
    triangles.append(tuple(remaining))
    return triangles


def _clipped_area(triangle, convex):
    signed = _signed_area2(convex)
    winding = 1 if signed > 0 else -1 if signed < 0 else 0
    if not winding:
        return 0
    polygon = list(triangle)
    for index, start in enumerate(convex):
        if not polygon:
            break
        end = convex[(index + 1) % len(convex)]
        source, polygon = polygon, []
        previous = source[-1]
        previous_side = winding * _orient(start, end, previous)
        for point in source:
            side = winding * _orient(start, end, point)
            inside = side >= -_AREA_EPSILON
            was_inside = previous_side >= -_AREA_EPSILON
            if inside != was_inside:
                ratio = previous_side / (previous_side - side)
                polygon.append((previous[0] + ratio * (point[0] - previous[0]),
                                previous[1] + ratio * (point[1] - previous[1])))
            if inside:
                polygon.append(point)
            previous, previous_side = point, side
    return abs(_signed_area2(polygon)) / 2 if len(polygon) >= 3 else 0


def _overlap(section, measured):
    if abs(_signed_area2(section)) / 2 <= _AREA_EPSILON:
        return False
    triangles = _triangulate(measured)
    # Invalid observed geometry is not evidence of safe empty space.
    if triangles is None:
        return True
    return any(_clipped_area(triangle, section) > _AREA_EPSILON
               for triangle in triangles)


def volume_intersects_plane(transform, bounds, spawn_scale, base_pose, plane,
                            *, floor_aligned=False):
    """Whether the oriented asset volume crosses a finite support/wall polygon."""
    surface = plane.get("surface", {})
    if (plane.get("source") != "webxr" or
            surface.get("kind") not in ("support", "wall") or
            not plane.get("roomPose") or len(surface.get("boundary", [])) < 3):
        return False
    size = bounds["size"]
    half = {axis: size[axis] * spawn_scale / 2 for axis in ("x", "y", "z")}
    center_y = (size["y"] / 2 if floor_aligned else bounds["center"]["y"]) * spawn_scale
    corners = []
    for x in (-half["x"], half["x"]):
        for y in (center_y - half["y"], center_y + half["y"]):
            for z in (-half["z"], half["z"]):
                world = _apply(_apply((x, y, z), transform), base_pose)
                corners.append(_inverse(world, plane["roomPose"]))
    heights = [point[1] for point in corners]
    if min(heights) >= -_EPSILON or max(heights) <= _EPSILON:
        return False
    section = []

    def add(point):
        if not any(math.dist(point, existing) < _EPSILON for existing in section):
            section.append(point)

    for i, j in _EDGES:
        a, b = corners[i], corners[j]
        if abs(a[1]) <= _EPSILON:
            add((a[0], a[2]))
        if abs(b[1]) <= _EPSILON:
            add((b[0], b[2]))
        if a[1] * b[1] < 0:
            ratio = a[1] / (a[1] - b[1])
            add((a[0] + (b[0] - a[0]) * ratio,
                 a[2] + (b[2] - a[2]) * ratio))
    if len(section) < 3:
        return False
    cx = sum(point[0] for point in section) / len(section)
    cz = sum(point[1] for point in section) / len(section)
    section.sort(key=lambda point: math.atan2(point[1] - cz, point[0] - cx))
    boundary = [(point["x"], point["z"]) for point in surface["boundary"]]
    return _overlap(section, boundary)


def overlapping_room_plane(transform, asset, base_pose, anchors, excluded_anchor_id):
    """Return only the conflicting plane kind; do not expose private geometry."""
    for plane in anchors:
        if plane["anchorId"] == excluded_anchor_id:
            continue
        if volume_intersects_plane(transform, asset["localBounds"],
                                   asset.get("spawnScale", 1), base_pose, plane,
                                   floor_aligned="sha256" in asset):
            return plane["surface"]["kind"]
    return None
