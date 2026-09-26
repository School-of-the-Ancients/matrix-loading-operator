"""Authored scene revisions remain stable during observed Citizens movement."""
import copy
import tempfile
import unittest
from unittest.mock import patch

from server import APIError, State, command, plan, snapshot
from test_scene_capture import capture_result
from test_web_components import ID as COMPONENT_ID, PACKAGE as COMPONENT_PACKAGE


POSE = {"position": {"x": 0, "y": 0.25, "z": -1},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 0.5, "y": 0.5, "z": 0.5}}
BASE = {
    "scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": [
        {"objectId": "ada", "assetId": "orb", "anchorId": "web-floor", "transform": copy.deepcopy(POSE)},
        {"objectId": "seat", "assetId": "chair", "anchorId": "web-floor", "transform": {
            **copy.deepcopy(POSE), "position": {"x": 1, "y": 0, "z": -1}}}]},
    "assets": [{"assetId": "orb", "displayName": "Orb"},
               {"assetId": "chair", "displayName": "Chair"}],
    "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
    "selection": {"anchorId": "web-floor", "objectId": "seat",
                  "position": {"x": 1, "y": 0, "z": -1}},
    "roomContext": {"mode": "white-room", "state": "ready",
                    "message": "Desktop virtual room", "alignmentVerified": False},
    "citizensObservation": {"residentObjectIds": ["ada"], "authoredGeneration": 100},
}


class CitizensRevisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.current = copy.deepcopy(BASE)
        self.exchange()

    def exchange(self, value=None, **extra):
        self.current = copy.deepcopy(value or self.current)
        return self.state.exchange({"clientId": "web-citizens", "snapshot": self.current,
                                    "results": [], **extra})

    def moved(self, distance=0.2):
        result = copy.deepcopy(self.current)
        result["scene"]["objects"][0]["transform"]["position"]["x"] += distance
        return result

    def test_actor_observation_keeps_revision_but_authored_edits_advance_it(self):
        revision = self.state.revision
        moved = self.moved()
        self.exchange(moved)
        self.assertEqual(self.state.revision, revision)
        self.assertEqual(self.state.latest["scene"]["objects"][0]["transform"],
                         moved["scene"]["objects"][0]["transform"])

        authored = self.moved()
        authored["citizensObservation"]["authoredGeneration"] += 1
        self.exchange(authored)
        self.assertEqual(self.state.revision, revision + 1)

        altered_size = self.moved()
        altered_size["scene"]["objects"][0]["transform"]["scale"]["x"] += 0.1
        self.exchange(altered_size)
        self.assertEqual(self.state.revision, revision + 2)

    def test_observation_marker_requires_real_desktop_residents_and_safe_generation(self):
        for change in (lambda value: value["citizensObservation"].update(residentObjectIds=["seat"]),
                       lambda value: value["citizensObservation"].update(residentObjectIds=["ada", "ada"]),
                       lambda value: value["citizensObservation"].update(authoredGeneration=True),
                       lambda value: value["citizensObservation"].update(authoredGeneration=2**53),
                       lambda value: value["scene"].update(roomId="webxr-session-test")):
            with self.subTest(change=change):
                value = copy.deepcopy(BASE)
                change(value)
                with self.assertRaises(APIError):
                    snapshot(value)

    def test_paused_resident_behavior_is_not_an_active_transform_owner(self):
        paused = copy.deepcopy(self.current)
        paused["scene"]["objects"][0]["behaviors"] = [
            {"kind": "rotate", "enabled": True, "paused": True}]
        self.exchange(paused)
        self.assertEqual(self.state.latest["scene"]["objects"][0]["behaviors"][0]["paused"], True)
        active = copy.deepcopy(paused)
        active["scene"]["objects"][0]["behaviors"][0]["paused"] = False
        with self.assertRaises(APIError):
            snapshot(active)

    def test_offline_static_edit_survives_unrelated_motion(self):
        proposed = plan(self.state, {"text": "move it 20 cm left", "mode": "offline-rules"})
        self.assertEqual(proposed["commands"][0]["objectId"], "seat")
        revision = self.state.revision
        self.exchange(self.moved())
        self.assertEqual(self.state.revision, revision)
        queued = self.state.apply_plan(proposed["planId"])
        self.assertEqual(queued["commands"][0]["objectId"], "seat")

    def test_moving_target_or_selected_actor_stales_proposal(self):
        actor_selected = copy.deepcopy(self.current)
        actor_selected["selection"]["objectId"] = "ada"
        self.exchange(actor_selected)
        proposed = plan(self.state, {"text": "move it 20 cm left", "mode": "offline-rules"})
        revision = self.state.revision
        self.exchange(self.moved())
        self.assertEqual(self.state.revision, revision)
        self.assertFalse(self.state.proposal_is_current(self.state.proposals[proposed["planId"]]))
        with self.assertRaises(APIError) as raised:
            self.state.apply_plan(proposed["planId"])
        self.assertEqual(raised.exception.status, 409)
        self.assertFalse(self.state.pending)

    def test_queued_actor_edit_carries_server_derived_pose_precondition(self):
        actor_selected = copy.deepcopy(self.current)
        actor_selected["selection"]["objectId"] = "ada"
        self.exchange(actor_selected)
        proposed = plan(self.state, {"text": "move it 20 cm left", "mode": "offline-rules"})
        expected = copy.deepcopy(actor_selected["scene"]["objects"][0]["transform"])
        reviewed = proposed["commands"][0]
        self.assertEqual(reviewed["expectedTransform"], expected)
        with self.assertRaises(APIError):
            command(reviewed)  # Untrusted planner output cannot set its own precondition.
        queued = self.state.apply_plan(proposed["planId"])
        request_id = queued["commands"][0]["requestId"]
        delivery = self.exchange(self.moved())
        self.assertEqual(delivery["commands"][0]["requestId"], request_id)
        self.assertEqual(delivery["commands"][0]["expectedTransform"], expected)
        self.assertNotEqual(self.state.latest["scene"]["objects"][0]["transform"], expected)

    def test_precondition_is_typed_and_limited_to_targeted_commands(self):
        actor = copy.deepcopy(self.current["scene"]["objects"][0]["transform"])
        with self.assertRaises(APIError):
            command({"op": "spawn", "assetId": "orb", "anchorId": "web-floor",
                     "transform": actor, "expectedTransform": actor}, allow_precondition=True)
        with self.assertRaises(APIError):
            command({"op": "select", "objectId": "ada", "expectedTransform": {
                **actor, "position": {"x": float("nan"), "y": 0, "z": 0}}},
                allow_precondition=True)
        with self.assertRaises(APIError):
            command({"op": "select", "objectId": "ada", "expectedTargetTransform": actor},
                    allow_precondition=True)

    def test_batch_preconditions_follow_earlier_resident_transforms(self):
        original = copy.deepcopy(self.current["scene"]["objects"][0]["transform"])
        first = copy.deepcopy(original)
        first["position"]["x"] = 0.2
        second = copy.deepcopy(original)
        second["position"]["x"] = 0.4
        response = {"mode": "codex-cli", "commands": [
            {"op": "select", "objectId": "ada"},
            {"op": "set_transform", "objectId": "ada", "transform": first},
            {"op": "set_transform", "objectId": "ada", "transform": second}],
            "summary": "Select and move Ada twice", "requiresApply": True, "status": "ready"}
        with patch("server.Planner.plan", return_value=response):
            proposed = plan(self.state, {"text": "Select and move Ada twice", "mode": "codex-cli"})
        commands = proposed["commands"]
        self.assertEqual([item["expectedTransform"] for item in commands],
                         [original, original, first])
        queued = self.state.apply_plan(proposed["planId"])
        self.assertEqual([item["expectedTransform"] for item in queued["commands"]],
                         [original, original, first])
        self.assertNotIn("requiresSuccessOf", queued["commands"][0])
        self.assertEqual(queued["commands"][1]["requiresSuccessOf"],
                         queued["commands"][0]["requestId"])
        self.assertEqual(queued["commands"][2]["requiresSuccessOf"],
                         queued["commands"][1]["requestId"])
        delivered = self.exchange()
        self.assertEqual(delivered["commands"], queued["commands"])

    def test_raw_commands_cannot_supply_proposal_success_dependencies(self):
        with self.assertRaises(APIError):
            command({"op": "select", "objectId": "ada", "requiresSuccessOf": "forged"},
                    allow_precondition=True)
        with self.assertRaises(APIError):
            self.state.queue([{"op": "select", "objectId": "ada",
                               "requiresSuccessOf": "forged"}])
        queued = self.state.queue([{"op": "select", "objectId": "ada"},
                                   {"op": "select", "objectId": "seat"}])["commands"]
        self.assertTrue(all("requiresSuccessOf" not in item for item in queued))

    def test_attach_component_proposal_uses_resident_pose_precondition(self):
        response = {"mode": "codex-cli", "commands": [{
            "op": "attach_component", "objectId": "ada", "targetObjectId": "seat",
            "componentId": COMPONENT_ID, "package": COMPONENT_PACKAGE}],
            "summary": "Attach a component", "requiresApply": True, "status": "ready"}
        with patch("server.Planner.plan", return_value=response):
            proposed = plan(self.state, {"text": "Attach a component", "mode": "codex-cli"})
        self.assertEqual(proposed["commands"][0]["expectedTransform"],
                         self.current["scene"]["objects"][0]["transform"])

    def test_static_component_host_tracks_moving_resident_target(self):
        original = copy.deepcopy(self.current["scene"]["objects"][0]["transform"])
        moved = copy.deepcopy(original)
        moved["position"]["x"] = 0.2
        response = {"mode": "codex-cli", "commands": [
            {"op": "set_transform", "objectId": "ada", "transform": moved},
            {"op": "attach_component", "objectId": "seat", "targetObjectId": "ada",
             "componentId": COMPONENT_ID, "package": COMPONENT_PACKAGE}],
            "summary": "Move Ada then attach a component to the chair",
            "requiresApply": True, "status": "ready"}
        with patch("server.Planner.plan", return_value=response):
            proposed = plan(self.state, {"text": "Move Ada then attach", "mode": "codex-cli"})
        first, attach = proposed["commands"]
        self.assertEqual(first["expectedTransform"], original)
        self.assertNotIn("expectedTransform", attach)
        self.assertEqual(attach["expectedTargetTransform"], moved)
        with self.assertRaises(APIError):
            command(attach)  # The planner may not assert its own target observation.
        self.assertEqual(command(attach, allow_precondition=True)["expectedTargetTransform"], moved)

    def test_ai_proposal_keeps_full_actor_pose_dependency(self):
        response = {"mode": "codex-cli", "commands": [
            {"op": "select", "objectId": "seat"}],
            "summary": "Select the chair", "requiresApply": True, "status": "ready"}
        with patch("server.Planner.plan", return_value=response):
            proposed = plan(self.state, {"text": "Select the chair", "mode": "codex-cli"})
        self.exchange(self.moved())
        with self.assertRaises(APIError) as raised:
            self.state.apply_plan(proposed["planId"])
        self.assertEqual(raised.exception.status, 409)

    def test_capture_does_not_pair_pixels_with_a_later_actor_pose(self):
        self.exchange(captureSupported=True)
        self.state.request_capture({})
        captured = capture_result(self.state, source="webxr_virtual_center_eye")
        revision = self.state.revision
        self.exchange(self.moved(), captureSupported=True)
        self.assertEqual(self.state.revision, revision)
        self.assertEqual(self.state.capture_status()["status"], "stale")
        self.exchange(captureSupported=True, capture=captured)
        self.assertEqual(self.state.capture_status()["status"], "error")
        self.assertIn("do not match", self.state.capture_status()["error"])

    def test_legacy_scene_save_load_omits_runtime_observation_marker(self):
        saved = self.state.save("CitizensScene")
        self.assertTrue(saved["saved"])
        document = self.state.path("CitizensScene").read_text(encoding="utf-8")
        self.assertNotIn("citizensObservation", document)
        queued = self.state.load("CitizensScene")
        self.assertEqual(queued["commands"][0]["op"], "load")
        self.assertEqual(queued["commands"][0]["scene"], self.state.latest["scene"])


if __name__ == "__main__":
    unittest.main()
