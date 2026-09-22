"""Strict conversion of the reviewed Krea image workflow, not a UI graph executor.

Conversion uses the worker's live /object_info schema, preserves the input, and
rejects unfamiliar/custom widget layouts rather than guessing their meaning.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math

from content_catalog import ContentError, require

SUPPORTED_IMAGE_NODES = {"VAELoader", "KSampler", "EmptyLatentImage", "VAEDecode", "SaveImage",
                         "DiffusionModelLoaderKJ", "ResolutionSelector", "CLIPTextEncode", "CLIPLoader"}
DISABLED_LORA = "Power Lora Loader (rgthree)"


def _input_schema(schema):
    require(isinstance(schema, dict) and isinstance(schema.get("input"), dict), "Missing worker input schema")
    return {**schema["input"].get("required", {}), **schema["input"].get("optional", {})}


def validate_api_graph(graph, object_info, allowed_nodes=SUPPORTED_IMAGE_NODES):
    require(isinstance(graph, dict) and 0 < len(graph) <= 64, "Invalid API workflow node count")
    dependencies = {}
    has_output = False
    for node_id, node in graph.items():
        require(isinstance(node_id, str) and node_id.isdigit() and isinstance(node, dict), "Invalid API workflow node")
        kind = node.get("class_type")
        require(isinstance(kind, str) and kind in allowed_nodes and kind in object_info, "Workflow uses an unsupported or unavailable node")
        schema = object_info[kind]
        spec = _input_schema(schema)
        values = node.get("inputs")
        require(isinstance(values, dict) and set(values) <= set(spec), "Unknown workflow inputs")
        require(set(schema["input"].get("required", {})) <= set(values), "Missing required workflow input")
        has_output = has_output or schema.get("output_node") is True
        dependencies[node_id] = []
        for name, value in values.items():
            definition = spec[name]
            require(isinstance(definition, list) and definition, "Invalid worker input definition")
            kind_or_options = definition[0]
            options = definition[1] if len(definition) > 1 and isinstance(definition[1], dict) else {}
            if isinstance(value, list):
                require(len(value) == 2 and isinstance(value[0], str) and type(value[1]) is int,
                        "Invalid API graph connection")
                upstream = graph.get(value[0])
                require(isinstance(upstream, dict) and upstream.get("class_type") in object_info, "Missing upstream workflow node")
                outputs = object_info[upstream["class_type"]].get("output", [])
                require(0 <= value[1] < len(outputs), "Invalid upstream output socket")
                require(isinstance(kind_or_options, str) and outputs[value[1]] == kind_or_options, "Workflow connection type mismatch")
                dependencies[node_id].append(value[0])
                continue
            require(not options.get("forceInput"), "Worker requires a connected input")
            if isinstance(kind_or_options, list):
                require(value in kind_or_options, "Workflow model or enum value is unavailable on this worker")
            elif kind_or_options == "COMBO":
                require(isinstance(options.get("options"), list) and value in options["options"], "Workflow combo value is unavailable on this worker")
            elif kind_or_options in ("INT", "FLOAT"):
                require(type(value) is int if kind_or_options == "INT" else type(value) in (int, float), "Invalid numeric workflow input")
                require(math.isfinite(value) and options.get("min", -math.inf) <= value <= options.get("max", math.inf), "Workflow numeric input is outside worker limits")
            elif kind_or_options == "BOOLEAN":
                require(type(value) is bool, "Invalid boolean workflow input")
            elif kind_or_options == "STRING":
                require(isinstance(value, str) and len(value) <= 8192, "Invalid text workflow input")
            else:
                raise ContentError(400, "Non-widget workflow inputs must be connected")
    require(has_output, "Workflow has no output node")
    visiting, visited = set(), set()

    def visit(node_id):
        require(node_id not in visiting, "Workflow contains a cycle")
        if node_id in visited:
            return
        visiting.add(node_id)
        for upstream in dependencies[node_id]:
            visit(upstream)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in graph:
        visit(node_id)
    return True


def convert_krea_workflow(document, object_info):
    require(isinstance(document, dict) and isinstance(object_info, dict), "Invalid workflow conversion inputs")
    raw_nodes, raw_links = document.get("nodes"), document.get("links")
    require(isinstance(raw_nodes, list) and 0 < len(raw_nodes) <= 64 and isinstance(raw_links, list)
            and len(raw_links) <= 256, "Invalid saved UI workflow")
    nodes, links = {}, {}
    for node in raw_nodes:
        require(isinstance(node, dict) and type(node.get("id")) is int, "Invalid UI workflow node")
        require(node["id"] not in nodes, "Duplicate UI node id")
        require(isinstance(node.get("type"), str), "Invalid UI node type")
        require(node.get("mode", 0) == 0, "Muted or bypassed UI nodes require a deliberate API export")
        nodes[node["id"]] = node
    for link in raw_links:
        require(isinstance(link, list) and len(link) == 6 and all(type(value) is int for value in link[:5]), "Invalid UI workflow link")
        require(link[0] not in links and link[1] in nodes and link[3] in nodes, "Duplicate or dangling UI link")
        inputs = nodes[link[3]].get("inputs", [])
        require(0 <= link[4] < len(inputs) and inputs[link[4]].get("link") == link[0], "UI link target does not match its input")
        links[link[0]] = link
    removed_notes, bypasses, controls = [], {}, []
    for node_id, node in nodes.items():
        if node.get("type") == "MarkdownNote":
            require(not any(link[1] == node_id or link[3] == node_id for link in raw_links), "Notes cannot participate in executable connections")
            removed_notes.append(node_id)
        elif node.get("type") == DISABLED_LORA:
            widgets = node.get("widgets_values")
            require(isinstance(widgets, list), "Invalid dynamic LoRA widget layout")
            loras = [widget for widget in widgets if isinstance(widget, dict) and "lora" in widget]
            require(loras and all(widget.get("on") is False for widget in loras), "Enabled or ambiguous dynamic LoRA widgets need an explicit API export")
            require(all(isinstance(widget, dict) and (not widget or "lora" in widget or widget == {"type": "PowerLoraLoaderHeaderWidget"})
                        or widget == "" for widget in widgets), "Unknown dynamic LoRA widget layout")
            model_input = next((item for item in node.get("inputs", []) if item.get("name") == "model"), {})
            incoming = links.get(model_input.get("link"))
            require(incoming is not None and incoming[5] == "MODEL", "Disabled LoRA passthrough requires a connected model")
            require(all(link[2] == 0 and link[5] == "MODEL" for link in raw_links if link[1] == node_id), "Disabled LoRA clip output is not supported by this converter")
            bypasses[node_id] = (incoming[1], incoming[2])
        else:
            require(node.get("type") in SUPPORTED_IMAGE_NODES and node["type"] in object_info, "Workflow contains an unsupported or unavailable executable node")

    def resolve_link(link):
        source, socket = link[1], link[2]
        seen = set()
        while source in bypasses:
            require(source not in seen and socket == 0, "Invalid disabled-LoRA passthrough cycle")
            seen.add(source)
            source, socket = bypasses[source]
        return [str(source), socket]

    graph = {}
    for node_id, node in nodes.items():
        if node_id in removed_notes or node_id in bypasses:
            continue
        kind = node["type"]
        spec = _input_schema(object_info[kind])
        ui_inputs = node.get("inputs", [])
        widgets = node.get("widgets_values", [])
        require(isinstance(ui_inputs, list) and isinstance(widgets, list), "Invalid UI input/widget layout")
        result, cursor = {}, 0
        seen_inputs = set()
        for ui_input in ui_inputs:
            name = ui_input.get("name")
            require(name in spec and name not in seen_inputs, "Unknown or duplicate UI input")
            seen_inputs.add(name)
            if ui_input.get("widget") is not None:
                require(ui_input["widget"].get("name") == name and cursor < len(widgets), "UI widget count or identity mismatch")
                result[name] = copy.deepcopy(widgets[cursor])
                cursor += 1
                definition = spec[name]
                options = definition[1] if len(definition) > 1 and isinstance(definition[1], dict) else {}
                if options.get("control_after_generate"):
                    require(cursor < len(widgets) and widgets[cursor] in ("fixed", "increment", "decrement", "randomize"), "Unknown seed control widget")
                    controls.append({"nodeId": node_id, "input": name, "control": widgets[cursor]})
                    cursor += 1
            if ui_input.get("link") is not None:
                link = links.get(ui_input["link"])
                require(link is not None, "UI input references a missing link")
                result[name] = resolve_link(link)
        require(cursor == len(widgets), "Unmapped UI widgets require a deliberate API export")
        graph[str(node_id)] = {"class_type": kind, "inputs": result}
    validate_api_graph(graph, object_info)
    report = {"schemaVersion": 1, "converter": "reviewed-krea-image-v1", "inputUnchanged": True,
              "sourceCanonicalSha256": hashlib.sha256(json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest(),
              "removedNonExecutableNoteIds": removed_notes, "bypassedDisabledLoraIds": list(bypasses),
              "omittedUiSeedControls": controls, "apiNodeCount": len(graph),
              "limitations": ["Only reviewed image node types are supported.", "Disabled LoRA nodes are model passthrough only.",
                              "Worker schemas validate installed names; generation must still validate execution."]}
    return graph, report
