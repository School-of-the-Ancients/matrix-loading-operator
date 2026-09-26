"""Independent arithmetic checks for the shared scale calculation."""
from decimal import Decimal
import unittest

import block_scale_math


class BlockScaleMathTests(unittest.TestCase):
    def test_exact_ratios_and_catalog_box_volume(self):
        bounds = {"size": {"x": 1, "y": 1, "z": 1}}
        baseline = {"x": .2, "y": .3, "z": .4}
        for factors in ({"x": 2, "y": 2, "z": 2}, {"x": 2, "y": 3, "z": 4},
                        {"x": .25, "y": 1, "z": 4}):
            with self.subTest(factors=factors):
                observed = {axis: baseline[axis] * factors[axis] for axis in baseline}
                result = block_scale_math.geometry(baseline, observed, bounds)
                independent_ratio = Decimal(str(factors["x"])) * Decimal(str(factors["y"])) * Decimal(str(factors["z"]))
                independent_base = Decimal('.2') * Decimal('.3') * Decimal('.4')
                self.assertAlmostEqual(result["mathematicalVolumeRatio"], float(independent_ratio))
                self.assertAlmostEqual(result["baselineBoundingVolumeCubicMeters"], float(independent_base))
                self.assertAlmostEqual(result["boundingVolumeCubicMeters"], float(independent_base * independent_ratio))
                for axis in baseline:
                    self.assertAlmostEqual(result["localDimensionsMeters"][axis], observed[axis])

    def test_bounds_absence_never_turns_ratio_into_a_physical_measurement(self):
        result = block_scale_math.geometry({"x": 1, "y": 1, "z": 1},
                                           {"x": 2, "y": 3, "z": 4})
        self.assertEqual(result["mathematicalVolumeRatio"], 24)
        self.assertIsNone(result["localDimensionsMeters"])
        self.assertIsNone(result["boundingVolumeCubicMeters"])
        for invalid in (None, {"x": 0, "y": 1, "z": 1},
                        {"x": True, "y": 1, "z": 1}, {"x": float('inf'), "y": 1, "z": 1}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                block_scale_math.geometry(invalid, {"x": 1, "y": 1, "z": 1})


if __name__ == "__main__":
    unittest.main()
