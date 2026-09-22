"""Bounded rendered-image transport validation; images remain PC-session data."""
import base64
import binascii
from datetime import datetime
import math

MAX_IMAGE_BYTES = 512 * 1024
MAX_IMAGE_DIMENSION = 1280
CAPTURE_INTERVAL = 2.0
CAPTURE_TIMEOUT = 15.0
MIXED_CAPTURE_TIMEOUT = 45.0
CAPTURE_MAX_AGE = 30.0


class CaptureError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


def check(condition, message, status=400):
    if not condition:
        raise CaptureError(message, status)


def jpeg_dimensions(raw):
    """Read JPEG frame dimensions without decoding or trusting supplied metadata."""
    check(raw.startswith(b"\xff\xd8") and raw.endswith(b"\xff\xd9"), "Capture is not a complete JPEG")
    offset, dimensions = 2, None
    while offset < len(raw) - 2:
        check(raw[offset] == 255, "Invalid JPEG marker")
        while offset < len(raw) and raw[offset] == 255:
            offset += 1
        check(offset < len(raw), "Truncated JPEG marker")
        marker = raw[offset]
        offset += 1
        if marker == 0xDA:  # compressed scan follows the bounded frame header
            check(dimensions is not None, "JPEG has no supported frame header")
            return dimensions
        check(marker not in (0, 0xD8, 0xD9) and not 0xD0 <= marker <= 0xD7,
              "Invalid JPEG header")
        check(offset + 2 <= len(raw), "Truncated JPEG header")
        length = int.from_bytes(raw[offset:offset + 2], "big")
        check(length >= 2 and offset + length <= len(raw), "Truncated JPEG segment")
        if marker in (0xC0, 0xC1, 0xC2):
            check(length >= 8, "Invalid JPEG frame")
            height = int.from_bytes(raw[offset + 3:offset + 5], "big")
            width = int.from_bytes(raw[offset + 5:offset + 7], "big")
            check(dimensions is None, "Multiple JPEG frames are unsupported")
            dimensions = width, height
        offset += length
    raise CaptureError("JPEG has no image scan")


def number(value, name, low, high):
    check(type(value) in (int, float) and low <= value <= high and math.isfinite(value),
          "Invalid capture " + name)
    return value


def vector(value, name):
    check(isinstance(value, dict), "Invalid capture " + name)
    return {axis: number(value.get(axis), name + "." + axis, -100000, 100000) for axis in "xyz"}


def utc_stamp(value, name):
    check(isinstance(value, str) and len(value) <= 64, "Invalid " + name)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        check(parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0,
              name + " must be UTC")
        return parsed
    except ValueError:
        raise CaptureError("Invalid " + name) from None


def capabilities(value, supported=False):
    if value is None:
        return {"modes": ["virtual"] if supported else [], "device": "Legacy runtime",
                "mixedStatus": "unsupported", "reason": "Update the AR player for Quest 3 camera access.",
                "depthOcclusion": False}
    check(isinstance(value, dict), "Invalid capture capabilities")
    modes = value.get("modes")
    check(isinstance(modes, list) and len(modes) <= 2
          and all(isinstance(mode, str) and mode in ("virtual", "mixed") for mode in modes)
          and len(set(modes)) == len(modes), "Invalid capture modes")
    state = value.get("mixedStatus")
    check(state in ("available", "permission_required", "unsupported", "denied", "error"),
          "Invalid mixed capture status")
    check(value.get("depthOcclusion") is False, "Depth occlusion is not supported by this protocol")
    result = {"modes": list(modes), "mixedStatus": state, "depthOcclusion": False}
    for key, maximum in (("device", 128), ("reason", 1000)):
        entry = value.get(key, "")
        check(isinstance(entry, str) and len(entry) <= maximum and not any(ord(c) < 32 for c in entry),
              "Invalid capture capability " + key)
        result[key] = entry
    check("mixed" not in modes or state != "unsupported", "Conflicting mixed capture capabilities")
    return result


def physical_camera(value, captured_at, width, height, camera):
    check(isinstance(value, dict), "Mixed capture is missing physical camera calibration")
    check(value.get("eye") == "left", "Unsupported physical camera eye")
    exposed = utc_stamp(value.get("frameTimestampUtc"), "physical frame timestamp")
    check(0 <= (captured_at - exposed).total_seconds() <= 1.1,
          "Physical camera frame is stale or newer than the composite")
    age = number(value.get("frameAgeMs"), "physical frame age", 0, 1000)
    check(abs((captured_at - exposed).total_seconds() * 1000 - age) <= 100,
          "Physical frame timestamp and age disagree")
    dims = {}
    for key in ("imageWidth", "imageHeight", "sensorWidth", "sensorHeight"):
        check(type(value.get(key)) is int and 1 <= value[key] <= 8192, "Invalid camera " + key)
        dims[key] = value[key]
    check(abs(width / height - dims["imageWidth"] / dims["imageHeight"]) <= .01,
          "Composite aspect does not match physical camera image")
    intrinsics = value.get("intrinsics")
    check(isinstance(intrinsics, dict), "Camera intrinsics are missing")
    intrinsics = {key: number(intrinsics.get(key), "intrinsics." + key, .001 if key in ("fx", "fy") else 0, 100000)
                  for key in ("fx", "fy", "cx", "cy")}
    check(intrinsics["cx"] <= dims["sensorWidth"] and intrinsics["cy"] <= dims["sensorHeight"],
          "Principal point is outside the sensor")
    pose = value.get("pose")
    check(isinstance(pose, dict), "Physical camera pose is missing")
    pose = {key: vector(pose.get(key), "physicalCamera.pose." + key) for key in ("position", "rotation", "forward")}
    for candidate in (pose, camera):
        check(abs(sum(component ** 2 for component in candidate["forward"].values()) - 1) <= .001,
              "Mixed camera forward must be a unit vector")
    for key in ("position", "forward"):
        check(all(abs(pose[key][axis] - camera[key][axis]) <= .001 for axis in "xyz"),
              "Composite camera does not match the exposure pose")
    check(all(abs((pose["rotation"][axis] - camera["rotation"][axis] + 180) % 360 - 180) <= .01 for axis in "xyz"),
          "Composite camera does not match the exposure rotation")
    projection = value.get("projection")
    check(isinstance(projection, list) and len(projection) == 16, "Physical projection matrix is missing")
    projection = [number(n, "projection", -100000, 100000) for n in projection]
    check(value.get("projectionConvention") == "unity_camera_row_major"
          and value.get("alignment") == "camera_intrinsics_at_exposure", "Unknown camera alignment")
    # Independently derive the SDK's centered sensor crop and Unity frustum.
    # This checks metadata consistency, not real optical calibration or pixels.
    aspect = dims["imageWidth"] / dims["imageHeight"]
    crop_width = min(dims["sensorWidth"], dims["sensorHeight"] * aspect)
    crop_height = min(dims["sensorHeight"], dims["sensorWidth"] / aspect)
    left = (dims["sensorWidth"] - crop_width) / 2
    bottom = (dims["sensorHeight"] - crop_height) / 2
    near, far = camera["nearClip"], camera["farClip"]
    check(far > near, "Mixed camera clipping range is empty")
    expected = [2 * intrinsics["fx"] / crop_width, 0,
                (2 * left + crop_width - 2 * intrinsics["cx"]) / crop_width, 0,
                0, 2 * intrinsics["fy"] / crop_height,
                (2 * bottom + crop_height - 2 * intrinsics["cy"]) / crop_height, 0,
                0, 0, -(far + near) / (far - near), -2 * far * near / (far - near),
                0, 0, -1, 0]
    check(all(math.isclose(actual, wanted, rel_tol=.0001, abs_tol=.0001)
              for actual, wanted in zip(projection, expected)),
          "Physical projection does not match camera intrinsics and clipping planes")
    check(abs(camera["aspect"] - width / height) <= .01
          and abs(camera["fieldOfView"] - math.degrees(2 * math.atan(1 / expected[5]))) <= .01,
          "Composite camera aspect or field of view does not match physical calibration")
    return {"eye": "left", "frameTimestampUtc": value["frameTimestampUtc"], "frameAgeMs": age,
            **dims, "intrinsics": intrinsics, "pose": pose, "projection": projection,
            "projectionConvention": "unity_camera_row_major", "alignment": "camera_intrinsics_at_exposure"}


def spatial_provenance(value):
    check(isinstance(value, dict) and value.get("source") in ("mruk_scene_model_v1", "virtual"),
          "Spatial provenance is missing")
    check(type(value.get("anchorCount")) is int and 0 <= value["anchorCount"] <= 128,
          "Invalid spatial anchor count")
    room = value.get("roomId")
    check(isinstance(room, str) and 0 < len(room) <= 128, "Invalid spatial room ID")
    check(type(value.get("alignmentVerified")) is bool and value.get("depthOcclusion") is False
          and value.get("physicalDepthIncluded") is False, "Unsupported depth or alignment metadata")
    return {key: value[key] for key in ("source", "roomId", "anchorCount", "alignmentVerified",
                                       "depthOcclusion", "physicalDepthIncluded")}


def image(value):
    check(isinstance(value, dict), "Invalid capture result")
    check(value.get("mimeType") == "image/jpeg", "Only JPEG rendered captures are supported")
    encoded = value.get("dataBase64")
    check(isinstance(encoded, str) and 0 < len(encoded) <= 4 * ((MAX_IMAGE_BYTES + 2) // 3),
          "Capture exceeds the 512 KiB image limit", 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise CaptureError("Invalid capture base64") from None
    check(0 < len(raw) <= MAX_IMAGE_BYTES, "Capture exceeds the 512 KiB image limit", 413)
    width, height = jpeg_dimensions(raw)
    check(0 < width <= MAX_IMAGE_DIMENSION and 0 < height <= MAX_IMAGE_DIMENSION,
          "Capture dimensions exceed 1280 pixels", 413)
    check(type(value.get("width")) is int and type(value.get("height")) is int
          and (value["width"], value["height"]) == (width, height), "Capture dimensions do not match JPEG")
    mixed = value.get("source") == "quest_camera_composite"
    check((mixed and value.get("includesPassthrough") is True and value.get("mode") == "mixed")
          or (value.get("source") == "unity_center_eye" and value.get("includesPassthrough") is False
              and value.get("mode", "virtual") in ("virtual", "")),
          "Capture source, mode and physical passthrough disclosure disagree")
    stamp = value.get("capturedAtUtc")
    check(isinstance(stamp, str) and len(stamp) <= 64, "Invalid capture timestamp")
    try:
        parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        check(parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0,
              "Capture timestamp must be UTC")
    except ValueError:
        raise CaptureError("Invalid capture timestamp") from None
    camera = value.get("camera")
    check(isinstance(camera, dict), "Capture camera pose is missing")
    pose = {key: vector(camera.get(key), "camera." + key) for key in ("position", "rotation", "forward")}
    pose["coordinateFrame"] = "unity_world; use snapshot.viewer frames for anchor-relative placement"
    pose["fieldOfView"] = number(camera.get("fieldOfView"), "camera.fieldOfView", 1, 179)
    pose["aspect"] = number(camera.get("aspect"), "camera.aspect", .01, 100)
    pose["nearClip"] = number(camera.get("nearClip"), "camera.nearClip", .0001, 1000)
    pose["farClip"] = number(camera.get("farClip"), "camera.farClip", pose["nearClip"], 100000)
    result = {"mimeType": "image/jpeg", "dataBase64": encoded, "width": width, "height": height,
              "byteLength": len(raw), "capturedAtUtc": stamp, "camera": pose,
              "source": value["source"], "includesPassthrough": mixed}
    if mixed:
        result["mode"] = "mixed"
        result["physicalCamera"] = physical_camera(value.get("physicalCamera"), parsed, width, height, pose)
    provenance = value.get("spatialProvenance")
    check(provenance is None or isinstance(provenance, dict), "Invalid spatial provenance")
    if mixed or provenance and provenance.get("source"):
        result["spatialProvenance"] = spatial_provenance(provenance)
    for key in ("renderMs", "encodeMs", "frameTimeMs"):
        result[key] = number(value.get(key), key, 0, 60000)
    result["captureDurationMs"] = result["renderMs"] + result["encodeMs"]
    if "captureFrameTimeMs" in value:
        result["captureFrameTimeMs"] = number(value["captureFrameTimeMs"], "captureFrameTimeMs", 0, 60000)
    if "frameCount" in value:
        result["frameCount"] = number(value["frameCount"], "frameCount", 0, 2147483647)
    if "capturedAtRuntimeSeconds" in value:
        result["capturedAtRuntimeSeconds"] = number(value["capturedAtRuntimeSeconds"], "capturedAtRuntimeSeconds", 0, 1e12)
    return result


def content_description(snapshot, capture=None):
    if capture and capture.get("includesPassthrough"):
        return ("Physical Quest left-camera photograph composited with virtual objects at its calibrated pose. "
                "MRUK anchors describe the configured room model. No physical depth image or depth occlusion is included; "
                "this is not the headset compositor view. Do not infer exact 3D distances from pixels alone.")
    if (snapshot.get("roomContext") or {}).get("mode") == "ar":
        return "AR virtual content and rendered MRUK debug geometry only. Physical passthrough and physical-room photographs are NOT included."
    return "Virtual scene rendered from the current camera viewpoint. No physical-camera image or passthrough is included."
