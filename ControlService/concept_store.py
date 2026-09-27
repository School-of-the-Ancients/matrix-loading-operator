"""Durable PC-local concept versions around the existing ComfyUI content connector.

The selected image is art direction. Nothing in this module requests a Matrix
world mutation, and a later image result never changes the selection.
"""
from __future__ import annotations

import copy
import hashlib
import os
from pathlib import Path
import re
import secrets
import shutil
import tempfile
import threading
import time
import uuid

from content_catalog import ContentError, atomic_json


MAX_CONCEPTS = 100
MAX_IMAGE_BYTES = 24 * 1024 * 1024
SESSION_ID = re.compile(r"[0-9a-f]{32}\Z")
CONCEPT_ID = re.compile(r"[0-9a-f]{32}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
               "webp": "image/webp"}
ACTIVE = {"queued", "generating"}
TERMINAL = {"ready", "failed", "cancelled"}
NATIVE_PROVIDER = "codex-native"
COMFY_PROVIDER = "comfyui"


def require(ok, message, status=400):
    if not ok:
        raise ContentError(status, message)


def checked_text(value, name, limit, *, empty=False):
    require(isinstance(value, str) and (empty or bool(value.strip())) and len(value) <= limit
            and not any(ord(character) < 32 and character not in "\n\t" for character in value),
            "Invalid " + name)
    return value.strip()


def checked_id(value, name, pattern=CONCEPT_ID):
    require(isinstance(value, str) and pattern.fullmatch(value), "Invalid " + name)
    return value


def image_type(path: Path, filename: str):
    extension = Path(filename).suffix.lower().lstrip(".")
    require(extension in IMAGE_TYPES, "Configured workflow did not return a supported image", 422)
    with path.open("rb") as source:
        signature = source.read(32)
    valid = ((extension == "png" and signature.startswith(b"\x89PNG\r\n\x1a\n") and
              signature[12:16] == b"IHDR") or
             (extension in ("jpg", "jpeg") and signature.startswith(b"\xff\xd8\xff")) or
             (extension == "webp" and signature.startswith(b"RIFF") and signature[8:12] == b"WEBP"))
    require(valid, "Generated image format did not match its file extension", 422)
    return IMAGE_TYPES[extension], extension


class ConceptStore:
    """One JSON index plus immutable, content-addressed image files."""

    def __init__(self, directory: str | Path, catalog_factory, native_factory=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.images = self.directory / "images"
        self.images.mkdir(exist_ok=True)
        self.path = self.directory / "concepts.json"
        self.catalog_factory = catalog_factory
        self.native_factory = native_factory
        self.lock = threading.RLock()
        self.data = {"schemaVersion": 1, "sessions": {}}
        if self.path.exists():
            from content_catalog import read_json
            document = read_json(self.path)
            require(isinstance(document, dict) and document.get("schemaVersion") == 1 and
                    isinstance(document.get("sessions"), dict),
                    "Saved concepts require PC repair", 503)
            recovered = False
            for session_id, entry in document["sessions"].items():
                require(SESSION_ID.fullmatch(session_id) and isinstance(entry, dict) and
                        isinstance(entry.get("jobs"), list) and
                        isinstance(entry.get("builds", []), list),
                        "Saved concepts require PC repair", 503)
                # Native image events are not replayed after process restart.
                # A ComfyUI prompt ID can still be polled from its history.
                for job in entry["jobs"]:
                    require(isinstance(job, dict) and isinstance(job.get("conceptId"), str),
                            "Saved concepts require PC repair", 503)
                    if job.get("providerId") not in (None, COMFY_PROVIDER, NATIVE_PROVIDER):
                        job["connectorProviderId"] = job["providerId"]
                        job["providerId"] = COMFY_PROVIDER
                        recovered = True
                    if job.get("status") in ACTIVE and job.get("providerId") == NATIVE_PROVIDER:
                        job.update(status="failed", message="Native image turn outcome is unknown after service restart; request another version.")
                        recovered = True
                    elif job.get("status") in ACTIVE and not job.get("catalogJobId"):
                        job.update(status="failed", message="Submission outcome is unknown after service restart; request another version.")
                        recovered = True
            self.data = document
            if recovered:
                atomic_json(self.path, self.data)

    def _session(self, data, session_id):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        return data["sessions"].setdefault(session_id, {"selectedConceptId": None,
                                                          "jobs": [], "builds": []})

    def _change(self, mutate):
        with self.lock:
            changed = copy.deepcopy(self.data)
            result = mutate(changed)
            atomic_json(self.path, changed)
            self.data = changed
            return result

    @staticmethod
    def _find(entry, concept_id):
        return next((item for item in entry["jobs"] if item["conceptId"] == concept_id), None)

    @staticmethod
    def _public(job):
        result = {key: copy.deepcopy(value) for key, value in job.items()
                  if key not in ("catalogJobId", "nativeTurnId", "nativeError", "imageFile")}
        result["id"] = job["conceptId"]
        result["cancellable"] = (job["status"] == "queued" and
                                 job.get("providerId") != NATIVE_PROVIDER and
                                 bool(job.get("catalogJobId")))
        if job["status"] == "ready":
            result["previewUrl"] = "/api/agent/concepts/" + job["conceptId"] + "/preview"
            result["imageSha256"] = job["sha256"]
        return result

    def _choose_workflow(self):
        catalog = self.catalog_factory()
        provider_id = os.environ.get("MATRIX_CONCEPT_PROVIDER_ID")
        workflow_id = os.environ.get("MATRIX_CONCEPT_WORKFLOW_ID")
        require(bool(provider_id) == bool(workflow_id),
                "Set both MATRIX_CONCEPT_PROVIDER_ID and MATRIX_CONCEPT_WORKFLOW_ID on the PC", 503)
        choices = [(provider["id"], workflow["id"], workflow) for provider in catalog.providers.values()
                   if provider["type"] == "comfyui" and catalog._enabled(provider)
                   for workflow in provider["workflows"].values()
                   if (not provider_id or provider["id"] == provider_id and workflow["id"] == workflow_id)]
        require(len(choices) == 1,
                "Configure exactly one enabled ComfyUI image workflow or select one with MATRIX_CONCEPT_PROVIDER_ID and MATRIX_CONCEPT_WORKFLOW_ID", 503)
        chosen_provider, chosen_workflow, config = choices[0]
        require(bool(config["seedNode"]),
                "Concept workflow needs a configured KSampler seed input for distinct versions", 409)
        return catalog, chosen_provider, chosen_workflow

    def providers(self, session_id):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        native = {"id": NATIVE_PROVIDER, "label": "Codex GPT Image",
                  "available": False, "reason": "Native image generation is not configured."}
        if self.native_factory is not None:
            try:
                capability = self.native_factory().native_image_available(session_id)
                native["available"] = capability.get("available") is True
                native["reason"] = None if native["available"] else str(
                    capability.get("reason") or "Native image generation is unavailable.")[:240]
            except Exception:
                native["reason"] = "Native image generation is unavailable."
        comfy = {"id": COMFY_PROVIDER, "label": "ComfyUI",
                 "available": False, "reason": "No configured ComfyUI concept workflow."}
        try:
            catalog, connector_id, workflow_id = self._choose_workflow()
            title = catalog.providers[connector_id]["workflows"][workflow_id].get("title")
            if isinstance(title, str) and title.strip():
                comfy["label"] = "ComfyUI · " + title.strip()[:100]
            comfy.update(available=True, reason=None)
        except (ContentError, OSError, ValueError):
            pass
        return {"providers": [native, comfy],
                "defaultProviderId": (NATIVE_PROVIDER if native["available"] else
                                      COMFY_PROVIDER if comfy["available"] else None)}

    def create(self, session_id, prompt, *, source_concept_id=None, negative_prompt=None,
               provider_id=None):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        if source_concept_id is not None:
            checked_id(source_concept_id, "source concept ID")
        if prompt is not None:
            prompt = checked_text(prompt, "concept prompt", 4096)
        if negative_prompt is not None:
            negative_prompt = checked_text(negative_prompt, "negative concept prompt", 4096,
                                           empty=True)
        require(provider_id is None or provider_id in (NATIVE_PROVIDER, COMFY_PROVIDER),
                "Unknown concept image provider")
        available = self.providers(session_id)
        chosen = provider_id or available["defaultProviderId"] or COMFY_PROVIDER
        if provider_id is not None:
            selected_provider = next(item for item in available["providers"] if item["id"] == provider_id)
            require(selected_provider["available"], selected_provider["reason"] or
                    "Concept image provider is unavailable", 409)
        concept_id = uuid.uuid4().hex

        def reserve(data):
            entry = self._session(data, session_id)
            require(len(entry["jobs"]) < MAX_CONCEPTS, "Concept history is full", 409)
            seed = None
            if chosen == COMFY_PROVIDER:
                used_seeds = {existing.get("seed") for existing in entry["jobs"]}
                seed = secrets.randbelow(2**32)
                while seed in used_seeds:
                    seed = secrets.randbelow(2**32)
            parent = self._find(entry, source_concept_id) if source_concept_id else None
            require(source_concept_id is None or parent is not None,
                    "Source concept is not in this Agent session", 404)
            actual_prompt = prompt if prompt is not None else parent["prompt"] if parent else None
            require(actual_prompt is not None, "Concept prompt is required")
            actual_negative = (negative_prompt if negative_prompt is not None else
                               parent.get("negativePrompt", "") if parent else "")
            if chosen == NATIVE_PROVIDER:
                require(len(actual_prompt) + (8 + len(actual_negative) if actual_negative else 0) <= 4096,
                        "Native image prompt is too long", 400)
            job = {"conceptId": concept_id, "version": len(entry["jobs"]) + 1,
                   "parentConceptId": source_concept_id, "prompt": actual_prompt,
                   "negativePrompt": actual_negative, "designNotes": "", "seed": seed,
                   "providerId": chosen, "generationMode": "text-to-image", "status": "queued",
                   "message": "Submitting the image request.",
                   "createdAt": time.time()}
            entry["jobs"].append(job)
            return copy.deepcopy(job)

        job = self._change(reserve)
        if chosen == NATIVE_PROVIDER:
            try:
                # The same persistent Agent Portal Codex thread owns this turn.
                # Matrix mutation is blocked by the portal for image-only turns.
                native_prompt = job["prompt"]
                if job["negativePrompt"]:
                    native_prompt += "\nAvoid: " + job["negativePrompt"]
                submitted = self.native_factory().start_native_image(session_id, native_prompt)
                turn_id = checked_text(submitted["turnId"], "native image turn ID", 128)
                return {"job": self._set_fields(session_id, concept_id, nativeTurnId=turn_id,
                                                status="generating",
                                                message="Codex is generating the image.")}
            except Exception:
                return {"job": self._set_fields(session_id, concept_id, status="failed",
                                                message="Native image submission could not be confirmed; request another version.")}
        try:
            catalog, provider_id, workflow_id = self._choose_workflow()
            submitted = catalog.submit_workflow(provider_id, workflow_id, job["prompt"],
                                                approved=True, seed=job["seed"],
                                                negative_prompt=job["negativePrompt"],
                                                validate_image=True)
        except ContentError as error:
            return {"job": self._set_fields(session_id, concept_id,
                                            status="failed", message=str(error))}
        except (OSError, ValueError):
            return {"job": self._set_fields(session_id, concept_id, status="failed",
                                            message="PC image submission could not be confirmed; check the service.")}
        except Exception:
            return {"job": self._set_fields(session_id, concept_id, status="failed",
                                            message="PC image submission failed; check the service.")}
        return {"job": self._set_fields(session_id, concept_id,
                                        catalogJobId=submitted["id"],
                                        connectorProviderId=provider_id, workflowId=workflow_id,
                                        workflowSha256=submitted.get("workflowSha256"),
                                        model=submitted.get("model", []),
                                        status="queued", message="ComfyUI accepted the image job.")}

    def _set_fields(self, session_id, concept_id, **fields):
        def update(data):
            job = self._find(self._session(data, session_id), concept_id)
            require(job is not None, "Concept not found", 404)
            job.update(fields, updatedAt=time.time())
            return self._public(job)
        return self._change(update)

    def _copy_image(self, source, checksum, extension):
        require(source.stat().st_size <= MAX_IMAGE_BYTES,
                "Generated concept image exceeds the PC concept limit", 413)
        destination = self.images / (checksum + "." + extension)
        if destination.is_file():
            require(hashlib.sha256(destination.read_bytes()).hexdigest() == checksum,
                    "Saved concept image checksum failed", 422)
            return destination.name
        descriptor, temporary = tempfile.mkstemp(prefix=".concept-", dir=self.images)
        try:
            with os.fdopen(descriptor, "wb") as output, source.open("rb") as stream:
                shutil.copyfileobj(stream, output, 128 * 1024)
            require(hashlib.sha256(Path(temporary).read_bytes()).hexdigest() == checksum,
                    "Saved concept image checksum failed", 422)
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return destination.name

    def _native_fields(self, session_id, job):
        result = self.native_factory().native_image_result(session_id, job["nativeTurnId"])
        require(type(result) is dict, "Invalid native image result", 502)
        status = result.get("status")
        if status == "ready":
            image_path = result.get("imagePath")
            require(type(image_path) is str and Path(image_path).is_absolute() and
                    Path(image_path).is_file(),
                    "Native image artifact is unavailable", 422)
            source = Path(image_path).resolve(strict=True)
            mime, extension = image_type(source, source.name)
            require(result.get("mimeType") == mime,
                    "Native image format did not match its declared type", 422)
            size = source.stat().st_size
            require(0 < size <= MAX_IMAGE_BYTES,
                    "Generated concept image exceeds the PC concept limit", 413)
            checksum = hashlib.sha256(source.read_bytes()).hexdigest()
            require(checksum == result.get("sha256"),
                    "Native image checksum failed", 422)
            image_file = self._copy_image(source, checksum, extension)
            fields = {"status": "ready", "message": "Image ready.",
                      "sha256": checksum, "imageFile": image_file,
                      "mimeType": mime, "byteLength": size}
            revised = result.get("revisedPrompt")
            if type(revised) is str and revised.strip():
                fields["revisedPrompt"] = revised.strip()[:4096]
            return fields
        if status == "failed":
            return {"status": "failed", "message": "Codex reported an image generation failure."}
        if status == "cancelled":
            return {"status": "cancelled", "message": "Codex cancelled image generation."}
        require(status in ("queued", "generating"), "Invalid native image status", 502)
        return {"status": status, "message": "Codex is generating the image."}

    def refresh(self, session_id, concept_id=None):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        with self.lock:
            entry = self.data["sessions"].get(session_id)
            jobs = [] if entry is None else [copy.deepcopy(job) for job in entry["jobs"]
                                     if job["status"] in ACTIVE and
                                     (job.get("catalogJobId") or job.get("nativeTurnId")) and
                                     (concept_id is None or job["conceptId"] == concept_id)]
        for job in jobs:
            try:
                if job.get("providerId") == NATIVE_PROVIDER:
                    fields = self._native_fields(session_id, job)
                else:
                    catalog = self.catalog_factory()
                    generation = catalog.poll_generation(job["catalogJobId"])
                    if generation["status"] == "completed":
                        outputs = [output for output in generation["outputs"]
                                   if Path(output["filename"]).suffix.lower().lstrip(".") in IMAGE_TYPES]
                        require(len(outputs) == 1 and len(generation["outputs"]) == 1,
                                "Configured concept workflow must produce exactly one image", 422)
                        artifact = catalog.prepare_generation_output(job["catalogJobId"], 0)
                        source = catalog.cached_file(artifact["sha256"])
                        mime, extension = image_type(source, artifact["filename"])
                        image_file = self._copy_image(source, artifact["sha256"], extension)
                        fields = {"status": "ready", "message": "Image ready.",
                                  "sha256": artifact["sha256"], "imageFile": image_file,
                                  "mimeType": mime, "byteLength": artifact["byteLength"]}
                    elif generation["status"] == "failed":
                        fields = {"status": "failed", "message": "ComfyUI reported an image generation failure."}
                    elif generation["status"] == "cancelled":
                        fields = {"status": "cancelled", "message": "ComfyUI confirmed cancellation."}
                    elif generation["status"] == "running":
                        fields = {"status": "generating", "message": "ComfyUI is generating the image."}
                    elif generation["status"] == "missing":
                        fields = {"message": "ComfyUI has no queue or history entry; completion is unverified. Retry status later."}
                    else:
                        fields = {"status": "queued", "message": "Image is queued at ComfyUI."}
            except ContentError as error:
                if error.status == 404:
                    fields = {"status": "failed", "message": (
                        "Native image artifact is unavailable; request another version." if
                        job.get("providerId") == NATIVE_PROVIDER else
                        "Saved ComfyUI job is missing; request another version.")}
                elif error.status in (413, 422):
                    fields = {"status": "failed", "message": str(error)}
                else:
                    fields = {"message": "Image status could not be verified: " + str(error)}
            except (OSError, ValueError):
                fields = {"message": "Image status could not be verified; check the PC service."}
            except Exception:
                fields = {"message": "Image status could not be verified; check the PC service."}
            with self.lock:
                current_entry = self.data["sessions"].get(session_id)
                current = self._find(current_entry, job["conceptId"]) if current_entry else None
                token = "nativeTurnId" if job.get("providerId") == NATIVE_PROVIDER else "catalogJobId"
                if current and current["status"] in ACTIVE and current.get(token) == job.get(token):
                    self._set_fields(session_id, job["conceptId"], **fields)

    def status(self, session_id, *, refresh=True):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        if refresh:
            self.refresh(session_id)
        with self.lock:
            entry = self.data["sessions"].get(session_id, {"selectedConceptId": None,
                                                            "jobs": [], "builds": []})
            jobs = [self._public(job) for job in entry["jobs"]]
            return {"jobs": jobs, "concepts": [job for job in jobs if job["status"] == "ready"],
                    "selectedConceptId": entry["selectedConceptId"],
                    "builds": [self._public_build(build) for build in entry.get("builds", [])],
                    **self.providers(session_id)}

    def select(self, session_id, concept_id, design_notes=None):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        checked_id(concept_id, "concept ID")
        if design_notes is not None:
            design_notes = checked_text(design_notes, "concept design notes", 2048, empty=True)
        def update(data):
            entry = self._session(data, session_id)
            job = self._find(entry, concept_id)
            require(job is not None and job["status"] == "ready",
                    "Select a ready concept in this Agent session", 409)
            entry["selectedConceptId"] = concept_id
            if design_notes is not None:
                job["designNotes"] = design_notes
            return {"selectedConceptId": concept_id, "concept": self._public(job)}
        return self._change(update)

    def selected(self, session_id):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        with self.lock:
            entry = self.data["sessions"].get(session_id)
            if not entry or not entry["selectedConceptId"]:
                return None
            job = self._find(entry, entry["selectedConceptId"])
            require(job is not None and job["status"] == "ready", "Selected concept is unavailable", 409)
            result = copy.deepcopy(job)
        path = self._image_file(result)
        result["imagePath"] = str(path.resolve())
        return result

    def _image_file(self, job):
        require(job.get("status") == "ready" and isinstance(job.get("sha256"), str) and
                SHA.fullmatch(job["sha256"]), "Concept image is unavailable", 404)
        name = job.get("imageFile")
        require(isinstance(name, str) and re.fullmatch(r"[0-9a-f]{64}\.(png|jpg|jpeg|webp)", name) and
                name.startswith(job["sha256"] + "."), "Concept image is unavailable", 404)
        path = self.images / name
        require(path.is_file() and 0 < path.stat().st_size <= MAX_IMAGE_BYTES and
                hashlib.sha256(path.read_bytes()).hexdigest() == job["sha256"],
                "Concept image checksum failed", 422)
        return path

    def preview(self, concept_id):
        checked_id(concept_id, "concept ID")
        with self.lock:
            job = next((copy.deepcopy(job) for entry in self.data["sessions"].values()
                        for job in entry["jobs"] if job["conceptId"] == concept_id), None)
        require(job is not None, "Concept not found", 404)
        return self._image_file(job), job["mimeType"]

    def cancel(self, session_id, concept_id):
        checked_id(session_id, "Agent session ID", SESSION_ID)
        checked_id(concept_id, "concept ID")
        with self.lock:
            entry = self.data["sessions"].get(session_id)
            job = copy.deepcopy(self._find(entry, concept_id)) if entry else None
        require(job is not None, "Concept not found", 404)
        require(job["status"] == "queued" and job.get("catalogJobId"),
                "Only a confirmed queued ComfyUI concept can be cancelled", 409)
        result = self.catalog_factory().cancel_generation(job["catalogJobId"])
        if result["status"] == "cancelled":
            return {"job": self._set_fields(session_id, concept_id, status="cancelled",
                                            message="ComfyUI confirmed cancellation.")}
        self.refresh(session_id, concept_id)
        raise ContentError(409, "ComfyUI started or completed before cancellation; inspect the job status")

    @staticmethod
    def _public_build(build):
        result = {key: copy.deepcopy(value) for key, value in build.items() if key != "sourcePaths"}
        if build.get("sourcePaths"):
            result["sourceNames"] = [Path(path).name for path in build["sourcePaths"]]
        return result

    def build_provenance(self, session_id, build_request_id):
        """PC-only complete record, including source paths, for evidence/recovery."""
        checked_id(session_id, "Agent session ID", SESSION_ID)
        checked_id(build_request_id, "build request ID")
        with self.lock:
            entry = self.data["sessions"].get(session_id)
            build = (next((item for item in entry["builds"]
                           if item["buildRequestId"] == build_request_id), None)
                     if entry else None)
            require(build is not None, "Concept build not found", 404)
            return copy.deepcopy(build)

    def record_build(self, session_id, provenance):
        """Associate an explicit Codex turn and verified result with its selection.

        The caller owns runtime receipt verification. This method never infers a
        completed Matrix result from an Agent message or generated image.
        """
        checked_id(session_id, "Agent session ID", SESSION_ID)
        require(isinstance(provenance, dict) and set(provenance) <= {
            "buildRequestId", "conceptId", "turnId", "status", "strategy", "sourcePaths",
            "assetIds", "objectIds", "receipts", "roomId", "sceneRevision", "hostWorldId",
            "runtimeGeneration", "recipe"} and
            {"buildRequestId", "conceptId", "status"} <= set(provenance),
            "Invalid concept build provenance")
        build_request_id = checked_id(provenance["buildRequestId"], "build request ID")
        concept_id = checked_id(provenance["conceptId"], "build concept ID")
        require(provenance["status"] in ("requested", "completed", "failed"),
                "Invalid concept build status")
        result = {"buildRequestId": build_request_id, "conceptId": concept_id,
                  "status": provenance["status"]}
        if "turnId" in provenance:
            result["turnId"] = (checked_text(provenance["turnId"], "build turn ID", 128)
                                if provenance["turnId"] is not None else None)
        for key in ("strategy", "roomId", "hostWorldId"):
            if key in provenance and provenance[key] is not None:
                result[key] = checked_text(provenance[key], key, 256)
        for key in ("sceneRevision", "runtimeGeneration"):
            if key in provenance and provenance[key] is not None:
                require(type(provenance[key]) is int and provenance[key] >= 0,
                        "Invalid build " + key)
                result[key] = provenance[key]
        if "recipe" in provenance and provenance["recipe"] is not None:
            recipe = provenance["recipe"]
            require(isinstance(recipe, dict) and set(recipe) ==
                    {"generatorId", "generatorVersion", "sourceRevision"},
                    "Invalid concept build recipe")
            result["recipe"] = {key: checked_text(recipe[key], key, 128)
                                for key in ("generatorId", "generatorVersion", "sourceRevision")}
        for key in ("sourcePaths", "assetIds", "objectIds", "receipts"):
            if key in provenance:
                values = provenance[key]
                require(isinstance(values, list) and len(values) <= 32,
                        "Invalid build " + key)
                result[key] = [checked_text(value, key, 1024 if key == "sourcePaths" else 256)
                               for value in values]
        if result["status"] == "completed":
            require(result.get("objectIds") and result.get("receipts"),
                    "Completed concept build needs observed Matrix objects and receipts", 409)

        def update(data):
            entry = self._session(data, session_id)
            concept = self._find(entry, concept_id)
            require(concept is not None and concept["status"] == "ready",
                    "Build concept is not ready in this session", 409)
            prior = next((build for build in entry["builds"]
                          if build["buildRequestId"] == build_request_id), None)
            if prior:
                require(prior["conceptId"] == concept_id,
                        "Build request is bound to a different concept", 409)
                require(prior["status"] == "requested",
                        "Build provenance cannot be rewritten", 409)
                require(result["status"] != "requested" or
                        (result.get("turnId") is not None and prior.get("turnId") is None),
                        "Requested build update needs its first turn ID", 409)
                require(result.get("turnId") is None or prior.get("turnId") in (None, result["turnId"]),
                        "Build turn ID cannot change", 409)
                require("turnId" not in result or result["turnId"] is not None or
                        prior.get("turnId") is None,
                        "Build turn ID cannot be cleared", 409)
                if result["status"] == "completed":
                    require(result.get("turnId") or prior.get("turnId"),
                            "Completed concept build needs its Codex turn ID", 409)
                for key in ("roomId", "sceneRevision", "hostWorldId", "runtimeGeneration"):
                    require(key not in result or key not in prior or result[key] == prior[key],
                            "Build request world context cannot change", 409)
                prior.update(result, updatedAt=time.time())
                return self._public_build(prior)
            require(result["status"] == "requested", "Build must start with a requested record", 409)
            require(entry["selectedConceptId"] == concept_id,
                    "Build request must use the explicitly selected concept", 409)
            require(len(entry["builds"]) < MAX_CONCEPTS, "Concept build history is full", 409)
            build = {**result, "conceptVersion": concept["version"],
                     "conceptSha256": concept["sha256"], "createdAt": time.time()}
            entry["builds"].append(build)
            return self._public_build(build)
        return self._change(update)
