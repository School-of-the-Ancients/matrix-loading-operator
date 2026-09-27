"""Object-authored Web GLB interactions stay bounded across PC command paths."""
import copy
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from agent_session import LocalCodexAgentBackend, _mcp_approval_description
from codex_provider import CodexConfig
from matrix_tool_bridge import (MatrixToolBridge, interaction_action, interaction_status,
                                scene_summary)
from server import (APIError, State, command, interaction_descriptor,
                    interaction_world_point, scene, snapshot)
from test_web_assets import glb


BOUNDS = {"center": {"x": 0, "y": .4, "z": 0},
          "size": {"x": .6, "y": .8, "z": .6}}
POSE = {"position": {"x": 0, "y": 0, "z": 0},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}


def descriptor(digest):
    return {"schemaVersion": 1, "interactionId": "rest-seat",
            "kind": "rest", "assetSha256": digest,
            "requiredCapabilities": ["static-virtual-floor", "verified-rendered-bounds"],
            "availability": ["target-static", "floor-aligned", "rendered-verified"],
            "approachPose": {"x": 0, "z": .65},
            "usePose": {"x": 0, "z": .2}, "rangeMeters": .8,
            "durationTicks": 7, "capacity": 1,
            "effect": {"need": "energy", "delta": 37}}


class WebInteractionContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = State(root / "scenes", web_assets_directory=root / "assets")
        source = root / "seat.glb"
        source.write_bytes(glb())
        self.asset = self.state.web_assets.register(source, "Seat", local_bounds=BOUNDS)
        self.interaction = descriptor(self.asset["sha256"])
        self.obj = {"objectId": "seat-1", "assetId": self.asset["assetId"],
                    "anchorId": "web-floor", "transform": copy.deepcopy(POSE)}
        self.current = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                                  "objects": [copy.deepcopy(self.obj)]},
                        "assets": [{"assetId": self.asset["assetId"], "displayName": "Seat",
                                    "sha256": self.asset["sha256"], "spawnScale": 1,
                                    "localBounds": copy.deepcopy(BOUNDS), "animationClips": []}],
                        "anchors": [{"anchorId": "web-floor", "displayName": "Floor"}],
                        "interactionSchemaVersion": 1,
                        "roomContext": {"mode": "white-room", "state": "ready",
                                        "alignmentVerified": False, "message": ""}}
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": self.current,
                             "results": []})

    def test_exact_descriptor_and_scene_shape(self):
        self.assertEqual(interaction_descriptor(self.interaction), self.interaction)
        authored = copy.deepcopy(self.obj)
        authored["interaction"] = copy.deepcopy(self.interaction)
        self.assertEqual(scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                                "objects": [authored]})["objects"][0]["interaction"],
                         self.interaction)
        for bad in (
                {**self.interaction, "extra": "code"},
                {**self.interaction, "schemaVersion": True},
                {**self.interaction, "interactionId": "Invalid ID"},
                {**self.interaction, "assetSha256": "0" * 63},
                {**self.interaction, "requiredCapabilities": ["shell"]},
                {**self.interaction, "availability": ["target-static"]},
                {**self.interaction, "approachPose": {"x": float("nan"), "z": .65}},
                {**self.interaction, "rangeMeters": 3},
                {**self.interaction, "durationTicks": 13},
                {**self.interaction, "capacity": 2},
                {**self.interaction, "effect": {"need": "fun", "delta": 37}},
        ):
            with self.subTest(bad=bad), self.assertRaises(APIError):
                command({"op": "set_interaction", "objectId": "seat-1",
                         "interaction": bad})
        self.assertEqual(command({"op": "remove_interaction", "objectId": "seat-1"}),
                         {"op": "remove_interaction", "objectId": "seat-1"})
        moving = copy.deepcopy(authored)
        moving["physics"] = {"schemaVersion": 1, "kind": "gravity-floor",
                             "collider": "rendered-bounds-box", "restitution": .3}
        with self.assertRaisesRegex(APIError, "static virtual-floor"):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [moving]})
        animated = copy.deepcopy(authored)
        animated["animation"] = {"loopClip": "Idle", "selectClip": None}
        with self.assertRaisesRegex(APIError, "static virtual-floor"):
            scene({"schemaVersion": 1, "roomId": "web-virtual-room-v1",
                   "objects": [animated]})

    def test_local_pose_uses_threejs_positive_yaw_and_axis_scales(self):
        obj = copy.deepcopy(self.obj)
        obj["transform"]["position"] = {"x": 2, "y": 0, "z": 3}
        obj["transform"]["rotation"]["y"] = 90
        obj["transform"]["scale"] = {"x": 2, "y": 1, "z": 3}
        point = interaction_world_point(obj, {"spawnScale": 1.25}, {"x": .4, "z": .7})
        # At +90 degrees local +X points toward world -Z and +Z toward +X.
        self.assertAlmostEqual(point[0], 4.625)
        self.assertAlmostEqual(point[1], 2)

    def test_queue_requires_matching_static_registered_asset_and_clear_geometry(self):
        op = {"op": "set_interaction", "objectId": "seat-1",
              "interaction": self.interaction}
        queued = self.state.queue([op])["commands"][0]
        self.assertEqual(queued["interaction"], self.interaction)
        self.assertEqual(queued["expectedTransform"], POSE)
        self.assertIsNone(queued["expectedInteraction"])
        self.assertIn(queued["requestId"], self.state.pending)
        with self.assertRaisesRegex(APIError, "one interaction"):
            self.state.queue([op, {"op": "get_scene"}])
        self.state.pending.clear()
        forged = self.state.queue([{**op, "expectedTransform":
                                    {**POSE, "position": {"x": 8, "y": 0, "z": 0}}}])["commands"][0]
        self.assertEqual(forged["expectedTransform"], POSE)
        self.assertIsNone(forged["expectedInteraction"])
        with self.assertRaisesRegex(APIError, "Unexpected command fields"):
            self.state.queue([{**op, "expectedInteraction": self.interaction}])
        self.state.pending.clear()
        for key, value, error in (
                ("assetSha256", "0" * 64, "matching static"),
                ("approachPose", {"x": 0, "z": .4}, "approach pose"),
                ("usePose", {"x": 0, "z": 1}, "use pose"),
                ("rangeMeters", .1, "use range")):
            with self.subTest(key=key):
                bad = {**self.interaction, key: value}
                with self.assertRaisesRegex(APIError, error):
                    self.state.queue([{**op, "interaction": bad}])
                self.assertFalse(self.state.pending)
        with self.assertRaisesRegex(APIError, "use range"):
            self.state.queue([{**op, "interaction":
                               {**self.interaction, "rangeMeters": .54}}])
        boundary = self.state.queue([{**op, "interaction":
                                      {**self.interaction, "rangeMeters": .55}}])["commands"][0]
        self.assertEqual(boundary["interaction"]["rangeMeters"], .55)
        self.state.pending.clear()
        stale = copy.deepcopy(self.current)
        stale["assets"][0]["sha256"] = "0" * 64
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": stale,
                             "results": []})
        with self.assertRaisesRegex(APIError, "metadata is stale"):
            self.state.queue([op])

    def test_stale_descriptor_survives_exchange_for_cleanup_but_not_new_set(self):
        present = copy.deepcopy(self.current)
        present["scene"]["objects"][0]["interaction"] = copy.deepcopy(self.interaction)
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": present,
                             "results": []})
        self.assertEqual(self.state.latest["scene"]["objects"][0]["interaction"],
                         self.interaction)
        replaced = self.state.queue([{"op": "set_interaction", "objectId": "seat-1",
                                      "interaction": self.interaction}])["commands"][0]
        self.assertEqual(replaced["expectedInteraction"], self.interaction)
        self.state.pending.clear()
        ar = copy.deepcopy(present)
        ar["scene"]["roomId"] = "webxr-session-test"
        ar["roomContext"]["mode"] = "ar"
        ar["roomContext"]["alignmentVerified"] = True
        ar["assets"] = []
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": ar,
                             "results": []})
        removed = self.state.queue([{"op": "remove_interaction",
                                     "objectId": "seat-1"}])["commands"][0]
        self.assertEqual(removed["op"], "remove_interaction")
        self.assertEqual(removed["expectedTransform"], POSE)
        self.assertEqual(removed["expectedInteraction"], self.interaction)
        with self.assertRaisesRegex(APIError, "Unexpected command fields"):
            self.state.queue([{"op": "remove_interaction", "objectId": "seat-1",
                               "expectedInteraction": self.interaction}])
        with self.assertRaisesRegex(APIError, "desktop virtual room"):
            self.state.queue([{"op": "set_interaction", "objectId": "seat-1",
                               "interaction": self.interaction}])
        no_capability = copy.deepcopy(present)
        del no_capability["interactionSchemaVersion"]
        with self.assertRaisesRegex(APIError, "Scene interactions require"):
            snapshot(no_capability)

    def test_bound_target_edits_keep_static_geometry_valid(self):
        present = copy.deepcopy(self.current)
        present["scene"]["objects"][0]["interaction"] = copy.deepcopy(self.interaction)
        present["physicsSchemaVersion"] = 1
        present["behaviorKinds"] = ["rotate"]
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": present,
                             "results": []})
        valid_pose = copy.deepcopy(POSE)
        valid_pose["position"]["x"] = 1
        moved = self.state.queue([{"op": "set_transform", "objectId": "seat-1",
                                  "transform": valid_pose}])["commands"][0]
        self.assertEqual(moved["transform"], valid_pose)
        self.state.pending.clear()
        invalid_pose = copy.deepcopy(POSE)
        invalid_pose["position"]["y"] = .5
        with self.assertRaisesRegex(APIError, "floor-aligned"):
            self.state.queue([{"op": "set_transform", "objectId": "seat-1",
                              "transform": invalid_pose}])
        with self.assertRaisesRegex(APIError, "interaction before enabling physics"):
            self.state.queue([{"op": "set_physics", "objectId": "seat-1",
                              "physics": {"schemaVersion": 1, "kind": "gravity-floor",
                                          "collider": "rendered-bounds-box",
                                          "restitution": .3}}])
        with self.assertRaisesRegex(APIError, "interaction before enabling"):
            self.state.queue([{"op": "set_behavior", "objectId": "seat-1",
                              "behavior": {"kind": "rotate", "enabled": True}}])
        edge = copy.deepcopy(present)
        edge["scene"]["objects"][0]["transform"]["position"]["x"] = 99.7
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": edge,
                             "results": []})
        with self.assertRaisesRegex(APIError, "floor or use range"):
            self.state.queue([{"op": "duplicate", "objectId": "seat-1"}])

    def test_reviewed_tool_receipt_bridge_and_native_summary(self):
        def request(action="set", **changes):
            value = {"action": action, "room_id": "web-virtual-room-v1",
                     "scene_revision": self.state.revision, "object_id": "seat-1",
                     "expected_asset_id": self.asset["assetId"]}
            if action == "set":
                value["interaction"] = copy.deepcopy(self.interaction)
            value.update(changes)
            return value

        for stale in (request(room_id="elsewhere"), request(scene_revision=-1),
                      request(expected_asset_id="chair")):
            with self.assertRaises(APIError):
                self.state.agent_interaction_action(stale)
        self.assertFalse(self.state.pending)
        queued = self.state.agent_interaction_action(request())
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(self.state.pending[queued["requestId"]]["op"], "set_interaction")
        observed = copy.deepcopy(self.current)
        observed["scene"]["objects"][0]["interaction"] = copy.deepcopy(self.interaction)
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": observed,
                             "results": [{"requestId": queued["requestId"], "ok": True,
                                          "error": "", "objectId": "seat-1"}]})
        self.assertEqual(self.state.agent_interaction_status(queued["requestId"])["status"],
                         "succeeded")
        summary = scene_summary(self.state)
        self.assertEqual(summary["interactionSchemaVersion"], 1)
        self.assertEqual(summary["objects"][0]["interaction"], self.interaction)

        removed = self.state.agent_interaction_action(request("remove"))
        self.assertEqual(removed["status"], "queued")
        self.state.exchange({"clientId": "web-interaction-test", "snapshot": self.current,
                             "results": [{"requestId": removed["requestId"], "ok": True,
                                          "error": "", "objectId": "seat-1"}]})
        self.assertEqual(self.state.agent_interaction_status(removed["requestId"])["status"],
                         "succeeded")

        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch("matrix_tool_bridge.MOVE_WAIT", .05):
            bridged = interaction_action(bridge.url, bridge.token, request())
            self.assertEqual(interaction_status(bridge.url, bridge.token,
                                                bridged["requestId"])["status"], "queued")
            with self.assertRaises(urllib.error.HTTPError):
                interaction_status(bridge.url, "wrong-token", bridged["requestId"])
        approval = {"serverName": "matrix_webxr",
                    "message": 'Allow the matrix_webxr MCP server to run tool "matrix_set_interaction"?',
                    "_meta": {"codex_approval_kind": "mcp_tool_call",
                              "tool_params": {key: value for key, value in request().items()
                                              if key != "action"}}}
        description, reviewable = _mcp_approval_description(approval)
        self.assertTrue(reviewable)
        self.assertIn("energy +37", description)
        self.assertIn("asset SHA", description)
        self.assertFalse(_mcp_approval_description({**approval, "_meta": {
            **approval["_meta"], "tool_params": {**approval["_meta"]["tool_params"],
                                                 "secret": "hidden"}}})[1])
        removal = {**approval,
                   "message": 'Allow the matrix_webxr MCP server to run tool "matrix_remove_interaction"?',
                   "_meta": {**approval["_meta"], "tool_params": {
                       key: value for key, value in approval["_meta"]["tool_params"].items()
                       if key != "interaction"}}}
        self.assertTrue(_mcp_approval_description(removal)[1])
        ar_removal = copy.deepcopy(removal)
        ar_removal["_meta"]["tool_params"]["room_id"] = "webxr-session-test"
        self.assertTrue(_mcp_approval_description(ar_removal)[1])
        ar_set = copy.deepcopy(approval)
        ar_set["_meta"]["tool_params"]["room_id"] = "webxr-session-test"
        self.assertFalse(_mcp_approval_description(ar_set)[1])
        with patch.object(CodexConfig, "validate"):
            backend = LocalCodexAgentBackend(CodexConfig("codex.exe"), self.temp.name, bridge)
        settings = " ".join(backend.transport.command)
        for name in ("matrix_set_interaction", "matrix_remove_interaction",
                     "matrix_interaction_status"):
            self.assertIn(name, settings)
        self.assertIn("tools.matrix_set_interaction.approval_mode", settings)
        self.assertNotIn(bridge.token, settings)


if __name__ == "__main__":
    unittest.main()
