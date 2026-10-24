"""Bounded public avatar metadata and persisted teacher binding validation."""
import copy
import re
import json
from pathlib import Path

ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
KEYS = {"schemaVersion", "teacherId", "teacherName", "schoolSessionId", "catalogId", "assetSha256", "representation"}


def validate_binding(value, asset_id):
    if not isinstance(value, dict) or set(value) != KEYS or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        raise ValueError("Invalid professor binding")
    for key in ("teacherId", "catalogId"):
        if not isinstance(value[key], str) or not ID.fullmatch(value[key]):
            raise ValueError("Invalid professor identity")
    if not isinstance(value["teacherName"], str) or not 1 <= len(value["teacherName"]) <= 100 or any(ord(c) < 32 for c in value["teacherName"]):
        raise ValueError("Invalid teacher name")
    if not isinstance(value["schoolSessionId"], str) or not UUID.fullmatch(value["schoolSessionId"]):
        raise ValueError("Invalid School session")
    digest = value["assetSha256"]
    if value["representation"] not in ("generic", "approximate"):
        raise ValueError("Invalid professor representation")
    if asset_id == "professor-placeholder":
        if value["catalogId"] != "generic-professor" or digest != "":
            raise ValueError("Invalid placeholder identity")
    elif not isinstance(digest, str) or not SHA.fullmatch(digest) or not asset_id.startswith("web:") or not asset_id.endswith(":" + digest[:12]):
        raise ValueError("Professor asset identity mismatch")
    return copy.deepcopy(value)


def public_catalog(assets, local_metadata=None):
    curated_path = Path(__file__).resolve().parents[1] / 'WebRuntime' / 'art' / 'professors' / 'catalog.json'
    if not curated_path.is_file():
        curated_path = Path(__file__).resolve().parents[1] / 'BundledAssets' / 'professors' / 'catalog.json'
    curated = {item['sha256']: item for item in json.loads(curated_path.read_text(encoding='utf-8'))['avatars']} if curated_path.is_file() else {}
    curated.update(local_metadata or {})
    entries = [{"catalogId": "generic-professor", "assetId": "professor-placeholder",
                "assetSha256": "", "displayName": "Stylized professor", "representation": "generic",
                "visualTags": ["stylized", "robe"], "availability": "ready", "automaticSelection": True}]
    for asset in assets:
        if not asset.get("geometry", {}).get("vrm"):
            continue
        metadata = curated.get(asset['sha256'], {})
        entries.append({"catalogId": asset["assetId"], "assetId": asset["assetId"],
                        "assetSha256": asset["sha256"], "displayName": asset["displayName"],
                        "representation": "approximate", "visualTags": metadata.get('visualTags', ['fantasy', 'cat-girl', 'ears', 'tail'] if 'riko' in asset['displayName'].lower() else []),
                        "teacherMatches": metadata.get('teacherMatches', []), "description": metadata.get('source', 'Owner-supplied avatar.'),
                        "availability": "ready", "automaticSelection": bool(metadata.get('automaticSelection')),
                        "libraryOwned": asset['sha256'] in (local_metadata or {})})
    entries.sort(key=lambda item: not item.get('libraryOwned', False))
    return {"schemaVersion": 1, "avatars": entries}
