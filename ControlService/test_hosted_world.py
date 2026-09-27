"""A headless Citizens owner and a separately authenticated observation route."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from server import APIError, Server, State, world_checkpoint_digest


FIXTURE = json.loads((Path(__file__).with_name("testdata") /
                      "hosted_world_fixture.json").read_text(encoding="utf-8"))
OWNER = "test-host-owner-token-0123456789"
VIEWER = "test-host-viewer-token-0123456789"


class HostedWorldTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 0.0
        self.state = State(Path(self.temp.name) / "scenes", clock=lambda: self.now,
                           web_assets_directory=Path(self.temp.name) / "assets")
        self.snapshot = copy.deepcopy(FIXTURE["snapshot"])
        self.world = copy.deepcopy(FIXTURE["world"])

    def tearDown(self):
        self.temp.cleanup()

    def exchange(self, snapshot=None, client_id="host-1", name="AdaBo", **extra):
        return self.state.exchange({"clientId": client_id, "hostWorldId": name,
                                    "snapshot": copy.deepcopy(snapshot or self.snapshot),
                                    "results": [], "captureSupported": False, **extra})

    def test_host_descriptor_and_static_fixture_are_truthful(self):
        self.assertEqual(self.snapshot["runtimeDescriptor"], {
            "schemaVersion": 1, "client": "matrix-world-host",
            "renderer": "none", "presentation": "host"})
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        self.assertEqual(self.state.hosted_observation()["world"], self.world)
        changed = copy.deepcopy(self.snapshot)
        changed["scene"]["objects"][0]["behaviors"] = [{
            "kind": "rotate", "enabled": True, "paused": False, "speed": 1}]
        with self.assertRaises(APIError):
            self.exchange(changed)
        self.assertEqual(self.state.latest["scene"], self.world["scene"])
        forged = copy.deepcopy(self.snapshot)
        forged["runtimeDescriptor"]["renderer"] = "threejs-webxr"
        with self.assertRaises(APIError):
            self.exchange(forged)

    def test_bootstrap_observation_and_atomic_checkpoint_freshness(self):
        empty = copy.deepcopy(self.snapshot)
        empty["scene"]["objects"] = []
        empty["citizensState"] = None
        empty.pop("citizensObservation", None)
        self.exchange(empty)
        with self.assertRaises(APIError):
            self.state.hosted_observation()
        with self.assertRaisesRegex(APIError, "full Citizens fixture"):
            self.state.save_world_checkpoint("AdaBo", {
                "version": 2, "scene": empty["scene"], "game": None})
        self.assertFalse(self.state.world_checkpoint_path("AdaBo").exists())
        with self.assertRaises(APIError):
            self.state.hosted_observation()
        self.exchange()
        with self.assertRaisesRegex(APIError, "not checkpointed"):
            self.state.hosted_observation()
        self.assertTrue(self.state.save_world_checkpoint("AdaBo", self.world)["saved"])
        checkpoint = self.state.load_world_checkpoint("AdaBo")
        self.assertEqual(checkpoint["world"], self.world)
        saved = json.loads(self.state.world_checkpoint_path("AdaBo").read_text(encoding="utf-8"))
        self.assertEqual(saved["hostedWorldId"], "AdaBo")
        stale = copy.deepcopy(self.world)
        stale["citizens"]["paused"] = not stale["citizens"]["paused"]
        with self.assertRaisesRegex(APIError, "Hosted Citizens world changed"):
            self.state.save_world_checkpoint("AdaBo", stale)
        with self.assertRaisesRegex(APIError, "Hosted Citizens world changed"):
            self.state.save_world_checkpoint("Other", self.world)
        self.assertFalse((self.state.directory / "world_checkpoints" / "Other.json").exists())

    def test_lease_restart_changes_observation_instance_and_never_catches_up(self):
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        first = self.state.hosted_observation()
        self.assertEqual(first["sequence"], 1)
        with self.assertRaisesRegex(APIError, "Another client"):
            self.exchange(client_id="host-2")
        self.now = 16.0
        with self.assertRaises(APIError):
            self.state.hosted_observation()
        self.exchange(client_id="host-2")
        with self.assertRaisesRegex(APIError, "not checkpointed"):
            self.state.hosted_observation()
        self.state.save_world_checkpoint("AdaBo", self.world)
        second = self.state.hosted_observation()
        self.assertNotEqual(second["instanceId"], first["instanceId"])
        self.assertEqual(second["sequence"], 1)
        self.assertEqual(second["clockTick"], first["clockTick"])
        with self.assertRaisesRegex(APIError, "Hosted world changed"):
            self.exchange(client_id="host-2", name="Other")

    def test_observation_token_is_distinct_and_read_only(self):
        with self.assertRaisesRegex(APIError, "requires a distinct SANDBOX_TOKEN"):
            Server(("127.0.0.1", 0), self.state, "", VIEWER)
        with self.assertRaisesRegex(APIError, "requires a distinct SANDBOX_TOKEN"):
            Server(("127.0.0.1", 0), self.state, OWNER, OWNER)
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        service = Server(("127.0.0.1", 0), self.state, OWNER, VIEWER)
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()

        def get(path, token=""):
            request = urllib.request.Request(
                f"http://127.0.0.1:{service.server_port}{path}",
                headers={"Authorization": "Bearer " + token} if token else {})
            try:
                response = urllib.request.urlopen(request, timeout=3)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.loads(response.read())

        try:
            self.assertEqual(get("/api/web/hosted/observe")[0], 401)
            self.assertEqual(get("/api/web/hosted/observe", OWNER)[0], 401)
            status, value = get("/api/web/hosted/observe", VIEWER)
            self.assertEqual(status, 200)
            self.assertEqual(value["worldId"], "AdaBo")
            self.assertEqual(value["world"], self.world)
            self.assertEqual(get("/api/state", VIEWER)[0], 401)
            self.assertEqual(get("/api/state", OWNER)[0], 200)
        finally:
            service.shutdown()
            service.server_close()
            thread.join(timeout=3)

    def test_hosted_checkpoint_cannot_take_over_a_browser_checkpoint(self):
        target = self.state.world_checkpoint_path("AdaBo")
        target.parent.mkdir(parents=True)
        browser_document = {"schemaVersion": 1, "world": self.world,
                            "dependencies": [],
                            "payloadSha256": world_checkpoint_digest(self.world, [])}
        original = json.dumps(browser_document).encode("utf-8")
        target.write_bytes(original)
        self.exchange()
        with self.assertRaisesRegex(APIError, "different owner"):
            self.state.load_world_checkpoint("AdaBo")
        with self.assertRaisesRegex(APIError, "different owner"):
            self.state.save_world_checkpoint("AdaBo", self.world)
        self.assertEqual(target.read_bytes(), original)
        with self.assertRaisesRegex(APIError, "not checkpointed"):
            self.state.hosted_observation()

    def test_browser_cannot_load_or_replace_a_hosted_checkpoint(self):
        self.exchange()
        self.state.save_world_checkpoint("AdaBo", self.world)
        original = self.state.world_checkpoint_path("AdaBo").read_bytes()
        browser = State(self.state.directory, clock=lambda: self.now,
                        web_assets_directory=Path(self.temp.name) / "assets")
        browser_snapshot = copy.deepcopy(self.snapshot)
        browser_snapshot["runtimeDescriptor"] = {
            "schemaVersion": 1, "client": "matrix-web",
            "renderer": "threejs-webxr", "presentation": "desktop"}
        browser.exchange({"clientId": "browser-1", "snapshot": browser_snapshot,
                          "results": [], "captureSupported": False})
        with self.assertRaisesRegex(APIError, "different owner"):
            browser.load_world_checkpoint("AdaBo")
        with self.assertRaisesRegex(APIError, "different owner"):
            browser.save_world_checkpoint("AdaBo", self.world)
        self.assertEqual(self.state.world_checkpoint_path("AdaBo").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
