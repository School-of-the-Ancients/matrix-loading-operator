"""Focused release-builder checks; the builder itself runs extracted smoke."""

import importlib.util
import hashlib
import json
from pathlib import Path, PurePosixPath
import tempfile
import unittest
import zipfile
import zlib


SCRIPT = Path(__file__).with_name("Build-WebXR-Release.py")
SPEC = importlib.util.spec_from_file_location("build_webxr_release", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class ReleaseBuilderTests(unittest.TestCase):
    def test_source_allowlist_keeps_owner_and_excludes_private_state(self):
        self.assertTrue(builder.eligible_source(
            PurePosixPath("ControlService/agent_session.py")))
        self.assertTrue(builder.eligible_source(
            PurePosixPath("WebRuntime/src/host_world.js")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("ControlService/scenes/private.json")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("ControlService/test_hosted_world.py")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("WebRuntime/test/fixtures/loopback-test.key")))
        for name in ("preview.png", "source.py", "editable.blend", "model.glb",
                     "README.md"):
            with self.subTest(name=name):
                self.assertFalse(builder.eligible_source(
                    PurePosixPath("WebRuntime/art/examples") / name))

    def test_public_copy_and_manifest_omit_plain_and_compressed_art_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, bundle = root / "source", root / "bundle"
            for name in (*builder.ROOT_FILES, *builder.DOC_FILES,
                         *builder.COMPAT_FILES, "ControlService/server.py",
                         "WebRuntime/src/host_world.js", "WebRuntime/hosted.html",
                         "WebRuntime/package-lock.json"):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("public fixture", encoding="utf-8")
            owner_path = b"C:\\Users\\release-owner\\private-work\\example.blend"
            art = source / "WebRuntime/art"
            art.mkdir()
            (art / "build_example.py").write_bytes(b"SOURCE = r'" + owner_path + b"'")
            (art / "preview.png").write_bytes(b"PNG metadata: " + owner_path)
            compressed = zlib.compress(owner_path)
            self.assertNotIn(owner_path, compressed)
            (art / "editable.blend").write_bytes(b"BLENDER-opaque" + compressed)

            builder.copy_release_source(source, bundle)
            self.assertTrue((bundle / "WebRuntime/src/host_world.js").is_file())
            self.assertFalse((bundle / "WebRuntime/art").exists())
            inventory = builder.add_zip(bundle, root / "public.zip")
            self.assertNotIn("WebRuntime/art/", "\n".join(inventory))
            with zipfile.ZipFile(root / "public.zip") as archive:
                self.assertEqual(set(archive.namelist()), set(inventory))
                self.assertFalse(any(name.startswith("WebRuntime/art/")
                                     for name in archive.namelist()))

    def test_zip_and_extraction_reject_art_added_after_source_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            art = bundle / "WebRuntime/art"
            art.mkdir(parents=True)
            payload = zlib.compress(b"C:\\Users\\release-owner\\private-work")
            (art / "editable.blend").write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "WebRuntime/art"):
                builder.add_zip(bundle, root / "rejected.zip")
            archive_path = root / "foreign.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("WebRuntime/art/editable.blend", payload)
            manifest = {"WebRuntime/art/editable.blend": hashlib.sha256(payload).hexdigest()}
            with self.assertRaisesRegex(ValueError, "WebRuntime/art"):
                builder.verify_extracted(archive_path, manifest, None, 0.1)
            for disguised in ("WebRuntime/Art/editable.blend",
                              "WebRuntime\\art\\editable.blend"):
                with self.subTest(disguised=disguised), self.assertRaisesRegex(
                        ValueError, "WebRuntime/art"):
                    builder.reject_private_art([disguised])

    def test_demo_copies_only_explicit_checkpoint_and_referenced_catalog(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root / "input-assets"
            catalog.mkdir()
            (catalog / "manifest.json").write_text("[]", encoding="utf-8")
            (catalog / "owner-token.txt").write_text("must stay out", encoding="utf-8")
            checkpoint = root / "AdaBo.json"
            checkpoint.write_text(json.dumps({
                "schemaVersion": 1, "hostedWorldId": "AdaBo",
                "world": {"version": 3, "game": None,
                          "scene": {"roomId": "web-virtual-room-v1"},
                          "citizens": {"schemaVersion": 15,
                                       "residents": [{"id": "ada"}, {"id": "bo"}]}},
                "dependencies": []}), encoding="utf-8")
            bundle = root / "bundle"
            self.assertEqual(builder.load_demo(checkpoint, catalog, bundle), "AdaBo")
            self.assertEqual(sorted(p.relative_to(bundle).as_posix()
                                    for p in bundle.rglob("*") if p.is_file()),
                             ["Demo/scenes/world_checkpoints/AdaBo.json",
                              "Demo/web_assets/manifest.json"])
            document = json.loads(checkpoint.read_text(encoding="utf-8"))
            document["ownerToken"] = "secret"
            checkpoint.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "sensitive field"):
                builder.load_demo(checkpoint, catalog, root / "second")

    def test_zip_bytes_and_inventory_are_repeatable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            (bundle / "WebRuntime").mkdir(parents=True)
            (bundle / "WebRuntime" / "hosted.html").write_text("hosted", encoding="utf-8")
            (bundle / "RELEASE-README.md").write_text("read me", encoding="utf-8")
            one, two = root / "one.zip", root / "two.zip"
            self.assertEqual(builder.add_zip(bundle, one), builder.add_zip(bundle, two))
            self.assertEqual(builder.file_digest(one), builder.file_digest(two))


if __name__ == "__main__":
    unittest.main()
