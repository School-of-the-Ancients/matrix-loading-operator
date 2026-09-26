"""Reviewed curved-bench interactions use the existing Matrix receipt boundary."""
import copy
from pathlib import Path
import tempfile
import unittest

from agent_session import _mcp_approval_description
from procedural_contract import (CURVED_BENCH_PARAMETERS, ProceduralError,
                                 interaction_bounds, new_recipe)
from server import APIError, State, interaction_descriptor, scene, snapshot


GENERATOR = {"generatorId": "curved-bench", "generatorVersion": "1.0.0",
             "sourceRevision": "curved-bench-v1", "description": "Reviewed curved bench",
             "parameterSchema": copy.deepcopy(CURVED_BENCH_PARAMETERS), "dependencies": []}
POSE = {"position": {"x": 0, "y": 0, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}


def descriptor(**changes):
    value = {"schemaVersion": 2, "interactionId": "bench-rest", "kind": "rest",
             "proceduralSource": {"generatorId": "curved-bench",
                                  "generatorVersion": "1.0.0",
                                  "sourceRevision": "curved-bench-v1"},
             "requiredCapabilities": ["static-virtual-floor", "reviewed-procedural-geometry"],
             "availability": ["target-static", "floor-aligned", "generator-available"],
             "approachPose": {"x": 0, "z": -.65}, "usePose": {"x": 0, "z": .2},
             "rangeMeters": 1, "durationTicks": 7, "capacity": 1,
             "effect": {"need": "energy", "delta": 37}}
    value.update(changes)
    return value


class ProceduralInteractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = State(root / "scenes", web_assets_directory=root / "assets")
        self.recipe = new_recipe([GENERATOR], "curved-bench")
        self.obj = {"objectId": "bench-1", "assetId": "matrix:procedural",
                    "anchorId": "web-floor", "transform": copy.deepcopy(POSE),
                    "procedural": copy.deepcopy(self.recipe)}
        self.current = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                                  "objects": [copy.deepcopy(self.obj)]},
                        "assets": [{"assetId": "matrix:procedural",
                                    "displayName": "Procedural construction"}],
                        "anchors": [{"anchorId": "web-floor", "displayName": "Floor"}],
                        "proceduralGenerators": [copy.deepcopy(GENERATOR)],
                        "interactionSchemaVersion": 2,
                        "roomContext": {"mode": "white-room", "state": "ready",
                                        "alignmentVerified": False, "message": ""}}
        self.exchange(self.current)

    def exchange(self, value):
        self.state.exchange({"clientId": "bench-test", "snapshot": value,
                             "results": []})

    def attached(self, value=None):
        active = copy.deepcopy(self.current)
        active["scene"]["objects"][0]["interaction"] = copy.deepcopy(value or descriptor())
        self.exchange(active)
        return active

    def test_descriptor_and_measured_bounds_are_pinned(self):
        self.assertEqual(interaction_descriptor(descriptor()), descriptor())
        bounds = interaction_bounds(self.recipe, [GENERATOR])
        self.assertAlmostEqual(bounds["center"]["z"], .1860852489521146)
        self.assertAlmostEqual(bounds["size"]["x"], 2.1226435573746216)
        self.assertAlmostEqual(bounds["size"]["z"], .7688471680498469)
        for bad in (descriptor(assetSha256="a" * 64),
                    descriptor(proceduralSource={"generatorId": "curved-bench"}),
                    descriptor(requiredCapabilities=["shell"]),
                    descriptor(availability=["generator-available"]),
                    descriptor(schemaVersion=True),
                    descriptor(effect={"need": "hunger", "delta": 37})):
            with self.subTest(bad=bad), self.assertRaises(APIError):
                interaction_descriptor(bad)
        other = {**GENERATOR, "parameterSchema": {
            "lengthMeters": {"type": "number", "default": 1, "min": .5, "max": 2}}}
        with self.assertRaises(ProceduralError):
            interaction_bounds(self.recipe, [other])
        widened = copy.deepcopy(GENERATOR)
        widened["parameterSchema"]["arcDegrees"]["max"] = 150
        with self.assertRaisesRegex(ProceduralError, "reviewed PC bounds"):
            interaction_bounds(self.recipe, [widened])

    def test_queue_checks_source_pose_version_and_native_review(self):
        action = {"action": "set", "room_id": "web-virtual-room-v1",
                  "scene_revision": self.state.revision, "object_id": "bench-1",
                  "expected_asset_id": "matrix:procedural", "interaction": descriptor()}
        queued = self.state.agent_interaction_action(action)
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(self.state.pending[queued["requestId"]]["interaction"], descriptor())
        self.state.pending.clear()
        for bad, message in ((descriptor(proceduralSource={**descriptor()["proceduralSource"],
                                                         "sourceRevision": "curved-bench-v2"}),
                              "source or kind changed"),
                             (descriptor(approachPose={"x": 0, "z": -.3}), "actor clearance"),
                             (descriptor(usePose={"x": 0, "z": 2}), "outside target footprint"),
                             (descriptor(rangeMeters=.5), "use range")):
            with self.subTest(bad=bad), self.assertRaisesRegex(APIError, message):
                self.state.agent_interaction_action({**action,
                                                     "scene_revision": self.state.revision,
                                                     "interaction": bad})
            self.assertFalse(self.state.pending)
        old = copy.deepcopy(self.current)
        old["interactionSchemaVersion"] = 1
        self.exchange(old)
        with self.assertRaisesRegex(APIError, "procedural interactions"):
            self.state.agent_interaction_action({**action,
                                                 "scene_revision": self.state.revision})
        with self.assertRaisesRegex(APIError, "interaction schema 2"):
            snapshot({**old, "scene": {**old["scene"], "objects": [
                {**self.obj, "interaction": descriptor()}]}})
        review = {"serverName": "matrix_webxr",
                  "message": 'Allow the matrix_webxr MCP server to run tool '
                             '"matrix_set_interaction"?',
                  "_meta": {"codex_approval_kind": "mcp_tool_call",
                            "tool_params": {key: value for key, value in action.items()
                                            if key != "action"}}}
        summary, reviewable = _mcp_approval_description(review)
        self.assertTrue(reviewable)
        self.assertIn("curved-bench@1.0.0:curved-bench-v1", summary)
        self.assertIn("energy +37", summary)

    def test_recipe_revision_rechecks_current_interaction(self):
        active = self.attached(descriptor(approachPose={"x": 0, "z": -.45},
                                          rangeMeters=.8))
        self.assertEqual(scene(active["scene"]), active["scene"])
        revise = lambda patch: self.state.agent_procedural_action({
            "action": "update", "room_id": "web-virtual-room-v1",
            "scene_revision": self.state.revision, "object_id": "bench-1",
            "expected_source_revision": "curved-bench-v1", "parameters_patch": patch})
        accepted = revise({"lengthMeters": 2})
        self.assertEqual(accepted["status"], "queued")
        self.state.pending.clear()
        with self.assertRaisesRegex(APIError, "actor clearance"):
            revise({"depthMeters": .8, "arcDegrees": 30})
        self.assertFalse(self.state.pending)
        self.assertEqual(self.state.latest["scene"], active["scene"])

    def test_pc_checkpoint_restores_without_glb_dependency(self):
        active = self.attached()
        world = {"version": 2, "scene": copy.deepcopy(active["scene"]), "game": None}
        saved = self.state.save_world_checkpoint("CurvedBench", world)
        self.assertEqual(saved["dependencies"], [])
        self.assertEqual(self.state.load_world_checkpoint("CurvedBench")["world"], world)
        wrong = copy.deepcopy(world)
        wrong["scene"]["objects"][0]["interaction"]["proceduralSource"]["sourceRevision"] = "stale"
        with self.assertRaises(APIError):
            self.state.save_world_checkpoint("CurvedBench", wrong)
        self.state.latest["proceduralGenerators"] = []
        with self.assertRaisesRegex(APIError, "unavailable"):
            self.state.load_world_checkpoint("CurvedBench")


if __name__ == "__main__":
    unittest.main()
