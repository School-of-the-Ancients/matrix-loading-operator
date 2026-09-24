"""PC-owned, bounded content catalogs, download cache and Editor import handoff.

Catalog data is descriptive, never executable. Credentials and local source paths
stay on the PC. A downloaded bundle still needs the player's independent checks.
"""
from __future__ import annotations

import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

MAX_MANIFEST = 2 * 1024 * 1024
MAX_DOWNLOAD = 128 * 1024 * 1024
MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024
MAX_ASSETS = 1000
MAX_QUEUE = 200
CATEGORIES = ("environments", "objects", "games", "characters", "voices", "animations", "sounds", "behaviors", "materials")
FORMATS = {"assetbundle", "png", "jpg", "jpeg", "hdr", "exr", "mp4", "webm", "wav", "ogg", "glb", "gltf", "fbx", "unitypackage", "declarative-behavior"}
POLYHAVEN_ASSETS_URL = "https://api.polyhaven.com/assets?t=all"
POLYHAVEN_CACHE_SECONDS = 600
SKETCHFAB_SEARCH_URL = "https://api.sketchfab.com/v3/search"
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")


class ContentError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def require(value, message, status=400):
    if not value:
        raise ContentError(status, message)


def string(value, field, maximum=256, empty=False):
    require(isinstance(value, str) and (empty or bool(value)) and len(value) <= maximum
            and not any(ord(c) < 32 for c in value), "Invalid " + field)
    return value


def identifier(value, field):
    require(isinstance(value, str) and ID.fullmatch(value), "Invalid " + field)
    return value


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def read_json(path, limit=MAX_MANIFEST):
    try:
        with Path(path).open("rb") as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, "JSON document exceeds size limit")
        return json.loads(data.decode("utf-8-sig"))
    except (OSError, UnicodeError, ValueError):
        raise ContentError(400, "Cannot read configured JSON document") from None


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".catalog-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(json_bytes(value))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def http_url(value):
    value = string(value, "URL", 2048)
    parsed = urllib.parse.urlsplit(value)
    require(parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username
            and not parsed.password and not parsed.fragment, "Only HTTP(S) URLs without embedded credentials are supported")
    try:
        parsed.port
    except ValueError:
        raise ContentError(400, "Invalid URL port") from None
    return value


def origin(value):
    parsed = urllib.parse.urlsplit(http_url(value))
    return parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)


def beneath(root, relative):
    relative = string(relative, "relative file location", 1024)
    require(not Path(relative).is_absolute() and not re.match(r"^[A-Za-z]:", relative)
            and not relative.startswith(("/", "\\")), "Absolute catalog paths are forbidden")
    candidate = (root / relative).resolve()
    require(candidate.is_relative_to(root.resolve()), "Catalog location escapes its directory")
    return candidate


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ContentError(502, "Provider redirects are disabled; configure its final URL")


def public_asset(asset, provider_id):
    # location and private provider configuration never reach the browser/model.
    result = {key: copy.deepcopy(value) for key, value in asset.items() if key != "location"}
    result["providerId"] = provider_id
    result["runtimeLoadable"] = asset["format"] == "assetbundle"
    result["requiresEditor"] = asset["format"] != "assetbundle"
    return result


def validate_manifest(document):
    require(isinstance(document, dict) and type(document.get("schemaVersion")) is int
            and document["schemaVersion"] == 1, "Unsupported content manifest schemaVersion")
    assets = document.get("assets")
    require(isinstance(assets, list) and len(assets) <= MAX_ASSETS, "Invalid catalog assets")
    result, identities = [], set()
    for raw in assets:
        require(isinstance(raw, dict), "Invalid catalog asset")
        item = {"assetId": identifier(raw.get("assetId"), "assetId"),
                "version": identifier(raw.get("version"), "version"),
                "title": string(raw.get("title"), "title"),
                "category": raw.get("category"), "format": raw.get("format"),
                "targetPlatform": identifier(raw.get("targetPlatform", "Any"), "targetPlatform"),
                "sha256": raw.get("sha256"), "byteLength": raw.get("byteLength"),
                "location": string(raw.get("location"), "location", 2048)}
        require(item["category"] in CATEGORIES, "Unsupported content category")
        require(isinstance(item["format"], str) and item["format"] in FORMATS, "Unsupported or executable content format")
        require(isinstance(item["sha256"], str) and SHA.fullmatch(item["sha256"]), "Invalid content sha256")
        require(type(item["byteLength"]) is int and 0 < item["byteLength"] <= MAX_DOWNLOAD, "Invalid content byteLength")
        identity = item["assetId"], item["version"], item["targetPlatform"]
        require(identity not in identities, "Duplicate asset/version/platform identity")
        identities.add(identity)
        license_info = raw.get("license")
        require(isinstance(license_info, dict), "Content license is required")
        item["license"] = {"name": string(license_info.get("name"), "license name"),
                           "url": string(license_info.get("url", ""), "license URL", 2048, True),
                           "attribution": string(license_info.get("attribution", ""), "license attribution", 2048, True)}
        if item["license"]["url"]:
            http_url(item["license"]["url"])
        dependencies = raw.get("dependencies", [])
        require(isinstance(dependencies, list) and len(dependencies) <= 32, "Invalid content dependencies")
        item["dependencies"] = []
        seen_dependencies = set()
        for dependency in dependencies:
            require(isinstance(dependency, dict), "Invalid content dependency")
            dependency = {key: identifier(dependency.get(key), key) for key in ("providerId", "assetId", "version")}
            identity = tuple(dependency.values())
            require(identity not in seen_dependencies, "Duplicate content dependency")
            seen_dependencies.add(identity)
            item["dependencies"].append(dependency)
        metadata = raw.get("metadata", {})
        require(isinstance(metadata, dict), "Invalid content metadata")
        try:
            require(len(json_bytes(metadata)) <= 32768, "Content metadata exceeds size limit")
        except (TypeError, ValueError):
            raise ContentError(400, "Invalid content metadata") from None
        # Metadata is public descriptive data. Only known fields are forwarded;
        # arbitrary provider fields could accidentally contain PC credentials.
        item["metadata"] = {key: copy.deepcopy(metadata[key]) for key in
                            ("description", "tags", "dimensions", "orientation", "questSuitability", "contentPack", "projection", "durationSeconds")
                            if key in metadata}
        if item["format"] == "assetbundle":
            pack = item["metadata"].get("contentPack")
            require(isinstance(pack, dict) and type(pack.get("schemaVersion")) is int and pack["schemaVersion"] == 1, "AssetBundle metadata.contentPack is required")
            require(pack.get("sha256") == item["sha256"] and pack.get("byteLength") == item["byteLength"]
                    and pack.get("version") == item["version"] and pack.get("platform") == item["targetPlatform"],
                    "Content pack identity does not match catalog entry")
            identifier(pack.get("packId"), "packId")
            identifier(pack.get("providerId"), "pack providerId")
            string(pack.get("unityVersion"), "pack unityVersion", 64)
            require(isinstance(pack.get("assets"), list) and 0 < len(pack["assets"]) <= 32, "Invalid content pack assets")
            require(pack["packId"] == item["assetId"], "Pack id must match catalog assetId")
            prefab_ids = set()
            for prefab in pack["assets"]:
                require(isinstance(prefab, dict), "Invalid content pack prefab")
                prefab_id = string(prefab.get("assetId"), "prefab assetId", 128)
                require(prefab_id.startswith(":".join((pack["providerId"], pack["packId"], pack["version"])) + ":")
                        and re.fullmatch(r"[A-Za-z0-9._:-]+", prefab_id) and prefab_id not in prefab_ids,
                        "Invalid or duplicate namespaced prefab assetId")
                prefab_ids.add(prefab_id)
                prefab_path = string(prefab.get("prefabPath"), "prefab path", 512)
                require(prefab_path.lower().startswith("assets/") and prefab_path.lower().endswith(".prefab")
                        and ".." not in prefab_path.split("/"), "Invalid bundled prefab path")
                string(prefab.get("displayName"), "prefab displayName", 256)
        result.append(item)
    return result


class ContentCatalog:
    def __init__(self, config_path=None, cache_dir=None):
        self.config_path = Path(config_path or os.environ["MATRIX_CONTENT_CONFIG"]).resolve() if config_path or os.environ.get("MATRIX_CONTENT_CONFIG") else None
        self.cache_dir = Path(cache_dir or os.environ.get("MATRIX_CONTENT_CACHE") or Path(__file__).resolve().parent.parent / "work" / "content-cache").resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.reserved_bytes = 0
        self.pending_generations = set()
        self.providers = {}
        self.polyhaven_cache = None
        self.polyhaven_cached_at = 0.0
        self.config_error = ""
        self.state_path = self.cache_dir / "state.json"
        self.state = {"schemaVersion": 1, "enabled": {}, "imports": [], "generations": []}
        if self.state_path.exists():
            state = read_json(self.state_path)
            require(isinstance(state, dict) and state.get("schemaVersion") == 1
                    and isinstance(state.get("enabled"), dict) and isinstance(state.get("imports"), list)
                    and isinstance(state.get("generations"), list), "Invalid persisted content state")
            self.state = state
        if self.config_path:
            try:
                self._configure(read_json(self.config_path))
            except ContentError as error:
                self.config_error = str(error)
        else:
            # Read-only public discovery is useful before the user has exported a pack.
            self._configure({"schemaVersion": 1, "providers": [
                {"id": "polyhaven", "type": "polyhaven", "title": "Poly Haven", "enabled": True},
                {"id": "sketchfab", "type": "sketchfab", "title": "Sketchfab models", "enabled": True}]})

    def _configure(self, config):
        require(isinstance(config, dict) and config.get("schemaVersion") == 1, "Unsupported content configuration")
        providers = config.get("providers")
        require(isinstance(providers, list) and len(providers) <= 32, "Invalid content provider list")
        configured = {}
        for raw in providers:
            require(isinstance(raw, dict), "Invalid provider configuration")
            provider_id = identifier(raw.get("id"), "provider id")
            require(provider_id not in configured, "Duplicate provider id")
            kind = raw.get("type")
            require(kind in ("local", "http", "polyhaven", "sketchfab", "comfyui", "generation-handoff"), "Unsupported content provider type")
            require(type(raw.get("enabled", False)) is bool, "Invalid provider enabled flag")
            provider = {"id": provider_id, "type": kind, "enabled": raw.get("enabled", False),
                        "title": string(raw.get("title", provider_id), "provider title")}
            token_env = raw.get("tokenEnv", "")
            require(isinstance(token_env, str), "Invalid credential environment variable")
            if token_env:
                require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", token_env), "Invalid credential environment variable")
            provider["tokenEnv"] = token_env
            if kind == "local":
                provider["manifest"] = (self.config_path.parent / string(raw.get("manifest"), "manifest path", 2048)).resolve()
            elif kind == "http":
                provider["manifestUrl"] = http_url(raw.get("manifestUrl"))
            elif kind == "polyhaven":
                require(not token_env, "Poly Haven public discovery does not use credentials")
            elif kind == "sketchfab":
                require(not token_env, "Sketchfab public discovery does not use credentials")
            elif kind == "comfyui":
                provider["baseUrl"] = http_url(raw.get("baseUrl")).rstrip("/")
                require(not urllib.parse.urlsplit(provider["baseUrl"]).query, "ComfyUI base URL cannot contain a query")
                workflows = raw.get("workflows", [])
                require(isinstance(workflows, list) and len(workflows) <= 32, "Invalid configured ComfyUI workflows")
                provider["workflows"] = {}
                for workflow in workflows:
                    require(isinstance(workflow, dict), "Invalid configured ComfyUI workflow")
                    workflow_id = identifier(workflow.get("id"), "workflow id")
                    require(workflow_id not in provider["workflows"], "Duplicate workflow id")
                    require(workflow.get("localOnly") is True, "ComfyUI workflows require operator-confirmed localOnly=true")
                    provider["workflows"][workflow_id] = {
                        "id": workflow_id, "title": string(workflow.get("title", workflow_id), "workflow title"),
                        "path": (self.config_path.parent / string(workflow.get("path"), "workflow path", 2048)).resolve(),
                        "promptNode": string(workflow.get("promptNode", ""), "promptNode", 96, True),
                        "promptInput": string(workflow.get("promptInput", "text"), "promptInput", 96)}
            else:
                provider["reason"] = string(raw.get("reason", "Configure and verify the provider API/model before execution."), "handoff reason", 2048)
            configured[provider_id] = provider
        self.providers = configured

    def _enabled(self, provider):
        with self.lock:
            return self.state["enabled"].get(provider["id"], provider["enabled"])

    def _provider(self, provider_id, enabled=True):
        identifier(provider_id, "provider id")
        provider = self.providers.get(provider_id)
        require(provider is not None, "Content provider is not configured", 404)
        require(not enabled or self._enabled(provider), "Content provider is disabled", 409)
        return provider

    def _request(self, provider, url, payload=None):
        headers = {"Accept": "application/json", "User-Agent": "MatrixLoadingOperator/1.0 (+https://github.com/School-of-the-Ancients/matrix-loading-operator)"}
        token_env = provider.get("tokenEnv")
        if token_env:
            token = os.environ.get(token_env)
            require(bool(token), "Provider credential is not configured on the PC", 503)
            headers["Authorization"] = "Bearer " + token
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=json_bytes(payload) if payload is not None else None, headers=headers)
        try:
            return urllib.request.build_opener(NoRedirect()).open(request, timeout=15)
        except urllib.error.HTTPError as error:
            status = 429 if error.code == 429 else 502
            message = "Provider authentication failed" if error.code in (401, 403) else "Provider rate limit reached" if error.code == 429 else "Provider HTTP request failed"
            raise ContentError(status, message) from None
        except (urllib.error.URLError, OSError, ValueError):
            raise ContentError(502, "Content provider is unreachable") from None

    def _json_request(self, provider, url, payload=None, limit=MAX_MANIFEST, empty_ok=False):
        try:
            with self._request(provider, url, payload) as response:
                data = response.read(limit + 1)
        except (OSError, http.client.HTTPException):
            raise ContentError(502, "Content provider response was interrupted") from None
        require(len(data) <= limit, "Provider JSON response exceeds size limit", 502)
        if empty_ok and not data:
            return {}
        try:
            return json.loads(data.decode("utf-8-sig"))
        except (UnicodeError, ValueError):
            raise ContentError(502, "Provider returned invalid JSON") from None

    def _assets(self, provider):
        if provider["type"] == "polyhaven":
            return self._polyhaven_assets(provider)
        if provider["type"] == "local":
            assets = validate_manifest(read_json(provider["manifest"]))
            for asset in assets:
                beneath(provider["manifest"].parent, asset["location"])
                if asset["format"] == "assetbundle":
                    require(asset["metadata"]["contentPack"]["providerId"] == provider["id"], "Pack providerId does not match configured catalog")
            return assets
        if provider["type"] == "http":
            assets = validate_manifest(self._json_request(provider, provider["manifestUrl"]))
            for asset in assets:
                url = urllib.parse.urljoin(provider["manifestUrl"], asset["location"])
                require(origin(url) == origin(provider["manifestUrl"]), "Catalog downloads must use the configured provider origin")
                if asset["format"] == "assetbundle":
                    require(asset["metadata"]["contentPack"]["providerId"] == provider["id"], "Pack providerId does not match configured catalog")
            return assets
        raise ContentError(409, "This provider generates content; it is not a searchable asset catalog")

    def _polyhaven_assets(self, provider):
        # Poly Haven's public API returns metadata, not immutable Unity content packs.
        # Cache the bounded index in memory, never claim these are installed prefabs.
        now = time.monotonic()
        with self.lock:
            if self.polyhaven_cache is not None and now - self.polyhaven_cached_at < POLYHAVEN_CACHE_SECONDS:
                return self.polyhaven_cache
        document = self._json_request(provider, POLYHAVEN_ASSETS_URL, limit=8 * MAX_MANIFEST)
        require(isinstance(document, dict) and len(document) <= 10000, "Invalid Poly Haven asset index", 502)
        kinds = {0: ("environments", "hdr"), 1: ("materials", "png"), 2: ("objects", "gltf")}
        rows = []
        for asset_id, data in document.items():
            if not isinstance(asset_id, str) or not ID.fullmatch(asset_id) or not isinstance(data, dict):
                continue
            kind = kinds.get(data.get("type")) if type(data.get("type")) is int else None
            if kind is None:
                continue
            title, description, tags = data.get("name"), data.get("description", ""), data.get("tags", [])
            if not isinstance(title, str) or not 0 < len(title) <= 256 or not isinstance(description, str):
                continue
            if not isinstance(tags, list):
                tags = []
            tags = [tag[:96] for tag in tags[:32] if isinstance(tag, str) and tag]
            version = data.get("files_hash")
            if not isinstance(version, str) or not re.fullmatch(r"[a-f0-9]{40}", version):
                version = "live"
            rows.append({"providerId": provider["id"], "assetId": asset_id, "version": version,
                         "title": title, "category": kind[0], "format": kind[1], "targetPlatform": "Any",
                         "license": {"name": "CC0", "url": "https://polyhaven.com/license", "attribution": ""},
                         "metadata": {"description": description[:2048], "tags": tags,
                                      "sourceUrl": "https://polyhaven.com/a/" + urllib.parse.quote(asset_id),
                                      "sourceKind": ("HDRI", "texture", "3D model")[data["type"]]},
                         "runtimeLoadable": False, "requiresEditor": True, "discoveryOnly": True})
        rows.sort(key=lambda row: (row["title"].casefold(), row["assetId"]))
        with self.lock:
            self.polyhaven_cache = rows
            self.polyhaven_cached_at = time.monotonic()
        return rows

    def _sketchfab_search(self, provider, query, cursor, limit):
        # The public search cursor is opaque. Downloads require per-user OAuth,
        # so these records are discovery only and never enter the pack installer.
        params = {"type": "models", "downloadable": "true", "count": min(limit, 24)}
        if query:
            params["q"] = query
        if cursor:
            params["cursor"] = cursor
        document = self._json_request(provider, SKETCHFAB_SEARCH_URL + "?" + urllib.parse.urlencode(params), limit=2 * MAX_MANIFEST)
        require(isinstance(document, dict) and isinstance(document.get("results"), list)
                and len(document["results"]) <= 24, "Invalid Sketchfab search response", 502)
        rows = []
        for data in document["results"]:
            if not isinstance(data, dict) or data.get("isDownloadable") is not True or data.get("isAgeRestricted") is True:
                continue
            uid, title, license_info = data.get("uid"), data.get("name"), data.get("license")
            if not isinstance(uid, str) or not re.fullmatch(r"[a-f0-9]{32}", uid):
                continue
            if not isinstance(title, str) or not 0 < len(title) <= 256 or not isinstance(license_info, dict):
                continue
            license_name = license_info.get("label")
            if not isinstance(license_name, str) or not license_name:
                continue
            raw_tags = data.get("tags", [])
            tags = [tag["name"][:96] for tag in raw_tags[:32] if isinstance(tag, dict) and isinstance(tag.get("name"), str)] if isinstance(raw_tags, list) else []
            raw_categories = data.get("categories", [])
            categories = [item.get("name", "") for item in raw_categories if isinstance(item, dict)] if isinstance(raw_categories, list) else []
            names = " ".join(categories + tags).casefold()
            category = "characters" if any(word in names for word in ("character", "creature", "people")) else "environments" if any(word in names for word in ("architecture", "scene", "environment")) else "objects"
            description = data.get("description", "")
            if not isinstance(description, str):
                description = ""
            rows.append({"providerId": provider["id"], "assetId": uid, "version": "live", "title": title,
                         "category": category, "format": "gltf", "targetPlatform": "Any",
                         "license": {"name": license_name[:128], "url": "https://sketchfab.com/licenses", "attribution": "Review creator and license on source page"},
                         "metadata": {"description": description[:2048], "tags": tags,
                                      "sourceUrl": "https://sketchfab.com/models/" + uid,
                                      "animationCount": data.get("animationCount", 0) if type(data.get("animationCount")) is int else 0},
                         "runtimeLoadable": False, "requiresEditor": True, "discoveryOnly": True})
        cursors = document.get("cursors")
        require(isinstance(cursors, dict), "Invalid Sketchfab cursor response", 502)
        next_cursor = cursors.get("next")
        previous_cursor = cursors.get("previous")
        require(next_cursor is None or isinstance(next_cursor, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", next_cursor),
                "Invalid Sketchfab next cursor", 502)
        require(previous_cursor is None or isinstance(previous_cursor, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", previous_cursor),
                "Invalid Sketchfab previous cursor", 502)
        return {"schemaVersion": 1, "assets": rows, "errors": [], "total": None, "offset": 0,
                "limit": min(limit, 24), "nextCursor": next_cursor, "previousCursor": previous_cursor,
                "hasMore": next_cursor is not None,
                "truncated": next_cursor is not None}

    def status(self):
        providers = []
        for provider in self.providers.values():
            kind = provider["type"]
            row = {"id": provider["id"], "title": provider["title"], "type": kind, "enabled": self._enabled(provider),
                   "credentialConfigured": not provider["tokenEnv"] or bool(os.environ.get(provider["tokenEnv"])),
                    "capabilities": {"search": kind in ("local", "http", "polyhaven", "sketchfab"), "retrieve": kind in ("local", "http"),
                                    "generate": kind == "comfyui", "editorImport": False}}
            if kind == "polyhaven":
                row["credit"] = "Powered by Poly Haven"
            if kind == "sketchfab":
                row["credit"] = "Models from Sketchfab · downloads require your Sketchfab authorization"
            if kind == "comfyui":
                row["workflows"] = [{"id": item["id"], "title": item["title"], "format": "comfyui-api"} for item in provider["workflows"].values()]
            if kind == "generation-handoff":
                row["reason"] = provider["reason"]
            providers.append(row)
        return {"schemaVersion": 1, "configured": bool(self.providers), "configError": self.config_error,
                "providers": providers, "limits": {"maxDownloadBytes": MAX_DOWNLOAD, "maxCacheBytes": MAX_CACHE_BYTES, "maxCatalogAssets": MAX_ASSETS},
                "categories": [{"id": category, "status": "bundle-or-editor-import" if category in ("objects", "characters", "environments", "animations")
                                else "catalog-and-editor-queue", "note": "Compiled behavior types only; downloaded C# and DLLs are never executed." if category == "behaviors"
                                else "A panorama is an image, not room geometry." if category == "environments" else ""} for category in CATEGORIES]}

    def set_enabled(self, provider_id, enabled):
        self._provider(provider_id, False)
        require(type(enabled) is bool, "Invalid enabled flag")
        with self.lock:
            self.state["enabled"][provider_id] = enabled
            atomic_json(self.state_path, self.state)
        return self.status()

    def test_provider(self, provider_id):
        # An explicit read-only test is useful before enabling a configured source.
        provider = self._provider(provider_id, enabled=False)
        if provider["type"] in ("local", "http", "polyhaven"):
            return {"providerId": provider_id, "ok": True, "assetCount": len(self._assets(provider))}
        if provider["type"] == "sketchfab":
            result = self._sketchfab_search(provider, "chair", None, 1)
            return {"providerId": provider_id, "ok": True, "searchable": bool(result["assets"])}
        if provider["type"] == "comfyui":
            stats = self._json_request(provider, provider["baseUrl"] + "/system_stats")
            require(isinstance(stats, dict), "Invalid ComfyUI system response", 502)
            nodes = self._json_request(provider, provider["baseUrl"] + "/object_info", limit=8 * MAX_MANIFEST)
            require(isinstance(nodes, dict), "Invalid ComfyUI node response", 502)
            return {"providerId": provider_id, "ok": True, "nodeCount": len(nodes),
                    "configuredWorkflowCount": len(provider["workflows"])}
        raise ContentError(409, provider["reason"])

    def search(self, query="", category=None, provider_id=None, offset=0, limit=100, cursor=None):
        query = string(query, "search query", 256, True).casefold()
        require(category is None or category in CATEGORIES, "Unsupported content category")
        require(type(offset) is int and 0 <= offset <= 100000, "Invalid catalog offset")
        require(type(limit) is int and 1 <= limit <= 100, "Invalid catalog page size")
        if provider_id is not None:
            identifier(provider_id, "provider id")
            provider = self._provider(provider_id)
            if provider["type"] == "sketchfab":
                require(offset == 0, "Sketchfab uses its returned page cursor, not an offset")
                require(cursor is None or isinstance(cursor, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", cursor), "Invalid Sketchfab cursor")
                require(category is None or category in ("objects", "characters", "environments"), "Sketchfab has no results in this category")
                result = self._sketchfab_search(provider, query, cursor, limit)
                if category is not None:
                    result["assets"] = [row for row in result["assets"] if row["category"] == category]
                return result
        require(cursor is None, "Page cursor requires the Sketchfab provider")
        providers = [self._provider(provider_id)] if provider_id else [provider for provider in self.providers.values() if self._enabled(provider) and provider["type"] in ("local", "http", "polyhaven")]
        results, errors = [], []
        for provider in providers:
            try:
                for asset in self._assets(provider):
                    haystack = " ".join((asset["assetId"], asset["title"], json.dumps(asset["metadata"]))).casefold()
                    if (not category or asset["category"] == category) and (not query or query in haystack):
                        results.append(copy.deepcopy(asset) if provider["type"] == "polyhaven" else public_asset(asset, provider["id"]))
            except ContentError as error:
                errors.append({"providerId": provider["id"], "message": str(error), "status": error.status})
        total = len(results)
        return {"schemaVersion": 1, "assets": results[offset:offset + limit], "errors": errors,
                "total": total, "offset": offset, "limit": limit, "hasMore": offset + limit < total,
                "truncated": offset + limit < total}

    def suggest_public(self, prompt, limit=20):
        """Find bounded, read-only source candidates for a proposal without sending prompt text to a provider."""
        if not isinstance(prompt, str) or not prompt or not 1 <= limit <= 40:
            return []
        stop = {"a", "add", "an", "and", "are", "as", "at", "can", "clear", "create", "delete", "duplicate", "edit", "for", "from", "game", "get",
                "give", "i", "in", "into", "is", "it", "make", "me", "move", "my", "of", "on", "our", "place",
                "here", "please", "put", "redo", "restore", "rotate", "room", "save", "scale", "select", "show", "some", "spawn", "the", "there", "this", "to", "undo", "want", "with"}
        tokens = [word for word in re.findall(r"[a-z0-9]+", prompt.casefold()) if len(word) > 2 and word not in stop]
        tokens = list(dict.fromkeys(tokens))[:8]
        if not tokens:
            return []
        ranked = []
        for provider in self.providers.values():
            if provider["type"] != "polyhaven" or not self._enabled(provider):
                continue
            try:
                for asset in self._polyhaven_assets(provider):
                    title = asset["title"].casefold()
                    tags = " ".join(asset["metadata"]["tags"]).casefold()
                    description = asset["metadata"]["description"].casefold()
                    score = sum(5 if token in title else 3 if token in tags else 1 if token in description else 0
                                for token in tokens)
                    if score:
                        ranked.append((-score, title, asset))
            except ContentError:
                continue
        ranked.sort(key=lambda row: (row[0], row[1]))
        return [copy.deepcopy(asset) for _, _, asset in ranked[:limit]]

    def _cache_stream(self, source, expected_sha=None, expected_length=None, cancel_event=None):
        reservation = expected_length or MAX_DOWNLOAD
        with self.lock:
            cache_bytes = sum(path.stat().st_size for path in self.cache_dir.iterdir() if SHA.fullmatch(path.name) and path.is_file())
            require(cache_bytes + self.reserved_bytes + reservation <= MAX_CACHE_BYTES, "Content cache is full; archive unneeded cached files on the PC", 507)
            self.reserved_bytes += reservation
        temporary = None
        digest, length = hashlib.sha256(), 0
        try:
            descriptor, temporary = tempfile.mkstemp(prefix=".download-", dir=self.cache_dir)
            with os.fdopen(descriptor, "wb") as target:
                while True:
                    require(not cancel_event or not cancel_event.is_set(), "Content download cancelled", 409)
                    chunk = source.read(128 * 1024)
                    if not chunk:
                        break
                    length += len(chunk)
                    require(length <= (expected_length or MAX_DOWNLOAD), "Content download exceeds declared size", 413)
                    digest.update(chunk)
                    target.write(chunk)
            checksum = digest.hexdigest()
            require(length > 0 and (expected_length is None or length == expected_length), "Content byte length does not match manifest", 422)
            require(expected_sha is None or checksum == expected_sha, "Content SHA-256 does not match manifest", 422)
            require(not cancel_event or not cancel_event.is_set(), "Content download cancelled", 409)
            os.replace(temporary, self.cache_dir / checksum)
            return checksum, length
        except (OSError, http.client.HTTPException):
            raise ContentError(502, "Content transfer or cache write was interrupted") from None
        finally:
            if temporary is not None and os.path.exists(temporary):
                os.unlink(temporary)
            with self.lock:
                self.reserved_bytes -= reservation

    def prepare(self, provider_id, asset_id, version=None, target_platform=None, cancel_event=None):
        provider = self._provider(provider_id)
        require(provider["type"] in ("local", "http"),
                "This discovery result needs review and Unity conversion before installation; open its source page", 409)
        identifier(asset_id, "assetId")
        if version is not None:
            identifier(version, "version")
        if target_platform is not None:
            identifier(target_platform, "target platform")
        matches = [asset for asset in self._assets(provider) if asset["assetId"] == asset_id
                   and (version is None or asset["version"] == version)
                   and (target_platform is None or asset["targetPlatform"] in (target_platform, "Any"))]
        if target_platform is not None:
            # Prefer the exact platform within each version, without choosing a version.
            exact_versions = {asset["version"] for asset in matches if asset["targetPlatform"] == target_platform}
            matches = [asset for asset in matches if asset["targetPlatform"] == target_platform
                       or asset["version"] not in exact_versions]
        require(bool(matches), "Content asset/version/platform not found", 404)
        require(len(matches) == 1, "Choose an exact asset version and target platform", 409)
        asset = matches[0]
        require(not cancel_event or not cancel_event.is_set(), "Content download cancelled", 409)
        cached = self.cache_dir / asset["sha256"]
        verified = cached.is_file() and cached.stat().st_size == asset["byteLength"] and hashlib.sha256(cached.read_bytes()).hexdigest() == asset["sha256"]
        if not verified:
            if provider["type"] == "local":
                path = beneath(provider["manifest"].parent, asset["location"])
                try:
                    with path.open("rb") as stream:
                        self._cache_stream(stream, asset["sha256"], asset["byteLength"], cancel_event)
                except OSError:
                    raise ContentError(404, "Catalog file is missing or unreadable") from None
            else:
                url = urllib.parse.urljoin(provider["manifestUrl"], asset["location"])
                with self._request(provider, url) as stream:
                    self._cache_stream(stream, asset["sha256"], asset["byteLength"], cancel_event)
        result = public_asset(asset, provider_id)
        result.update({"downloadPath": "/api/content/files/" + asset["sha256"], "cached": True})
        return result

    def cached_file(self, sha256):
        require(isinstance(sha256, str) and SHA.fullmatch(sha256), "Invalid content checksum")
        path = self.cache_dir / sha256
        require(path.is_file(), "Prepared content is missing", 404)
        require(path.stat().st_size <= MAX_DOWNLOAD and hashlib.sha256(path.read_bytes()).hexdigest() == sha256, "Cached content checksum failed", 422)
        return path

    def queue_import(self, source, title="", category="objects", notes=""):
        require(category in CATEGORIES, "Unsupported content category")
        source = string(source, "import source", 2048)
        title = string(title, "import title", 256, True)
        notes = string(notes, "import notes", 2048, True)
        kind, public_source, private_source, checksum = "asset-store", source, "", ""
        if source.startswith("https://"):
            parsed = urllib.parse.urlsplit(http_url(source))
            require(parsed.hostname == "assetstore.unity.com" and parsed.path.startswith("/packages/") and not parsed.query,
                    "Use a Unity Asset Store package URL without a query")
        else:
            path = Path(source).resolve()
            require(path.suffix.lower() == ".unitypackage" and path.is_file(), "Import source must be a Unity Asset Store URL or existing .unitypackage")
            require(path.stat().st_size <= MAX_DOWNLOAD, "Unity package exceeds staging size limit", 413)
            with path.open("rb") as stream:
                checksum, _ = self._cache_stream(stream)
            kind, public_source, private_source = "unitypackage", path.name, str(self.cache_dir / checksum)
        row = {"id": uuid.uuid4().hex, "kind": kind, "source": public_source, "title": title or public_source,
               "category": category, "notes": notes, "status": "queued", "createdAt": time.time(),
               "sha256": checksum, "requiresEditor": True, "privateSource": private_source}
        with self.lock:
            require(len(self.state["imports"]) < MAX_QUEUE, "Editor import queue is full", 409)
            self.state["imports"].append(row)
            atomic_json(self.state_path, self.state)
        return {key: value for key, value in row.items() if key != "privateSource"}

    def import_queue(self):
        with self.lock:
            return [{key: copy.deepcopy(value) for key, value in row.items() if key != "privateSource"} for row in self.state["imports"]]

    def update_import(self, import_id, status, notes=""):
        identifier(import_id, "import id")
        require(status in ("queued", "acquired", "imported", "exported", "cancelled", "failed"), "Invalid Editor import status")
        notes = string(notes, "import notes", 2048, True)
        with self.lock:
            row = next((row for row in self.state["imports"] if row["id"] == import_id), None)
            require(row is not None, "Editor import request not found", 404)
            row.update(status=status, notes=notes, updatedAt=time.time())
            atomic_json(self.state_path, self.state)
        return self.import_queue()

    def submit_workflow(self, provider_id, workflow_id, prompt="", approved=False):
        provider = self._provider(provider_id)
        require(provider["type"] == "comfyui", "Provider cannot execute a local ComfyUI workflow", 409)
        require(approved is True, "Review and approve the configured workflow before submitting", 409)
        identifier(workflow_id, "workflow id")
        workflow = provider["workflows"].get(workflow_id)
        require(workflow is not None, "ComfyUI workflow is not configured", 404)
        prompt = string(prompt, "generation prompt", 4096, True)
        graph = read_json(workflow["path"])
        require(isinstance(graph, dict) and graph and all(isinstance(node, dict) and isinstance(node.get("class_type"), str)
                    and isinstance(node.get("inputs"), dict) for node in graph.values()), "Workflow must use ComfyUI API graph format")
        if prompt:
            node = graph.get(workflow["promptNode"])
            require(node is not None and workflow["promptInput"] in node["inputs"], "Configured workflow does not expose this prompt input")
            node["inputs"][workflow["promptInput"]] = prompt
        job_id = uuid.uuid4().hex
        with self.lock:
            require(len(self.state["generations"]) + len(self.pending_generations) < MAX_QUEUE,
                    "Generation history is full", 409)
            self.pending_generations.add(job_id)
        try:
            # Reserve capacity before provider I/O without holding the catalog lock.
            response = self._json_request(provider, provider["baseUrl"] + "/prompt", {"prompt": graph, "client_id": "matrix-" + uuid.uuid4().hex})
            require(isinstance(response, dict) and isinstance(response.get("prompt_id"), str) and not response.get("error"), "ComfyUI rejected the workflow", 502)
            prompt_id = identifier(response["prompt_id"], "ComfyUI prompt id")
            job = {"id": job_id, "providerId": provider_id, "workflowId": workflow_id,
                   "promptId": prompt_id, "status": "queued", "createdAt": time.time(), "outputs": []}
            with self.lock:
                # Transfer the slot to history atomically so it is never counted twice.
                self.pending_generations.remove(job_id)
                self.state["generations"].append(job)
                atomic_json(self.state_path, self.state)
            return copy.deepcopy(job)
        finally:
            with self.lock:
                self.pending_generations.discard(job_id)

    def generations(self):
        with self.lock:
            return copy.deepcopy(self.state["generations"])

    def poll_generation(self, job_id):
        identifier(job_id, "generation id")
        with self.lock:
            job = next((copy.deepcopy(row) for row in self.state["generations"] if row["id"] == job_id), None)
        require(job is not None, "Generation request not found", 404)
        if job["status"] in ("completed", "failed", "cancelled"):
            return job
        provider = self._provider(job["providerId"])
        history = self._json_request(provider, provider["baseUrl"] + "/history/" + job["promptId"])
        require(isinstance(history, dict), "Invalid ComfyUI history response", 502)
        entry = history.get(job["promptId"])
        if entry:
            require(isinstance(entry, dict) and isinstance(entry.get("outputs", {}), dict), "Invalid ComfyUI output response", 502)
            status = entry.get("status", {})
            require(isinstance(status, dict), "Invalid ComfyUI status", 502)
            job["status"] = "failed" if status.get("status_str") == "error" else "completed" if status.get("completed") else "running"
            outputs = []
            for node in entry.get("outputs", {}).values():
                require(isinstance(node, dict), "Invalid ComfyUI output node", 502)
                for key in ("images", "gifs", "videos", "audio"):
                    for output in node.get(key, []):
                        require(isinstance(output, dict), "Invalid ComfyUI output", 502)
                        filename = string(output.get("filename"), "output filename", 256)
                        subfolder = string(output.get("subfolder", ""), "output subfolder", 512, True)
                        require(Path(filename).name == filename and not any(character in filename for character in ("/", "\\", ":"))
                                and not any(part in ("..", ".") for part in re.split(r"[/\\]", subfolder))
                                and not subfolder.startswith(("/", "\\")) and ":" not in subfolder, "Invalid ComfyUI output location", 502)
                        require(output.get("type", "output") == "output", "Only final ComfyUI output files can be retrieved", 502)
                        extension = Path(filename).suffix.lower().lstrip(".")
                        require(extension in {"png", "jpg", "jpeg", "webp", "mp4", "webm", "gif", "wav", "ogg", "mp3", "flac"}, "Unsupported generated output format", 502)
                        outputs.append({"filename": filename, "subfolder": subfolder, "type": "output"})
            require(len(outputs) <= 32, "Too many ComfyUI outputs", 502)
            job["outputs"] = outputs
        else:
            queue = self._json_request(provider, provider["baseUrl"] + "/queue")
            require(isinstance(queue, dict), "Invalid ComfyUI queue response", 502)
            running = queue.get("queue_running", [])
            pending = queue.get("queue_pending", [])
            require(isinstance(running, list) and isinstance(pending, list), "Invalid ComfyUI queue entries", 502)
            contains_job = lambda rows: any(isinstance(row, list) and len(row) > 1 and row[1] == job["promptId"] for row in rows)
            job["status"] = "running" if contains_job(running) else "queued" if contains_job(pending) else "missing"
            if job["status"] == "missing":
                job["message"] = "Workflow is absent from this worker's queue and history; it may have restarted or cleared history."
        with self.lock:
            index = next(i for i, row in enumerate(self.state["generations"]) if row["id"] == job_id)
            self.state["generations"][index] = job
            atomic_json(self.state_path, self.state)
        return copy.deepcopy(job)

    def prepare_generation_output(self, job_id, output_index, cancel_event=None):
        job = self.poll_generation(job_id)
        require(job["status"] == "completed", "Generation is not complete", 409)
        require(type(output_index) is int and 0 <= output_index < len(job["outputs"]), "Invalid generation output index")
        provider = self._provider(job["providerId"])
        output = job["outputs"][output_index]
        with self._request(provider, provider["baseUrl"] + "/view?" + urllib.parse.urlencode(output)) as response:
            checksum, length = self._cache_stream(response, cancel_event=cancel_event)
        return {"providerId": job["providerId"], "jobId": job_id, "filename": output["filename"],
                "sha256": checksum, "byteLength": length, "downloadPath": "/api/content/files/" + checksum,
                "runtimeLoadable": False, "note": "Generated media requires review and a compatible environment/content export before use in the player."}

    def cancel_generation(self, job_id):
        job = self.poll_generation(job_id)
        require(job["status"] == "queued", "Only this queued workflow can be cancelled; running shared workers are never interrupted", 409)
        provider = self._provider(job["providerId"])
        self._json_request(provider, provider["baseUrl"] + "/queue", {"delete": [job["promptId"]]}, empty_ok=True)
        # The worker can start the queued request between our poll and delete.
        queue = self._json_request(provider, provider["baseUrl"] + "/queue")
        require(isinstance(queue, dict), "Invalid ComfyUI queue response", 502)
        running, pending = queue.get("queue_running", []), queue.get("queue_pending", [])
        require(isinstance(running, list) and isinstance(pending, list), "Invalid ComfyUI queue entries", 502)
        contains_job = lambda rows: any(isinstance(row, list) and len(row) > 1 and row[1] == job["promptId"] for row in rows)
        require(not contains_job(running), "Workflow started before cancellation; its shared worker was not interrupted", 409)
        require(not contains_job(pending), "Worker did not confirm removal of the queued workflow", 502)
        history = self._json_request(provider, provider["baseUrl"] + "/history/" + job["promptId"])
        require(isinstance(history, dict), "Invalid ComfyUI history response", 502)
        if history.get(job["promptId"]):
            return self.poll_generation(job_id)
        with self.lock:
            row = next(row for row in self.state["generations"] if row["id"] == job_id)
            row["status"] = "cancelled"
            atomic_json(self.state_path, self.state)
            return copy.deepcopy(row)
