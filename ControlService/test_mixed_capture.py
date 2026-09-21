"""Synthetic camera protocol tests. These do not validate Quest 3 optics/hardware."""
import copy
import math
import tempfile
import unittest

import scene_capture
from server import APIError, State
from test_scene_capture import capture_result
from test_room_context import SNAPSHOT
from codex_provider import screenshot_parts


CAPABILITIES = {"modes": ["virtual", "mixed"], "device": "Quest 3",
                "mixedStatus": "permission_required", "reason": "Grant camera permission in the headset.",
                "depthOcclusion": False}


def mixed_result(state):
    value = capture_result(state, mode="mixed", source="quest_camera_composite", includesPassthrough=True)
    value["camera"]["fieldOfView"] = math.degrees(2 * math.atan(.8))
    near, far = value["camera"]["nearClip"], value["camera"]["farClip"]
    value["physicalCamera"] = {"eye": "left", "frameTimestampUtc": "2026-09-21T12:34:55.950Z",
        "frameAgeMs": 50, "imageWidth": 1280, "imageHeight": 1280, "sensorWidth": 1280, "sensorHeight": 1280,
        "intrinsics": {"fx": 800, "fy": 800, "cx": 640, "cy": 640},
        "pose": {key: copy.deepcopy(value["camera"][key]) for key in ("position", "rotation", "forward")},
        "projection": [1.25, 0, 0, 0, 0, 1.25, 0, 0, 0, 0, -(far + near) / (far - near),
                       -2 * far * near / (far - near), 0, 0, -1, 0],
        "projectionConvention": "unity_camera_row_major", "alignment": "camera_intrinsics_at_exposure"}
    value["spatialProvenance"] = {"source": "mruk_scene_model_v1", "roomId": state.latest["scene"]["roomId"],
        "anchorCount": len(state.latest["anchors"]), "alignmentVerified": True,
        "depthOcclusion": False, "physicalDepthIncluded": False}
    return value


class MixedCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 100
        self.state = State(self.temp.name, clock=lambda: self.now)
        self.exchange()

    def exchange(self, **changes):
        body = {"clientId": "quest3", "snapshot": copy.deepcopy(SNAPSHOT), "captureSupported": True,
                "captureCapabilities": copy.deepcopy(CAPABILITIES)}
        body.update(changes)
        return self.state.exchange(body)

    def test_explicit_request_permission_wait_and_paired_physical_metadata(self):
        self.state.request_capture({"mode": "mixed"})
        for _ in range(4):
            self.now += 8
            self.assertEqual(self.exchange()["capture"]["mode"], "mixed")
            self.assertEqual(self.state.capture_status()["status"], "pending")
        self.exchange(capture=mixed_result(self.state))
        result = self.state.capture_status(True)
        self.assertEqual(result["status"], "ready")
        self.assertTrue(result["includesPassthrough"])
        self.assertEqual(result["ageSeconds"], 0)
        self.assertIn("Physical Quest", result["content"])
        metadata, pixels = screenshot_parts(self.state.capture["image"])
        self.assertTrue(pixels)
        self.assertEqual(metadata["physicalCamera"]["intrinsics"]["fx"], 800)
        self.state.save("Mixed")
        self.assertNotIn("physicalCamera", self.state.path("Mixed").read_text())

    def test_pro_and_legacy_never_accept_mixed_requests(self):
        self.exchange(captureCapabilities=None)
        with self.assertRaisesRegex(APIError, "Quest 3"):
            self.state.request_capture({"mode": "mixed"})
        self.state.request_capture({})
        self.exchange(capture=mixed_result(self.state), captureCapabilities=None)
        self.assertEqual(self.state.capture_status()["status"], "error")
        self.assertIn("no fallback", self.state.capture_status()["error"])

    def test_mixed_request_cannot_silently_return_virtual(self):
        self.state.request_capture({"mode": "mixed"})
        self.exchange(capture=capture_result(self.state))
        self.assertIn("no fallback", self.state.capture_status()["error"])

    def test_reject_missing_stale_or_false_camera_metadata(self):
        self.state.request_capture({"mode": "mixed"})
        valid = mixed_result(self.state)
        for mutate in (
            lambda v: v.pop("physicalCamera"),
            lambda v: v["physicalCamera"].update(frameAgeMs=2000),
            lambda v: v["physicalCamera"].update(frameTimestampUtc="2026-09-21T12:34:50Z"),
            lambda v: v["physicalCamera"].update(projection=[0]),
            lambda v: v["physicalCamera"].update(projection=[0] * 16),
            lambda v: v["physicalCamera"]["intrinsics"].update(fx=float("nan")),
            lambda v: v["physicalCamera"]["pose"]["forward"].update(z=0),
            lambda v: v["camera"]["forward"].update(z=0),
            lambda v: v["physicalCamera"]["pose"]["position"].update(x=.1),
            lambda v: v["physicalCamera"]["pose"]["rotation"].update(y=10),
            lambda v: v["physicalCamera"]["pose"]["forward"].update(x=1, z=0),
            lambda v: v["camera"].update(aspect=2),
            lambda v: v["camera"].update(fieldOfView=70),
            lambda v: v["camera"].update(farClip=v["camera"]["nearClip"]),
            lambda v: v["spatialProvenance"].update(physicalDepthIncluded=True),
            lambda v: v.update(spatialProvenance=None),
            lambda v: v.update(includesPassthrough=False),
        ):
            value = copy.deepcopy(valid)
            mutate(value)
            with self.assertRaises(scene_capture.CaptureError):
                scene_capture.image(value)

    def test_capability_and_spatial_data_must_match(self):
        for bad in ({}, {**CAPABILITIES, "depthOcclusion": True}, {**CAPABILITIES, "modes": ["depth"]},
                    {**CAPABILITIES, "modes": [{}]}, {**CAPABILITIES, "modes": [[]]}):
            with self.assertRaises(APIError):
                self.exchange(captureCapabilities=bad)
        self.state.request_capture({"mode": "mixed"})
        value = mixed_result(self.state)
        value["spatialProvenance"]["roomId"] = "different-room"
        self.exchange(capture=value)
        self.assertIn("paired room", self.state.capture_status()["error"])

    def test_false_spatial_provenance_is_acknowledged_without_breaking_heartbeats(self):
        for change in ({"source": "virtual"}, {"alignmentVerified": False}, {"anchorCount": 0}):
            with self.subTest(change=change):
                self.state.request_capture({"mode": "mixed"})
                value = mixed_result(self.state)
                value["spatialProvenance"].update(change)
                response = self.exchange(capture=value)
                self.assertNotIn("capture", response)
                self.assertEqual(self.state.capture_status()["status"], "error")
                self.assertIn("paired room", self.state.capture_status()["error"])
                self.now += 2

    def test_virtual_legacy_null_provenance_and_malformed_objects(self):
        self.state.request_capture({})
        for empty in (None, {}):
            value = capture_result(self.state, spatialProvenance=empty)
            self.assertNotIn("spatialProvenance", scene_capture.image(value))
        for invalid in ([], "mruk", 1):
            with self.subTest(provenance=invalid), self.assertRaises(scene_capture.CaptureError):
                scene_capture.image(capture_result(self.state, spatialProvenance=invalid))

    def test_mixed_request_requires_actual_ar_room_even_with_camera_capability(self):
        virtual = copy.deepcopy(SNAPSHOT)
        virtual["roomContext"].update(mode="white-room", alignmentVerified=False)
        for anchor in virtual["anchors"]:
            anchor.pop("source")
        self.exchange(snapshot=virtual)
        with self.assertRaisesRegex(APIError, "AR runtime"):
            self.state.request_capture({"mode": "mixed"})

    def test_calibrated_center_crop_off_axis_projection_and_float_roundoff(self):
        self.state.request_capture({"mode": "mixed"})
        value = mixed_result(self.state)
        physical = value["physicalCamera"]
        # A square output crops a 1280x960 sensor to its central 960x960.
        physical["sensorHeight"] = 960
        physical["intrinsics"].update(cx=620, cy=460)
        physical["projection"][0] = physical["projection"][5] = 1600 / 960
        physical["projection"][2] = physical["projection"][6] = 40 / 960
        physical["projection"] = [float(format(component, ".7g")) for component in physical["projection"]]
        value["camera"]["fieldOfView"] = math.degrees(2 * math.atan(.6))
        result = scene_capture.image(value)
        self.assertEqual(result["physicalCamera"]["sensorHeight"], 960)
        physical["projection"][2] *= -1
        with self.assertRaisesRegex(scene_capture.CaptureError, "projection"):
            scene_capture.image(value)


if __name__ == "__main__":
    unittest.main()
