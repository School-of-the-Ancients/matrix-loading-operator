"""The Blender MCP example crosses the shipped catalog's GLB boundary."""
from pathlib import Path
import tempfile
import unittest

from web_assets import WebAssetCatalog


ASTROLABE = Path(__file__).resolve().parent.parent / "WebRuntime" / "art" / "copper-astrolabe" / "copper-astrolabe-final.glb"


class CopperAstrolabeAssetTests(unittest.TestCase):
    def test_registered_astrolabe_preserves_validated_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            catalog = WebAssetCatalog(folder)
            asset = catalog.register(ASTROLABE, "Copper Astrolabe")
            self.assertEqual(asset["assetId"], "web:copper-astrolabe:4a239db63c67")
            self.assertEqual(asset["geometry"]["meshes"], 51)
            self.assertEqual(asset["geometry"]["vertices"], 50130)
            self.assertEqual(asset["geometry"]["animationClips"], [])
            self.assertEqual(catalog.file(asset["sha256"]).read_bytes(), ASTROLABE.read_bytes())


if __name__ == "__main__":
    unittest.main()
