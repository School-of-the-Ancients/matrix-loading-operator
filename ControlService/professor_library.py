"""Reusable teaching assets, backed by the existing validated Matrix catalog."""
import copy
import json
import os
from pathlib import Path
import re
import tempfile
import threading

from content_catalog import ContentError


def tokens(value):
    return set(re.findall(r"[a-z0-9]+", str(value).lower()))


def validate_metadata(teacher_ids, tags, job_id):
    if (not isinstance(teacher_ids, (list, tuple)) or len(teacher_ids) > 12 or
        not all(isinstance(item, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", item) for item in teacher_ids) or
        not isinstance(tags, (list, tuple)) or len(tags) > 24 or
        not all(isinstance(item, str) and 0 < len(item) <= 80 for item in tags) or
        job_id is not None and (not isinstance(job_id, str) or (job_id and not re.fullmatch(r'[a-f0-9-]{36}', job_id)))):
        raise ContentError(400, "Invalid teaching asset metadata")


class ProfessorLibrary:
    def __init__(self, root, assets):
        self.path = Path(root) / "professor-library.json"
        self.assets = assets
        self.lock = threading.RLock()
        self.metadata = {}
        if self.path.exists():
            data = json.loads(self.path.read_text("utf-8"))
            if data.get("version") != 1 or not isinstance(data.get("assets"), dict):
                raise ContentError(503, "Teaching asset library is unreadable; preserved for recovery")
            self.metadata = data["assets"]

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as stream:
            json.dump({"version": 1, "assets": self.metadata}, stream)
            stream.flush(); os.fsync(stream.fileno())
            temporary = stream.name
        os.replace(temporary, self.path)

    def remember(self, asset_id, *, teacher_ids=(), tags=(), job_id=None):
        validate_metadata(teacher_ids, tags, job_id)
        asset = next((item for item in self.assets.list() if item["assetId"] == asset_id), None)
        if asset is None:
            raise ContentError(404, "Register and validate the asset before adding library metadata")
        with self.lock:
            previous = self.metadata.get(asset_id, {})
            value = {"sha256": asset["sha256"], "teacherMatches": list(dict.fromkeys(teacher_ids)),
                     "visualTags": list(dict.fromkeys(tags)),
                     "automaticSelection": bool(teacher_ids),
                     "source": "Locally created teaching asset; approximate representation."}
            if job_id:
                value["jobId"] = job_id
            self.metadata[asset_id] = value
            self._save()
            return copy.deepcopy(value)

    def avatar_metadata(self):
        with self.lock:
            return {item["sha256"]: copy.deepcopy(item) for item in self.metadata.values()}

    def list(self, query="", kind="any"):
        if kind not in ("any", "avatar", "exhibit") or not isinstance(query, str) or len(query) > 500:
            raise ContentError(400, "Invalid library search")
        terms = tokens(query)
        result = []
        with self.lock:
            metadata = copy.deepcopy(self.metadata)
        for asset in self.assets.list():
            avatar = bool(asset.get("geometry", {}).get("vrm"))
            if kind != "any" and avatar != (kind == "avatar"):
                continue
            entry = metadata.get(asset["assetId"], {})
            description = asset.get("description", "")
            haystack = tokens(" ".join([asset["displayName"], description, *entry.get("teacherMatches", []), *entry.get("visualTags", [])]))
            score = len(terms & haystack)
            if terms and not score:
                continue
            result.append({"assetId": asset["assetId"], "sha256": asset["sha256"], "name": asset["displayName"],
                           "description": description, "kind": "avatar" if avatar else "exhibit",
                           "teacherMatches": entry.get("teacherMatches", []), "tags": entry.get("visualTags", []),
                           "animationClips": asset.get("geometry", {}).get("animationClips", []), "score": score})
        return {"version": 1, "assets": sorted(result, key=lambda item: (-item["score"], item["name"]))[:64]}

    def register(self, value):
        required = {"source_path", "expected_sha256", "name", "description", "kind", "teacher_ids", "tags", "job_id"}
        if not isinstance(value, dict) or set(value) != required or value["kind"] not in ("avatar", "exhibit"):
            raise ContentError(400, "Invalid library registration")
        validate_metadata(value['teacher_ids'], value['tags'], value['job_id'])
        path = Path(value["source_path"])
        import hashlib
        if not path.is_absolute() or not path.is_file() or path.stat().st_size > 32*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest() != value["expected_sha256"]:
            raise ContentError(409, "Source asset hash changed")
        from web_assets import inspect_glb
        geometry = inspect_glb(path)
        if bool(geometry.get("vrm")) != (value["kind"] == "avatar"):
            raise ContentError(400, "Avatar assets must be VRM 1.0; exhibit assets must be ordinary GLB")
        asset = self.assets.register(path, value["name"], value["description"])
        self.remember(asset["assetId"], teacher_ids=value["teacher_ids"], tags=value["tags"], job_id=value["job_id"])
        return {"status": "registered", "assetId": asset["assetId"], "sha256": asset["sha256"], "kind": value["kind"]}
