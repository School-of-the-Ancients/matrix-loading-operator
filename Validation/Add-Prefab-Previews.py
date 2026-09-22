"""Publish actual Editor-rendered prefab samples through an existing PC catalog.

Only preview image entries are added/replaced; bundle bytes and pack manifests are
unchanged. Run SandboxPrefabPreview first, then pass its report and a catalog.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ControlService"))
from content_catalog import validate_manifest


def publish(catalog_path: Path, report_path: Path):
    document = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    validate_manifest(document)
    report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    unity = report["unityVersion"]
    previews = report["previews"]
    if not isinstance(previews, list) or not previews or not isinstance(unity, str):
        raise ValueError("Renderer report must contain previews and an exact Unity version")
    packs = [a for a in document["assets"] if a["format"] == "assetbundle"]
    platforms = sorted({a["targetPlatform"] for a in packs})
    if not platforms:
        raise ValueError("Catalog needs a pack declaring the supported target platforms")
    additions, files, summaries = [], [], []
    for preview in previews:
        asset_id = preview["assetId"]
        relative = Path(preview["path"])
        image_path = (report_path.parent / relative).resolve()
        if relative.is_absolute() or not image_path.is_relative_to(report_path.parent.resolve()):
            raise ValueError("Preview image must be inside the renderer report directory")
        with image_path.open("rb") as stream:
            data = stream.read(1024 * 1024 + 1)
        if not 24 <= len(data) <= 1024 * 1024 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise ValueError("Expected a bounded rendered PNG")
        width, height = struct.unpack(">II", data[16:24])
        if not (0 < width <= 2048 and 0 < height <= 2048):
            raise ValueError("Preview dimensions exceed the browser sample limit")
        digest = hashlib.sha256(data).hexdigest()
        if preview.get("sha256") != digest:
            raise ValueError("Renderer PNG digest does not match its report")
        dependency = preview.get("sourceDependencyHash", "")
        if not isinstance(dependency, str) or not re.fullmatch(r"[a-f0-9]{32}", dependency):
            raise ValueError("Renderer must record the imported prefab dependency hash")
        matches = [p for p in packs if any(a["assetId"] == asset_id for a in p["metadata"]["contentPack"]["assets"])]
        if ":" in asset_id and not matches:
            raise ValueError("Downloaded prefab has no exact catalog pack: " + asset_id)
        if not matches and asset_id not in {"chair", "table", "wall", "pedestal", "block", "orb", "column"}:
            raise ValueError("Unknown bundled prefab; supply a matching downloadable pack")
        for pack in matches:
            manifest = pack["metadata"]["contentPack"]
            entry = next(a for a in manifest["assets"] if a["assetId"] == asset_id)
            if manifest["unityVersion"] != unity or entry["prefabPath"].casefold() != preview.get("prefabPath", "").casefold():
                raise ValueError("Rendered prefab path or Unity version differs from the catalog pack")
        variants = matches or [dict(targetPlatform=p, version="1.0.0", license={
            "name": "MIT", "url": "https://opensource.org/license/mit",
            "attribution": "Matrix Operator authored bundled prefab"}) for p in platforms]
        for pack in variants:
            tags = ["prefab-preview", "prefab:" + asset_id, "unity:" + unity, "source-dependency:" + dependency]
            tags.append("bundle:" + pack["sha256"] if matches else "bundled")
            # The digest and platform keep different renderings independently cached.
            image_id = "preview-" + hashlib.sha256((asset_id + digest).encode()).hexdigest()[:32]
            additions.append({"assetId": image_id, "version": pack["version"],
                "title": preview.get("displayName", asset_id) + " — Editor sample",
                "category": "objects", "format": "png", "targetPlatform": pack["targetPlatform"],
                "sha256": digest, "byteLength": len(data), "location": "previews/" + digest + ".png",
                "license": pack["license"], "dependencies": [], "metadata": {
                    "tags": tags, "description": "Authored prefab sample rendered in Unity Editor studio lighting, associated by its publisher with this catalog version. This is not a render of the installed bundle; headset lighting may differ."}})
        files.append((data, catalog_path.parent / "previews" / (digest + ".png")))
        summaries.append({"assetId": asset_id, "sha256": digest, "bytes": len(data), "width": width, "height": height,
                          "sourceDependencyHash": dependency, "sourcePrefab": preview["prefabPath"]})
    selected = {"prefab:" + p["assetId"] for p in previews}
    def replaced(asset):
        tags = asset.get("metadata", {}).get("tags", [])
        return asset.get("format") == "png" and asset.get("assetId", "").startswith("preview-") and isinstance(tags, list) and "prefab-preview" in tags and bool(selected.intersection(t for t in tags if isinstance(t, str)))
    document["assets"] = [a for a in document["assets"] if not replaced(a)] + additions
    validate_manifest(document)
    if [a for a in document["assets"] if a["format"] == "assetbundle"] != packs:
        raise ValueError("Preview publication must preserve every bundle entry")
    for data, target in files:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    temporary = catalog_path.with_name(catalog_path.name + ".preview-tmp")
    temporary.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(catalog_path)
    return {"unityVersion": unity, "previewCount": len(summaries), "catalogImageVariants": len(additions),
            "bundleEntriesUnchanged": True, "previews": summaries}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output-report", type=Path, required=True)
    args = parser.parse_args()
    result = publish(args.catalog.resolve(), args.report.resolve())
    args.output_report.parent.mkdir(parents=True, exist_ok=True)
    args.output_report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("previewCount", "catalogImageVariants", "bundleEntriesUnchanged")}))
