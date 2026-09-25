"""Content contract, cache integrity and provider isolation tests."""
import copy
import hashlib
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from content_catalog import ContentCatalog, ContentError, MAX_DOWNLOAD, validate_manifest


DATA = b"a bounded, independently downloaded content artifact"
DIGEST = hashlib.sha256(DATA).hexdigest()


def asset(**changes):
    result = {"assetId": "demo-orb", "version": "1.0.0", "title": "Demo Orb", "category": "objects",
              "format": "glb", "targetPlatform": "Any", "sha256": DIGEST, "byteLength": len(DATA),
              "location": "orb.glb", "license": {"name": "CC0", "attribution": "Test fixture"},
              "dependencies": [], "metadata": {"description": "A blue orb", "tags": ["science"]}}
    result.update(changes)
    return result


class ProviderServer(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.server.requests.append(("GET", self.path, self.headers.get("Authorization")))
        response = self.server.responses.get(self.path, (404, b"missing"))
        status, value = response
        self.send_response(status)
        if status == 302:
            self.send_header("Location", value)
            self.end_headers()
            return
        self.end_headers()
        self.wfile.write(value if isinstance(value, bytes) else json.dumps(value).encode())

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        self.server.requests.append(("POST", self.path, body))
        if self.path == "/queue" and "delete" in body and not getattr(self.server, "ignore_queue_delete", False):
            queue = self.server.responses["/queue"][1]
            queue["queue_pending"] = [row for row in queue.get("queue_pending", []) if row[1] not in body["delete"]]
        status, value = self.server.responses.get("POST " + self.path, (404, b"missing"))
        self.send_response(status)
        self.end_headers()
        self.wfile.write(value if isinstance(value, bytes) else json.dumps(value).encode())


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "orb.glb").write_bytes(DATA)
        self.write_manifest([asset()])
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ProviderServer)
        self.server.responses = {"/catalog.json": (200, {"schemaVersion": 1, "assets": [asset()]}), "/orb.glb": (200, DATA)}
        self.server.requests = []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)
        self.providers = [{"id": "local-pack", "type": "local", "title": "Local packs", "enabled": True, "manifest": "catalog.json"},
                          {"id": "remote-pack", "type": "http", "title": "Remote packs", "enabled": True, "manifestUrl": self.url + "/catalog.json"}]
        self.catalog = self.create_catalog()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def create_catalog(self):
        (self.root / "config.json").write_text(json.dumps({"schemaVersion": 1, "providers": self.providers}), encoding="utf-8")
        return ContentCatalog(self.root / "config.json", self.root / "cache")

    def write_manifest(self, assets):
        (self.root / "catalog.json").write_text(json.dumps({"schemaVersion": 1, "assets": assets}), encoding="utf-8")

    def assert_error(self, status, callback):
        with self.assertRaises(ContentError) as caught:
            callback()
        self.assertEqual(status, caught.exception.status)

    def test_two_providers_search_filter_and_provenance(self):
        found = self.catalog.search("science", "objects")
        self.assertEqual({"local-pack", "remote-pack"}, {row["providerId"] for row in found["assets"]})
        self.assertFalse(found["errors"])
        self.assertEqual([], self.catalog.search("unrelated")["assets"])
        self.assertNotIn("location", found["assets"][0])
        self.assertEqual("CC0", found["assets"][0]["license"]["name"])
        self.assertFalse(found["assets"][0]["runtimeLoadable"])
        self.assertTrue(found["assets"][0]["requiresEditor"])

    def test_hdr_and_fbx_source_formats_stay_editor_only(self):
        sources = [asset(assetId="sky", category="environments", format="hdr"),
                   asset(assetId="model", category="objects", format="fbx")]
        self.write_manifest(sources)
        found = self.catalog.search(provider_id="local-pack")["assets"]
        self.assertEqual({"hdr", "fbx"}, {item["format"] for item in found})
        self.assertTrue(all(item["requiresEditor"] and not item["runtimeLoadable"] for item in found))

    def test_independent_provider_enable_persists(self):
        self.catalog.set_enabled("remote-pack", False)
        replacement = ContentCatalog(self.root / "config.json", self.root / "cache")
        self.assertEqual(1, len(replacement.search()["assets"]))
        self.assert_error(409, lambda: replacement.prepare("remote-pack", "demo-orb"))
        self.assertEqual(1, replacement.test_provider("local-pack")["assetCount"])
        self.assertEqual(1, replacement.test_provider("remote-pack")["assetCount"])

    def test_retrieve_verifies_both_providers_and_served_file(self):
        prepared = self.catalog.prepare("remote-pack", "demo-orb", "1.0.0", "Android")
        self.assertEqual(DATA, self.catalog.cached_file(DIGEST).read_bytes())
        self.assertEqual("/api/content/files/" + DIGEST, prepared["downloadPath"])
        self.assertEqual(DIGEST, self.catalog.prepare("local-pack", "demo-orb")["sha256"])
        self.assertNotIn(str(self.root), json.dumps(prepared))

    def test_corrupt_cache_is_repaired_and_serving_rechecks(self):
        prepared = self.catalog.prepare("local-pack", "demo-orb")
        cached = self.root / "cache" / prepared["sha256"]
        cached.write_bytes(b"corruption")
        self.assert_error(422, lambda: self.catalog.cached_file(DIGEST))
        self.catalog.prepare("local-pack", "demo-orb")
        self.assertEqual(DATA, cached.read_bytes())

    def test_bad_download_hash_rejected_without_partial_files(self):
        self.server.responses["/orb.glb"] = (200, b"x" * len(DATA))
        self.assert_error(422, lambda: self.catalog.prepare("remote-pack", "demo-orb"))
        self.assertFalse((self.root / "cache" / DIGEST).exists())
        self.assertEqual([], list((self.root / "cache").glob(".download-*")))

    def test_truncated_and_oversize_downloads_rejected(self):
        for invalid in (DATA[:-1], DATA + b"extra"):
            self.server.responses["/orb.glb"] = (200, invalid)
            with self.assertRaises(ContentError):
                self.catalog.prepare("remote-pack", "demo-orb")

    def test_cancelled_download_does_not_create_cache(self):
        cancelled = threading.Event()
        cancelled.set()
        self.assert_error(409, lambda: self.catalog.prepare("local-pack", "demo-orb", cancel_event=cancelled))
        self.assertFalse((self.root / "cache" / DIGEST).exists())

    def test_cancellation_during_transfer_cleans_temporary_file(self):
        cancelled = threading.Event()

        class CancelAfterRead(io.BytesIO):
            def read(self, count):
                result = super().read(count)
                cancelled.set()
                return result

        with CancelAfterRead(DATA) as source:
            self.assert_error(409, lambda: self.catalog._cache_stream(source, DIGEST, len(DATA), cancelled))
        self.assertEqual([], list((self.root / "cache").glob(".download-*")))
        self.assertEqual(0, self.catalog.reserved_bytes)
        self.assertFalse((self.root / "cache" / DIGEST).exists())

    def test_local_path_escape_and_absolute_path_rejected(self):
        for location in ("../secret.glb", str(self.root / "orb.glb"), "C:\\secret.glb"):
            self.write_manifest([asset(location=location)])
            self.assertTrue(self.catalog.search(provider_id="local-pack")["errors"])
            self.assert_error(400, lambda: self.catalog.prepare("local-pack", "demo-orb"))

    def test_remote_cross_origin_and_redirect_rejected(self):
        self.server.responses["/catalog.json"] = (200, {"schemaVersion": 1, "assets": [asset(location="https://example.com/leak")]})
        self.assert_error(400, lambda: self.catalog.prepare("remote-pack", "demo-orb"))
        self.server.responses["/catalog.json"] = (302, "https://example.com/leak")
        self.assert_error(502, lambda: self.catalog.test_provider("remote-pack"))

    def test_credentials_stay_in_pc_request_headers(self):
        self.providers[1]["tokenEnv"] = "MATRIX_TEST_CATALOG_KEY"
        self.catalog = self.create_catalog()
        with patch.dict(os.environ, {"MATRIX_TEST_CATALOG_KEY": "secret-should-not-leak"}):
            status = self.catalog.status()
            found = self.catalog.search()
            self.assertNotIn("secret-should-not-leak", json.dumps([status, found]))
            self.assertNotIn("MATRIX_TEST_CATALOG_KEY", json.dumps(status))
            self.assertEqual("Bearer secret-should-not-leak", self.server.requests[-1][2])
        with patch.dict(os.environ, {}, clear=True):
            self.assert_error(503, lambda: self.catalog.test_provider("remote-pack"))

    def test_auth_and_rate_limit_errors_do_not_echo_provider_body(self):
        for status, expected in ((401, 502), (429, 429)):
            self.server.responses["/catalog.json"] = (status, b"sensitive provider body")
            result = self.catalog.search(provider_id="remote-pack")
            self.assertEqual(expected, result["errors"][0]["status"])
            self.assertNotIn("sensitive", json.dumps(result))

    def test_invalid_manifest_contracts_and_duplicate_identity(self):
        variants = [asset(format="dll"), asset(byteLength=True), asset(byteLength=MAX_DOWNLOAD + 1),
                    asset(sha256="bad"), asset(category="scripts"), asset(license=None), asset(version="../bad")]
        for invalid in variants:
            with self.assertRaises(ContentError):
                validate_manifest({"schemaVersion": 1, "assets": [invalid]})
        with self.assertRaises(ContentError):
            validate_manifest({"schemaVersion": 1, "assets": [asset(), asset()]})

    def test_version_and_platform_require_exact_choice(self):
        self.write_manifest([asset(targetPlatform="Android"), asset(targetPlatform="StandaloneWindows64")])
        self.assert_error(409, lambda: self.catalog.prepare("local-pack", "demo-orb"))
        self.assertEqual("Android", self.catalog.prepare("local-pack", "demo-orb", target_platform="Android")["targetPlatform"])

    def test_explicit_platform_prefers_exact_variant_over_any(self):
        variants = [asset(), asset(targetPlatform="Android"), asset(targetPlatform="StandaloneWindows64")]
        for rows in (variants, list(reversed(variants))):
            with self.subTest(platforms=[row["targetPlatform"] for row in rows]):
                self.write_manifest(rows)
                for platform in ("Android", "StandaloneWindows64", "Any"):
                    prepared = self.catalog.prepare("local-pack", "demo-orb", "1.0.0", platform)
                    self.assertEqual(platform, prepared["targetPlatform"])
                self.assertEqual("Android", self.catalog.prepare("local-pack", "demo-orb", target_platform="Android")["targetPlatform"])
                self.assert_error(409, lambda: self.catalog.prepare("local-pack", "demo-orb", "1.0.0"))

    def test_explicit_platform_falls_back_to_any(self):
        self.write_manifest([asset(), asset(targetPlatform="StandaloneWindows64")])
        prepared = self.catalog.prepare("local-pack", "demo-orb", "1.0.0", "Android")
        self.assertEqual("Any", prepared["targetPlatform"])
        self.write_manifest([asset(targetPlatform="StandaloneWindows64")])
        self.assert_error(404, lambda: self.catalog.prepare("local-pack", "demo-orb", "1.0.0", "Android"))

    def test_platform_preference_preserves_version_ambiguity(self):
        for any_version, android_version in (("1.0.0", "2.0.0"), ("2.0.0", "1.0.0")):
            with self.subTest(any_version=any_version, android_version=android_version):
                self.write_manifest([asset(version=any_version), asset(version=android_version, targetPlatform="Android")])
                self.assert_error(409, lambda: self.catalog.prepare("local-pack", "demo-orb", target_platform="Android"))
                self.assertEqual("Any", self.catalog.prepare("local-pack", "demo-orb", any_version, "Android")["targetPlatform"])
                self.assertEqual("Android", self.catalog.prepare("local-pack", "demo-orb", android_version, "Android")["targetPlatform"])

    def test_assetbundle_metadata_matches_binary_and_version(self):
        pack = {"schemaVersion": 1, "packId": "starter", "providerId": "local-pack", "version": "1.0.0", "platform": "Android",
                "unityVersion": "6000.6.0f1", "sha256": DIGEST, "byteLength": len(DATA),
                "assets": [{"assetId": "local-pack:starter:1.0.0:orb", "prefabPath": "Assets/Orb.prefab", "displayName": "Orb"}]}
        item = asset(assetId="starter", format="assetbundle", targetPlatform="Android", metadata={"contentPack": pack})
        self.assertTrue(validate_manifest({"schemaVersion": 1, "assets": [item]}))
        pack["sha256"] = "0" * 64
        with self.assertRaises(ContentError):
            validate_manifest({"schemaVersion": 1, "assets": [item]})

    def test_ready_shortlist_searches_local_prefab_catalog(self):
        pack = {"schemaVersion": 1, "packId": "armchair", "providerId": "local-pack", "version": "1.0.0", "platform": "Android",
                "unityVersion": "6000.6.0f1", "sha256": DIGEST, "byteLength": len(DATA),
                "assets": [{"assetId": "local-pack:armchair:1.0.0:model", "prefabPath": "assets/chair.prefab", "displayName": "Armchair"}]}
        self.write_manifest([asset(assetId="armchair", title="Chinese Armchair", format="assetbundle", targetPlatform="Android",
                                   metadata={"description": "Comfortable chair", "tags": ["furniture"], "contentPack": pack})])
        found = self.catalog.suggest_ready("Find a better comfortable armchair")
        self.assertEqual(1, len(found))
        self.assertEqual("local-pack", found[0]["providerId"])
        self.assertTrue(found[0]["runtimeLoadable"])
        self.assertNotIn("location", found[0])

    def test_ready_shortlist_respects_explicit_panorama_intent(self):
        def ready(identifier, category):
            pack = {"schemaVersion": 1, "packId": identifier, "providerId": "local-pack", "version": "1.0.0",
                    "platform": "Android", "unityVersion": "6000.6.0f1", "sha256": DIGEST, "byteLength": len(DATA),
                    "assets": [{"assetId": "local-pack:" + identifier + ":1.0.0:visual",
                                "prefabPath": "assets/" + identifier + ".prefab", "displayName": identifier}]}
            return asset(assetId=identifier, title="Grassy " + identifier, category=category,
                         format="assetbundle", targetPlatform="Android", metadata={"contentPack": pack})
        self.write_manifest([ready("cobblestone", "materials"), ready("meadow", "environments")])
        found = self.catalog.suggest_ready("Show a grassy panorama", platform="Android", unity_version="6000.6.0f1")
        self.assertEqual(["meadow"], [item["assetId"] for item in found])

    def test_public_discovery_default_and_invalid_config_report_honestly(self):
        with patch.dict(os.environ, {}, clear=True):
            default = ContentCatalog(cache_dir=self.root / "empty").status()
            self.assertTrue(default["configured"])
            self.assertEqual("polyhaven", default["providers"][0]["id"])
            self.assertFalse(default["providers"][0]["capabilities"]["retrieve"])
        self.providers.append(copy.deepcopy(self.providers[0]))
        status = self.create_catalog().status()
        self.assertFalse(status["configured"])
        self.assertIn("Duplicate", status["configError"])
        self.assertEqual(9, len(status["categories"]))

    def test_public_polyhaven_discovery_is_paged_cached_and_never_prepared_as_a_pack(self):
        self.providers = [{"id": "polyhaven", "type": "polyhaven", "enabled": True}]
        catalog = self.create_catalog()
        listing = {"model-" + str(i): {"type": 2, "name": "Chair " + str(i),
                   "description": "Wooden chair", "tags": ["furniture"], "files_hash": "a" * 40}
                   for i in range(225)}
        listing["sunset"] = {"type": 0, "name": "Sunset", "description": "Sky", "tags": ["outdoor"]}
        listing["marble"] = {"type": 1, "name": "Marble", "description": "Stone", "tags": ["surface"]}
        with patch.object(catalog, "_json_request", return_value=listing) as fetch:
            first = catalog.search(category="objects", limit=100)
            second = catalog.search(category="objects", offset=100, limit=100)
            third = catalog.search(category="objects", offset=200, limit=100)
            self.assertEqual([100, 100, 25], [len(first["assets"]), len(second["assets"]), len(third["assets"])])
            self.assertEqual(225, first["total"])
            self.assertFalse(third["hasMore"])
            self.assertEqual(225, len({row["assetId"] for result in (first, second, third) for row in result["assets"]}))
            self.assertEqual(1, fetch.call_count)
            self.assertEqual(1, catalog.search(category="environments")["total"])
            self.assertEqual(1, catalog.search(category="materials")["total"])
            suggested = catalog.suggest_public("Please put a wooden chair in my room")
            self.assertTrue(suggested)
            self.assertEqual("polyhaven", suggested[0]["providerId"])
            self.assertEqual([], catalog.suggest_public("please put it in my room"))
            row = catalog.search("Chair 12")["assets"][0]
            self.assertEqual("CC0", row["license"]["name"])
            self.assertTrue(row["discoveryOnly"])
            self.assertFalse(row["runtimeLoadable"])
            self.assertTrue(row["metadata"]["sourceUrl"].startswith("https://polyhaven.com/a/"))
            self.assert_error(409, lambda: catalog.prepare("polyhaven", row["assetId"]))
            self.assert_error(400, lambda: catalog.search(limit=101))
            self.assert_error(400, lambda: catalog.search(offset=-1))

    def test_sketchfab_search_preserves_license_and_opaque_page_cursors(self):
        self.providers = [{"id": "sketchfab", "type": "sketchfab", "enabled": True}]
        catalog = self.create_catalog()
        uid = "a" * 32
        item = {"uid": uid, "name": "Old Castle", "isDownloadable": True, "isAgeRestricted": False,
                "license": {"label": "CC Attribution"}, "description": "A 3D castle", "tags": [{"name": "castle"}],
                "categories": [{"name": "architecture"}], "animationCount": 0}
        pages = [{"results": [item], "cursors": {"next": "next_24", "previous": None}},
                 {"results": [dict(item, uid="b" * 32)], "cursors": {"next": None, "previous": "prev_0"}}]
        with patch.object(catalog, "_json_request", side_effect=pages) as fetch:
            first = catalog.search("castle", provider_id="sketchfab")
            second = catalog.search("castle", provider_id="sketchfab", cursor=first["nextCursor"])
        self.assertIsNone(first["total"])
        self.assertEqual("next_24", first["nextCursor"])
        self.assertEqual("prev_0", second["previousCursor"])
        self.assertFalse(second["hasMore"])
        self.assertEqual("CC Attribution", first["assets"][0]["license"]["name"])
        self.assertTrue(first["assets"][0]["discoveryOnly"])
        self.assertEqual("environments", first["assets"][0]["category"])
        self.assertIn("cursor=next_24", fetch.call_args.args[1])
        self.assert_error(409, lambda: catalog.prepare("sketchfab", uid))
        self.assert_error(400, lambda: catalog.search(provider_id="sketchfab", cursor="../../bad"))

    def test_openverse_audio_preserves_credit_and_pages_without_installing(self):
        self.providers = [{"id": "openverse-audio", "type": "openverse-audio", "enabled": True}]
        catalog = self.create_catalog()
        first_id = "a8783d20-f1af-4c4b-b9ec-a8c212f67fee"
        second_id = "b8783d20-f1af-4c4b-b9ec-a8c212f67fee"
        item = {"id": first_id, "title": "Footsteps, Stones", "license": "by",
                "license_url": "https://creativecommons.org/licenses/by/4.0/",
                "creator": "InspectorJ", "attribution": "Footsteps by InspectorJ, CC BY 4.0",
                "foreign_landing_url": "https://freesound.org/people/InspectorJ/sounds/345560",
                "filetype": "MP3", "duration": 18940, "tags": [{"name": "footsteps"}]}
        pages = [{"results": [item], "result_count": 2, "page_count": 2, "page": 1},
                 {"results": [dict(item, id=second_id)],
                  "result_count": 2, "page_count": 2, "page": 2}]
        with patch.object(catalog, "_json_request", side_effect=pages) as fetch:
            first = catalog.search("footsteps", provider_id="openverse-audio", category="sounds", limit=1)
            self.assertEqual(2, first["total"])
            self.assertTrue(first["hasMore"])
            self.assertEqual(1, len(first["assets"]))
            row = first["assets"][0]
            self.assertEqual("sounds", row["category"])
            self.assertEqual("mp3", row["format"])
            self.assertEqual("by", row["license"]["name"])
            self.assertEqual("Footsteps by InspectorJ, CC BY 4.0", row["license"]["attribution"])
            self.assertEqual("https://freesound.org/people/InspectorJ/sounds/345560", row["metadata"]["sourceUrl"])
            self.assertEqual(18.94, row["metadata"]["durationSeconds"])
            self.assertTrue(row["discoveryOnly"])
            self.assertFalse(row["runtimeLoadable"])
            second = catalog.search("footsteps", provider_id="openverse-audio", offset=1, limit=1)
            self.assertEqual(second_id, second["assets"][0]["assetId"])
            self.assertFalse(second["hasMore"])
            self.assertIn("page=2", fetch.call_args.args[1])
        self.assert_error(409, lambda: catalog.prepare("openverse-audio", first_id))
        self.assert_error(400, lambda: catalog.search(provider_id="openverse-audio", category="objects"))
        self.assert_error(400, lambda: catalog.search(provider_id="openverse-audio", offset=1, limit=2))
        self.assert_error(400, lambda: catalog.search(provider_id="openverse-audio", cursor="bad"))

    def test_openverse_audio_excludes_mature_rows_and_unsafe_links(self):
        self.providers = [{"id": "openverse-audio", "type": "openverse-audio", "enabled": True}]
        catalog = self.create_catalog()
        first_id = "a8783d20-f1af-4c4b-b9ec-a8c212f67fee"
        second_id = "b8783d20-f1af-4c4b-b9ec-a8c212f67fee"
        item = {"id": first_id, "title": "Footsteps", "license": "cc0", "creator": "Creator"}
        page = {"results": [dict(item, mature=True),
                            dict(item, id=second_id, foreign_landing_url="http://insecure.example/audio")],
                "result_count": 2, "page_count": 1, "page": 1}
        with patch.object(catalog, "_json_request", return_value=page):
            result = catalog.search("footsteps", provider_id="openverse-audio", limit=2)
        self.assertEqual(1, len(result["assets"]))
        self.assertEqual("https://api.openverse.org/v1/audio/" + second_id + "/",
                         result["assets"][0]["metadata"]["sourceUrl"])
        self.assertFalse(result["hasMore"])

    def test_malformed_http_identifiers_return_domain_errors(self):
        self.configure_comfy()
        for invalid in ([], {}, True, 42, None):
            for operation in (
                lambda: self.catalog.test_provider(invalid),
                lambda: self.catalog.set_enabled(invalid, True),
                lambda: self.catalog.prepare(invalid, "demo-orb"),
                lambda: self.catalog.submit_workflow("fleet", invalid, approved=True),
                lambda: self.catalog.poll_generation(invalid),
                lambda: self.catalog.update_import(invalid, "queued"),
            ):
                self.assert_error(400, operation)
        for field in ("format", "sha256", "byteLength", "assetId", "version"):
            with self.assertRaises(ContentError):
                validate_manifest({"schemaVersion": 1, "assets": [asset(**{field: []})]})

    def test_editor_queue_has_no_automatic_execution_and_persists(self):
        source = "https://assetstore.unity.com/packages/3d/props/example-123"
        row = self.catalog.queue_import(source, "Example Props")
        self.assertEqual("queued", row["status"])
        self.assertTrue(row["requiresEditor"])
        replacement = ContentCatalog(self.root / "config.json", self.root / "cache")
        replacement.update_import(row["id"], "acquired", "License checked in Unity")
        self.assertEqual("acquired", replacement.import_queue()[0]["status"])
        self.assert_error(400, lambda: replacement.queue_import("https://example.com/packages/evil"))

    def test_local_unitypackage_is_staged_and_source_path_private(self):
        package = self.root / "licensed.unitypackage"
        package.write_bytes(DATA)
        row = self.catalog.queue_import(str(package))
        self.assertEqual(package.name, row["source"])
        self.assertNotIn(str(self.root), json.dumps(row))
        self.assertEqual(DATA, self.catalog.cached_file(row["sha256"]).read_bytes())
        self.assertNotIn("privateSource", json.dumps(self.catalog.import_queue()))

    def configure_comfy(self):
        graph = {"3": {"class_type": "CLIPTextEncode", "inputs": {"text": "configured prompt"}}}
        (self.root / "workflow.json").write_text(json.dumps(graph), encoding="utf-8")
        self.providers.append({"id": "fleet", "type": "comfyui", "enabled": True, "baseUrl": self.url,
                               "workflows": [{"id": "skybox", "path": "workflow.json", "localOnly": True, "promptNode": "3"}]})
        self.server.responses.update({"/system_stats": (200, {"devices": []}), "/object_info": (200, {"CLIPTextEncode": {}}),
                                      "POST /prompt": (200, {"prompt_id": "job-123", "number": 1}), "/history/job-123": (200, {}),
                                      "/queue": (200, {"queue_running": [], "queue_pending": [[0, "job-123"]]}), "POST /queue": (200, b"")})
        self.catalog = self.create_catalog()

    def test_comfy_requires_reviewed_local_workflow_and_explicit_approval(self):
        self.configure_comfy()
        self.assertEqual(1, self.catalog.test_provider("fleet")["nodeCount"])
        self.assert_error(409, lambda: self.catalog.submit_workflow("fleet", "skybox", "stars"))
        self.assert_error(404, lambda: self.catalog.submit_workflow("fleet", "unknown", approved=True))
        self.assertFalse(any(method == "POST" for method, _, _ in self.server.requests))
        job = self.catalog.submit_workflow("fleet", "skybox", "stars", approved=True)
        self.assertEqual("queued", job["status"])
        self.assertEqual("stars", self.server.requests[-1][2]["prompt"]["3"]["inputs"]["text"])
        self.assertNotIn(str(self.root), json.dumps([self.catalog.status(), job]))

    def test_comfy_poll_and_bounded_output_cache(self):
        self.configure_comfy()
        job = self.catalog.submit_workflow("fleet", "skybox", approved=True)
        self.server.responses["/history/job-123"] = (200, {"job-123": {"status": {"completed": True, "status_str": "success"},
            "outputs": {"9": {"images": [{"filename": "skybox.png", "subfolder": "matrix", "type": "output"}]}}}})
        self.server.responses["/view?filename=skybox.png&subfolder=matrix&type=output"] = (200, DATA)
        result = self.catalog.prepare_generation_output(job["id"], 0)
        self.assertEqual(DIGEST, result["sha256"])
        self.assertFalse(result["runtimeLoadable"])
        self.assertEqual("completed", self.catalog.generations()[0]["status"])

    def test_comfy_cancel_only_own_queued_job(self):
        self.configure_comfy()
        job = self.catalog.submit_workflow("fleet", "skybox", approved=True)
        self.assertEqual("cancelled", self.catalog.cancel_generation(job["id"])["status"])
        self.assertIn(("POST", "/queue", {"delete": ["job-123"]}), self.server.requests)
        self.assertFalse(any(path == "/interrupt" for _, path, _ in self.server.requests))
        job = self.catalog.submit_workflow("fleet", "skybox", approved=True)
        self.server.responses["/queue"] = (200, {"queue_running": [[0, "job-123"]]})
        self.assert_error(409, lambda: self.catalog.cancel_generation(job["id"]))

    def test_comfy_rejects_output_path_traversal(self):
        self.configure_comfy()
        job = self.catalog.submit_workflow("fleet", "skybox", approved=True)
        self.server.responses["/history/job-123"] = (200, {"job-123": {"status": {"completed": True},
            "outputs": {"9": {"images": [{"filename": "private.png", "subfolder": "../secret", "type": "output"}]}}}})
        self.assert_error(502, lambda: self.catalog.poll_generation(job["id"]))

    def test_comfy_workflow_editor_format_is_not_submitted(self):
        self.configure_comfy()
        (self.root / "workflow.json").write_text(json.dumps({"nodes": [{"id": 1, "type": "Node"}], "links": []}), encoding="utf-8")
        self.assert_error(400, lambda: self.catalog.submit_workflow("fleet", "skybox", approved=True))
        self.assertFalse(any(method == "POST" for method, _, _ in self.server.requests))

    def test_comfy_lost_history_reports_missing(self):
        self.configure_comfy()
        job = self.catalog.submit_workflow("fleet", "skybox", approved=True)
        self.server.responses["/queue"] = (200, {"queue_running": [], "queue_pending": []})
        self.assertEqual("missing", self.catalog.poll_generation(job["id"])["status"])

    def test_comfy_does_not_claim_cancel_when_worker_keeps_job(self):
        self.configure_comfy()
        job = self.catalog.submit_workflow("fleet", "skybox", approved=True)
        self.server.ignore_queue_delete = True
        self.assert_error(502, lambda: self.catalog.cancel_generation(job["id"]))
        self.assertNotEqual("cancelled", self.catalog.generations()[0]["status"])

    def test_bad_provider_does_not_hide_good_provider(self):
        self.server.responses["/catalog.json"] = (200, b"invalid json")
        result = self.catalog.search()
        self.assertEqual(["local-pack"], [row["providerId"] for row in result["assets"]])
        self.assertEqual("remote-pack", result["errors"][0]["providerId"])

    def test_cache_capacity_prevents_unbounded_disk_growth(self):
        with patch("content_catalog.MAX_CACHE_BYTES", len(DATA) - 1):
            self.assert_error(507, lambda: self.catalog.prepare("local-pack", "demo-orb"))
        self.assertEqual(0, self.catalog.reserved_bytes)


if __name__ == "__main__":
    unittest.main()
