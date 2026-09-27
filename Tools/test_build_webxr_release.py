"""Focused release-builder checks; the builder itself runs extracted smoke."""

import importlib.util
import json
from pathlib import Path, PurePosixPath
import tempfile
import unittest


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
