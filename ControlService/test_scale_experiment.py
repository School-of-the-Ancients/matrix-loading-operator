"""Mathematical/result boundary checks for the static experiment recipe."""
import copy
from decimal import Decimal
import math
import unittest

from ai_adapter import PlannerError
import scale_experiment as experiment


def fixture():
    return {"scene": {"schemaVersion": 1, "roomId": "virtual-fixture", "objects": [
        {"objectId": "block-1", "assetId": "block", "anchorId": "floor", "transform": {
            "position": {"x": 2, "y": .3, "z": 1}, "rotation": {"x": 0, "y": 45, "z": 0}, "scale": {"x": .2, "y": .3, "z": .4}}}]},
        "assets": [{"assetId": "block", "displayName": "Terracotta block"}],
        "anchors": [{"anchorId": "floor", "displayName": "Floor"}]}


def intent(factors=None):
    return {"kind": "block-scale", "version": 1, "action": "configure", "objectId": "block-1",
            "factors": factors or {"x": 2, "y": 3, "z": 4}}


def succeeded(plan, snapshot):
    observed = copy.deepcopy(snapshot)
    observed["scene"]["objects"][0]["transform"] = copy.deepcopy(plan["commands"][0]["transform"])
    return {"status": "succeeded", "experiment": copy.deepcopy(plan["experiment"]), "commandIds": ["command-1"],
            "receipts": [{"requestId": "command-1", "ok": True, "objectId": "block-1", "error": ""}],
            "observed": {"revision": 5, "snapshot": observed}}


class ScaleExperimentTests(unittest.TestCase):
    def test_normalized_event_requires_acknowledged_transform_and_uses_catalog_bounds(self):
        snapshot = fixture()
        snapshot["assets"][0]["localBounds"] = {"center": {"x": 0, "y": .5, "z": 0},
                                                 "size": {"x": 1, "y": 1, "z": 1}}
        planned = experiment.plan(intent(), snapshot)
        request = succeeded(planned, snapshot)
        request["requestId"] = "configure-1"
        event = experiment.observed_event(request, session_id="pair-1")
        self.assertEqual(event["eventId"], "pair-1:configure-1:observed")
        self.assertEqual(event["type"], "experiment.block-scale.observed")
        self.assertEqual(event["mathematicalVolumeRatio"], 24)
        self.assertAlmostEqual(event["baselineBoundingVolumeCubicMeters"], .024)
        self.assertAlmostEqual(event["boundingVolumeCubicMeters"], .576)
        self.assertEqual(event["localDimensionsMeters"], planned["commands"][0]["transform"]["scale"])
        self.assertEqual(event["dimensionSource"], "catalog-local-bounds")
        self.assertFalse(event["physicalMeasurement"])
        request["status"] = "ready"
        self.assertIsNone(experiment.observed_event(request, session_id="pair-1"))

    def test_descriptor_is_detached_and_discloses_units_scope_limits_and_authority(self):
        value = experiment.descriptor()
        self.assertEqual(value["supportedRoomModes"], ["white-room"])
        self.assertEqual(value["actions"], ["configure", "reset"])
        self.assertTrue(value["requiresOperatorApply"])
        self.assertIn("not physical", value["result"])
        value["factorBounds"]["maximum"] = 1000
        self.assertEqual(experiment.descriptor()["factorBounds"]["maximum"], 4)

    def test_exact_parameters_apply_to_detached_original_baseline_and_independent_math(self):
        for factors in ({"x": 2, "y": 2, "z": 2}, {"x": 2, "y": 3, "z": 4}, {"x": .25, "y": 1, "z": 4}):
            with self.subTest(factors=factors):
                snapshot = fixture(); original = copy.deepcopy(snapshot)
                value = experiment.plan(intent(factors), snapshot)
                result = experiment.observation(succeeded(value, snapshot))
                self.assertEqual(snapshot, original)
                independent = Decimal(str(factors["x"])) * Decimal(str(factors["y"])) * Decimal(str(factors["z"]))
                self.assertAlmostEqual(result["mathematicalVolumeRatio"], float(independent))
                self.assertFalse(result["physicalMeasurement"])
                self.assertEqual(result["source"], "acknowledged-runtime-transform")
                value["experiment"]["baseline"]["transform"]["scale"]["x"] = 99
                self.assertEqual(snapshot, original)

    def test_proposal_prediction_has_no_observation_until_exact_runtime_evidence(self):
        snapshot = fixture(); planned = experiment.plan(intent(), snapshot)
        result = succeeded(planned, snapshot)
        for state in ("planning", "ready", "queued", "running", "failed", "cancelled", "unconfirmed"):
            value = copy.deepcopy(result); value["status"] = state
            self.assertIsNone(experiment.observation(value))
        changes = [lambda r: r["receipts"][0].update(requestId="unrelated"),
                   lambda r: r["receipts"][0].update(ok=False),
                   lambda r: r["receipts"].append(copy.deepcopy(r["receipts"][0])),
                   lambda r: r["observed"]["snapshot"]["scene"].update(roomId="another-room"),
                   lambda r: r["observed"]["snapshot"]["scene"]["objects"][0].update(assetId="orb"),
                   lambda r: r["observed"]["snapshot"]["scene"]["objects"][0]["transform"]["position"].update(x=3)]
        for change in changes:
            value = copy.deepcopy(result); change(value)
            self.assertIsNone(experiment.observation(value))

    def test_virtual_only_support_and_conflicting_decorative_behavior_reject(self):
        for mutate in (lambda s: s.update(roomContext={"mode": "ar", "state": "ready", "alignmentVerified": True}),
                       lambda s: s["anchors"][0].update(source="mruk"),
                       lambda s: s["scene"]["objects"][0].update(behaviors=[{"kind": "rotate", "enabled": True}]),
                       lambda s: s["assets"][0].update(source={"providerId": "untrusted"}),
                       lambda s: s.update(readOnly=True)):
            snapshot = fixture(); mutate(snapshot); before = copy.deepcopy(snapshot)
            with self.assertRaises(PlannerError): experiment.plan(intent(), snapshot)
            self.assertEqual(snapshot, before)

    def test_ordinary_text_or_caller_supplied_baseline_cannot_enter_recipe(self):
        for change in ({"baseline": {}}, {"commands": []}, {"physicalVolume": 8}, {"kind": "offline-rules"}):
            with self.assertRaises(PlannerError): experiment.validate_intent({**intent(), **change})


if __name__ == "__main__":
    unittest.main()
