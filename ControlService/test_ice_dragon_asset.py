"""The shipped Blender example crosses the same GLB catalog boundary as other assets."""
from pathlib import Path
import tempfile
import unittest

from web_assets import WebAssetCatalog


DRAGON = Path(__file__).resolve().parent.parent / "WebRuntime" / "art" / "ice-dragon.glb"


class IceDragonAssetTests(unittest.TestCase):
    def test_registered_dragon_has_two_validated_interaction_clips(self):
        with tempfile.TemporaryDirectory() as folder:
            catalog = WebAssetCatalog(folder)
            asset = catalog.register(DRAGON, "Ice Dragon")
            self.assertEqual(asset["assetId"], "web:ice-dragon:2f5620d245e2")
            self.assertEqual([clip["name"] for clip in asset["geometry"]["animationClips"]],
                             ["Flight", "Frost Burst"])
            self.assertEqual(catalog.list(), [asset])
            self.assertEqual(catalog.file(asset["sha256"]).read_bytes(), DRAGON.read_bytes())


if __name__ == "__main__":
    unittest.main()
