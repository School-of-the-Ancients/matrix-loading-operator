"""PC download jobs and lease-bound, acknowledged runtime pack installation."""
import copy
import os
import re
import threading
import time
import uuid

from content_catalog import ContentCatalog, ContentError


def require(ok, message, status=400):
    if not ok:
        raise ContentError(status, message)


def runtime_capabilities(value):
    if value is None:
        return {"supported": False, "platform": "", "unityVersion": ""}
    require(isinstance(value, dict) and type(value.get("supported")) is bool, "Invalid content runtime capability")
    require(value.get("platform") in ("Android", "StandaloneWindows64", "unsupported"), "Invalid runtime content platform")
    version = value.get("unityVersion")
    require(isinstance(version, str) and re.fullmatch(r"[0-9A-Za-z.]{1,48}", version), "Invalid runtime Unity version")
    return {"supported": value["supported"], "platform": value["platform"], "unityVersion": version}


class ContentBridge:
    def __init__(self, state, catalog=None):
        self.state = state
        self._catalog = catalog
        self.catalog_lock = threading.Lock()
        self.runtime = runtime_capabilities(None)
        self.jobs = {}
        self.events = {}
        self.search_results = []

    @property
    def catalog(self):
        with self.catalog_lock:
            if self._catalog is None:
                self._catalog = ContentCatalog(cache_dir=os.environ.get("MATRIX_CONTENT_CACHE") or self.state.directory / ".content-cache")
        return self._catalog

    def expire(self):
        for job in self.jobs.values():
            if job["phase"] in ("preparing", "installing") and (not self.state.online() or self.state.client_id != job["clientId"]):
                job.update(phase="error", error="Runtime disconnected; installation outcome is unknown. Reconnect and retry.")
                self.events[job["requestId"]].set()
            elif job["phase"] == "installing" and time.monotonic() - job["installStarted"] > 180:
                job.update(phase="error", error="Runtime installation acknowledgement timed out. Check the runtime before retrying.")

    def busy(self):
        self.expire()
        return any(job["phase"] in ("preparing", "installing") for job in self.jobs.values())

    @staticmethod
    def public_job(job):
        return {key: copy.deepcopy(value) for key, value in job.items()
                if key not in ("clientId", "manifest", "installStarted")}

    def status(self):
        # Provider config / filesystem reads do not hold the scene lock.
        catalog_status = self.catalog.status()
        with self.state.lock:
            self.expire()
            return {**catalog_status, "runtime": {**self.runtime, "online": self.state.online()},
                    "jobs": [self.public_job(job) for job in self.jobs.values()],
                    "imports": self.catalog.import_queue(), "generations": self.catalog.generations()}

    def search(self, body):
        require(set(body) <= {"query", "category", "providerId", "offset", "limit", "cursor"}, "Unknown catalog search field")
        result = self.catalog.search(body.get("query", ""), category=body.get("category") or None,
                                     provider_id=body.get("providerId") or None,
                                     offset=body.get("offset", 0), limit=body.get("limit", 100),
                                     cursor=body.get("cursor"))
        with self.state.lock:
            self.search_results = copy.deepcopy(result)
        return result

    def planner_context(self, prompt="", installed_assets=None):
        """Bounded source suggestions and user searches; never download or install."""
        with self.state.lock:
            runtime = copy.deepcopy(self.runtime)
            rows = copy.deepcopy(self.search_results.get("assets", []) if isinstance(self.search_results, dict) else [])
        normalized = " " + re.sub(r"[^a-z0-9]+", " ", prompt.casefold()).strip() + " "
        installed = any(" " + re.sub(r"[^a-z0-9]+", " ", name.casefold()).strip() + " " in normalized
                        for asset in (installed_assets or []) if isinstance(asset, dict)
                        for name in (asset.get("assetId"), asset.get("displayName")) if isinstance(name, str) and name)
        discovery_intent = bool(re.search(r"\b(add|create|find|give|import|make|place|put|search|show|spawn|summon)\b", prompt, re.I))
        alternative_intent = bool(re.search(r"\b(another|alternative|better|replace|replacement)\b", prompt, re.I))
        ready = (self.catalog.suggest_ready(prompt, limit=40, platform=runtime["platform"],
                                            unity_version=runtime["unityVersion"])
                 if runtime["supported"] and discovery_intent and (not installed or alternative_intent)
                 and hasattr(self.catalog, "suggest_ready") else [])
        environment_intent = bool(re.search(r"\b(skybox|sky|hdri|panorama|background|environment)\b", prompt, re.I))
        material_intent = bool(re.search(r"\b(material|texture)\b", prompt, re.I))
        if not environment_intent and not material_intent:
            ready = [item for item in ready if item.get("category") == "objects"]
        public = self.catalog.suggest_public(prompt) if discovery_intent and (not installed or alternative_intent) and hasattr(self.catalog, "suggest_public") else []
        selected, seen = [], set()
        for asset in ready + public + rows:
            if asset.get("runtimeLoadable"):
                pack = asset.get("metadata", {}).get("contentPack", {})
                if (not runtime["supported"] or asset.get("targetPlatform") != runtime["platform"]
                        or pack.get("unityVersion") != runtime["unityVersion"]):
                    continue
            identity = (asset.get("providerId"), asset.get("assetId"), asset.get("version"), asset.get("targetPlatform"))
            if identity in seen:
                continue
            seen.add(identity)
            item = {key: copy.deepcopy(asset[key]) for key in ("providerId", "assetId", "version", "title", "category",
                   "format", "targetPlatform", "license", "runtimeLoadable", "discoveryOnly") if key in asset}
            source_url = asset.get("metadata", {}).get("sourceUrl")
            if isinstance(source_url, str) and (source_url.startswith("https://polyhaven.com/a/") or
                                                source_url.startswith("https://sketchfab.com/models/")):
                item["sourcePage"] = source_url
            selected.append(item)
            if len(selected) == 40:
                break
        return selected

    def post(self, path, body):
        if path == "/api/content/search":
            return self.search(body)
        if path == "/api/content/recommend":
            return self.recommend(body)
        if path == "/api/content/install":
            return self.queue_install(body)
        if path == "/api/content/cancel":
            return self.cancel(body.get("requestId"))
        if path == "/api/content/providers/test":
            return self.catalog.test_provider(body.get("providerId"))
        if path == "/api/content/providers/enable":
            return self.catalog.set_enabled(body.get("providerId"), body.get("enabled"))
        if path == "/api/content/prepare":
            return self.catalog.prepare(body.get("providerId"), body.get("assetId"), body.get("version"),
                                        target_platform=body.get("targetPlatform"))
        if path == "/api/content/imports":
            return self.catalog.queue_import(body.get("source"), body.get("title", ""),
                                              body.get("category", "objects"), body.get("notes", ""))
        if path == "/api/content/imports/update":
            return self.catalog.update_import(body.get("id"), body.get("status"), body.get("notes", ""))
        if path == "/api/content/generate":
            return self.catalog.submit_workflow(body.get("providerId"), body.get("workflowId"),
                                                 body.get("prompt", ""), body.get("approved", False))
        if path == "/api/content/generate/poll":
            return self.catalog.poll_generation(body.get("id"))
        if path == "/api/content/generate/cancel":
            return self.catalog.cancel_generation(body.get("id"))
        if path == "/api/content/generate/output":
            return self.catalog.prepare_generation_output(body.get("id"), body.get("outputIndex"))
        raise ContentError(404, "Content operation not found")

    def recommend(self, body):
        """Return exact, compatible prefab pack IDs for a requested scene object."""
        require(isinstance(body, dict) and set(body) == {"text"} and isinstance(body["text"], str)
                and 0 < len(body["text"]) <= 4000, "Recommend requires request text")
        with self.state.lock:
            runtime = copy.deepcopy(self.runtime)
            installed = {asset.get("assetId") for asset in (self.state.latest or {}).get("assets", [])}
        if not runtime["supported"]:
            return {"candidates": []}
        candidates = []
        for row in self.catalog.suggest_ready(body["text"], limit=10,
                                              platform=runtime["platform"], unity_version=runtime["unityVersion"]):
            pack = row.get("metadata", {}).get("contentPack", {})
            prefab_ids = [item.get("assetId") for item in pack.get("assets", []) if isinstance(item, dict)]
            if row.get("targetPlatform") != runtime["platform"] or pack.get("unityVersion") != runtime["unityVersion"] or not prefab_ids:
                continue
            candidates.append({"providerId": row["providerId"], "assetId": row["assetId"], "version": row["version"],
                               "targetPlatform": row["targetPlatform"], "title": row["title"], "prefabAssetIds": prefab_ids,
                               "installed": all(asset_id in installed for asset_id in prefab_ids)})
        return {"candidates": candidates}

    def queue_install(self, body):
        require(set(body) <= {"providerId", "assetId", "version", "targetPlatform"}, "Unknown install field")
        for key in ("providerId", "assetId", "version"):
            require(isinstance(body.get(key), str) and 0 < len(body[key]) <= 128, "Install requires " + key)
        with self.state.lock:
            self.state.expire()
            require(self.state.online() and self.state.latest is not None and self.runtime["supported"],
                    "Connect an updated runtime before installing content", 409)
            require(not self.state.pending and not self.busy(), "Wait for pending edits or content installation", 409)
            require(self.state.capture_status()["status"] != "pending", "Wait for the image capture to finish", 409)
            platform = self.runtime["platform"]
            require(body.get("targetPlatform", platform) == platform, "Content platform does not match connected runtime", 409)
            while len(self.jobs) >= 32:
                key = next(iter(self.jobs))
                del self.jobs[key]
                self.events.pop(key, None)
            key = uuid.uuid4().hex
            job = {"requestId": key, "phase": "preparing", "providerId": body["providerId"],
                   "assetId": body["assetId"], "version": body["version"], "platform": platform,
                   "clientId": self.state.client_id, "error": "", "assetIds": []}
            runtime = copy.deepcopy(self.runtime)
            self.jobs[key] = job
            event = self.events[key] = threading.Event()
            # Freeze the initial response before the worker can add manifest
            # fields; iterating a concurrently growing dict can raise RuntimeError.
            response = self.public_job(job)

        def prepare():
            try:
                prepared = self.catalog.prepare(body["providerId"], body["assetId"], body["version"],
                                                target_platform=platform, cancel_event=event)
                asset = prepared.get("asset", prepared)
                require(not asset.get("dependencies"), "Pack dependencies must be flattened in the Unity exporter before installation", 422)
                manifest = (asset.get("metadata") or {}).get("contentPack")
                require(prepared.get("runtimeLoadable") is True and isinstance(manifest, dict),
                        "This item needs the Unity import queue; only exported prefab packs can load at runtime", 422)
                require(manifest.get("platform") == platform and manifest.get("unityVersion") == runtime["unityVersion"],
                        "Pack platform or Unity version differs from the player; export a matching pack", 409)
                require(manifest.get("sha256") == prepared.get("sha256") and manifest.get("byteLength") == prepared.get("byteLength"),
                        "Content pack and cached file identity disagree", 422)
                with self.state.lock:
                    self.expire()
                    if event.is_set() or job["phase"] != "preparing":
                        return
                    job.update(phase="installing", manifest=copy.deepcopy(manifest), installStarted=time.monotonic())
            except ContentError as error:
                with self.state.lock:
                    if job["phase"] == "preparing":
                        job.update(phase="cancelled" if event.is_set() else "error", error=str(error))
            except Exception:
                with self.state.lock:
                    job.update(phase="error", error="Content preparation failed. Check the configured provider and pack.")

        try:
            threading.Thread(target=prepare, daemon=True, name="matrix-content-prepare").start()
        except Exception:
            with self.state.lock:
                event.set()
                job.update(phase="error", error="Content preparation worker could not start. Retry when the PC service has available resources.")
            raise ContentError(503, "Content preparation worker could not start") from None
        return response

    def cancel(self, request_id):
        require(isinstance(request_id, str) and re.fullmatch(r"[a-f0-9]{32}", request_id), "Invalid content request ID")
        with self.state.lock:
            job = self.jobs.get(request_id)
            require(job is not None, "Unknown content job", 404)
            require(job["phase"] == "preparing", "Only PC preparation can be cancelled; await runtime installation acknowledgement", 409)
            self.events[request_id].set()
            job.update(phase="cancelled", error="Cancelled before sending an install request to the runtime.")
            return self.public_job(job)

    def exchange(self, capabilities, receipt):
        # Caller owns scene lock. No provider/network access here.
        self.runtime = capabilities
        self.expire()
        if receipt and isinstance(receipt, dict) and receipt.get("requestId"):
            require(isinstance(receipt["requestId"], str) and re.fullmatch(r"[a-f0-9]{32}", receipt["requestId"]),
                    "Invalid content receipt request ID")
            job = self.jobs.get(receipt["requestId"])
            if job and job["phase"] == "installing" and job["clientId"] == self.state.client_id:
                require(type(receipt.get("ok")) is bool, "Invalid content installation receipt")
                if receipt["ok"]:
                    manifest = job["manifest"]
                    require(all(receipt.get(key) == manifest[key] for key in ("packId", "version", "sha256")),
                            "Content receipt identity differs from requested pack", 409)
                    expected = {asset["assetId"] for asset in job["manifest"]["assets"]}
                    source = {key: manifest[key] for key in ("providerId", "packId", "version", "sha256", "platform", "unityVersion")}
                    if self.state.latest is not None:
                        installed = {asset["assetId"]: asset for asset in self.state.latest["assets"]}
                        require(expected <= installed.keys() and all(installed[key].get("source") == source for key in expected),
                                "Content receipt is missing registered runtime assets or their exact provenance", 409)
                        job.update(phase="ready", assetIds=sorted(expected), error="")
                    # A room reload can remove the snapshot immediately after
                    # successful registration. Keep the heartbeat valid and resend
                    # the same request below: the runtime retains its receipt and
                    # retries it with the next localized catalog. A receipt alone
                    # never establishes that the matching assets are available.
                else:
                    error = receipt.get("error")
                    require(isinstance(error, str) and 0 < len(error) <= 2048, "Invalid install error")
                    job.update(phase="error", error=error)
        for job in self.jobs.values():
            if job["phase"] == "installing" and job["clientId"] == self.state.client_id:
                return {"requestId": job["requestId"], "manifest": copy.deepcopy(job["manifest"])}
        return None
