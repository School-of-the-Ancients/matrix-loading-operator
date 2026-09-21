"""Bounded rendered-image transport validation; images remain PC-session data."""
import base64
import binascii
from datetime import datetime
import math

MAX_IMAGE_BYTES = 512 * 1024
MAX_IMAGE_DIMENSION = 1280
CAPTURE_INTERVAL = 2.0
CAPTURE_TIMEOUT = 15.0
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
    check(value.get("source") == "unity_center_eye" and value.get("includesPassthrough") is False,
          "Capture must disclose virtual rendering without physical passthrough")
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
              "source": "unity_center_eye", "includesPassthrough": False}
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


def content_description(snapshot):
    if (snapshot.get("roomContext") or {}).get("mode") == "ar":
        return "AR virtual content and rendered MRUK debug geometry only. Physical passthrough and physical-room photographs are NOT included."
    return "Virtual scene rendered from the current camera viewpoint. No physical-camera image or passthrough is included."
