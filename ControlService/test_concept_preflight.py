"""Configured concept graph values are checked against the live ComfyUI schema."""
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from content_catalog import ContentCatalog, ContentError


def schema(required, output, *, output_node=False):
    return {"input": {"required": required}, "output": output, "output_node": output_node}


class ConceptPreflightTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.graph = {
            "1": {"class_type": "DiffusionModelLoaderKJ",
                  "inputs": {"model_name": "available.safetensors"}},
            "2": {"class_type": "EmptyLatentImage",
                  "inputs": {"width": 512, "height": 512, "batch_size": 1}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "%prompt%"}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "%negative_prompt%"}},
            "5": {"class_type": "KSampler", "inputs": {
                "model": ["1", 0], "latent_image": ["2", 0],
                "positive": ["3", 0], "negative": ["4", 0],
                "seed": "%seed%", "steps": 8}},
            "6": {"class_type": "VAELoader", "inputs": {"vae_name": "vae.safetensors"}},
            "7": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["6", 0]}},
            "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0],
                                                        "filename_prefix": "MatrixConcept"}},
        }
        self.schema = {
            "DiffusionModelLoaderKJ": schema({"model_name": [["available.safetensors"]]}, ["MODEL"]),
            "EmptyLatentImage": schema({"width": ["INT"], "height": ["INT"],
                                        "batch_size": ["INT"]}, ["LATENT"]),
            "CLIPTextEncode": schema({"text": ["STRING"]}, ["CONDITIONING"]),
            "KSampler": schema({"model": ["MODEL"], "latent_image": ["LATENT"],
                                "positive": ["CONDITIONING"], "negative": ["CONDITIONING"],
                                "seed": ["INT"], "steps": ["INT"]}, ["LATENT"]),
            "VAELoader": schema({"vae_name": [["vae.safetensors"]]}, ["VAE"]),
            "VAEDecode": schema({"samples": ["LATENT"], "vae": ["VAE"]}, ["IMAGE"]),
            "SaveImage": schema({"images": ["IMAGE"], "filename_prefix": ["STRING"]},
                                ["IMAGE"], output_node=True),
        }
        (self.root / "graph.json").write_text(json.dumps(self.graph), encoding="utf-8")
        (self.root / "config.json").write_text(json.dumps({"schemaVersion": 1, "providers": [{
            "id": "worker", "type": "comfyui", "enabled": True,
            "baseUrl": "http://127.0.0.1:8188", "workflows": [{
                "id": "image", "path": "graph.json", "localOnly": True,
                "promptNode": "3", "seedNode": "5", "negativePromptNode": "4"}]}]}),
            encoding="utf-8")
        self.catalog = ContentCatalog(self.root / "config.json", self.root / "cache")

    def test_live_schema_precedes_submission_and_parameters_are_replaced(self):
        calls = []
        def response(provider, url, payload=None, **kwargs):
            calls.append((url, payload))
            return self.schema if url.endswith("/object_info") else {"prompt_id": "accepted"}
        with patch.object(self.catalog, "_json_request", side_effect=response):
            job = self.catalog.submit_workflow("worker", "image", "forest", approved=True,
                                               seed=1234, negative_prompt="no cars",
                                               validate_image=True)
        self.assertTrue(calls[0][0].endswith("/object_info"))
        self.assertTrue(calls[1][0].endswith("/prompt"))
        submitted = calls[1][1]["prompt"]
        self.assertEqual(submitted["3"]["inputs"]["text"], "forest")
        self.assertEqual(submitted["4"]["inputs"]["text"], "no cars")
        self.assertEqual(submitted["5"]["inputs"]["seed"], 1234)
        self.assertEqual(job["model"], ["available.safetensors", "vae.safetensors"])
        self.assertEqual(job["seed"], 1234)

    def test_missing_worker_model_blocks_prompt_submission(self):
        self.schema["DiffusionModelLoaderKJ"]["input"]["required"]["model_name"] = [["other.safetensors"]]
        with patch.object(self.catalog, "_json_request", return_value=self.schema) as request:
            with self.assertRaises(ContentError):
                self.catalog.submit_workflow("worker", "image", "forest", approved=True,
                                             seed=1234, negative_prompt="", validate_image=True)
        self.assertEqual(request.call_count, 1)

    def test_panorama_renders_a_two_to_one_latent_without_resizing_source(self):
        calls = []
        def response(provider, url, payload=None, **kwargs):
            calls.append((url, payload))
            return self.schema if url.endswith("/object_info") else {"prompt_id": "accepted"}
        with patch.object(self.catalog, "_json_request", side_effect=response):
            job = self.catalog.submit_workflow("worker", "image", "sunset desert",
                                               approved=True, seed=9, negative_prompt="",
                                               validate_image=True,
                                               panorama=True)
        submitted = calls[1][1]["prompt"]
        self.assertEqual(submitted["2"]["inputs"]["width"], 1024)
        self.assertEqual(submitted["2"]["inputs"]["height"], 512)
        self.assertEqual(job["outputPurpose"], "panorama")
        self.assertEqual((job["outputWidth"], job["outputHeight"]), (1024, 512))
        self.assertNotEqual(job["workflowSha256"], job["submittedGraphSha256"])
        self.assertEqual(job["submittedGraphSha256"], hashlib.sha256(json.dumps(
            submitted, ensure_ascii=False, allow_nan=False, sort_keys=True,
            separators=(",", ":")).encode("utf-8")).hexdigest())
        self.assertEqual(self.graph["2"]["inputs"]["width"], 512)
        self.assertEqual(self.graph["2"]["inputs"]["height"], 512)

    def test_panorama_rejects_ambiguous_graph_before_worker_submission(self):
        graph = dict(self.graph)
        graph["9"] = {"class_type": "EmptyLatentImage", "inputs": {
            "width": 512, "height": 512, "batch_size": 1}}
        (self.root / "graph.json").write_text(json.dumps(graph), encoding="utf-8")
        with patch.object(self.catalog, "_json_request") as request:
            with self.assertRaisesRegex(ContentError, "one single-image latent"):
                self.catalog.submit_workflow("worker", "image", "sunset desert",
                                             approved=True, seed=9, validate_image=True,
                                             panorama=True)
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
