"""Resume a local, Quest-sized Poly Haven source library on a spacious PC drive.

This fetches one 1k (or fallback 2k) representation per catalog entry. Models
use FBX plus its declared dependencies; HDRIs use HDR; textures use available
1k material maps. These source files are not Unity runtime prefabs until
exported by PolyHavenPrefabExporter. Every file is checksum verified.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.parse


_module = importlib.util.spec_from_file_location("polyhaven_model", Path(__file__).with_name("Prepare-PolyHaven-Model.py"))
model = importlib.util.module_from_spec(_module)
_module.loader.exec_module(model)

KINDS = {0: "HDRIs", 1: "Textures", 2: "Models"}
MAX_LIBRARY_BYTES = 100 * 1024 ** 3


def selected_files(kind, files):
    if kind == 0:
        hdri = files.get("hdri", {})
        resolution = next((r for r in ("1k", "2k") if "hdr" in hdri.get(r, {})), None)
        if resolution is None:
            raise model.PreparationError("No Quest-sized HDR panorama")
        return resolution, [model.source_file(hdri[resolution]["hdr"], "HDRIs")]
    if kind != 1:
        raise model.PreparationError("Unsupported source type")
    selected, resolutions = [], set()
    for family, versions in files.items():
        if not isinstance(versions, dict):
            continue
        for resolution in ("1k", "2k"):
            formats = versions.get(resolution, {})
            if not isinstance(formats, dict):
                continue
            format_name = next((format_name for format_name in ("jpg", "png") if isinstance(formats.get(format_name), dict)), None)
            if format_name:
                selected.append(model.source_file(formats[format_name], "Textures"))
                resolutions.add(resolution)
                break
    if not selected:
        raise model.PreparationError("No Quest-sized texture maps")
    if len({item["filename"].lower() for item in selected}) != len(selected):
        raise model.PreparationError("Duplicate texture map filenames")
    if sum(item["byteLength"] for item in selected) > model.MAX_SOURCE_BYTES:
        raise model.PreparationError("Texture maps exceed per-asset source budget")
    return "+".join(sorted(resolutions)), selected


def verified_manifest(path):
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        for item in manifest["files"]:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", item["filename"]):
                return False
            source = path.parent / item["filename"]
            if not source.is_file() or source.stat().st_size != item["byteLength"]:
                return False
            with source.open("rb") as stream:
                digest = hashlib.sha256()
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != item["sha256"]:
                return False
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def store_other(asset_id, kind, info, files, root, download):
    version = info.get("files_hash")
    if not isinstance(version, str) or not re.fullmatch(r"[a-f0-9]{40}", version):
        raise model.PreparationError("Missing stable source version")
    resolution, selected = selected_files(kind, files)
    total = sum(item["byteLength"] for item in selected)
    result = {"assetId": asset_id, "category": KINDS[kind], "resolution": resolution,
              "sourceBytes": total, "fileCount": len(selected), "version": version}
    if not download:
        return result
    directory = root / KINDS[kind] / asset_id / version
    directory.mkdir(parents=True, exist_ok=True)
    stored = []
    for item in selected:
        sha256, _ = model.download(item, directory / item["filename"])
        stored.append({**item, "sha256": sha256})
    manifest = {"schemaVersion": 1, "providerId": "polyhaven", "assetId": asset_id,
                "title": info.get("name", asset_id)[:100], "category": KINDS[kind],
                "sourceVersion": version, "sourceUrl": "https://polyhaven.com/a/" + urllib.parse.quote(asset_id, safe=""),
                "license": {"name": "CC0", "url": "https://polyhaven.com/license", "attribution": ""},
                "resolution": resolution, "files": stored}
    path = directory / "polyhaven-source.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    result["sourceManifest"] = str(path)
    return result


def run(root, download, limit, offset, delay, report_name=None):
    root.mkdir(parents=True, exist_ok=True)
    index_path = root / "polyhaven-index.json"
    index = json.loads(model.fetch("https://api.polyhaven.com/assets?t=all", 5 * 1024 * 1024))
    if not isinstance(index, dict) or not 0 < len(index) <= 10000:
        raise model.PreparationError("Unexpected Poly Haven index")
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    rows = [(asset_id, entry["type"]) for asset_id, entry in index.items()
            if model.ASSET_ID.fullmatch(asset_id) and isinstance(entry, dict) and entry.get("type") in KINDS]
    rows.sort(key=lambda row: (row[1], row[0].casefold()))
    if limit is not None:
        rows = rows[offset:offset + limit]
    elif offset:
        rows = rows[offset:]
    report_path = root / (report_name or ("download-results.jsonl" if download else "plan-results.jsonl"))
    counts = Counter()
    expected_bytes = 0
    with report_path.open("a", encoding="utf-8") as report:
        for position, (asset_id, kind) in enumerate(rows, offset + 1):
            try:
                quoted = urllib.parse.quote(asset_id, safe="")
                info = json.loads(model.fetch("https://api.polyhaven.com/info/" + quoted, 256 * 1024))
                if not isinstance(info, dict) or info.get("type") != kind:
                    raise model.PreparationError("Asset type changed")
                version = info.get("files_hash", "")
                existing = root / KINDS[kind] / asset_id / version / "polyhaven-source.json"
                if download and verified_manifest(existing):
                    manifest = json.loads(existing.read_text(encoding="utf-8"))
                    if kind == 2 and isinstance(info.get("dimensions"), list) and len(info["dimensions"]) == 3 and \
                            all(type(value) in (int, float) and 0 < value <= 200000 for value in info["dimensions"]) and \
                            manifest.get("dimensions") != info["dimensions"]:
                        manifest["dimensions"] = info["dimensions"]
                        temporary = existing.with_suffix(".tmp")
                        temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
                        os.replace(temporary, existing)
                    source_bytes = sum(item["byteLength"] for item in manifest["files"])
                    outcome = {"assetId": asset_id, "category": KINDS[kind], "status": "reused", "sourceManifest": str(existing),
                               "sourceBytes": source_bytes}
                else:
                    files = json.loads(model.fetch("https://api.polyhaven.com/files/" + quoted, 1024 * 1024))
                    if kind == 2:
                        resolution, selected = model.select_model_files(files)
                        source_bytes = sum(item["byteLength"] for item in selected)
                        if source_bytes > model.MAX_SOURCE_BYTES or len(selected) > 33:
                            raise model.PreparationError("Model source exceeds per-asset budget")
                        if expected_bytes + source_bytes > MAX_LIBRARY_BYTES:
                            raise model.PreparationError("Library source budget exceeded")
                        if download and shutil.disk_usage(root).free < source_bytes + 1024 ** 3:
                            raise model.PreparationError("Less than 1 GiB would remain on the library drive")
                        if download:
                            path, reused, count = model.prepare(asset_id, root / "Models", info, files)
                            outcome = {"assetId": asset_id, "category": "Models", "status": "downloaded", "sourceManifest": str(path),
                                       "cachedFilesReused": reused, "fileCount": count, "sourceBytes": source_bytes}
                        else:
                            outcome = {"assetId": asset_id, "category": "Models", "resolution": resolution,
                                       "sourceBytes": source_bytes, "fileCount": len(selected),
                                       "status": "planned"}
                    else:
                        _, selected = selected_files(kind, files)
                        source_bytes = sum(item["byteLength"] for item in selected)
                        if expected_bytes + source_bytes > MAX_LIBRARY_BYTES:
                            raise model.PreparationError("Library source budget exceeded")
                        if download and shutil.disk_usage(root).free < source_bytes + 1024 ** 3:
                            raise model.PreparationError("Less than 1 GiB would remain on the library drive")
                        outcome = store_other(asset_id, kind, info, files, root, download)
                        outcome["status"] = "downloaded" if download else "planned"
                expected_bytes += outcome.get("sourceBytes", 0)
                counts[outcome["status"]] += 1
            except Exception as error:
                outcome = {"assetId": asset_id, "category": KINDS[kind], "status": "failed",
                           "error": type(error).__name__ + ": " + str(error)[:250]}
                counts["failed"] += 1
            report.write(json.dumps(outcome) + "\n")
            report.flush()
            if position % 25 == 0 or outcome["status"] == "failed":
                print(json.dumps({"processed": position, "total": offset + len(rows), "counts": dict(counts), "last": asset_id}), flush=True)
            if delay:
                time.sleep(delay)
    summary = {"indexCount": len(index), "processed": len(rows), "counts": dict(counts),
               "plannedSourceBytes": expected_bytes, "report": str(report_path)}
    print(json.dumps(summary), flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Dedicated library root, ideally a drive with ample space")
    parser.add_argument("--download", action="store_true", help="Download and checksum-verify sources; default only plans sizes")
    parser.add_argument("--limit", type=int, help="Process only this many entries")
    parser.add_argument("--offset", type=int, default=0, help="Resume at sorted-index entry")
    parser.add_argument("--delay", type=float, default=0.25, help="Seconds between assets (default 0.25)")
    parser.add_argument("--report-name", help="Separate JSONL journal basename for a parallel index slice")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1 or args.offset < 0 or not 0.1 <= args.delay <= 10:
        parser.error("Invalid limit, offset, or delay")
    if args.report_name is not None and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.jsonl", args.report_name):
        parser.error("Invalid report basename")
    run(Path(args.output).resolve(), args.download, args.limit, args.offset, args.delay, args.report_name)


if __name__ == "__main__":
    main()
