"""Catalog integrity checks for publishing Editor preview images."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("preview_publisher", Path(__file__).with_name("Add-Prefab-Previews.py"))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PreviewPublishingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Parser fixture only, not claimed as rendered appearance evidence.
        self.png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x01\x80\x00\x00\x01\x80"
        (self.root / "beacon.png").write_bytes(self.png)
        self.asset_id = "fixture:props:1.0.0:beacon"
        self.pack = dict(assetId="props", version="1.0.0", title="Props", category="objects", format="assetbundle",
                         targetPlatform="Android", sha256="a" * 64, byteLength=100, location="props.bundle",
                         license={"name": "MIT"}, dependencies=[], metadata={"tags": ["prefab-preview", "prefab:" + self.asset_id]})
        self.pack["metadata"]["contentPack"] = dict(schemaVersion=1, providerId="fixture", packId="props", version="1.0.0",
            platform="Android", unityVersion="6000.6.0f1", sha256="a" * 64, byteLength=100,
            assets=[dict(assetId=self.asset_id, prefabPath="assets/beacon.prefab", displayName="Beacon")])
        self.catalog = self.root / "catalog.json"
        self.catalog.write_text(json.dumps({"schemaVersion": 1, "assets": [self.pack]}))
        self.report_data = dict(unityVersion="6000.6.0f1", previews=[dict(assetId=self.asset_id, displayName="Beacon",
            path="beacon.png", prefabPath="Assets/Beacon.prefab", sourceDependencyHash="b" * 32,
            sha256=hashlib.sha256(self.png).hexdigest())])
        self.report = self.root / "preview-report.json"

    def publish(self):
        self.report.write_text(json.dumps(self.report_data))
        return publisher.publish(self.catalog, self.report)

    def test_keeps_tagged_bundle_and_publishes_verified_bytes_idempotently(self):
        result = self.publish()
        self.assertEqual(result["previewCount"], 1)
        document = json.loads(self.catalog.read_text())
        self.assertEqual(document["assets"][0], self.pack)
        image = document["assets"][1]
        self.assertEqual((self.root / image["location"]).read_bytes(), self.png)
        self.assertIn("bundle:" + self.pack["sha256"], image["metadata"]["tags"])
        self.publish()
        self.assertEqual(json.loads(self.catalog.read_text()), document)

    def test_rejects_wrong_source_before_modifying_catalog(self):
        original = self.catalog.read_bytes()
        original_report = copy.deepcopy(self.report_data)
        for field, value in [("unityVersion", "other"), ("prefabPath", "Assets/Different.prefab"), ("sha256", "c" * 64)]:
            self.report_data = copy.deepcopy(original_report)
            if field == "unityVersion":
                self.report_data[field] = value
            else:
                self.report_data["previews"][0][field] = value
            with self.assertRaises(ValueError):
                self.publish()
            self.assertEqual(self.catalog.read_bytes(), original)

    def test_rejects_outside_or_oversized_images(self):
        self.report_data["previews"][0]["path"] = "../outside.png"
        with self.assertRaises(ValueError):
            self.publish()
        self.report_data["previews"][0]["path"] = "beacon.png"
        (self.root / "beacon.png").write_bytes(self.png + bytes(1024 * 1024))
        with self.assertRaises(ValueError):
            self.publish()


if __name__ == "__main__":
    unittest.main()
