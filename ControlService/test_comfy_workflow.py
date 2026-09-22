import copy
import unittest

from content_catalog import ContentError
from comfy_workflow import convert_krea_workflow, validate_api_graph


def fixtures():
    def schema(required, output, output_node=False):
        return {"input": {"required": required}, "output": output, "output_node": output_node}
    info = {
        "VAELoader": schema({"vae_name": [["installed.safetensors"]]}, ["VAE"]),
        "EmptyLatentImage": schema({"width": ["INT", {"min": 8, "max": 4096}], "height": ["INT"], "batch_size": ["INT"]}, ["LATENT"]),
        "VAEDecode": schema({"samples": ["LATENT"], "vae": ["VAE"]}, ["IMAGE"]),
        "SaveImage": schema({"images": ["IMAGE"], "filename_prefix": ["STRING"]}, ["IMAGE"], True),
        "DiffusionModelLoaderKJ": schema({"model_name": [["installed-model.safetensors"]]}, ["MODEL"]),
        "KSampler": schema({"model": ["MODEL"], "latent_image": ["LATENT"], "seed": ["INT", {"control_after_generate": True}], "steps": ["INT", {"min": 1}]}, ["LATENT"]),
    }
    def widget(name):
        return {"name": name, "widget": {"name": name}, "link": None}
    def linked(name, link_id):
        return {"name": name, "link": link_id}
    document = {"nodes": [
        {"id": 1, "type": "VAELoader", "inputs": [widget("vae_name")], "widgets_values": ["installed.safetensors"]},
        {"id": 2, "type": "EmptyLatentImage", "inputs": [widget("width"), widget("height"), widget("batch_size")], "widgets_values": [512, 512, 1]},
        {"id": 3, "type": "VAEDecode", "inputs": [linked("samples", 1), linked("vae", 2)], "widgets_values": []},
        {"id": 4, "type": "SaveImage", "inputs": [linked("images", 3), widget("filename_prefix")], "widgets_values": ["matrix"]},
        {"id": 5, "type": "MarkdownNote", "widgets_values": ["Private explanatory note"]},
    ], "links": [[1, 2, 0, 3, 0, "LATENT"], [2, 1, 0, 3, 1, "VAE"], [3, 3, 0, 4, 0, "IMAGE"]]}
    return document, info


class WorkflowConversionTests(unittest.TestCase):
    def test_known_graph_converts_without_mutating_original(self):
        document, info = fixtures()
        original = copy.deepcopy(document)
        graph, report = convert_krea_workflow(document, info)
        self.assertEqual(original, document)
        self.assertEqual(["2", 0], graph["3"]["inputs"]["samples"])
        self.assertEqual([5], report["removedNonExecutableNoteIds"])
        self.assertNotIn("Private", str(report))
        self.assertTrue(validate_api_graph(graph, info))

    def test_missing_model_enum_is_rejected(self):
        document, info = fixtures()
        document["nodes"][0]["widgets_values"][0] = "missing-model.safetensors"
        with self.assertRaisesRegex(ContentError, "unavailable"):
            convert_krea_workflow(document, info)

    def test_unknown_node_or_widget_layout_is_not_guessed(self):
        document, info = fixtures()
        document["nodes"][0]["widgets_values"].append("unexpected custom widget")
        with self.assertRaisesRegex(ContentError, "Unmapped"):
            convert_krea_workflow(document, info)
        document, info = fixtures()
        document["nodes"][0]["type"] = "UnknownCustomNode"
        with self.assertRaisesRegex(ContentError, "unsupported"):
            convert_krea_workflow(document, info)

    def test_link_types_and_target_slots_are_validated(self):
        document, info = fixtures()
        document["links"][0][1] = 1
        with self.assertRaisesRegex(ContentError, "type mismatch"):
            convert_krea_workflow(document, info)
        document, info = fixtures()
        document["links"][0][4] = 1
        with self.assertRaisesRegex(ContentError, "target"):
            convert_krea_workflow(document, info)

    def test_required_inputs_and_numeric_bounds_are_checked(self):
        document, info = fixtures()
        document["nodes"][1]["widgets_values"][0] = 999999
        with self.assertRaisesRegex(ContentError, "outside"):
            convert_krea_workflow(document, info)
        document, info = fixtures()
        graph, _ = convert_krea_workflow(document, info)
        del graph["2"]["inputs"]["batch_size"]
        with self.assertRaisesRegex(ContentError, "Missing required"):
            validate_api_graph(graph, info)

    def test_output_and_cycles_are_checked(self):
        document, info = fixtures()
        graph, _ = convert_krea_workflow(document, info)
        graph["4"]["inputs"]["images"] = ["4", 0]
        with self.assertRaisesRegex(ContentError, "cycle"):
            validate_api_graph(graph, info)
        graph["4"]["inputs"]["images"] = ["3", 0]
        info["SaveImage"]["output_node"] = False
        with self.assertRaisesRegex(ContentError, "no output"):
            validate_api_graph(graph, info)

    def test_disabled_lora_and_seed_control_have_explicit_conversion(self):
        document, info = fixtures()
        document["nodes"].extend([
            {"id": 6, "type": "DiffusionModelLoaderKJ", "inputs": [{"name": "model_name", "widget": {"name": "model_name"}}], "widgets_values": ["installed-model.safetensors"]},
            {"id": 7, "type": "Power Lora Loader (rgthree)", "inputs": [{"name": "model", "link": 4}],
             "widgets_values": [{}, {"type": "PowerLoraLoaderHeaderWidget"}, {"lora": "unused", "on": False}, ""]},
            {"id": 8, "type": "KSampler", "inputs": [{"name": "model", "link": 5}, {"name": "latent_image", "link": 6},
             {"name": "seed", "widget": {"name": "seed"}}, {"name": "steps", "widget": {"name": "steps"}}], "widgets_values": [42, "fixed", 4]},
        ])
        document["links"][0][1] = 8
        document["links"].extend([[4, 6, 0, 7, 0, "MODEL"], [5, 7, 0, 8, 0, "MODEL"], [6, 2, 0, 8, 1, "LATENT"]])
        graph, report = convert_krea_workflow(document, info)
        self.assertEqual(["6", 0], graph["8"]["inputs"]["model"])
        self.assertEqual(4, graph["8"]["inputs"]["steps"])
        self.assertEqual([7], report["bypassedDisabledLoraIds"])
        document["nodes"][6]["widgets_values"][2]["on"] = True
        with self.assertRaisesRegex(ContentError, "Enabled"):
            convert_krea_workflow(document, info)

    def test_worker_combo_options_are_validated(self):
        document, info = fixtures()
        info["VAELoader"]["input"]["required"]["vae_name"] = ["COMBO", {"options": ["installed.safetensors"]}]
        self.assertTrue(convert_krea_workflow(document, info)[0])
        info["VAELoader"]["input"]["required"]["vae_name"][1]["options"] = []
        with self.assertRaisesRegex(ContentError, "combo"):
            convert_krea_workflow(document, info)


if __name__ == "__main__":
    unittest.main()
