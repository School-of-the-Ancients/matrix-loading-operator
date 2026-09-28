"""Immutable, content-addressed PNG panoramas for Matrix Web worlds."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
import threading
import unicodedata
import zlib


MAX_BYTES = 32 * 1024 * 1024
MAX_ASSETS = 128
SHA = re.compile(r"[0-9a-f]{64}\Z")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
ASSET_ID = re.compile(r"panorama:([a-z0-9]+(?:-[a-z0-9]+)*):([0-9a-f]{12})\Z")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class WebEnvironmentError(Exception):
    pass


def inspect_panorama(path):
    """Decode enough PNG structure to reject corrupt, oversized or non-2:1 files."""
    path = Path(path)
    size = path.stat().st_size
    if not 45 <= size <= MAX_BYTES:
        raise WebEnvironmentError("Panorama PNG must be at most 32 MiB")
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise WebEnvironmentError("Panorama must be a PNG image")
    offset = len(PNG_SIGNATURE)
    width = height = row_size = None
    idat = bytearray()
    seen_idat = seen_iend = False
    while offset + 12 <= len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data) or not re.fullmatch(rb"[A-Za-z]{4}", kind):
            raise WebEnvironmentError("Panorama PNG has an invalid chunk")
        chunk = data[offset + 8:offset + 8 + length]
        recorded = struct.unpack_from(">I", data, offset + 8 + length)[0]
        if zlib.crc32(kind + chunk) & 0xffffffff != recorded:
            raise WebEnvironmentError("Panorama PNG checksum failed")
        if width is None and kind != b"IHDR":
            raise WebEnvironmentError("Panorama PNG lacks its header")
        if kind == b"IHDR":
            if width is not None or length != 13:
                raise WebEnvironmentError("Panorama PNG has an invalid header")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunk)
            if (not 2 <= width <= 4096 or not 1 <= height <= 2048 or
                    width != 2 * height or depth != 8 or color not in (2, 6) or
                    compression != 0 or filtering != 0 or interlace != 0):
                raise WebEnvironmentError("Panorama requires a non-interlaced 2:1, 8-bit RGB/RGBA PNG up to 4096x2048")
            row_size = 1 + width * (3 if color == 2 else 4)
        elif kind == b"IDAT":
            if seen_iend:
                raise WebEnvironmentError("Panorama PNG has data after its end")
            seen_idat = True
            idat.extend(chunk)
        elif kind == b"IEND":
            if length != 0 or not seen_idat or end != len(data):
                raise WebEnvironmentError("Panorama PNG has an invalid end")
            seen_iend = True
            break
        elif kind in (b"acTL", b"fcTL", b"fdAT") or not kind[0] & 0x20:
            raise WebEnvironmentError("Panorama PNG uses an unsupported chunk")
        offset = end
    if not seen_iend:
        raise WebEnvironmentError("Panorama PNG is incomplete")
    expected = row_size * height
    decoder = zlib.decompressobj()
    try:
        pixels = decoder.decompress(idat, expected + 1)
        if len(pixels) > expected:
            raise WebEnvironmentError("Panorama PNG pixels exceed its declared dimensions")
        pixels += decoder.flush(expected + 1 - len(pixels))
    except zlib.error:
        raise WebEnvironmentError("Panorama PNG pixels are corrupt") from None
    if (len(pixels) != expected or not decoder.eof or decoder.unconsumed_tail or
            decoder.unused_data or any(pixels[index * row_size] > 4 for index in range(height))):
        raise WebEnvironmentError("Panorama PNG pixels are incomplete or invalid")
    return {"width": width, "height": height, "format": "png", "byteLength": size}


def environment_descriptor(value):
    """Normalize the world-level equirectangular descriptor, without IO."""
    if type(value) is not dict or set(value) != {"schemaVersion", "kind", "assetId", "sha256", "yawDegrees"}:
        raise WebEnvironmentError("Invalid Matrix environment descriptor")
    digest = value["sha256"]
    asset_id = value["assetId"]
    match = ASSET_ID.fullmatch(asset_id) if type(asset_id) is str else None
    yaw = value["yawDegrees"]
    if (type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or
            value["kind"] != "equirectangular" or match is None or len(match[1]) > 40 or
            type(digest) is not str or not SHA.fullmatch(digest) or
            match[2] != digest[:12] or type(yaw) not in (int, float) or
            not 0 <= yaw < 360):
        raise WebEnvironmentError("Invalid Matrix environment descriptor")
    return {"schemaVersion": 1, "kind": "equirectangular", "assetId": asset_id,
            "sha256": digest, "yawDegrees": yaw}


def environment_asset_entry(item):
    if type(item) is not dict or set(item) != {
            "assetId", "displayName", "sha256", "byteLength", "width", "height", "format", "url"}:
        raise WebEnvironmentError("Panorama catalog entry is invalid")
    try:
        environment_descriptor({"schemaVersion": 1, "kind": "equirectangular",
                                "assetId": item["assetId"], "sha256": item["sha256"],
                                "yawDegrees": 0})
    except WebEnvironmentError:
        raise WebEnvironmentError("Panorama catalog entry is invalid") from None
    if (type(item["displayName"]) is not str or not 1 <= len(item["displayName"]) <= 80 or
            any(unicodedata.category(char).startswith("C") for char in item["displayName"]) or
            type(item["byteLength"]) is not int or not 45 <= item["byteLength"] <= MAX_BYTES or
            type(item["width"]) is not int or type(item["height"]) is not int or
            not 2 <= item["width"] <= 4096 or item["width"] != 2 * item["height"] or
            item["format"] != "png" or item["url"] !=
            f"/api/web/environments/{item['sha256']}.png"):
        raise WebEnvironmentError("Panorama catalog entry is invalid")
    return item.copy()


class WebEnvironmentCatalog:
    def __init__(self, root):
        self.root = Path(root)
        self.lock = threading.RLock()

    def list(self):
        with self.lock:
            manifest = self.root / "manifest.json"
            if not manifest.is_file():
                return []
            if manifest.is_symlink():
                raise WebEnvironmentError("Panorama catalog link is unsupported")
            try:
                items = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, ValueError, UnicodeError):
                raise WebEnvironmentError("Panorama catalog is unreadable") from None
            if type(items) is not list or len(items) > MAX_ASSETS:
                raise WebEnvironmentError("Panorama catalog is invalid")
            ids, digests = set(), set()
            for item in items:
                environment_asset_entry(item)
                if item["assetId"] in ids or item["sha256"] in digests:
                    raise WebEnvironmentError("Panorama catalog entry is invalid")
                ids.add(item["assetId"])
                digests.add(item["sha256"])
            return items

    def file(self, digest):
        if type(digest) is not str or not SHA.fullmatch(digest):
            raise WebEnvironmentError("Invalid panorama digest")
        if not any(item["sha256"] == digest for item in self.list()):
            raise WebEnvironmentError("Unknown panorama digest")
        path = self.root / f"{digest}.png"
        if (path.is_symlink() or not path.is_file() or
                not 45 <= path.stat().st_size <= MAX_BYTES or
                hashlib.sha256(path.read_bytes()).hexdigest() != digest):
            raise WebEnvironmentError("Registered panorama is missing or corrupt")
        return path

    def register(self, source, name):
        with self.lock:
            source = Path(source)
            if source.is_symlink() or not source.is_file() or source.suffix.lower() != ".png":
                raise WebEnvironmentError("Use an existing local PC .png file")
            if (type(name) is not str or name != name.strip() or not 1 <= len(name) <= 80 or
                    any(unicodedata.category(char).startswith("C") for char in name)):
                raise WebEnvironmentError("Panorama name must be 1 to 80 printable characters")
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-")
            if not SLUG.fullmatch(slug):
                raise WebEnvironmentError("Panorama name needs letters or digits")
            self.root.mkdir(parents=True, exist_ok=True)
            staged = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.root, prefix=".panorama-", delete=False) as temporary:
                    staged = Path(temporary.name)
                    with source.open("rb") as original:
                        copied = 0
                        while chunk := original.read(128 * 1024):
                            copied += len(chunk)
                            if copied > MAX_BYTES:
                                raise WebEnvironmentError("Panorama PNG exceeds 32 MiB")
                            temporary.write(chunk)
                    temporary.flush()
                    os.fsync(temporary.fileno())
                info = inspect_panorama(staged)
                digest = hashlib.sha256(staged.read_bytes()).hexdigest()
                asset_id = f"panorama:{slug}:{digest[:12]}"
                items = self.list()
                for item in items:
                    if item["sha256"] == digest:
                        self.file(digest)
                        return item
                    if item["assetId"] == asset_id:
                        raise WebEnvironmentError("Panorama asset ID digest collision")
                if len(items) >= MAX_ASSETS:
                    raise WebEnvironmentError("Panorama catalog is full")
                target = self.root / f"{digest}.png"
                if target.exists():
                    if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                        raise WebEnvironmentError("Existing panorama bytes are corrupt")
                else:
                    os.replace(staged, target)
                    staged = None
                entry = {"assetId": asset_id, "displayName": name, "sha256": digest,
                         **info, "url": f"/api/web/environments/{digest}.png"}
                items.append(entry)
                manifest = None
                try:
                    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.root,
                                                     prefix=".manifest-", delete=False) as temporary:
                        manifest = Path(temporary.name)
                        json.dump(items, temporary, indent=2)
                        temporary.flush()
                        os.fsync(temporary.fileno())
                    os.replace(manifest, self.root / "manifest.json")
                    manifest = None
                finally:
                    if manifest is not None:
                        manifest.unlink(missing_ok=True)
                return entry
            finally:
                if staged is not None:
                    staged.unlink(missing_ok=True)
