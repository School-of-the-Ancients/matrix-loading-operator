"""On-demand PC Blender jobs that register immutable Quest-sized GLBs."""
from collections import OrderedDict
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

from blender_blueprint import BlueprintError, design_blueprint, validate_blueprint
from web_assets import WebAssetError


class BlenderAuthoringError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def blender_executable():
    configured = os.environ.get("MATRIX_BLENDER_EXE", "").strip()
    candidates = [configured, shutil.which("blender")]
    root = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Blender Foundation"
    if root.is_dir():
        candidates.extend(str(path) for path in sorted(root.glob("Blender */blender.exe"), reverse=True))
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and Path(candidate).suffix.lower() == ".exe":
            return str(Path(candidate).resolve())
    raise BlenderAuthoringError("Blender is not installed on the PC; set MATRIX_BLENDER_EXE", 503)


def build_in_blender(recipe, directory, executable=None):
    recipe = validate_blueprint(recipe)
    executable = executable or blender_executable()
    directory = Path(directory)
    source = directory / "blueprint.json"
    output = directory / "asset.glb"
    metadata = directory / "bounds.json"
    source.write_text(json.dumps(recipe), encoding="utf-8")
    script = Path(__file__).with_name("build_blueprint.py")
    try:
        process = subprocess.run([executable, "--background", "--factory-startup", "--python", str(script),
                                  "--", str(source), str(output), str(metadata)],
                                 cwd=directory, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        raise BlenderAuthoringError("Blender build failed or timed out", 503) from None
    if process.returncode != 0 or not output.is_file() or not metadata.is_file():
        detail = process.stderr.decode("utf-8", errors="replace")[-500:]
        raise BlenderAuthoringError("Blender could not export the asset. " + detail, 503)
    try:
        bounds = json.loads(metadata.read_text(encoding="utf-8"))["localBounds"]
    except (OSError, ValueError, KeyError):
        raise BlenderAuthoringError("Blender returned invalid asset bounds", 503) from None
    return output, bounds


class BlenderAuthoringJobs:
    def __init__(self, catalog, designer=design_blueprint, builder=build_in_blender):
        self.catalog = catalog
        self.designer = designer
        self.builder = builder
        self.lock = threading.RLock()
        self.worker = threading.Semaphore(1)
        self.jobs = OrderedDict()

    def submit(self, body, codex_config=None):
        if not isinstance(body, dict) or set(body) != {"prompt"}:
            raise BlenderAuthoringError("Expected a Blender asset prompt")
        prompt = body["prompt"]
        if not isinstance(prompt, str) or not 3 <= len(prompt.strip()) <= 1000:
            raise BlenderAuthoringError("Asset prompt must be 3 to 1000 characters")
        blender_executable()
        with self.lock:
            if sum(job["phase"] in ("queued", "designing", "building") for job in self.jobs.values()) >= 4:
                raise BlenderAuthoringError("Four Blender jobs are already active", 409)
            while len(self.jobs) >= 32:
                oldest = next(iter(self.jobs))
                if self.jobs[oldest]["phase"] in ("queued", "designing", "building"):
                    raise BlenderAuthoringError("Blender job history is full", 409)
                del self.jobs[oldest]
            job_id = uuid.uuid4().hex
            job = {"jobId": job_id, "phase": "queued", "prompt": prompt.strip(),
                   "createdAt": time.time(), "elapsedMs": None}
            self.jobs[job_id] = job
        threading.Thread(target=self._run, args=(job_id, codex_config), name="matrix-blender", daemon=True).start()
        return copy.deepcopy(job)

    def _run(self, job_id, codex_config):
        with self.worker:
            with self.lock:
                job = self.jobs[job_id]
                job["phase"] = "designing"
                prompt = job["prompt"]
                started = time.monotonic()
            try:
                recipe = (self.designer(prompt, config=codex_config) if codex_config is not None
                          else self.designer(prompt))
                validate_blueprint(recipe)
                with self.lock:
                    job["phase"] = "building"
                with tempfile.TemporaryDirectory(prefix="matrix-blender-build-") as directory:
                    output, bounds = self.builder(recipe, directory)
                    size = bounds["size"]
                    scale = min(1, 3 / max(size.values()))
                    asset = self.catalog.register(output, recipe["name"],
                                                  ("Created in Blender for: " + prompt)[:500],
                                                  spawn_scale=scale, local_bounds=bounds)
                result = {"phase": "ready", "asset": asset, "parts": len(recipe["parts"])}
            except (BlueprintError, BlenderAuthoringError, WebAssetError, OSError, ValueError, KeyError) as error:
                result = {"phase": "error", "error": str(error)[:500]}
            except Exception:
                result = {"phase": "error", "error": "Blender asset creation failed on the PC"}
            with self.lock:
                job.update(result, elapsedMs=round((time.monotonic() - started) * 1000))

    def status(self, job_id=None):
        with self.lock:
            if job_id is not None:
                job = self.jobs.get(job_id)
                if job is None:
                    raise BlenderAuthoringError("Unknown Blender job", 404)
                return copy.deepcopy(job)
            return {"jobs": [copy.deepcopy(job) for job in self.jobs.values()]}
