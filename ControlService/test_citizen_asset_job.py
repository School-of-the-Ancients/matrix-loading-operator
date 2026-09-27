"""Durable Citizen Blender jobs reuse the ordinary fixed runner and catalog."""
import json
from pathlib import Path
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch

from blender_authoring import BlenderAuthoringJobs, BlenderAuthoringError
from citizen_asset_profile import PROFILE_ID, PROFILE_REVISION
from web_assets import WebAssetCatalog, WebAssetError


CHAIR = Path(__file__).parent.parent / "WebRuntime" / "test" / "fixtures" / "citizens-demo-chair.glb"
BOUNDS = {"center": {"x": 0, "y": .475, "z": 0},
          "size": {"x": .62, "y": .95, "z": .62}}


def ready(worker, job_id, phases=("ready", "error", "unconfirmed")):
    for _ in range(300):
        job = worker.status(job_id)
        if job["phase"] in phases:
            return job
        time.sleep(.01)
    raise AssertionError("Citizen Blender worker did not finish")


class CitizenBlenderJobTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.catalog = WebAssetCatalog(self.root / "catalog")
        self.calls = []

    def tearDown(self):
        self.folder.cleanup()

    def builder(self, recipe, directory):
        self.calls.append(recipe)
        output = Path(directory) / "asset.glb"
        shutil.copyfile(CHAIR, output)
        return output, BOUNDS

    def worker(self, *, catalog=None, builder=None):
        return BlenderAuthoringJobs(catalog or self.catalog,
                                    builder=builder or self.builder,
                                    citizen_directory=self.root / "jobs")

    def test_profile_job_is_durable_idempotent_and_does_not_rerun_blender(self):
        with patch("blender_authoring.blender_executable", return_value="fixture-blender.exe"):
            worker = self.worker()
            first = worker.submit_profile("AdaBo", "citizens-29-generated-2/asset.generate/1",
                                          "a" * 64, PROFILE_ID)
            result = ready(worker, first["jobId"])
            self.assertEqual(result["phase"], "ready", result)
            self.assertEqual(result["profileRevision"], PROFILE_REVISION)
            self.assertEqual(len(self.calls), 1)
            self.assertEqual(result["asset"]["sha256"], result["sha256"])
            self.assertEqual(self.catalog.file(result["sha256"]).read_bytes(), CHAIR.read_bytes())
            repeated = worker.submit_profile("AdaBo", first["citizenRequestId"],
                                             "a" * 64, PROFILE_ID)
            self.assertEqual(repeated["jobId"], first["jobId"])
            with self.assertRaisesRegex(BlenderAuthoringError, "changed"):
                worker.submit_profile("AdaBo", first["citizenRequestId"],
                                      "b" * 64, PROFILE_ID)
            restarted = self.worker(builder=lambda *_: self.fail("Blender reran"))
            self.assertEqual(restarted.status(first["jobId"])["phase"], "ready")
            self.assertEqual(len(self.calls), 1)
            self.assertEqual(len(restarted.status()["jobs"]), 1)

    def test_registration_error_retains_generated_bytes_for_safe_retry(self):
        with patch("blender_authoring.blender_executable", return_value="fixture-blender.exe"):
            worker = self.worker()
            with patch.object(self.catalog, "register", side_effect=WebAssetError("catalog unavailable")):
                submitted = worker.submit_profile("AdaBo", "citizens-29-generated-3/asset.generate/1",
                                                  "c" * 64, PROFILE_ID)
                for _ in range(300):
                    result = worker.status(submitted["jobId"])
                    if result["phase"] == "generated" and "error" in result:
                        break
                    time.sleep(.01)
                else:
                    self.fail("Expected retained generated phase")
            self.assertEqual(len(self.calls), 1)
            self.assertEqual(result["error"], "catalog unavailable")
            source = worker._citizen_path("AdaBo", submitted["citizenRequestId"]) / "asset.glb"
            self.assertTrue(source.is_file())
            worker.resume_registration(submitted["jobId"])
            restored = ready(worker, submitted["jobId"])
            self.assertEqual(restored["phase"], "ready", restored)
            self.assertEqual(len(self.calls), 1)
            self.assertEqual(self.catalog.file(restored["sha256"]).read_bytes(),
                             CHAIR.read_bytes())

    def test_interrupted_build_is_unconfirmed_without_automatic_retry(self):
        with patch("blender_authoring.blender_executable", return_value="fixture-blender.exe"):
            worker = self.worker()
            request_id = "citizens-29-generated-4/asset.generate/1"
            job = {"jobId": "d" * 32, "phase": "building",
                   "citizenRequestId": request_id, "hostWorldId": "AdaBo",
                   "requestSha256": "e" * 64, "profileId": PROFILE_ID,
                   "profileRevision": PROFILE_REVISION, "createdAt": 1.0,
                   "elapsedMs": None}
            worker._save_citizen_job(job)
            restarted = self.worker(builder=lambda *_: self.fail("Blender reran"))
            result = restarted.status(job["jobId"])
            self.assertEqual(result["phase"], "unconfirmed")
            self.assertEqual(json.loads((worker._citizen_path("AdaBo", request_id) /
                                         "job.json").read_text())["phase"], "unconfirmed")
            self.assertEqual(len(self.calls), 0)


if __name__ == "__main__":
    unittest.main()
