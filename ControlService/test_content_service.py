"""Runtime installation acknowledgement, provenance and authenticated HTTP tests."""
import copy
import json
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from content_catalog import ContentError
from server import APIError, State, snapshot
from test_server import SNAPSHOT, TRANSFORM
import test_server

SOURCE = {"providerId": "test", "packId": "props", "version": "1.0.0", "sha256": "a" * 64,
          "platform": "StandaloneWindows64", "unityVersion": "6000.6.0f1"}
ASSET = {"assetId": "test:props:1.0.0:beacon", "displayName": "Beacon", "source": SOURCE}
MANIFEST = {**SOURCE, "schemaVersion": 1, "byteLength": 12,
            "assets": [{"assetId": ASSET["assetId"], "prefabPath": "assets/beacon.prefab", "displayName": "Beacon", "spawnScale": 1}]}
CAPS = {"supported": True, "platform": SOURCE["platform"], "unityVersion": SOURCE["unityVersion"]}


class FakeCatalog:
    def __init__(self):
        self.gate = None
        self.manifest = MANIFEST
    def prepare(self, *args, **kwargs):
        if self.gate:
            self.gate.wait(2)
        return {"runtimeLoadable": True, "sha256": "a" * 64, "byteLength": 12, "metadata": {"contentPack": self.manifest}}


class ContentServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 100
        self.state = State(self.temp.name, clock=lambda: self.now)
        self.catalog = self.state.content._catalog = FakeCatalog()
        self.exchange()

    def exchange(self, value=SNAPSHOT, **kw):
        return self.state.exchange({"clientId": "desktop", "snapshot": value, "contentCapabilities": CAPS, **kw})

    def install(self):
        return self.state.content.queue_install({"providerId": "test", "assetId": "props", "version": "1.0.0"})

    def wait(self):
        for _ in range(200):
            job = next(iter(self.state.content.jobs.values()))
            if job["phase"] != "preparing":
                return job
            time.sleep(.005)
        self.fail("Preparation did not finish")

    def test_install_acknowledges_actual_snapshot_then_persists_exact_version(self):
        requested = self.install()
        self.assertEqual(self.wait()["phase"], "installing")
        incoming = self.exchange()["contentInstall"]
        self.assertEqual(incoming["manifest"], MANIFEST)
        with self.assertRaisesRegex(APIError, "installation"):
            self.state.queue([{"op": "clear"}])
        receipt = {"requestId": requested["requestId"], "ok": True, **{key: SOURCE[key] for key in ("sha256", "packId", "version")}}
        with self.assertRaisesRegex(ContentError, "registered"):
            self.exchange(contentReceipt=receipt)
        value = copy.deepcopy(SNAPSHOT)
        value["assets"].append(copy.deepcopy(ASSET))
        self.assertNotIn("contentInstall", self.exchange(value, contentReceipt=receipt))
        self.assertEqual(self.wait()["phase"], "ready")
        value["scene"]["objects"].append({"objectId": "new", "assetId": ASSET["assetId"], "anchorId": "floor", "transform": TRANSFORM, "source": SOURCE})
        self.exchange(value)
        self.state.save("Pack")
        saved = json.loads(self.state.path("Pack").read_text())
        self.assertEqual(saved["scene"]["objects"][0]["source"], SOURCE)
        self.assertEqual(saved["assets"][-1]["source"], SOURCE)
        self.exchange(value, contentReceipt=receipt)  # lost HTTP response retry
        self.assertEqual(len(self.state.content.jobs), 1)

    def test_cancel_before_runtime_dispatch(self):
        self.catalog.gate = threading.Event()
        job = self.install()
        self.state.content.cancel(job["requestId"])
        self.catalog.gate.set()
        self.assertNotIn("contentInstall", self.exchange())
        self.assertEqual(self.wait()["phase"], "cancelled")

    def test_install_response_is_frozen_before_worker_mutates_job(self):
        self.catalog.gate = threading.Event()
        started = threading.Event()
        threads = []
        original_start, original_copy = threading.Thread.start, copy.deepcopy

        def start(thread):
            started.set()
            threads.append(thread)
            return original_start(thread)

        def copy_value(value, *args, **kwargs):
            if (started.is_set() and threading.current_thread() is threading.main_thread()
                    and isinstance(value, str) and len(value) == 32):
                # If serialization starts after the worker, force completion
                # between dictionary entries: the old code raises RuntimeError.
                self.catalog.gate.set()
                self.assertEqual(self.wait()["phase"], "installing")
            return original_copy(value, *args, **kwargs)

        try:
            with patch("content_service.threading.Thread.start", new=start), \
                    patch("content_service.copy.deepcopy", side_effect=copy_value):
                response = self.install()
            self.assertEqual(response["phase"], "preparing")
            self.assertNotIn("manifest", response)
            self.assertNotIn("installStarted", response)
        finally:
            self.catalog.gate.set()
            for thread in threads:
                thread.join(2)
        self.assertEqual(self.wait()["phase"], "installing")

    def test_worker_start_failure_retires_job_and_does_not_block_retry(self):
        with patch("content_service.threading.Thread.start", side_effect=RuntimeError("cannot start new thread")):
            with self.assertRaises(ContentError) as caught:
                self.install()
        self.assertEqual(caught.exception.status, 503)
        job = next(iter(self.state.content.jobs.values()))
        self.assertEqual(job["phase"], "error")
        self.assertTrue(self.state.content.events[job["requestId"]].is_set())
        self.assertFalse(self.state.content.busy())
        retried = self.install()
        self.assertNotEqual(retried["requestId"], job["requestId"])

    def test_success_receipt_waits_for_localized_snapshot_without_dropping_heartbeat(self):
        requested = self.install()
        self.assertEqual(self.wait()["phase"], "installing")
        receipt = {"requestId": requested["requestId"], "ok": True,
                   **{key: SOURCE[key] for key in ("sha256", "packId", "version")}}
        loading = {"mode": "ar", "state": "loading", "message": "Room reload in progress", "alignmentVerified": False}
        response = self.exchange(None, runtime=loading, contentReceipt=receipt)
        self.assertIsNone(self.state.latest)
        self.assertTrue(self.state.online())
        self.assertEqual(response["contentInstall"]["requestId"], requested["requestId"])
        self.assertEqual(self.wait()["phase"], "installing")
        # Lost-response retries during localization must be equally harmless.
        self.exchange(None, runtime=loading, contentReceipt=receipt)
        value = copy.deepcopy(SNAPSHOT)
        value["assets"].append(copy.deepcopy(ASSET))
        self.assertNotIn("contentInstall", self.exchange(value, contentReceipt=receipt))
        self.assertEqual(self.wait()["phase"], "ready")

    def test_disconnect_never_retargets_install_to_new_client(self):
        self.install()
        self.wait()
        self.now += 20
        self.state.exchange({"clientId": "other", "snapshot": SNAPSHOT, "contentCapabilities": CAPS})
        self.assertEqual(self.wait()["phase"], "error")
        self.assertNotIn("contentInstall", self.state.exchange({"clientId": "other", "snapshot": SNAPSHOT, "contentCapabilities": CAPS}))

    def test_same_client_reconnect_does_not_revive_expired_install_or_accept_late_receipt(self):
        requested = self.install()
        self.assertEqual(self.wait()["phase"], "installing")
        self.now += 20
        # No status poll occurs while offline: the next call is this same
        # client's heartbeat, carrying an otherwise valid late success receipt.
        value = copy.deepcopy(SNAPSHOT)
        value["assets"].append(copy.deepcopy(ASSET))
        receipt = {"requestId": requested["requestId"], "ok": True,
                   **{key: SOURCE[key] for key in ("sha256", "packId", "version")}}
        response = self.exchange(value, contentReceipt=receipt)
        self.assertTrue(self.state.online())
        self.assertEqual(self.state.client_id, "desktop")
        self.assertNotIn("contentInstall", response)
        self.assertEqual(self.wait()["phase"], "error")
        self.assertIn("disconnected", self.wait()["error"])
        self.assertTrue(self.state.content.events[requested["requestId"]].is_set())
        self.assertNotIn("contentInstall", self.exchange(value, contentReceipt=receipt))

    def test_incompatible_pack_fails_before_runtime_request(self):
        self.catalog.manifest = {**MANIFEST, "unityVersion": "6000.0.0f1"}
        self.install()
        self.assertEqual(self.wait()["phase"], "error")
        self.assertNotIn("contentInstall", self.exchange())

    def test_partial_or_forged_provenance_rejected(self):
        for source in ({"providerId": "test"}, {**SOURCE, "sha256": "bad"}, {**SOURCE, "packId": "other"}):
            value = copy.deepcopy(SNAPSHOT)
            value["assets"].append({**ASSET, "source": source})
            with self.assertRaises(APIError):
                snapshot(value)


class ContentHttpTests(unittest.TestCase):
    setUp = test_server.ServiceTests.setUp
    tearDown = test_server.ServiceTests.tearDown
    request = test_server.ServiceTests.request
    def test_content_panel_and_authentication(self):
        self.assertIs(self.request("/api/state")[1]["contentLibrary"], True)
        code, html = self.request("/content")
        self.assertEqual(code, 200)
        self.assertIn(b"Unity import queue", html)
        self.server.token = "t" * 24
        self.assertEqual(self.request("/api/content")[0], 401)
        headers = {"Authorization": "Bearer " + self.server.token}
        code, state = self.request("/api/content", headers=headers)
        self.assertEqual(code, 200)
        self.assertFalse(state["configured"])
        self.assertEqual(self.request("/api/content/files/" + "a" * 64)[0], 401)
        self.assertEqual(self.request("/api/content/install", {"providerId": "test", "assetId": "props", "version": "1"}, headers=headers)[0], 409)


if __name__ == "__main__":
    unittest.main()
