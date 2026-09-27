"""Build and verify a frozen Matrix WebXR/PC release without local state.

The input is a Git commit, never the working tree. Run ``--help`` or see
Tools/README-WebXR-Release.md before preparing a public artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import zipfile


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/School-of-the-Ancients/matrix-loading-operator"
VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
WORLD_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
ROOT_FILES = (
    "Start-CodexControlService.ps1", "Start-ControlService.ps1",
    "Setup-LocalSpeech.ps1", "README.md", "VISION.md", "ARCHITECTURE.md",
    "ROADMAP.md", "LICENSE",
)
DOC_FILES = (
    "Docs/Persistent-World-Host.md", "Docs/Citizens-Shared-World.md",
    "Docs/Versions-And-Submissions.md", "Docs/Control-Page-Routes.md",
)
COMPAT_FILES = ("Examples/block_scale_client.py",
                "Validation/client-api-v1-fixtures.json")
FORBIDDEN_NAMES = re.compile(
    r"(^|[._-])(secret|password|credential|private|room-scan|transcript)"
    r"([._-]|$)|(^|/)control\.json$|\.(key|pem|p12|pfx|crt|env)$",
    re.IGNORECASE,
)
FORBIDDEN_DEMO_KEYS = re.compile(
    r"token|secret|password|credential|authorization|api.?key|private.?key|"
    r"room.?image|room.?scan", re.IGNORECASE,
)
FIXED_ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def run(*command: str, cwd: Path | None = None, env: dict | None = None) -> str:
    completed = subprocess.run(command, cwd=cwd, env=env, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               check=False)
    if completed.returncode:
        raise RuntimeError(f"{' '.join(command)} failed ({completed.returncode}): "
                           f"{completed.stderr[-3000:]}")
    return completed.stdout.strip()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def committed_source(repo: Path, ref: str, destination: Path) -> str:
    commit = run("git", "rev-parse", "--verify", f"{ref}^{{commit}}", cwd=repo)
    archive = subprocess.run(
        ["git", "archive", "--format=tar", commit, "--", "ControlService",
         "WebRuntime", "Docs", *ROOT_FILES, *COMPAT_FILES], cwd=repo,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if archive.returncode:
        raise RuntimeError(f"git archive failed: {archive.stderr.decode(errors='replace')}")
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode="r:") as tar:
        for member in tar:
            part = PurePosixPath(member.name)
            if (part.is_absolute() or ".." in part.parts or member.issym() or
                    member.islnk() or not (member.isdir() or member.isfile())):
                raise ValueError(f"Unsafe committed archive entry: {member.name}")
            target = destination.joinpath(*part.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    return commit


def eligible_source(relative: PurePosixPath) -> bool:
    path = relative.as_posix()
    if path in ROOT_FILES or path in DOC_FILES or path in COMPAT_FILES:
        return True
    if path.startswith("ControlService/"):
        return (len(relative.parts) == 2 and
                not relative.name.startswith("test_") and
                not FORBIDDEN_NAMES.search(relative.name))
    if path.startswith("WebRuntime/"):
        if len(relative.parts) == 2:
            return relative.name in {
                "index.html", "citizens.html", "hosted.html", "package.json",
                "package-lock.json", "vite.config.js", "README.md",
                "QUEST3_ACCEPTANCE.md", "BLENDER_AUTHORING_TIERS.md",
            }
        return (relative.parts[1] in {"src", "art"} and
                not FORBIDDEN_NAMES.search(relative.name))
    return False


def copy_release_source(source: Path, bundle: Path) -> None:
    for item in sorted(source.rglob("*")):
        if not item.is_file():
            continue
        relative = PurePosixPath(*item.relative_to(source).parts)
        if eligible_source(relative):
            target = bundle.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item, target)
    required = [*ROOT_FILES, *DOC_FILES, *COMPAT_FILES, "ControlService/server.py",
                "WebRuntime/src/host_world.js", "WebRuntime/hosted.html",
                "WebRuntime/package-lock.json"]
    missing = [name for name in required if not (bundle / name).is_file()]
    if missing:
        raise ValueError(f"Commit lacks release source: {', '.join(missing)}")


def tool(name: str) -> str:
    found = shutil.which(name + (".cmd" if os.name == "nt" and name == "npm" else ""))
    if not found:
        raise RuntimeError(f"{name} is required on PATH")
    return found


def build_web(source: Path, bundle: Path) -> dict:
    npm = tool("npm")
    node = tool("node")
    web = source / "WebRuntime"
    run(npm, "ci", "--no-audit", "--no-fund", cwd=web)
    run(npm, "run", "build", cwd=web)
    dist = web / "dist"
    for name in ("index.html", "citizens.html", "hosted.html"):
        if not (dist / name).is_file():
            raise RuntimeError(f"Vite omitted {name}")
    shutil.copytree(dist, bundle / "WebRuntime" / "dist")
    # The headless owner imports Three.js from WebRuntime/src. Ship only locked
    # production packages so the extracted bundle can run without npm/network.
    run(npm, "ci", "--omit=dev", "--no-audit", "--no-fund", cwd=bundle / "WebRuntime")
    return {"node": run(node, "--version"), "npm": run(npm, "--version"),
            "python": sys.version.split()[0]}


def reject_sensitive_keys(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if FORBIDDEN_DEMO_KEYS.search(key):
                raise ValueError(f"Demo JSON contains a sensitive field: {key}")
            reject_sensitive_keys(child)
    elif isinstance(value, list):
        for child in value:
            reject_sensitive_keys(child)


def load_demo(checkpoint_path: Path | None, catalog_path: Path | None,
              bundle: Path) -> str | None:
    if checkpoint_path is None and catalog_path is None:
        return None
    if checkpoint_path is None or catalog_path is None:
        raise ValueError("Supply both --demo-checkpoint and --demo-assets")
    if checkpoint_path.is_symlink() or catalog_path.is_symlink():
        raise ValueError("Demo input cannot be a symlink")
    if not checkpoint_path.is_file() or not (catalog_path / "manifest.json").is_file():
        raise ValueError("Demo checkpoint or asset manifest is missing")
    document = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    catalog = json.loads((catalog_path / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("Demo checkpoint must be a JSON object")
    reject_sensitive_keys(document)
    reject_sensitive_keys(catalog)
    world = document.get("world", {})
    if not isinstance(world, dict):
        raise ValueError("Demo world must be a JSON object")
    scene = world.get("scene", {})
    citizens = world.get("citizens", {})
    if not isinstance(scene, dict) or not isinstance(citizens, dict):
        raise ValueError("Demo scene and Citizens state must be objects")
    name = document.get("hostedWorldId")
    if (document.get("schemaVersion") != 1 or not isinstance(name, str) or
            not WORLD_NAME.fullmatch(name) or re.fullmatch(
                r"CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]", name, re.I) or
            world.get("version") != 3 or
            world.get("game") is not None or
            scene.get("roomId") != "web-virtual-room-v1" or
            citizens.get("schemaVersion") != 15):
        raise ValueError("Demo must be a completed v3 hosted Ada/Bo checkpoint")
    residents = citizens.get("residents", [])
    if (not isinstance(residents, list) or
            any(not isinstance(item, dict) for item in residents) or
            sorted(item.get("id") for item in residents) != ["ada", "bo"]):
        raise ValueError("Demo has unexpected resident identities")
    if not isinstance(catalog, list) or len(catalog) > 4:
        raise ValueError("Demo asset catalog must be a small explicit list")
    dependencies = document.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ValueError("Demo dependencies are invalid")
    if any(not isinstance(item, dict) for item in dependencies):
        raise ValueError("Demo asset dependency is invalid")
    referenced = {item.get("assetId"): item.get("sha256") for item in dependencies}
    if any(not isinstance(k, str) or not isinstance(v, str) or
           not SHA.fullmatch(v) for k, v in referenced.items()):
        raise ValueError("Demo asset dependency is invalid")
    if (any(not isinstance(item, dict) for item in catalog) or
            {item.get("assetId") for item in catalog} != set(referenced)):
        raise ValueError("Demo catalog must contain exactly checkpoint dependencies")
    demo = bundle / "Demo"
    target = demo / "scenes" / "world_checkpoints" / f"{name}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(checkpoint_path, target)
    assets = demo / "web_assets"
    assets.mkdir(parents=True)
    shutil.copyfile(catalog_path / "manifest.json", assets / "manifest.json")
    for item in catalog:
        asset_id = item.get("assetId")
        sha = item.get("sha256")
        if (referenced.get(asset_id) != sha or not isinstance(sha, str) or
                not SHA.fullmatch(sha)):
            raise ValueError("Demo asset catalog disagrees with checkpoint")
        glb = catalog_path / f"{sha}.glb"
        if glb.is_symlink() or not glb.is_file() or file_digest(glb) != sha:
            raise ValueError(f"Demo GLB is missing or does not match {sha}")
        shutil.copyfile(glb, assets / glb.name)
    return name


def release_readme(version: str, commit: str, versions: dict,
                   demo_name: str | None) -> str:
    demo = (f"A deliberately supplied, bounded demo checkpoint for {demo_name} is "
            "under Demo/. Copy its scenes/ and web_assets/ into isolated data "
            "directories before starting the service.\n" if demo_name else
            "No world checkpoint or asset catalog is included. Start a fresh "
            "hosted AdaBo fixture, or supply a separately reviewed data export.\n")
    return f"""# Matrix WebXR PC bundle — {version}

Frozen source: `{commit}`. The bundle preserves the v0.7 root-level service and
WebRuntime layout, and includes a prebuilt `/web/`, `/web/citizens.html`, and
`/web/hosted.html` client plus the headless Node world owner. It is not an APK.
Build tools: Node {versions['node']}, npm {versions['npm']}, Python {versions['python']}.

## Start an isolated hosted world

Install Python and the native Codex CLI separately. The included Node production
dependencies are locked and installed in WebRuntime/node_modules. For PC Agent
Portal Matrix tools, install `ControlService/requirements-agent-mcp.txt` into
the Python environment that starts the service. Speech and Blender are optional
external installations; Blender is needed to run a new Citizen generated-asset
job, not to view a completed registered GLB.

Set distinct random `SANDBOX_TOKEN` and `SANDBOX_WORLD_VIEW_TOKEN` values, each
at least 24 characters. Keep the owner token only on the PC. Start an isolated
service on a loopback port other than 8765 with `python ControlService/server.py
--host 127.0.0.1 --port PORT --scenes DATA/scenes --web-assets DATA/web_assets`.
In another PC terminal, set only the owner token and run `node
WebRuntime/src/host_world.js --url http://127.0.0.1:PORT --name AdaBo`.
Open `http://127.0.0.1:PORT/web/hosted.html` and enter only the view token.
For Quest Browser over USB debugging, map that same port with `adb reverse`.

`/web/` is the separate interactive browser-owned Creator world. The hosted page
is a read-only visitor. The PC Agent Portal can make one reviewed procedural
addition to the hosted fixture, or Bo can use its one addition for a bounded
procedural/Blender seat. These are mutually exclusive in this release.

{demo}
The release excludes credentials, private worlds, room images, Agent history,
browser storage, speech models, Blender installations, and Blender job state.
The hosted owner resumes the last complete checkpoint, without downtime catch-up.
See Docs/Persistent-World-Host.md and Docs/Versions-And-Submissions.md.
"""


def add_zip(bundle: Path, target: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9) as archive:
        for source in sorted(bundle.rglob("*")):
            if not source.is_file():
                continue
            name = source.relative_to(bundle).as_posix()
            info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            data = source.read_bytes()
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED,
                             compresslevel=9)
            hashes[name] = digest(data)
    return hashes


def fetch(base: str, path: str, token: str | None = None) -> tuple[int, bytes]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        with urlopen(Request(base + path, headers=headers), timeout=3) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_for_service(base: str, process: subprocess.Popen,
                     owner: str, timeout: float) -> None:
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if process.poll() is not None:
            raise RuntimeError("Extracted ControlService exited before health check")
        try:
            status, _ = fetch(base, "/api/health", owner)
            if status == 200:
                return
        except (URLError, TimeoutError):
            pass
        time.sleep(.15)
    raise TimeoutError("Extracted ControlService did not become healthy")


def stop(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def verify_extracted(archive_path: Path, hashes: dict[str, str],
                     demo_name: str | None, timeout: float = 35) -> dict:
    with tempfile.TemporaryDirectory(prefix="matrix-release-verify-") as temp:
        root = Path(temp)
        with zipfile.ZipFile(archive_path) as archive:
            if set(archive.namelist()) != set(hashes):
                raise ValueError("ZIP inventory differs from SHA manifest")
            for entry in archive.infolist():
                name = PurePosixPath(entry.filename)
                if (name.is_absolute() or ".." in name.parts or
                        digest(archive.read(entry)) != hashes[entry.filename]):
                    raise ValueError(f"ZIP entry is unsafe or corrupt: {entry.filename}")
            archive.extractall(root)
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        owner, viewer = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("SANDBOX_", "MATRIX_")) and
               key not in {"CODEX_API_KEY", "OPENAI_API_KEY"}}
        env.update(SANDBOX_TOKEN=owner, SANDBOX_WORLD_VIEW_TOKEN=viewer)
        data = root / "smoke-data"
        scenes, assets = data / "scenes", data / "web_assets"
        if demo_name:
            shutil.copytree(root / "Demo" / "scenes", scenes)
            shutil.copytree(root / "Demo" / "web_assets", assets)
        else:
            scenes.mkdir(parents=True)
            assets.mkdir(parents=True)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        service = host = None
        try:
            service = subprocess.Popen(
                [sys.executable, "ControlService/server.py", "--host", "127.0.0.1",
                 "--port", str(port), "--scenes", str(scenes), "--web-assets", str(assets)],
                cwd=root, env=env, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, creationflags=flags)
            wait_for_service(base, service, owner, timeout)
            pages = {"health": "/api/health", "web": "/web/",
                     "citizens": "/web/citizens.html",
                     "hosted": "/web/hosted.html"}
            status = {}
            referenced_assets: set[str] = set()
            for name, route in pages.items():
                code, body = fetch(base, route, owner if name == "health" else None)
                if code != 200 or (name != "health" and b"<html" not in body.lower()):
                    raise RuntimeError(f"Extracted {route} returned HTTP {code}")
                status[name] = code
                if name != "health":
                    referenced_assets.update(match.decode("ascii") for match in
                        re.findall(rb'(?:src|href)="(/web/assets/[A-Za-z0-9._-]+)"', body))
            if not referenced_assets:
                raise RuntimeError("Extracted Web pages reference no built assets")
            for route in sorted(referenced_assets):
                code, body = fetch(base, route)
                if code != 200 or not body:
                    raise RuntimeError(f"Extracted built asset {route} returned HTTP {code}")
            host = subprocess.Popen(
                [tool("node"), "WebRuntime/src/host_world.js", "--url", base,
                 "--name", demo_name or "AdaBo"], cwd=root, env=env,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=flags)
            start = time.monotonic()
            observation = None
            while time.monotonic() - start < timeout:
                if host.poll() is not None:
                    raise RuntimeError("Extracted Node owner exited before observation")
                code, body = fetch(base, "/api/web/hosted/observe", viewer)
                if code == 200:
                    observed = json.loads(body)
                    if observed.get("clockTick", -1) >= 2:
                        observation = observed
                        break
                time.sleep(.25)
            if observation is None:
                raise TimeoutError("Extracted owner produced no advancing hosted world")
            if (observation.get("readOnly") is not True or
                    observation.get("worldId") != (demo_name or "AdaBo") or
                    sorted(item["id"] for item in
                           observation["world"]["citizens"]["residents"]) !=
                    ["ada", "bo"] or
                    fetch(base, "/api/web/hosted/observe", owner)[0] != 401 or
                    fetch(base, "/api/state", viewer)[0] != 401):
                raise RuntimeError("Extracted hosted authority or fixture check failed")
            return {"http": status, "builtAssets": len(referenced_assets),
                    "owner": "started", "clockTick":
                    observation["clockTick"], "worldId": observation["worldId"],
                    "tokenSeparation": "passed"}
        finally:
            stop(host)
            stop(service)


def build(args: argparse.Namespace) -> dict:
    if not VERSION.fullmatch(args.version):
        raise ValueError("Version must be a safe release label")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    prefix = f"Matrix-WebXR-{args.version}"
    artifact = output / f"Matrix-WebXR-PC-{args.version}.zip"
    manifest_path = output / f"{prefix}-manifest.json"
    sums_path = output / f"{prefix}-SHA256SUMS.txt"
    existing = [path for path in (artifact, manifest_path, sums_path) if path.exists()]
    if existing and not args.force:
        raise FileExistsError("Release output exists; choose a new version or --force")
    with tempfile.TemporaryDirectory(prefix="matrix-release-build-") as temp:
        stage = Path(temp)
        source, bundle = stage / "committed-source", stage / "bundle"
        source.mkdir()
        bundle.mkdir()
        commit = committed_source(args.repo.resolve(), args.commit, source)
        copy_release_source(source, bundle)
        versions = build_web(source, bundle)
        demo_name = load_demo(args.demo_checkpoint, args.demo_assets, bundle)
        (bundle / "RELEASE-README.md").write_text(
            release_readme(args.version, commit, versions, demo_name),
            encoding="utf-8", newline="\n")
        staged_zip = stage / artifact.name
        hashes = add_zip(bundle, staged_zip)
        smoke = verify_extracted(staged_zip, hashes, demo_name,
                                 timeout=args.smoke_timeout)
        shutil.copyfile(staged_zip, artifact)
    manifest = {
        "schema_version": 1, "release": args.version,
        "release_type": "WebXR PC and Quest Browser prerelease",
        "repository": REPOSITORY, "source_commit": commit,
        "builder_sha256": file_digest(Path(__file__)),
        "artifact": {"file": artifact.name, "bytes": artifact.stat().st_size,
                     "sha256": file_digest(artifact), "files": len(hashes)},
        "file_sha256": hashes,
        "build_tools": versions,
        "validation": {"vite_build": "passed",
                       "extracted_bundle_smoke": smoke},
        "demo_world": demo_name,
        "exclusions": ["credentials and private world state",
                       "Quest room imagery and browser storage",
                       "Agent sessions and transcripts", "local speech models",
                       "Blender installation and unfinished Blender job state"],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                             encoding="utf-8", newline="\n")
    sums_path.write_text(
        f"{file_digest(artifact)}  {artifact.name}\n"
        f"{file_digest(manifest_path)}  {manifest_path.name}\n",
        encoding="utf-8", newline="\n")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True,
                        help="Release label, such as v0.8.0-preview.1")
    parser.add_argument("--commit", default="HEAD",
                        help="Frozen Git commit/ref to package (default: HEAD)")
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--demo-checkpoint", type=Path,
                        help="Explicit, sanitized hosted checkpoint JSON")
    parser.add_argument("--demo-assets", type=Path,
                        help="Matching sanitized WebAssetCatalog directory")
    parser.add_argument("--smoke-timeout", type=float, default=35)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        manifest = build(args)
    except (OSError, ValueError, RuntimeError, TimeoutError,
            subprocess.SubprocessError) as error:
        print(f"Release build failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"release": manifest["release"],
                      "source_commit": manifest["source_commit"],
                      "artifact": manifest["artifact"],
                      "extracted_bundle_smoke":
                      manifest["validation"]["extracted_bundle_smoke"]},
                     indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
