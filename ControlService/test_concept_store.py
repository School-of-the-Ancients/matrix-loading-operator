"""Concept version/selection durability and honest ComfyUI job state."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from concept_store import ConceptStore
from content_catalog import ContentError


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/"
    "lXcAAAAASUVORK5CYII=")


class FakeConceptCatalog:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.image = self.directory / hashlib.sha256(PNG).hexdigest()
        self.image.write_bytes(PNG)
        self.providers = {"worker": {"id": "worker", "type": "comfyui", "enabled": True,
                                     "workflows": {"krea": {"id": "krea", "seedNode": "55"}}}}
        self.requests = []
        self.states = {}
        self.unreachable = False

    @staticmethod
    def _enabled(provider):
        return provider["enabled"]

    def submit_workflow(self, provider_id, workflow_id, prompt, **options):
        self.requests.append((provider_id, workflow_id, prompt, options))
        job_id = f"comfy-{len(self.requests)}"
        self.states[job_id] = "queued"
        return {"id": job_id, "workflowSha256": "f" * 64,
                "model": ["Krea2.safetensors"], "seed": options["seed"]}

    def poll_generation(self, job_id):
        if self.unreachable:
            raise ContentError(502, "Content provider is unreachable")
        status = self.states[job_id]
        return {"status": status, "outputs": [{"filename": "result.png"}] if status == "completed" else []}

    def prepare_generation_output(self, job_id, index):
        if self.unreachable:
            raise ContentError(502, "Content provider is unreachable")
        return {"sha256": self.image.name, "byteLength": len(PNG), "filename": "result.png"}

    def cached_file(self, checksum):
        assert checksum == self.image.name
        return self.image

    def cancel_generation(self, job_id):
        if self.states[job_id] != "queued":
            raise ContentError(409, "Only queued jobs can be cancelled")
        self.states[job_id] = "cancelled"
        return {"status": "cancelled"}


class ConceptStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.catalog = FakeConceptCatalog(self.directory / "cache")
        self.store = ConceptStore(self.directory / "concepts", lambda: self.catalog)
        self.session = "a" * 32

    def create(self, prompt="Forest temple", **kwargs):
        return self.store.create(self.session, prompt, **kwargs)["job"]

    def test_variants_are_distinct_and_late_result_does_not_change_selection(self):
        first = self.create()
        self.assertEqual(first["status"], "queued")
        self.assertEqual(first["version"], 1)
        self.assertEqual(self.store.status(self.session, refresh=False)["selectedConceptId"], None)
        self.catalog.states[self.store.data["sessions"][self.session]["jobs"][0]["catalogJobId"]] = "completed"
        first = self.store.status(self.session)["concepts"][0]
        self.assertEqual(first["status"], "ready")
        self.store.select(self.session, first["conceptId"], "Keep tall trees")
        self.store.select(self.session, first["conceptId"])

        second = self.create(None, source_concept_id=first["conceptId"])
        self.assertEqual(second["version"], 2)
        self.assertEqual(second["parentConceptId"], first["conceptId"])
        self.assertEqual(self.catalog.requests[0][2], self.catalog.requests[1][2])
        self.assertNotEqual(self.catalog.requests[0][3]["seed"], self.catalog.requests[1][3]["seed"])
        self.assertTrue(self.catalog.requests[1][3]["validate_image"])
        self.catalog.states[self.store.data["sessions"][self.session]["jobs"][1]["catalogJobId"]] = "completed"
        status = self.store.status(self.session)
        self.assertEqual(len(status["concepts"]), 2)
        self.assertEqual(status["selectedConceptId"], first["conceptId"])
        selected = self.store.selected(self.session)
        self.assertEqual(selected["designNotes"], "Keep tall trees")
        self.assertEqual(Path(selected["imagePath"]).read_bytes(), PNG)
        self.assertEqual(selected["sha256"], hashlib.sha256(PNG).hexdigest())
        self.assertEqual(selected["model"], ["Krea2.safetensors"])
        self.assertNotIn("imagePath", json.dumps(status))

        reopened = ConceptStore(self.directory / "concepts", lambda: self.catalog)
        self.assertEqual(reopened.status(self.session)["selectedConceptId"], first["conceptId"])
        self.assertEqual(len(reopened.status(self.session)["concepts"]), 2)

    def test_unavailable_worker_preserves_uncertain_job_for_late_completion(self):
        job = self.create()
        catalog_id = self.store.data["sessions"][self.session]["jobs"][0]["catalogJobId"]
        self.catalog.unreachable = True
        uncertain = self.store.status(self.session)["jobs"][0]
        self.assertEqual(uncertain["status"], "queued")
        self.assertIn("could not be verified", uncertain["message"])
        self.catalog.unreachable = False
        self.catalog.states[catalog_id] = "running"
        self.assertEqual(self.store.status(self.session)["jobs"][0]["status"], "generating")
        self.catalog.states[catalog_id] = "completed"
        self.assertEqual(self.store.status(self.session)["jobs"][0]["status"], "ready")
        self.assertIsNone(self.store.status(self.session)["selectedConceptId"])

    def test_failed_submission_and_restart_without_catalog_job_are_not_resubmitted(self):
        self.catalog.providers.clear()
        failed = self.create()
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(len(self.catalog.requests), 0)

        payload = self.store.data
        payload["sessions"][self.session]["jobs"][0].update(status="queued", message="submitting")
        from content_catalog import atomic_json
        atomic_json(self.store.path, payload)
        recovered = ConceptStore(self.directory / "concepts", lambda: self.catalog)
        self.assertEqual(recovered.status(self.session)["jobs"][0]["status"], "failed")
        self.assertIn("outcome is unknown", recovered.status(self.session)["jobs"][0]["message"])
        self.assertEqual(len(self.catalog.requests), 0)

    def test_selection_requires_ready_and_cancel_is_confirmed(self):
        job = self.create()
        with self.assertRaises(ContentError):
            self.store.select(self.session, job["conceptId"])
        cancelled = self.store.cancel(self.session, job["conceptId"])["job"]
        self.assertEqual(cancelled["status"], "cancelled")
        with self.assertRaises(ContentError):
            self.store.cancel(self.session, job["conceptId"])

    def test_completed_worker_job_needs_a_verified_image_before_ready(self):
        self.create()
        catalog_id = self.store.data["sessions"][self.session]["jobs"][0]["catalogJobId"]
        self.catalog.states[catalog_id] = "completed"
        original = self.catalog.prepare_generation_output
        def wrong_format(job_id, index):
            return {**original(job_id, index), "filename": "result.jpg"}
        with patch.object(self.catalog, "prepare_generation_output", side_effect=wrong_format):
            status = self.store.status(self.session)
        self.assertEqual(status["jobs"][0]["status"], "failed")
        self.assertEqual(status["concepts"], [])
        self.assertIsNone(status["selectedConceptId"])

    def test_build_provenance_is_bound_to_original_concept_after_selection_changes(self):
        first = self.create()
        first_id = self.store.data["sessions"][self.session]["jobs"][0]["catalogJobId"]
        self.catalog.states[first_id] = "completed"
        self.store.status(self.session)
        self.store.select(self.session, first["conceptId"])
        requested = {"buildRequestId": "b" * 32, "conceptId": first["conceptId"],
                     "status": "requested", "turnId": None, "roomId": "web-room",
                     "sceneRevision": 3}
        self.store.record_build(self.session, requested)
        self.store.record_build(self.session, {**requested, "turnId": "turn-1"})
        second = self.create(None, source_concept_id=first["conceptId"])
        second_id = self.store.data["sessions"][self.session]["jobs"][1]["catalogJobId"]
        self.catalog.states[second_id] = "completed"
        self.store.status(self.session)
        self.store.select(self.session, second["conceptId"])
        completed = self.store.record_build(self.session, {
            "buildRequestId": "b" * 32, "conceptId": first["conceptId"],
            "status": "completed", "turnId": "turn-1", "strategy": "code-generated GLB",
            "sourcePaths": ["C:/private/forest.py"], "assetIds": ["web:forest"],
            "objectIds": ["grove-1"], "receipts": ["receipt-1"]})
        self.assertEqual(completed["conceptId"], first["conceptId"])
        self.assertEqual(completed["conceptVersion"], 1)
        self.assertEqual(completed["conceptSha256"], hashlib.sha256(PNG).hexdigest())
        self.assertEqual(completed["objectIds"], ["grove-1"])
        self.assertNotIn("sourcePaths", completed)
        self.assertEqual(completed["sourceNames"], ["forest.py"])
        self.assertEqual(self.store.build_provenance(self.session, "b" * 32)["sourcePaths"],
                         ["C:/private/forest.py"])
        with self.assertRaises(ContentError):
            self.store.record_build(self.session, {"buildRequestId": "b" * 32,
                                                   "conceptId": first["conceptId"],
                                                   "status": "failed"})


if __name__ == "__main__":
    unittest.main()
