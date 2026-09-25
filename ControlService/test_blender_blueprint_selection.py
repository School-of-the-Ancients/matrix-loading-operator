"""Blender blueprint CLI selection remains data-only and uses the chosen Codex settings."""
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from blender_blueprint import design_blueprint
from codex_provider import CodexConfig


class BlenderBlueprintSelectionTests(unittest.TestCase):
    def test_selected_model_and_reasoning_reach_the_bounded_codex_call(self):
        recipe = {"name": "Test Cube", "parts": [{"kind": "cube", "name": "Body",
                  "location": [0, 0, .5], "rotation": [0, 0, 0], "dimensions": [1, 1, 1],
                  "color": "#336699", "metallic": 0, "roughness": .7, "emission": 0}]}
        calls = []
        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            Path(args[args.index("--output-last-message") + 1]).write_text(json.dumps(recipe), encoding="utf-8")
            return SimpleNamespace(returncode=0)
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / "codex.exe"
            executable.write_bytes(b"MZfixture")
            config = CodexConfig(str(executable), model="operator-model", reasoning_effort="high")
            with patch("blender_blueprint.subprocess.run", side_effect=fake_run):
                result = design_blueprint("Create a cube", config=config)
        self.assertEqual(result, recipe)
        args, kwargs = calls[0]
        self.assertEqual(args[args.index("--model") + 1], "operator-model")
        self.assertIn('model_reasoning_effort="high"', args)
        self.assertIn("--output-schema", args)
        self.assertIn("--sandbox", args)
        self.assertIn("read-only", args)
        self.assertIn('web_search="disabled"', args)
        self.assertEqual(kwargs["timeout"], 180)


if __name__ == "__main__":
    unittest.main()
