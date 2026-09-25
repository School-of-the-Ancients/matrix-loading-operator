"""Session-scoped, bounded authoring jobs for static browser GLB prototypes."""
from collections import OrderedDict
import copy
from pathlib import Path
import tempfile
import threading
import time
import uuid

from procedural_glb import PALETTES, SHAPES, build_glb
from web_assets import WebAssetError


class WebAuthoringError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def checked_spec(body):
    if not isinstance(body, dict) or set(body) != {"name", "shape", "palette", "width", "height", "depth", "brief"}:
        raise WebAuthoringError("Expected name, shape, palette, width, height, depth and brief")
    name, brief = body["name"], body["brief"]
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise WebAuthoringError("Asset name must be 1 to 80 characters")
    if not isinstance(brief, str) or len(brief) > 500:
        raise WebAuthoringError("Brief must be at most 500 characters")
    if (not isinstance(body["shape"], str) or body["shape"] not in SHAPES
            or not isinstance(body["palette"], str) or body["palette"] not in PALETTES):
        raise WebAuthoringError("Choose a supported shape and palette")
    dimensions = {}
    for key, low, high in (("width", .5, 4), ("height", .5, 4), ("depth", .2, 2)):
        value = body[key]
        if type(value) not in (int, float) or not low <= value <= high:
            raise WebAuthoringError(f"{key} must be {low} to {high} metres")
        dimensions[key] = round(float(value), 3)
    return {"name": name.strip(), "brief": brief.strip(), "shape": body["shape"],
            "palette": body["palette"], **dimensions}


class WebAuthoringJobs:
    def __init__(self, catalog):
        self.catalog = catalog
        self.lock = threading.RLock()
        self.worker = threading.Semaphore(1)
        self.jobs = OrderedDict()

    def submit(self, body):
        spec = checked_spec(body)
        try:
            build_glb(spec)  # Validate recipe geometry before reserving a slot.
        except ValueError as error:
            raise WebAuthoringError(str(error)) from None
        with self.lock:
            if sum(job["phase"] in ("queued", "building") for job in self.jobs.values()) >= 4:
                raise WebAuthoringError("Four authoring jobs are already active", 409)
            while len(self.jobs) >= 32:
                oldest = next(iter(self.jobs))
                if self.jobs[oldest]["phase"] in ("queued", "building"):
                    raise WebAuthoringError("Authoring history is full", 409)
                del self.jobs[oldest]
            job_id = uuid.uuid4().hex
            job = {"jobId": job_id, "phase": "queued", "spec": spec,
                   "createdAt": time.time(), "elapsedMs": None}
            self.jobs[job_id] = job
        threading.Thread(target=self._run, args=(job_id,), daemon=True).start()
        return copy.deepcopy(job)

    def _run(self, job_id):
        with self.worker:
            with self.lock:
                job = self.jobs[job_id]
                job["phase"] = "building"
                started = time.monotonic()
                spec = copy.deepcopy(job["spec"])
            try:
                output = build_glb(spec)
                with tempfile.TemporaryDirectory(prefix="matrix-web-author-") as directory:
                    source = Path(directory) / "asset.glb"
                    source.write_bytes(output)
                    description = (f"Procedural {spec['palette']} {spec['shape']}; "
                                   f"{spec['width']} × {spec['height']} × {spec['depth']} m. "
                                   + spec["brief"])
                    asset = self.catalog.register(source, spec["name"], description[:500])
                update = {"phase": "ready", "asset": asset}
            except (OSError, WebAssetError, ValueError) as error:
                update = {"phase": "error", "error": str(error)[:300]}
            with self.lock:
                self.jobs[job_id].update(update, elapsedMs=round((time.monotonic() - started) * 1000))

    def status(self, job_id=None):
        with self.lock:
            if job_id is not None:
                job = self.jobs.get(job_id)
                if job is None:
                    raise WebAuthoringError("Unknown authoring job", 404)
                return copy.deepcopy(job)
            return {"jobs": [copy.deepcopy(job) for job in self.jobs.values()]}
