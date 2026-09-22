"""Generation capacity stays bounded while provider submissions are in flight."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from content_catalog import ContentCatalog, ContentError


class GenerationCapacityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "workflow.json").write_text(json.dumps({
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "test"}}
        }), encoding="utf-8")
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"schemaVersion": 1, "providers": [{
            "id": "local-worker", "type": "comfyui", "enabled": True,
            "baseUrl": "http://127.0.0.1:1",
            "workflows": [{"id": "image", "path": "workflow.json", "localOnly": True}]
        }]}), encoding="utf-8")
        self.catalog = ContentCatalog(self.config, self.root / "cache")

    def submit(self):
        return self.catalog.submit_workflow("local-worker", "image", approved=True)

    def test_last_slot_is_reserved_before_provider_submission(self):
        entered = threading.Event()
        release = threading.Event()

        def provider_response(*args):
            if not entered.is_set():
                entered.set()
                if not release.wait(5):
                    raise TimeoutError("Test did not release provider submission")
            return {"prompt_id": "accepted"}

        with patch("content_catalog.MAX_QUEUE", 2):
            with patch.object(self.catalog, "_json_request", return_value={"prompt_id": "existing"}):
                existing = self.submit()
            with patch.object(self.catalog, "_json_request", side_effect=provider_response) as request:
                with ThreadPoolExecutor(max_workers=3) as executor:
                    first = executor.submit(self.submit)
                    try:
                        self.assertTrue(entered.wait(2))
                        # Provider I/O must not hold the catalog lock or block status reads.
                        self.assertEqual([existing], executor.submit(self.catalog.generations).result(timeout=2))
                        with self.assertRaises(ContentError) as caught:
                            executor.submit(self.submit).result(timeout=2)
                        self.assertEqual(409, caught.exception.status)
                        self.assertEqual(1, request.call_count)
                    finally:
                        release.set()
                    accepted = first.result(timeout=2)

        expected = [existing, accepted]
        self.assertEqual(expected, self.catalog.generations())
        self.assertEqual(expected, ContentCatalog(self.config, self.root / "cache").generations())

    def test_failed_submissions_release_capacity_for_retry(self):
        failures = [ContentError(502, "Provider is unreachable"),
                    RuntimeError("Unexpected provider failure"),
                    {}, {"prompt_id": "rejected", "error": "invalid graph"},
                    {"prompt_id": "../invalid"}]
        for index, failure in enumerate(failures):
            with self.subTest(failure=repr(failure)):
                catalog = ContentCatalog(self.config, self.root / ("retry-" + str(index)))
                with patch("content_catalog.MAX_QUEUE", 1):
                    response = {"side_effect": failure} if isinstance(failure, Exception) else {"return_value": failure}
                    with patch.object(catalog, "_json_request", **response):
                        with self.assertRaises((ContentError, RuntimeError)):
                            catalog.submit_workflow("local-worker", "image", approved=True)
                    self.assertEqual([], catalog.generations())
                    with patch.object(catalog, "_json_request", return_value={"prompt_id": "retry"}) as request:
                        accepted = catalog.submit_workflow("local-worker", "image", approved=True)
                        with self.assertRaises(ContentError) as caught:
                            catalog.submit_workflow("local-worker", "image", approved=True)
                        self.assertEqual(409, caught.exception.status)
                        self.assertEqual(1, request.call_count)
                self.assertEqual([accepted], ContentCatalog(self.config, catalog.cache_dir).generations())

    def test_persistence_failure_does_not_count_accepted_job_twice(self):
        with patch("content_catalog.MAX_QUEUE", 2):
            with patch.object(self.catalog, "_json_request", return_value={"prompt_id": "accepted"}):
                with patch("content_catalog.atomic_json", side_effect=OSError("Disk unavailable")):
                    with self.assertRaises(OSError):
                        self.submit()
            # The accepted job remains in memory, but its submission slot is released.
            self.assertEqual(1, len(self.catalog.generations()))
            with patch.object(self.catalog, "_json_request", return_value={"prompt_id": "second"}) as request:
                self.submit()
                with self.assertRaises(ContentError) as caught:
                    self.submit()
                self.assertEqual(409, caught.exception.status)
                self.assertEqual(1, request.call_count)
        history = ContentCatalog(self.config, self.root / "cache").generations()
        self.assertEqual(["accepted", "second"], [job["promptId"] for job in history])

    def test_parallel_submissions_can_use_distinct_available_slots(self):
        both_entered = threading.Barrier(2)

        def provider_response(provider, url, payload):
            both_entered.wait(timeout=2)
            return {"prompt_id": payload["client_id"]}

        with patch("content_catalog.MAX_QUEUE", 2), patch.object(self.catalog, "_json_request", side_effect=provider_response):
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(self.submit) for _ in range(2)]
                accepted = [future.result(timeout=3) for future in futures]
        self.assertCountEqual(accepted, self.catalog.generations())
        self.assertCountEqual(accepted, ContentCatalog(self.config, self.root / "cache").generations())


if __name__ == "__main__":
    unittest.main()
