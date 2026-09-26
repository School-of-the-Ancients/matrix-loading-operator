"""Live browser archive commands remain scoped and produce bounded receipts."""
import copy
from pathlib import Path
import tempfile
import unittest

from matrix_tool_bridge import MatrixToolBridge, read_scene, world_archive_status
from server import APIError, State


ROOM = "web-virtual-room-v1"
ARCHIVE_ID = "c71c91e5-bf36-4670-bc19-b0e929ef6b21"
RESTORE_ID = "d626253e-2a1d-496a-b4bb-3eb01b87713a"
POSE = {"position": {"x": 0, "y": 0, "z": 0},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}


class MatrixWorldArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(Path(self.temp.name) / "scenes")
        self.world = {
            "scene": {"schemaVersion": 1, "roomId": ROOM,
                      "objects": [{"objectId": "block-1", "assetId": "block",
                                   "anchorId": "web-floor", "transform": copy.deepcopy(POSE)}]},
            "assets": [{"assetId": "block", "displayName": "Block"}],
            "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
            "roomContext": {"mode": "white-room", "state": "ready",
                            "message": "Virtual room", "alignmentVerified": False},
            "creatorMode": {"schemaVersion": 1, "mode": "creator",
                            "simulation": "paused", "revision": 3},
            "rigidSchemaVersion": 1, "rigidGravity": {"x": 0, "y": -5, "z": 0},
            "worldSlotSchemaVersion": 1, "citizensState": None,
            "game": None, "gameStatus": None,
        }
        self.exchange()

    def exchange(self, receipt=None):
        return self.state.exchange({"clientId": "web-client",
                                    "snapshot": copy.deepcopy(self.world),
                                    "results": [] if receipt is None else [receipt]})

    def action(self, action, **extra):
        return self.state.agent_world_archive_action({
            "action": action, "room_id": ROOM,
            "scene_revision": self.state.revision, **extra})

    def test_list_new_restore_follow_browser_receipts(self):
        listing = self.action("list", offset=0)
        self.assertEqual(listing["status"], "queued")
        self.assertEqual(self.state.pending[listing["requestId"]]["op"],
                         "list_world_archives")
        self.assertNotIn("expectedScene", self.state.pending[listing["requestId"]])
        self.exchange({"requestId": listing["requestId"], "ok": True,
                       "error": "", "objectId": "", "outcome": {
                           "kind": "world-archives", "archives": [{
                               "archiveId": RESTORE_ID, "name": "An earlier lab",
                               "createdAtUtc": "2026-09-26T15:00:00.000Z",
                               "objectCount": 2, "gameTitle": "Gravity Lab"}],
                           "offset": 0, "total": 1, "nextOffset": None}})
        page = self.state.agent_world_archive_status(listing["requestId"])
        self.assertEqual(page["status"], "succeeded")
        self.assertEqual(page["outcome"]["archives"][0]["archiveId"], RESTORE_ID)

        original_scene = copy.deepcopy(self.world["scene"])
        created = self.action("new", archive_name="Current playground")
        command = self.state.pending[created["requestId"]]
        self.assertEqual(command["expectedScene"], original_scene)
        self.assertEqual(command["expectedGame"], None)
        self.assertEqual(command["expectedGravity"], {"x": 0, "y": -5, "z": 0})
        self.assertEqual(command["expectedCreatorRevision"], 3)
        self.assertIn("expectedCitizensState", command)
        self.assertIn("expectedCitizensGeneration", command)
        self.world["scene"]["objects"] = []
        self.exchange({"requestId": created["requestId"], "ok": True,
                       "error": "", "objectId": "", "outcome": {
                           "kind": "world-created", "archived": {
                               "archiveId": ARCHIVE_ID, "name": "Current playground"}}})
        self.assertEqual(self.state.agent_world_archive_status(created["requestId"])["status"],
                         "succeeded")

        restored = self.action("restore", archive_id=RESTORE_ID,
                               archive_name="New blank world")
        self.assertEqual(self.state.pending[restored["requestId"]]["archiveId"], RESTORE_ID)
        self.world["scene"] = original_scene
        self.exchange({"requestId": restored["requestId"], "ok": True,
                       "error": "", "objectId": "", "outcome": {
                           "kind": "world-restored",
                           "archived": {"archiveId": ARCHIVE_ID,
                                        "name": "New blank world"},
                           "restored": {"archiveId": RESTORE_ID,
                                        "name": "An earlier lab"}}})
        status = self.state.agent_world_archive_status(restored["requestId"])
        self.assertEqual(status["status"], "succeeded")
        self.assertEqual(status["outcome"]["restored"]["archiveId"], RESTORE_ID)

        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        self.assertEqual(read_scene(bridge.url, bridge.token)["worldSlotSchemaVersion"], 1)
        self.assertEqual(world_archive_status(bridge.url, bridge.token,
                                              restored["requestId"])["status"], "succeeded")

    def test_refuses_stale_play_and_physical_ar_switches(self):
        with self.assertRaisesRegex(APIError, "changed; inspect"):
            self.state.agent_world_archive_action({"action": "new", "room_id": ROOM,
                "scene_revision": self.state.revision - 1,
                "archive_name": "Old revision"})
        self.world["creatorMode"].update(mode="play", simulation="running")
        self.exchange()
        with self.assertRaisesRegex(APIError, "paused Creator Mode"):
            self.action("new", archive_name="Current world")
        self.world["creatorMode"].update(mode="creator", simulation="paused")
        self.world["scene"]["objects"][0]["anchorId"] = "physical-table"
        self.world["anchors"].append({"anchorId": "physical-table", "displayName": "Table"})
        self.exchange()
        with self.assertRaisesRegex(APIError, "virtual floor objects"):
            self.action("new", archive_name="Current world")

    def test_rejects_unverified_outcome_and_reports_browser_failure(self):
        created = self.action("new", archive_name="Current world")
        self.world["scene"]["objects"] = []
        with self.assertRaisesRegex(APIError, "different|Invalid world switch|name changed"):
            self.exchange({"requestId": created["requestId"], "ok": True,
                           "error": "", "objectId": "", "outcome": {
                               "kind": "world-created", "archived": {
                                   "archiveId": ARCHIVE_ID, "name": "Wrong world"}}})
        self.assertEqual(self.state.agent_world_archive_status(created["requestId"])["status"],
                         "queued")
        self.exchange({"requestId": created["requestId"], "ok": False,
                       "error": "World switch stopped: storage write failed; active world restored",
                       "objectId": ""})
        self.assertEqual(self.state.agent_world_archive_status(created["requestId"])["status"],
                         "failed")

    def test_incomplete_browser_rollback_is_not_reported_as_safe_to_retry(self):
        created = self.action("new", archive_name="Current world")
        error = ("World switch stopped: Persistent browser save failed. "
                 "Recovery needs attention (matrix-web-world-v2 could not be rolled back). "
                 "A verified archive remains as Current world.")
        self.exchange({"requestId": created["requestId"], "ok": False,
                       "error": error, "objectId": ""})
        status = self.state.agent_world_archive_status(created["requestId"])
        self.assertEqual(status["status"], "unconfirmed")
        self.assertEqual(status["error"], error)


if __name__ == "__main__":
    unittest.main()
