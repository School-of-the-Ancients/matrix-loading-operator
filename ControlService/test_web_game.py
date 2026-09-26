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
    def test_v2_event_credit_and_unlock_checkpoint_are_checked(self):
        snapshot = copy.deepcopy(fixtures.SNAPSHOT)
        spec = {**PLAN, "schemaVersion": 2,
                "roles": [{**PLAN["roles"][0], "count": 1}, PLAN["roles"][1],
                          {"roleId": "exit", "kind": "exit", "assetId": "cube", "count": 1}],
                "rules": [{**PLAN["rules"][0], "event": "sensor-enter"}],
                "objectives": [{"kind": "delivered-count", "roleId": "cubes", "targetCount": 1}],
                "consequences": [{"kind": "unlock", "roleId": "exit"}]}
        scene = {"objects": [{"objectId": object_id, "assetId": "cube", "anchorId": "web-floor"}
                             for object_id in ("pickup-1", "station-1", "exit-1")]}
        game = {"spec": spec, "bindings": {"cubes": ["pickup-1"], "station": ["station-1"],
                                            "exit": ["exit-1"]},
                "state": {"phase": "won", "score": 10, "deliveries": ["pickup-1"],
                          "objectiveProgress": {"cubes": 1},
                          "creditedEvents": [{"eventId": "contact-1", "event": "sensor-enter",
                                              "objectId": "pickup-1", "targetObjectId": "station-1",
                                              "scorePoints": 10}],
                          "unlockedObjectIds": ["exit-1"]}}
        self.assertIs(web_game.validate_saved_game(game, scene, snapshot), game)
        for change in ({"unlockedObjectIds": []},
                       {"creditedEvents": [{**game["state"]["creditedEvents"][0], "targetObjectId": "exit-1"}]},
                       {"score": 20}):
            altered = copy.deepcopy(game)
            altered["state"].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                web_game.validate_saved_game(altered, scene, snapshot)

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

    def test_score_threshold_is_bounded_by_possible_one_time_awards(self):
        snapshot = copy.deepcopy(fixtures.SNAPSHOT)
        score_plan = {**PLAN, "objectives": [{"kind": "score-at-least", "targetPoints": 20}]}
        self.assertEqual(web_game.validate_game_plan(score_plan, snapshot), score_plan)
        mixed = {**PLAN, "objectives": PLAN["objectives"] + score_plan["objectives"]}
        self.assertEqual(web_game.validate_game_plan(mixed, snapshot), mixed)
        for objectives in ([{"kind": "score-at-least", "targetPoints": 31}],
                           [{"kind": "score-at-least", "targetPoints": True}],
                           [{"kind": "score-at-least", "targetPoints": 20, "script": "bad"}],
                           score_plan["objectives"] * 2):
            with self.subTest(objectives=objectives), self.assertRaises(ValueError):
                web_game.validate_game_plan({**PLAN, "objectives": objectives}, snapshot)
        shadowed = {**score_plan, "rules": [{**PLAN["rules"][0], "scorePoints": 1},
                                               PLAN["rules"][0]]}
        with self.assertRaisesRegex(ValueError, "Duplicate game rule"):
            web_game.validate_game_plan(shadowed, snapshot)

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
