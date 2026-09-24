"""Stage one Poly Haven static model for the Matrix Unity content-pack exporter.

Only the selected model is downloaded. Repeating the command verifies and reuses
the local source files. This does not install a prefab in a running player.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.parse
import urllib.request


USER_AGENT = "MatrixLoadingOperator/1.0 (+https://github.com/School-of-the-Ancients/matrix-loading-operator)"
MAX_FILE_BYTES = 768 * 1024 * 1024
MAX_SOURCE_BYTES = 1024 * 1024 * 1024
ASSET_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}\Z")
DIGEST = re.compile(r"[a-f0-9]{32}\Z")


class PreparationError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise PreparationError("Poly Haven source redirected unexpectedly")


def fetch(url, max_bytes):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise PreparationError("Poly Haven response exceeds the configured limit")
    return data


def source_file(value, category="Models"):
    if not isinstance(value, dict):
        raise PreparationError("Invalid Poly Haven file metadata")
    size, checksum, url = value.get("size"), value.get("md5"), value.get("url")
    if type(size) is not int or not 0 < size <= MAX_FILE_BYTES or not isinstance(checksum, str) or not DIGEST.fullmatch(checksum):
        raise PreparationError("Poly Haven source has no bounded size and checksum")
    if not isinstance(url, str):
        raise PreparationError("Poly Haven source has no URL")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != "dl.polyhaven.org" or parsed.port not in (None, 443)
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or not parsed.path.startswith("/file/ph-assets/" + category + "/")):
        raise PreparationError("Unexpected Poly Haven download origin or path")
    filename = Path(urllib.parse.unquote(parsed.path)).name
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", filename):
        raise PreparationError("Unexpected Poly Haven source filename")
    return {"filename": filename, "url": url, "byteLength": size, "md5": checksum}


def download(item, destination):
    if destination.is_file() and destination.stat().st_size == item["byteLength"]:
        current = hashlib.md5(destination.read_bytes()).hexdigest()
        if current == item["md5"]:
            return hashlib.sha256(destination.read_bytes()).hexdigest(), True
    data = fetch(item["url"], item["byteLength"])
    if len(data) != item["byteLength"] or hashlib.md5(data).hexdigest() != item["md5"]:
        raise PreparationError("Poly Haven file does not match its declared size and checksum")
    descriptor, temporary = tempfile.mkstemp(prefix=".polyhaven-", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return hashlib.sha256(data).hexdigest(), False


def select_model_files(files):
    if not isinstance(files, dict) or not isinstance(files.get("fbx"), dict):
        raise PreparationError("This model has no FBX source for Unity")
    resolution = next((key for key in ("1k", "2k") if isinstance(files["fbx"].get(key), dict)
                       and isinstance(files["fbx"][key].get("fbx"), dict)), None)
    if resolution is None:
        raise PreparationError("This model has no 1k or 2k FBX source")
    fbx = files["fbx"][resolution]["fbx"]
    selected = [source_file(fbx)]
    includes = fbx.get("include", {})
    if not isinstance(includes, dict) or len(includes) > 256:
        raise PreparationError("Unsupported Poly Haven model dependencies")
    def priority(name):
        label = name.casefold()
        return (0 if any(word in label for word in ("diff", "basecolor", "albedo")) else
                1 if "nor_gl" in label else 2 if any(word in label for word in ("rough", "arm")) else 3, label)
    for name, metadata in sorted(includes.items(), key=lambda pair: priority(pair[0])):
        if not isinstance(name, str) or not name.startswith("textures/") or Path(name).suffix.lower() not in (".jpg", ".png", ".exr"):
            raise PreparationError("Unexpected Poly Haven model dependency")
        item = source_file(metadata)
        if len(selected) < 33 and sum(file["byteLength"] for file in selected) + item["byteLength"] <= MAX_SOURCE_BYTES:
            selected.append(item)
    if len({item["filename"].lower() for item in selected}) != len(selected) or sum(item["byteLength"] for item in selected) > MAX_SOURCE_BYTES:
        raise PreparationError("Poly Haven model is too large or contains duplicate filenames")
    return resolution, selected


def prepare(asset_id, output_root, info=None, files=None):
    if not isinstance(asset_id, str) or not ASSET_ID.fullmatch(asset_id):
        raise PreparationError("Invalid Poly Haven asset ID")
    quoted = urllib.parse.quote(asset_id, safe="")
    info = info if info is not None else json.loads(fetch("https://api.polyhaven.com/info/" + quoted, 256 * 1024))
    if not isinstance(info, dict) or info.get("type") != 2 or not isinstance(info.get("name"), str):
        raise PreparationError("This Poly Haven entry is not a 3D model")
    source_version = info.get("files_hash")
    if not isinstance(source_version, str) or not re.fullmatch(r"[a-f0-9]{40}", source_version):
        raise PreparationError("Poly Haven did not provide a stable model version")
    files = files if files is not None else json.loads(fetch("https://api.polyhaven.com/files/" + quoted, 1024 * 1024))
    resolution, selected = select_model_files(files)
    directory = Path(output_root).resolve() / asset_id / source_version
    directory.mkdir(parents=True, exist_ok=True)
    files_out, reused = [], 0
    for item in selected:
        sha256, cached = download(item, directory / item["filename"])
        files_out.append({**item, "sha256": sha256})
        reused += int(cached)
    diffuse = next((item["filename"] for item in files_out if re.search(r"(?:diff|diffuse).*\.(?:jpg|png)$", item["filename"], re.I)), "")
    manifest = {"schemaVersion": 1, "providerId": "polyhaven", "assetId": asset_id, "title": info["name"][:100],
                "sourceVersion": source_version, "sourceUrl": "https://polyhaven.com/a/" + quoted,
                "license": {"name": "CC0", "url": "https://polyhaven.com/license", "attribution": ""},
                "resolution": resolution, "fbx": selected[0]["filename"], "diffuse": diffuse,
                "dimensions": info.get("dimensions"),
                "files": files_out}
    path = directory / "polyhaven-source.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return path, reused, len(files_out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset_id", help="Poly Haven model ID from the Matrix catalog")
    parser.add_argument("--output", default="work/polyhaven-models", help="Persistent source cache directory")
    args = parser.parse_args()
    path, reused, total = prepare(args.asset_id, args.output)
    print(json.dumps({"sourceManifest": str(path), "cachedFilesReused": reused, "fileCount": total}))


if __name__ == "__main__":
    main()
