"""Offline checks for the full-library selection and catalog handoff."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mirror = load("mirror_polyhaven", "Mirror-PolyHaven.py")
catalog = load("catalog_polyhaven", "Build-PolyHaven-Catalog.py")


def descriptor(category, filename, payload=b"source"):
    return {"size": len(payload), "md5": hashlib.md5(payload).hexdigest(),
            "url": "https://dl.polyhaven.org/file/ph-assets/" + category + "/1k/" + filename}


class LibraryTests(unittest.TestCase):
    def test_quest_sized_hdri_and_texture_selection(self):
        hdr = descriptor("HDRIs", "sky_1k.hdr")
        self.assertEqual(("1k", [mirror.model.source_file(hdr, "HDRIs")]),
                         mirror.selected_files(0, {"hdri": {"1k": {"hdr": hdr}}}))
        jpg = descriptor("Textures", "stone_diff_1k.jpg")
        png = descriptor("Textures", "stone_diff_1k.png")
        resolution, selected = mirror.selected_files(1, {"Diffuse": {"1k": {"jpg": jpg, "png": png}}})
        self.assertEqual("1k", resolution)
        self.assertEqual("stone_diff_1k.jpg", selected[0]["filename"])
        with self.assertRaises(mirror.model.PreparationError):
            mirror.model.source_file(descriptor("Models", "evil.fbx"), "HDRIs")

    def test_resume_checks_digest_and_filename(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = b"source"
            item = {"filename": "sky.hdr", "byteLength": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
            (root / "sky.hdr").write_bytes(payload)
            manifest = root / "polyhaven-source.json"
            manifest.write_text(json.dumps({"files": [item]}), encoding="utf-8")
            self.assertTrue(mirror.verified_manifest(manifest))
            (root / "sky.hdr").write_bytes(b"tamper")
            self.assertFalse(mirror.verified_manifest(manifest))
            item["filename"] = ".."
            manifest.write_text(json.dumps({"files": [item]}), encoding="utf-8")
            self.assertFalse(mirror.verified_manifest(manifest))

    def test_combined_catalog_preserves_pack_and_category(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "polyhaven-index.json").write_text(json.dumps({"sky": {"type": 0, "name": "Sunrise Sky", "tags": ["outdoor"]}}), encoding="utf-8")
            pack_dir = root / "Packs" / "Android" / "sky"
            pack_dir.mkdir(parents=True)
            payload = b"bundle"
            (pack_dir / "sky.bundle").write_bytes(payload)
            pack = {"schemaVersion": 1, "providerId": "polyhaven", "packId": "sky-pack", "version": "v1",
                    "platform": "Android", "sha256": hashlib.sha256(payload).hexdigest(), "byteLength": len(payload)}
            row = {"assetId": "sky-pack", "version": "v1", "title": "old", "category": "objects", "format": "assetbundle",
                   "targetPlatform": "Android", "sha256": pack["sha256"], "byteLength": len(payload), "location": "sky.bundle",
                   "metadata": {"contentPack": pack}}
            (pack_dir / "catalog.json").write_text(json.dumps({"schemaVersion": 1, "assets": [row]}), encoding="utf-8")
            result = catalog.build(root, "Android")
            self.assertEqual(1, result["readyPrefabs"])
            combined = json.loads((root / "Packs" / "Android" / "catalog.json").read_text(encoding="utf-8"))
            self.assertEqual("environments", combined["assets"][0]["category"])
            self.assertEqual("sky/sky.bundle", combined["assets"][0]["location"])
            self.assertEqual("Sunrise Sky", combined["assets"][0]["title"])


if __name__ == "__main__":
    unittest.main()
