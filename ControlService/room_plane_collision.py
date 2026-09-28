"""Finite measured-plane intersection for a bounded room-aware object edit.

Only a fresh WebXR snapshot may supply these session-local planes. A plane is
surface evidence, not a reconstruction of furniture or other room occupancy.
"""

import math


_EPSILON = .005
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


def _on_boundary(point, polygon):
    for index, a in enumerate(polygon):
        b = polygon[(index + 1) % len(polygon)]
        edge = (b[0] - a[0], b[1] - a[1])
        relative = (point[0] - a[0], point[1] - a[1])
        length_squared = edge[0] ** 2 + edge[1] ** 2
        dot = relative[0] * edge[0] + relative[1] * edge[1]
        if (length_squared > _EPSILON ** 2 and
                abs(_cross(relative, edge)) <= _EPSILON * math.sqrt(length_squared)
                and -_EPSILON <= dot <= length_squared + _EPSILON):
            return True
    return False


def _inside(point, polygon):
    if _on_boundary(point, polygon):
        return False
    inside = False
    for index, a in enumerate(polygon):
        b = polygon[(index + 1) % len(polygon)]
        if ((a[1] > point[1]) != (b[1] > point[1]) and
                point[0] < (b[0] - a[0]) * (point[1] - a[1]) /
                (b[1] - a[1]) + a[0]):
            inside = not inside
    return inside


def _proper_cross(a, b, c, d):
    ab = (b[0] - a[0], b[1] - a[1])
    cd = (d[0] - c[0], d[1] - c[1])
    first = _cross(ab, (c[0] - a[0], c[1] - a[1]))
    second = _cross(ab, (d[0] - a[0], d[1] - a[1]))
    third = _cross(cd, (a[0] - c[0], a[1] - c[1]))
    fourth = _cross(cd, (b[0] - c[0], b[1] - c[1]))
    return first * second < -_EPSILON ** 2 and third * fourth < -_EPSILON ** 2


def _overlap(first, second):
    if any(_inside(point, second) for point in first) or any(
            _inside(point, first) for point in second):
        return True
    centers = [tuple(sum(point[axis] for point in polygon) / len(polygon)
                     for axis in (0, 1)) for polygon in (first, second)]
    if _inside(centers[0], second) or _inside(centers[1], first):
        return True
    return any(_proper_cross(a, first[(i + 1) % len(first)], b,
                             second[(j + 1) % len(second)])
               for i, a in enumerate(first) for j, b in enumerate(second))


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
