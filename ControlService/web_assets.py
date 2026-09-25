"""Content-addressed, static GLB registry for the Matrix browser runtime.

Asset creation happens on the authoring PC. Runtime clients read only validated,
immutable files from this registry; no JavaScript or arbitrary download URL is
accepted as a Matrix asset.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile

MAX_BYTES = 16 * 1024 * 1024
MAX_ASSETS = 256
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")


class WebAssetError(Exception):
    pass


def inspect_glb(path):
    path = Path(path)
    size = path.stat().st_size
    if size < 20 or size > MAX_BYTES:
        raise WebAssetError("GLB must be 20 bytes to 16 MiB")
    with path.open("rb") as handle:
        header = handle.read(12)
        magic, version, declared = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or declared != size:
            raise WebAssetError("Expected complete glTF 2.0 binary (.glb)")
        chunk_length, chunk_type = struct.unpack("<I4s", handle.read(8))
        if chunk_type != b"JSON" or chunk_length > size - 20:
            raise WebAssetError("GLB needs a JSON first chunk")
        try:
            document = json.loads(handle.read(chunk_length).rstrip(b" \x00"))
        except (UnicodeError, ValueError):
            raise WebAssetError("Invalid GLB JSON") from None
    if not isinstance(document, dict) or not isinstance(document.get("asset"), dict) or document["asset"].get("version") != "2.0":
        raise WebAssetError("Expected glTF 2.0 asset metadata")
    def has_uri(value):
        if isinstance(value, dict):
            return "uri" in value or any(has_uri(child) for child in value.values())
        if isinstance(value, list):
            return any(has_uri(child) for child in value)
        return False

    if has_uri(document):
        raise WebAssetError("External and data URI resources are unsupported; pack images into GLB buffer views")
    if any(ext in document.get("extensionsRequired", []) for ext in
           ("KHR_draco_mesh_compression", "KHR_texture_basisu", "EXT_meshopt_compression")):
        raise WebAssetError("Compressed GLB extension needs a decoder that this runtime does not ship")
    limits = {"nodes": 256, "meshes": 128, "materials": 64, "images": 32, "textures": 32}
    if any(not isinstance(document.get(key, []), list) or len(document.get(key, [])) > limit
           for key, limit in limits.items()):
        raise WebAssetError("GLB complexity limit exceeded")
    if any(not isinstance(mesh, dict) or not isinstance(mesh.get("primitives", []), list)
           for mesh in document.get("meshes", [])):
        raise WebAssetError("Invalid GLB meshes")
    primitives = [primitive for mesh in document.get("meshes", []) for primitive in mesh.get("primitives", [])]
    if len(primitives) > 256:
        raise WebAssetError("GLB has too many mesh primitives")
    accessors = document.get("accessors", [])
    try:
        vertices = sum(accessors[part["attributes"]["POSITION"]]["count"] for part in primitives)
    except (KeyError, IndexError, TypeError):
        raise WebAssetError("Mesh primitive needs a position accessor") from None
    if not isinstance(vertices, int) or not primitives or vertices < 3 or vertices > 300000:
        raise WebAssetError("GLB needs 3 to 300,000 referenced vertices")
    return {"bytes": size, "vertices": vertices, "meshes": len(document.get("meshes", [])),
            "images": len(document.get("images", []))}


class WebAssetCatalog:
    def __init__(self, root):
        self.root = Path(root)

    def list(self):
        manifest = self.root / "manifest.json"
        if not manifest.is_file():
            return []
        try:
            items = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise WebAssetError("Web asset manifest is unreadable") from None
        if not isinstance(items, list) or len(items) > MAX_ASSETS:
            raise WebAssetError("Web asset manifest is invalid")
        return items

    def file(self, digest):
        if not SHA.fullmatch(digest):
            raise WebAssetError("Invalid asset digest")
        if not any(item.get("sha256") == digest for item in self.list()):
            raise WebAssetError("Unknown asset digest")
        path = self.root / f"{digest}.glb"
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise WebAssetError("Registered GLB is missing or corrupt")
        return path

    def register(self, source, name, description="", spawn_scale=None, local_bounds=None):
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise WebAssetError("Asset name must be 1 to 80 characters")
        if not isinstance(description, str) or len(description) > 500:
            raise WebAssetError("Description must be at most 500 characters")
        if spawn_scale is not None and (type(spawn_scale) not in (int, float) or not math.isfinite(spawn_scale)
                                        or not 0.01 <= spawn_scale <= 20):
            raise WebAssetError("Spawn scale must be 0.01 to 20")
        if local_bounds is not None:
            if not isinstance(local_bounds, dict) or set(local_bounds) != {"center", "size"}:
                raise WebAssetError("Invalid local bounds")
            for kind in ("center", "size"):
                vector = local_bounds[kind]
                if not isinstance(vector, dict) or set(vector) != {"x", "y", "z"} or any(
                        type(vector[axis]) not in (int, float) or not math.isfinite(vector[axis]) or
                        abs(vector[axis]) > 20 or (kind == "size" and vector[axis] <= 0)
                        for axis in ("x", "y", "z")):
                    raise WebAssetError("Invalid local bounds")
        info = inspect_glb(source)
        digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-")
        if not SLUG.fullmatch(slug):
            raise WebAssetError("Asset name needs letters or digits")
        asset_id = f"web:{slug}:{digest[:12]}"
        self.root.mkdir(parents=True, exist_ok=True)
        items = self.list()
        for item in items:
            if item.get("assetId") == asset_id:
                if local_bounds is not None:
                    item["localBounds"] = local_bounds
                if spawn_scale is not None:
                    item["spawnScale"] = spawn_scale
                if spawn_scale is not None or local_bounds is not None:
                    self._write_manifest(items)
                return item
        if len(items) >= MAX_ASSETS:
            raise WebAssetError("Web asset catalog is full")
        entry = {"assetId": asset_id, "displayName": name.strip(), "description": description,
                 "spawnScale": spawn_scale if spawn_scale is not None else 1, "sha256": digest, "byteLength": info["bytes"],
                 "url": f"/api/web/assets/{digest}.glb", "geometry": info}
        if local_bounds is not None:
            entry["localBounds"] = local_bounds
        target = self.root / f"{digest}.glb"
        if not target.exists():
            with tempfile.NamedTemporaryFile(dir=self.root, prefix=".asset-", delete=False) as temp:
                temp_path = Path(temp.name)
                with Path(source).open("rb") as handle:
                    shutil.copyfileobj(handle, temp)
                temp.flush()
                os.fsync(temp.fileno())
            os.replace(temp_path, target)
        items.append(entry)
        self._write_manifest(items)
        return entry

    def _write_manifest(self, items):
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.root,
                                         prefix=".manifest-", delete=False) as temp:
            temp_path = Path(temp.name)
            json.dump(items, temp, indent=2)
            temp.flush()
            os.fsync(temp.fileno())
        os.replace(temp_path, self.root / "manifest.json")
