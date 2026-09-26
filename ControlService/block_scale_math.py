"""Pure local-axis geometry for the built-in Matrix block-scale experiment.

Catalog bounds and acknowledged transform scale are the only inputs. A
renderer, lesson, or agent should consume the resulting observation rather
than calculate a second version of the experiment's display values.
"""
from __future__ import annotations

import math


AXES = ("x", "y", "z")


def _positive_vector(value):
    return (isinstance(value, dict) and set(value) == set(AXES) and
            all(type(value[axis]) in (int, float) and math.isfinite(value[axis])
                and value[axis] > 0 for axis in AXES))


def local_dimensions(bounds, scale):
    """Return local-axis bounding dimensions in metres, if declared.

    The built-in block's transform scale already includes its suggested
    spawnScale in the Unity runtime. WebRuntime's built-in block has
    spawnScale=1. Multiplying catalog spawnScale again would misreport Unity.
    Rotation does not change these local-axis lengths.
    """
    size = bounds.get("size") if isinstance(bounds, dict) else None
    if not _positive_vector(size) or not _positive_vector(scale):
        return None
    dimensions = {axis: size[axis] * scale[axis] for axis in AXES}
    return dimensions if _positive_vector(dimensions) else None


def geometry(baseline_scale, observed_scale, bounds=None):
    """Compute a ratio and optional catalog-bounds box dimensions/volumes."""
    if not _positive_vector(baseline_scale) or not _positive_vector(observed_scale):
        raise ValueError("Scale components must be finite and positive")
    factors = {axis: observed_scale[axis] / baseline_scale[axis] for axis in AXES}
    if not _positive_vector(factors):
        raise ValueError("Relative factors must be finite and positive")
    ratio = math.prod(factors.values())
    if not math.isfinite(ratio):
        raise ValueError("Mathematical volume ratio must be finite")
    baseline = local_dimensions(bounds, baseline_scale)
    observed = local_dimensions(bounds, observed_scale)
    return {"relativeFactors": factors, "mathematicalVolumeRatio": ratio,
            "baselineLocalDimensionsMeters": baseline, "localDimensionsMeters": observed,
            "baselineBoundingVolumeCubicMeters": math.prod(baseline.values()) if baseline else None,
            "boundingVolumeCubicMeters": math.prod(observed.values()) if observed else None}
