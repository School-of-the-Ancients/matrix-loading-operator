"""VRM 1.0 metadata inspection for the existing immutable web asset registry."""
import math

MAX_VRM_BYTES = 32 * 1024 * 1024
REQUIRED_BONES = {"hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand",
                  "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg",
                  "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"}


def inspect_vrm(document):
    extension = document.get("extensions", {}).get("VRMC_vrm")
    if extension is None:
        if "VRM" in document.get("extensions", {}):
            raise ValueError("VRM 0.x is not supported by this first avatar profile")
        return None
    if not isinstance(extension, dict) or extension.get("specVersion") != "1.0":
        raise ValueError("Only VRM 1.0 is supported")
    bones = extension.get("humanoid", {}).get("humanBones", {})
    nodes = document.get("nodes", [])
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 512:
        raise ValueError("VRM must contain at most 512 nodes")
    if not isinstance(bones, dict) or not REQUIRED_BONES <= bones.keys():
        raise ValueError("VRM is missing required humanoid bones")
    indices = []
    for bone in bones.values():
        index = bone.get("node") if isinstance(bone, dict) else None
        if type(index) is not int or not 0 <= index < len(nodes):
            raise ValueError("VRM bone references an invalid node")
        indices.append(index)
    if len(indices) != len(set(indices)):
        raise ValueError("VRM bones must refer to distinct nodes")
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Invalid VRM node")
        for field, length in (("translation", 3), ("rotation", 4), ("scale", 3), ("matrix", 16)):
            values = node.get(field)
            if values is not None and (not isinstance(values, list) or len(values) != length or
                any(type(x) not in (int, float) or not math.isfinite(x) or abs(x) > 1000 for x in values)):
                raise ValueError("Invalid VRM node transform")
    # Reject cycles and shared children before a runtime traverses the graph.
    parents = set()
    for node in nodes:
        children = node.get("children", [])
        if not isinstance(children, list) or any(type(i) is not int or not 0 <= i < len(nodes) for i in children):
            raise ValueError("Invalid VRM child node")
        for index in children:
            if index in parents:
                raise ValueError("VRM node has multiple parents")
            parents.add(index)
    visited, active = set(), set()
    def visit(index):
        if index in active:
            raise ValueError("VRM node cycle")
        if index in visited:
            return
        active.add(index)
        for child in nodes[index].get("children", []):
            visit(child)
        active.remove(index)
        visited.add(index)
    for index in range(len(nodes)):
        visit(index)
    meta = extension.get("meta", {})
    if not isinstance(meta, dict) or not isinstance(meta.get("name"), str) or not isinstance(meta.get("licenseUrl"), str):
        raise ValueError("VRM requires name and license metadata")
    preset = extension.get("expressions", {}).get("preset", {})
    if not isinstance(preset, dict) or len(preset) > 32:
        raise ValueError("Invalid VRM expressions")
    return {"specVersion": "1.0", "expressions": sorted(preset), "humanBones": sorted(bones),
            "license": {key: meta[key] for key in ("name", "licenseUrl", "otherLicenseUrl", "authors", "copyrightInformation", "avatarPermission", "commercialUsage",
                "allowRedistribution", "modification") if key in meta}}
