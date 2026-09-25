"""Combine verified Android or Windows Poly Haven prefab packs into a local catalog."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def build(library, platform):
    root = library / "Packs" / ("Android" if platform == "Android" else "Desktop")
    if not root.is_dir():
        raise ValueError("No exported pack directory for " + platform)
    index = json.loads((library / "polyhaven-index.json").read_text(encoding="utf-8"))
    rows, failures = [], []
    for directory in sorted(root.iterdir()):
        if not directory.is_dir() or not (directory / "catalog.json").is_file():
            continue
        try:
            source = index[directory.name]
            kind = source.get("type")
            if kind not in (0, 1, 2):
                raise ValueError("Pack does not refer to a Poly Haven asset")
            catalog = json.loads((directory / "catalog.json").read_text(encoding="utf-8"))
            if catalog.get("schemaVersion") != 1 or len(catalog.get("assets", [])) != 1:
                raise ValueError("Expected one exported prefab pack")
            row = catalog["assets"][0]
            if row.get("targetPlatform") != platform or row.get("format") != "assetbundle":
                raise ValueError("Pack platform or format mismatch")
            manifest = row["metadata"]["contentPack"]
            if manifest.get("providerId") != "polyhaven" or manifest.get("packId") != row.get("assetId"):
                raise ValueError("Pack provider or ID mismatch")
            artifact = (directory / row["location"]).resolve()
            if not artifact.is_file() or not artifact.is_relative_to(directory.resolve()):
                raise ValueError("Pack file missing or outside directory")
            if artifact.stat().st_size != row["byteLength"] or digest(artifact) != row["sha256"]:
                raise ValueError("Pack size or SHA-256 mismatch")
            row["title"] = source.get("name", directory.name)[:100]
            row["category"] = {0: "environments", 1: "materials", 2: "objects"}[kind]
            row["location"] = directory.name + "/" + row["location"]
            row["metadata"]["description"] = (source.get("description") or "")[:2048]
            row["metadata"]["tags"] = [str(tag)[:96] for tag in source.get("tags", [])[:32]]
            rows.append(row)
        except (KeyError, ValueError, TypeError, OSError) as error:
            failures.append({"assetId": directory.name, "error": str(error)})
    if len(rows) > 3000:
        raise ValueError("Catalog exceeds the current 3,000 pack entry limit")
    catalog_path = root / "catalog.json"
    temporary = catalog_path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"schemaVersion": 1, "assets": rows}, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, catalog_path)
    config_path = library / "matrix-content-config.json"
    config = {"schemaVersion": 1, "providers": [
        {"id": "polyhaven", "title": "Installed Poly Haven prefabs", "type": "local", "enabled": True,
         "manifest": str(catalog_path)},
        {"id": "polyhaven-source", "title": "Poly Haven full source index", "type": "polyhaven", "enabled": True},
        {"id": "sketchfab", "title": "Sketchfab public model search", "type": "sketchfab", "enabled": True},
        {"id": "openverse-audio", "title": "Openverse public audio search", "type": "openverse-audio", "enabled": True}]}
    temporary = config_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, config_path)
    return {"platform": platform, "readyPrefabs": len(rows), "invalidPacks": failures,
            "catalog": str(catalog_path), "config": str(config_path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", required=True)
    parser.add_argument("--platform", choices=("Android", "Desktop"), default="Android")
    args = parser.parse_args()
    platform = "Android" if args.platform == "Android" else "StandaloneWindows64"
    print(json.dumps(build(Path(args.library).resolve(), platform)))


if __name__ == "__main__":
    main()
