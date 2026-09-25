"""Game plans remain bounded and do not mutate the scene before browser Apply."""
import copy
import tempfile
import unittest
from unittest.mock import patch

import server
import test_server as fixtures
import web_game


PLAN = {"kind": "game", "title": "Orb Courier",
        "roles": [{"roleId": "cubes", "kind": "pickup", "assetId": "cube", "count": 3},
                  {"roleId": "station", "kind": "delivery-zone", "assetId": "cube", "count": 1}],
        "rules": [{"event": "release-near", "actorRoleId": "cubes", "targetRoleId": "station",
                   "distanceMeters": 0.55, "scorePoints": 10}],
        "objectives": [{"kind": "delivered-count", "roleId": "cubes", "targetCount": 3}],
        "summary": "Carry three cubes to the station."}


class GamePlanTests(unittest.TestCase):
    def test_catalog_ids_and_item_count_are_validated(self):
        snapshot = copy.deepcopy(fixtures.SNAPSHOT)
        self.assertEqual(web_game.validate_game_plan(PLAN, snapshot), PLAN)
        for bad in ({**PLAN, "roles": [{**PLAN["roles"][0], "assetId": "invented"}, PLAN["roles"][1]]},
                    {**PLAN, "roles": [{**PLAN["roles"][0], "count": 7}, PLAN["roles"][1]]},
                    {**PLAN, "roles": [{**PLAN["roles"][0], "count": True}, PLAN["roles"][1]]},
                    {**PLAN, "rules": [{**PLAN["rules"][0], "targetRoleId": "cubes"}]},
                    {**PLAN, "script": "alert(1)"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                web_game.validate_game_plan(bad, snapshot)

    def test_game_route_returns_reviewable_plan_without_scene_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            state = server.State(directory)
            snapshot = copy.deepcopy(fixtures.SNAPSHOT)
            snapshot["scene"]["roomId"] = "web-virtual-room-v1"
            state.exchange({"clientId": "web-client", "snapshot": snapshot, "results": []})
            with patch.object(server, "design_game", return_value=PLAN) as design:
                result = server.plan(state, {"text": "Create a sci-fi game", "mode": "codex-cli", "webRuntime": True})
            self.assertTrue(result["requiresApply"])
            self.assertEqual(result["commands"], [])
            self.assertEqual(result["gamePlan"], PLAN)
            self.assertEqual(state.latest["scene"], snapshot["scene"])
            self.assertEqual(len(state.pending), 0)
            design.assert_called_once()

    def test_explicitly_unsupported_mechanic_has_no_apply_action(self):
        with tempfile.TemporaryDirectory() as directory:
            state = server.State(directory)
            snapshot = copy.deepcopy(fixtures.SNAPSHOT)
            snapshot["scene"]["roomId"] = "web-virtual-room-v1"
            state.exchange({"clientId": "web-client", "snapshot": snapshot, "results": []})
            unsupported = {"kind": "unsupported", "title": "Shooter", "roles": [], "rules": [],
                           "objectives": [], "summary": "Combat mechanics are unavailable."}
            with patch.object(server, "design_game", return_value=unsupported):
                result = server.plan(state, {"text": "Make a shooter game", "mode": "codex-cli", "webRuntime": True})
            self.assertFalse(result["requiresApply"])
            self.assertEqual(result["commands"], [])
            self.assertNotIn("gamePlan", result)

    def test_web_flag_does_not_route_a_unity_runtime_into_web_games(self):
        with tempfile.TemporaryDirectory() as directory:
            state = server.State(directory)
            state.exchange({"clientId": "unity", "snapshot": copy.deepcopy(fixtures.SNAPSHOT), "results": []})
            with patch.object(server, "design_game", return_value=PLAN) as design:
                with self.assertRaises(server.APIError) as error:
                    server.plan(state, {"text": "Create a game", "mode": "codex-cli", "webRuntime": True})
            self.assertEqual(error.exception.status, 409)
            design.assert_not_called()
