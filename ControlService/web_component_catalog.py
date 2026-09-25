"""PC-owned immutable catalog for bounded WebXR component packages."""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading

from web_components import COMPONENT_ID, ComponentError, validate_package


MAX_COMPONENTS = 64


def _canonical(package):
    return json.dumps(package, ensure_ascii=False, sort_keys=True, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def _identity(package, digest):
    slug = re.sub(r"[^a-z0-9]+", "-", package["name"].lower()).strip("-")[:40].strip("-")
    if not slug:
        # The package schema permits Unicode letters. Keep the public ID ASCII
        # without rejecting a valid localized name or changing its digest.
        slug = "component-" + digest[:8]
    component_id = f"webcomp:{slug}:{digest[:12]}"
    if not COMPONENT_ID.fullmatch(component_id):
        raise ComponentError("Invalid component ID")
    return component_id


class WebComponentCatalog:
    def __init__(self, root):
        self.root = Path(root)
        self.lock = threading.RLock()

    def list(self):
        with self.lock:
            path = self.root / "manifest.json"
            if not path.is_file():
                return []
            try:
                items = json.loads(path.read_text(encoding="utf-8"))
                if type(items) is not list or len(items) > MAX_COMPONENTS:
                    raise ValueError()
                seen = set()
                for item in items:
                    if type(item) is not dict or set(item) != {"componentId", "sha256", "package"} or \
                            type(item["componentId"]) is not str or not COMPONENT_ID.fullmatch(item["componentId"]) or \
                            type(item["sha256"]) is not str or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
                        raise ValueError()
                    validate_package(item["package"])
                    digest = hashlib.sha256(_canonical(item["package"])).hexdigest()
                    if digest != item["sha256"] or item["componentId"] != _identity(item["package"], digest) or \
                            item["componentId"] in seen:
                        raise ValueError()
                    seen.add(item["componentId"])
                return items
            except (OSError, ValueError, TypeError, RecursionError):
                raise ComponentError("Component catalog is unreadable or corrupt") from None

    def get(self, component_id):
        if type(component_id) is not str or not COMPONENT_ID.fullmatch(component_id):
            raise ComponentError("Invalid component ID")
        item = next((entry for entry in self.list() if entry["componentId"] == component_id), None)
        if item is None:
            raise ComponentError("Unknown component ID")
        return copy.deepcopy(item)

    def publish(self, package):
        validate_package(package)
        package = copy.deepcopy(package)
        digest = hashlib.sha256(_canonical(package)).hexdigest()
        component_id = _identity(package, digest)
        with self.lock:
            items = self.list()
            existing = next((item for item in items if item["componentId"] == component_id), None)
            if existing:
                if existing["sha256"] != digest:
                    raise ComponentError("Component ID digest collision")
                return copy.deepcopy(existing)
            if len(items) >= MAX_COMPONENTS:
                raise ComponentError("Component catalog is full")
            entry = {"componentId": component_id, "sha256": digest, "package": package}
            items.append(entry)
            self.root.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.root,
                                                 prefix=".manifest-", suffix=".tmp", delete=False) as handle:
                    temporary = Path(handle.name)
                    json.dump(items, handle, ensure_ascii=False, sort_keys=True, allow_nan=False,
                              separators=(",", ":"))
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.root / "manifest.json")
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return copy.deepcopy(entry)
