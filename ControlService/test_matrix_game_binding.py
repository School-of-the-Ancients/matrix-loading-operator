"""Reviewed game binding reuses existing objects, queue and observed receipts."""
import copy
from pathlib import Path
import tempfile
import unittest

from matrix_tool_bridge import MatrixToolBridge, bind_game, game_status, update_game
from server import APIError, State


POSE = {"position": {"x": 0, "y": 0, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
SPEC = {"schemaVersion": 2, "kind": "game", "title": "Delivery challenge",
        "summary": "Deliver the block and unlock the exit.",
        "roles": [{"roleId": "cargo", "kind": "pickup", "assetId": "block", "count": 1},
                  {"roleId": "bin", "kind": "delivery-zone", "assetId": "pedestal", "count": 1},
                  {"roleId": "exit", "kind": "exit", "assetId": "wall", "count": 1}],
        "rules": [{"event": "sensor-enter", "actorRoleId": "cargo",
                   "targetRoleId": "bin", "distanceMeters": .6, "scorePoints": 1}],
        "objectives": [{"kind": "delivered-count", "roleId": "cargo", "targetCount": 1}],
        "consequences": [{"kind": "unlock", "roleId": "exit"}]}
BINDINGS = {"cargo": ["block-1"], "bin": ["bin-1"], "exit": ["exit-1"]}
BODY = {"schemaVersion": 1, "type": "dynamic", "collider": "bounds-box",
        "restitution": .2, "friction": .6, "sensor": False}


class MatrixGameBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(Path(self.temp.name) / "scenes")
        objects = []
        for object_id, asset_id in (("block-1", "block"),
                                    ("bin-1", "pedestal"), ("exit-1", "wall")):
            obj = {"objectId": object_id, "assetId": asset_id,
                   "anchorId": "web-floor", "transform": copy.deepcopy(POSE)}
            if object_id == "block-1":
                obj["rigidBody"] = copy.deepcopy(BODY)
            if object_id == "bin-1":
                obj["rigidBody"] = {**BODY, "type": "static", "sensor": True}
            objects.append(obj)
        self.snapshot = {"scene": {"schemaVersion": 1,
                                   "roomId": "web-virtual-room-v1", "objects": objects},
                         "assets": [{"assetId": item, "displayName": item}
                                    for item in ("block", "pedestal", "wall")],
                         "anchors": [{"anchorId": "web-floor",
                                      "displayName": "Virtual floor"}],
                         "rigidSchemaVersion": 1,
                         "rigidGravity": {"x": 0, "y": -9.81, "z": 0},
                         "rigidStates": [],
                         "creatorMode": {"schemaVersion": 1, "mode": "creator",
                                         "simulation": "paused", "revision": 0},
                         "game": None, "gameStatus": None,
                         "roomContext": {"mode": "white-room", "state": "ready",
                                         "message": "Virtual room",
                                         "alignmentVerified": False}}
        self.exchange()

    def exchange(self, *, game=None, request_id=None, ok=True, error=""):
        value = copy.deepcopy(self.snapshot)
        value["game"] = game
        value["gameStatus"] = (None if game is None else {
            "phase": game["state"]["phase"], "score": game["state"]["score"],
            "objectiveProgress": game["state"]["objectiveProgress"],
            "unlockedObjectIds": game["state"]["unlockedObjectIds"]})
        results = ([{"requestId": request_id, "ok": ok, "error": error}]
                   if request_id else [])
        self.state.exchange({"clientId": "web-client", "snapshot": value,
                             "results": results})

    def request(self, **overrides):
        return {"room_id": "web-virtual-room-v1",
                "scene_revision": self.state.revision,
                "spec": copy.deepcopy(SPEC), "bindings": copy.deepcopy(BINDINGS),
                **overrides}

    def initial_game(self):
        return {"spec": copy.deepcopy(SPEC), "bindings": copy.deepcopy(BINDINGS),
                "state": {"phase": "playing", "score": 0, "deliveries": [],
                          "objectiveProgress": {"cargo": 0},
                          "creditedEvents": [], "unlockedObjectIds": []}}

    def test_bind_queue_and_receipt_observe_exact_existing_bindings(self):
        before_ids = [item["objectId"] for item in self.state.latest["scene"]["objects"]]
        queued = self.state.agent_bind_game(self.request())
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(self.state.pending[queued["requestId"]]["op"], "bind_game")
        self.exchange(request_id=queued["requestId"])
        self.assertEqual(self.state.agent_game_status(queued["requestId"])["status"],
                         "unconfirmed")
        second = self.state.agent_bind_game(self.request())
        self.exchange(game=self.initial_game(), request_id=second["requestId"])
        result = self.state.agent_game_status(second["requestId"])
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["gameStatus"]["score"], 0)
        self.assertEqual([item["objectId"] for item in
                          self.state.latest["scene"]["objects"]], before_ids)
        with self.assertRaisesRegex(APIError, "existing game"):
            self.state.agent_bind_game(self.request())

    def test_invalid_bindings_and_play_mode_reject_without_queue(self):
        for request in (self.request(scene_revision=0),
                        self.request(bindings={**BINDINGS, "cargo": ["wrong"]}),
                        self.request(spec={**SPEC, "consequences": [{"kind": "unlock",
                                                                   "roleId": "bin"}]})):
            with self.assertRaises(APIError):
                self.state.agent_bind_game(request)
        self.assertFalse(self.state.pending)
        self.state.latest["creatorMode"] = {"schemaVersion": 1, "mode": "play",
                                            "simulation": "running", "revision": 1}
        with self.assertRaisesRegex(APIError, "Creator Mode"):
            self.state.agent_bind_game(self.request())
        self.assertFalse(self.state.pending)

    def test_private_bridge_uses_same_binding_status(self):
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        from unittest.mock import patch
        with patch("matrix_tool_bridge.MOVE_WAIT", .02):
            queued = bind_game(bridge.url, bridge.token, self.request())
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(game_status(bridge.url, bridge.token,
                                     queued["requestId"])["status"], "queued")

    def test_update_game_preserves_earned_progress_and_rejects_reinterpretation(self):
        earned = self.initial_game()
        earned["state"] = {"phase": "won", "score": 1,
                           "deliveries": ["block-1"],
                           "objectiveProgress": {"cargo": 1},
                           "creditedEvents": [{"eventId": "event-1", "event": "sensor-enter",
                                               "objectId": "block-1", "targetObjectId": "bin-1",
                                               "scorePoints": 1}],
                           "unlockedObjectIds": ["exit-1"]}
        self.exchange(game=earned)
        revised_spec = {**copy.deepcopy(SPEC), "title": "Revised delivery",
                        "summary": "The earned exit remains open."}
        queued = self.state.agent_update_game(self.request(spec=revised_spec))
        raw = self.state.pending[queued["requestId"]]
        self.assertEqual(raw["op"], "update_game")
        self.assertEqual(raw["expectedSpec"], SPEC)
        self.assertEqual(raw["expectedBindings"], BINDINGS)
        revised = {**copy.deepcopy(earned), "spec": revised_spec}
        self.exchange(game=revised, request_id=queued["requestId"])
        status = self.state.agent_game_status(queued["requestId"])
        self.assertEqual(status["status"], "succeeded")
        self.assertEqual(status["gameStatus"]["score"], 1)
        self.assertEqual(status["gameStatus"]["unlockedObjectIds"], ["exit-1"])
        changed_rules = {**copy.deepcopy(revised_spec),
                         "rules": [{**SPEC["rules"][0], "scorePoints": 2}]}
        with self.assertRaisesRegex(APIError, "unchanged roles and rules"):
            self.state.agent_update_game(self.request(spec=changed_rules))
        removed_unlock = {**copy.deepcopy(revised_spec), "consequences": []}
        with self.assertRaises(APIError):
            self.state.agent_update_game(self.request(spec=removed_unlock))
        self.assertFalse(self.state.pending)

    def test_update_game_before_credit_can_revise_rules_through_bridge(self):
        self.exchange(game=self.initial_game())
        spec = {**copy.deepcopy(SPEC), "rules": [{**SPEC["rules"][0], "scorePoints": 2}]}
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        from unittest.mock import patch
        with patch("matrix_tool_bridge.MOVE_WAIT", .02):
            queued = update_game(bridge.url, bridge.token, self.request(spec=spec))
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(self.state.pending[queued["requestId"]]["expectedSpec"], SPEC)
        revised = {**self.initial_game(), "spec": spec}
        self.exchange(game=revised, request_id=queued["requestId"])
        self.assertEqual(game_status(bridge.url, bridge.token,
                                     queued["requestId"])["status"], "succeeded")


if __name__ == "__main__":
    unittest.main()
