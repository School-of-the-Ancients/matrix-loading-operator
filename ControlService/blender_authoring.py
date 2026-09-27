"""On-demand PC Blender jobs that register immutable Quest-sized GLBs."""
from collections import OrderedDict
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

from blender_blueprint import BlueprintError, design_blueprint, validate_blueprint
from citizen_asset_profile import PROFILE_ID, PROFILE_REVISION, reviewed_blueprint
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
    def __init__(self, catalog, designer=design_blueprint, builder=build_in_blender,
                 citizen_directory=None):
        self.catalog = catalog
        self.designer = designer
        self.builder = builder
        self.lock = threading.RLock()
        self.worker = threading.Semaphore(1)
        self.jobs = OrderedDict()
        self.citizen_directory = Path(citizen_directory) if citizen_directory else None
        self.citizen_ids = {}
        if self.citizen_directory is not None:
            self._restore_citizen_jobs()

    def _citizen_path(self, host_world_id, citizen_request_id):
        digest = hashlib.sha256((host_world_id + "\0" + citizen_request_id).encode(
            "utf-8")).hexdigest()
        return self.citizen_directory / digest

    def _save_citizen_job(self, job):
        directory = self._citizen_path(job["hostWorldId"], job["citizenRequestId"])
        if directory.is_symlink():
            raise BlenderAuthoringError("Citizen Blender job directory is a link", 503)
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / "job.json"
        if target.is_symlink():
            raise BlenderAuthoringError("Citizen Blender job record is a link", 503)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory,
                                         prefix=".job-", delete=False) as handle:
            staged = Path(handle.name)
            json.dump(job, handle, ensure_ascii=False, allow_nan=False, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(staged, target)

    def _restore_citizen_jobs(self):
        if not self.citizen_directory.exists():
            return
        if self.citizen_directory.is_symlink():
            raise BlenderAuthoringError("Citizen Blender job directory is a link", 503)
        for folder in sorted(self.citizen_directory.iterdir()):
            if not folder.is_dir() or folder.is_symlink() or not folder.name.isalnum():
                continue
            record = folder / "job.json"
            if not record.is_file() or record.is_symlink():
                continue
            try:
                job = json.loads(record.read_text(encoding="utf-8"))
                request_id = job["citizenRequestId"]
                world_id = job["hostWorldId"]
                key = (world_id, request_id)
                if (type(request_id) is not str or
                        type(world_id) is not str or not world_id or
                        folder != self._citizen_path(world_id, request_id) or
                        type(job.get("jobId")) is not str or
                        re.fullmatch(r"[0-9a-f]{32}", job["jobId"]) is None or
                        re.fullmatch(r"[0-9a-f]{64}", job.get("requestSha256", "")) is None or
                        job.get("profileId") != PROFILE_ID or
                        job.get("profileRevision") != PROFILE_REVISION or
                        job.get("phase") not in ("queued", "building", "generated",
                                                 "registered", "ready", "error", "unconfirmed") or
                        job["jobId"] in self.jobs or key in self.citizen_ids):
                    raise ValueError("Invalid Citizen Blender job record")
            except (OSError, ValueError, KeyError, TypeError) as error:
                raise BlenderAuthoringError(
                    f"Citizen Blender job record is unreadable: {error}", 503) from None
            self.jobs[job["jobId"]] = job
            self.citizen_ids[key] = job["jobId"]
            if job["phase"] == "building":
                job.update(phase="unconfirmed", error="Blender was interrupted; inspect the retained job before retrying")
                self._save_citizen_job(job)
            elif job["phase"] in ("queued", "generated", "registered"):
                threading.Thread(target=self._run_profile, args=(job["jobId"],),
                                 name="matrix-citizen-blender", daemon=True).start()

    def submit_profile(self, host_world_id, citizen_request_id, request_sha256,
                       profile_id):
        """Reserve one durable reviewed job before any expensive Blender call."""
        if (self.citizen_directory is None or type(host_world_id) is not str or
                not 1 <= len(host_world_id) <= 64 or
                type(citizen_request_id) is not str or
                not 1 <= len(citizen_request_id) <= 256 or
                type(request_sha256) is not str or
                re.fullmatch(r"[0-9a-f]{64}", request_sha256) is None or
                profile_id != PROFILE_ID):
            raise BlenderAuthoringError("Invalid Citizen Blender generation profile")
        reviewed_blueprint(profile_id)
        with self.lock:
            key = (host_world_id, citizen_request_id)
            existing_id = self.citizen_ids.get(key)
            if existing_id is not None:
                if self.jobs[existing_id]["requestSha256"] != request_sha256:
                    raise BlenderAuthoringError("Citizen Blender request changed under its durable ID", 409)
                return copy.deepcopy(self.jobs[existing_id])
            blender_executable()
            if any(job.get("citizenRequestId") and job["phase"] in
                   ("queued", "building", "generated", "registered")
                   for job in self.jobs.values()):
                raise BlenderAuthoringError("A Citizen Blender job is already active", 409)
            job_id = uuid.uuid4().hex
            job = {"jobId": job_id, "phase": "queued",
                   "citizenRequestId": citizen_request_id, "profileId": profile_id,
                   "hostWorldId": host_world_id, "requestSha256": request_sha256,
                   "profileRevision": PROFILE_REVISION,
                   "createdAt": time.time(), "elapsedMs": None}
            self._save_citizen_job(job)
            self.jobs[job_id] = job
            self.citizen_ids[key] = job_id
        threading.Thread(target=self._run_profile, args=(job_id,),
                         name="matrix-citizen-blender", daemon=True).start()
        return copy.deepcopy(job)

    def resume_registration(self, job_id):
        """Retry only the cheap catalog step from retained generated bytes."""
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None or not job.get("citizenRequestId") or job["phase"] not in (
                    "generated", "registered"):
                raise BlenderAuthoringError("Citizen GLB is not ready for registration retry", 409)
            job.pop("error", None)
            self._save_citizen_job(job)
        threading.Thread(target=self._run_profile, args=(job_id,),
                         name="matrix-citizen-register", daemon=True).start()
        return copy.deepcopy(job)

    def _run_profile(self, job_id):
        with self.worker:
            with self.lock:
                job = self.jobs[job_id]
                phase = job["phase"]
                if phase == "queued":
                    job["phase"] = "building"
                    self._save_citizen_job(job)
                elif phase not in ("generated", "registered"):
                    return
                started = time.monotonic()
                directory = self._citizen_path(job["hostWorldId"],
                                               job["citizenRequestId"])
            try:
                if phase == "queued":
                    recipe = reviewed_blueprint(job["profileId"])
                    output, bounds = self.builder(recipe, directory)
                    output = Path(output)
                    if output.is_symlink() or (directory / "asset.glb").is_symlink():
                        raise BlenderAuthoringError("Citizen Blender GLB is a link", 503)
                    if output != directory / "asset.glb":
                        shutil.copyfile(output, directory / "asset.glb")
                        output = directory / "asset.glb"
                    with output.open("rb+") as handle:
                        os.fsync(handle.fileno())
                    digest = hashlib.sha256(output.read_bytes()).hexdigest()
                    with self.lock:
                        job.update(phase="generated", sha256=digest,
                                   localBounds=bounds, parts=len(recipe["parts"]))
                        self._save_citizen_job(job)
                output = directory / "asset.glb"
                if (output.is_symlink() or not output.is_file() or
                        hashlib.sha256(output.read_bytes()).hexdigest() != job["sha256"]):
                    raise BlenderAuthoringError("Retained Citizen GLB is missing or changed", 503)
                if job["phase"] == "generated":
                    size = job["localBounds"]["size"]
                    scale = min(1, 3 / max(size.values()))
                    asset = self.catalog.register(output, reviewed_blueprint(job["profileId"])["name"],
                                                  "Reviewed Citizen rest seat generated in Blender",
                                                  spawn_scale=scale,
                                                  local_bounds=job["localBounds"])
                    with self.lock:
                        job.update(phase="registered", asset=asset)
                        self._save_citizen_job(job)
                registered = next((item for item in self.catalog.list() if
                                   item["assetId"] == job["asset"]["assetId"] and
                                   item["sha256"] == job["sha256"]), None)
                if registered is None:
                    raise BlenderAuthoringError("Registered Citizen GLB is unavailable", 503)
                self.catalog.file(job["sha256"])
                with self.lock:
                    job.update(phase="ready", asset=registered,
                               elapsedMs=round((time.monotonic() - started) * 1000))
                    self._save_citizen_job(job)
            except (BlueprintError, BlenderAuthoringError, WebAssetError, OSError,
                    ValueError, KeyError, TypeError) as error:
                with self.lock:
                    # Retain generated bytes for a registration-only retry;
                    # never repeat Blender for this Citizen request.
                    failure_phase = (job["phase"] if job["phase"] in
                                     ("generated", "registered") else "error")
                    job.update(phase=failure_phase, error=str(error)[:500],
                               elapsedMs=round((time.monotonic() - started) * 1000))
                    self._save_citizen_job(job)
            except Exception:
                with self.lock:
                    job.update(phase="unconfirmed",
                               error="Citizen Blender job outcome is uncertain; inspect its retained files",
                               elapsedMs=round((time.monotonic() - started) * 1000))
                    self._save_citizen_job(job)

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
