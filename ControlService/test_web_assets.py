"""Check immutable GLB registration and reject external resources."""
import json
from pathlib import Path
import struct
import tempfile
import unittest

from web_assets import WebAssetCatalog, WebAssetError


def glb(external=False):
    vertices = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    indices = struct.pack("<3H", 0, 1, 2)
    binary = vertices + indices + b"\x00\x00"
    document = {"asset": {"version": "2.0"}, "buffers": [{"byteLength": len(binary)}],
                "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36},
                                {"buffer": 0, "byteOffset": 36, "byteLength": 6}],
                "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                              {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}],
                "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
                "nodes": [{"mesh": 0}], "scenes": [{"nodes": [0]}], "scene": 0}
    if external:
        document["images"] = [{"uri": "https://example.invalid/texture.png"}]
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    return struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(encoded), b"JSON") + encoded + struct.pack("<I4s", len(binary), b"BIN\x00") + binary


class WebAssetTests(unittest.TestCase):
    def test_register_and_read_content_addressed_glb(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "triangle.glb"
            source.write_bytes(glb())
            catalog = WebAssetCatalog(Path(directory) / "catalog")
            first = catalog.register(source, "Test Triangle", "Small test mesh")
            second = catalog.register(source, "Test Triangle", "Small test mesh")
            self.assertEqual(first, second)
            self.assertEqual(len(catalog.list()), 1)
            self.assertEqual(catalog.file(first["sha256"]).read_bytes(), source.read_bytes())
            self.assertTrue(first["url"].endswith(first["sha256"] + ".glb"))

    def test_reject_external_texture_uri(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "external.glb"
            source.write_bytes(glb(external=True))
            with self.assertRaisesRegex(WebAssetError, "External"):
                WebAssetCatalog(Path(directory) / "catalog").register(source, "External")

    def test_measured_bounds_and_default_scale_can_update_registered_glb(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "triangle.glb"
            source.write_bytes(glb())
            catalog = WebAssetCatalog(Path(directory) / "catalog")
            first = catalog.register(source, "Test Triangle")
            bounds = {"center": {"x": 0, "y": 0.5, "z": 0},
                      "size": {"x": 1, "y": 1, "z": 1}}
            updated = catalog.register(source, "Test Triangle", spawn_scale=0.5, local_bounds=bounds)
            self.assertEqual(first["assetId"], updated["assetId"])
            self.assertEqual(catalog.list()[0]["localBounds"], bounds)
            self.assertEqual(catalog.list()[0]["spawnScale"], 0.5)
            with self.assertRaisesRegex(WebAssetError, "local bounds"):
                catalog.register(source, "Bad bounds", local_bounds={"center": bounds["center"],
                                                                    "size": {"x": 0, "y": 1, "z": 1}})


if __name__ == "__main__":
    unittest.main()
