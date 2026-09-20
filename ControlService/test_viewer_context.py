"""Viewer metadata validation and proposal stability; inference is always mocked.

These tests use synthetic snapshots and the real planner/service functions, not a
headset. A subprocess tripwire prevents accidental Codex execution.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ai_adapter
from ai_adapter import Planner, PlannerError
from codex_provider import CodexConfig
from server import APIError, LEASE_SECONDS, State, plan, snapshot


FRAME = {"anchorId": "floor", "position": {"x": 1, "y": 1.65, "z": -2},
         "forward": {"x": 0, "y": 0, "z": 1}}
VIEWER = {"frames": [FRAME]}
POSE = {"position": {"x": 0, "y": 0, "z": 1}, "rotation": dict.fromkeys("xyz", 0),
        "scale": dict.fromkeys("xyz", 1)}
SNAPSHOT = {"scene": {"schemaVersion": 1, "roomId": "viewer-test-room", "objects": [
    {"objectId": "chair-1", "assetId": "chair", "anchorId": "floor", "transform": POSE}]},
    "assets": [{"assetId": "chair", "displayName": "Chair", "spawnScale": 1}],
    "anchors": [{"anchorId": "floor", "displayName": "Floor"}],
    "selection": {"anchorId": "floor", "objectId": "chair-1", "position": {"x": 0, "y": 0, "z": 1}}}
RESPONSE = {"proposal": {"commands": [{"op": "duplicate", "objectId": "chair-1"}],
                         "summary": "Add another chair.", "assumptions": []},
            "receipt": {"transport": "codex-cli", "completedTurn": True, "toolCallCount": 0,
                        "usage": {"input_tokens": 200, "output_tokens": 30}}}


def with_viewer(value=VIEWER):
    result = copy.deepcopy(SNAPSHOT)
    result["viewer"] = copy.deepcopy(value)
    return result


def malformed_viewers():
    bad = [False, [], "viewer", {}, {"frames": None}, {"frames": {}}, {"frames": [], "extra": True},
           {"frames": [None]}, {"frames": [{**FRAME, "extra": True}]},
           {"frames": [{key: value for key, value in FRAME.items() if key != "forward"}]},
           {"frames": [{**FRAME, "anchorId": "unknown"}]}, {"frames": [FRAME, FRAME]}]
    for group, axis, value in (("position", "x", 10000.1), ("position", "y", -10000.1),
                               ("position", "z", float("nan")), ("position", "x", float("inf")),
                               ("position", "y", True), ("position", "z", "1"),
                               ("forward", "y", .001), ("forward", "x", float("inf")),
                               ("forward", "z", float("nan")), ("forward", "x", False),
                               ("forward", "z", 0), ("forward", "z", .989), ("forward", "z", 1.011)):
        value_copy = copy.deepcopy(VIEWER)
        value_copy["frames"][0][group][axis] = value
        bad.append(value_copy)
    for vector in ({"x": 0, "y": 0}, {"x": 0, "y": 0, "z": 1, "w": 0}, [0, 0, 1], None):
        value_copy = copy.deepcopy(VIEWER)
        value_copy["frames"][0]["forward"] = vector
        bad.append(value_copy)
    return bad


class ViewerValidationTests(unittest.TestCase):
    def test_valid_viewer_is_deep_copied(self):
        original = copy.deepcopy(VIEWER)
        result = ai_adapter.validate_viewer(original, {"floor"})
        self.assertEqual(result, original)
        result["frames"][0]["position"]["x"] = 9
        result["frames"][0]["forward"]["z"] = -1
        self.assertEqual(original, VIEWER)

    def test_null_and_unity_empty_frames_mean_unknown(self):
        self.assertIsNone(ai_adapter.validate_viewer(None, {"floor"}))
        self.assertIsNone(ai_adapter.validate_viewer({"frames": []}, {"floor"}))

    def test_position_limits_and_horizontal_near_unit_forward(self):
        for length in (.99, .995, 1, 1.005, 1.01):
            with self.subTest(length=length):
                value = copy.deepcopy(VIEWER)
                value["frames"][0]["position"] = {"x": -10000, "y": 10000, "z": 10000}
                value["frames"][0]["forward"] = {"x": -length, "y": 0, "z": 0}
                self.assertEqual(ai_adapter.validate_viewer(value, {"floor"}), value)
        diagonal = copy.deepcopy(VIEWER)
        diagonal["frames"][0]["forward"] = {"x": .6, "y": 0, "z": -.8}
        self.assertEqual(ai_adapter.validate_viewer(diagonal, {"floor"}), diagonal)

    def test_at_most_128_unique_existing_anchor_frames(self):
        frames = [{**copy.deepcopy(FRAME), "anchorId": "floor-" + str(i)} for i in range(129)]
        anchors = {item["anchorId"] for item in frames}
        self.assertEqual(ai_adapter.validate_viewer({"frames": frames[:128]}, anchors), {"frames": frames[:128]})
        with self.assertRaises(PlannerError):
            ai_adapter.validate_viewer({"frames": frames}, anchors)

    def test_forged_or_malformed_viewers_rejected_by_adapter_and_server_snapshot(self):
        for index, value in enumerate(malformed_viewers()):
            with self.subTest(case=index):
                with self.assertRaises(PlannerError):
                    ai_adapter.validate_viewer(value, {"floor"})
                with self.assertRaises(APIError) as raised:
                    snapshot(with_viewer(value))
                self.assertEqual(raised.exception.status, 400)

    def test_server_retains_valid_copied_viewer_and_omits_unknown(self):
        original = with_viewer()
        result = snapshot(original)
        self.assertEqual(result["viewer"], VIEWER)
        result["viewer"]["frames"][0]["position"]["y"] = 3
        self.assertEqual(original["viewer"], VIEWER)
        for value in (SNAPSHOT, with_viewer(None), with_viewer({"frames": []})):
            self.assertNotIn("viewer", snapshot(value))


class ViewerPlannerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        executable = Path(self.temp.name) / "mock-codex.exe"
        executable.write_bytes(b"MZ inert configuration fixture; never execute")
        self.config = CodexConfig(str(executable))
        self.planner = Planner(config=self.config)
        for mock_patch in (patch.dict(os.environ, {"SANDBOX_AI_MODE": "codex-cli"}, clear=True),
                           patch.object(CodexConfig, "from_environment", return_value=self.config),
                           patch.object(subprocess, "Popen", side_effect=AssertionError("No live Codex execution in viewer tests")),
                           patch("ai_adapter._offline_plan", side_effect=AssertionError("No offline fallback in viewer tests"))):
            mock_patch.start()
            self.addCleanup(mock_patch.stop)
        transport = patch("ai_adapter.plan_codex", return_value=copy.deepcopy(RESPONSE))
        self.transport = transport.start()
        self.addCleanup(transport.stop)
        self.now = [100.0]
        self.state = State(Path(self.temp.name) / "scenes", clock=lambda: self.now[0])
        self.current = with_viewer()
        self.exchange(self.current)

    def exchange(self, value, client="viewer-test-runtime"):
        return self.state.exchange({"clientId": client, "snapshot": value, "results": []})

    def propose(self):
        return plan(self.state, {"text": "Arrange another chair in front of me", "mode": "codex-cli"})

    def test_viewer_is_forwarded_to_real_planner_context_without_input_mutation(self):
        original = with_viewer()
        self.planner.plan("Place a chair in front of me", original, mode="codex-cli")
        context = self.transport.call_args.args[3]
        self.assertEqual(context["viewer"], VIEWER)
        context["viewer"]["frames"][0]["position"]["x"] = 10
        self.assertEqual(original, with_viewer())

    def test_unknown_viewer_is_omitted_from_model_context(self):
        for value in (SNAPSHOT, with_viewer(None), with_viewer({"frames": []})):
            with self.subTest(viewer=value.get("viewer")):
                self.planner.plan("Arrange another chair", value, mode="codex-cli")
                self.assertNotIn("viewer", self.transport.call_args.args[3])

    def test_malformed_viewer_never_reaches_model_or_mutates_service(self):
        before, revision = copy.deepcopy(self.state.latest), self.state.revision
        for index, value in enumerate(malformed_viewers()):
            with self.subTest(case=index):
                self.transport.reset_mock()
                with self.assertRaises(PlannerError):
                    self.planner.plan("Place a chair", with_viewer(value), mode="codex-cli")
                self.transport.assert_not_called()
                with self.assertRaises(APIError):
                    self.exchange(with_viewer(value))
                self.assertEqual(self.state.latest, before)
                self.assertEqual(self.state.revision, revision)

    def test_head_movement_during_inference_keeps_proposal_valid_and_uses_captured_pose(self):
        initial = copy.deepcopy(self.current)
        moved = copy.deepcopy(self.current)
        moved["viewer"]["frames"][0]["position"]["x"] += 2
        moved["viewer"]["frames"][0]["forward"] = {"x": 1, "y": 0, "z": 0}
        revision = self.state.revision
        def move_during_inference(*_args):
            self.exchange(moved)
            return copy.deepcopy(RESPONSE)
        self.transport.side_effect = move_during_inference
        proposal = self.propose()
        self.assertTrue(proposal["requiresApply"])
        self.assertEqual(proposal["viewerAtRequest"], initial["viewer"])
        self.assertEqual(self.transport.call_args.args[3]["viewer"], initial["viewer"])
        self.assertEqual(self.state.latest["viewer"], moved["viewer"])
        proposal["viewerAtRequest"]["frames"][0]["position"]["x"] = 999
        self.assertEqual(self.state.latest["viewer"], moved["viewer"])
        self.assertEqual(self.transport.call_args.args[3]["viewer"], initial["viewer"])
        self.assertEqual(self.state.revision, revision)
        self.assertEqual(self.state.pending, {})
        self.assertEqual(len(self.state.apply_plan(proposal["planId"])["commands"]), 1)

    def test_head_movement_before_apply_does_not_expire_proposal(self):
        proposal = self.propose()
        revision = self.state.revision
        moved = copy.deepcopy(self.current)
        moved["viewer"]["frames"][0]["position"]["z"] += .2
        self.exchange(moved)
        self.assertEqual(self.state.revision, revision)
        self.assertIn(proposal["planId"], self.state.proposals)
        self.assertEqual(len(self.state.apply_plan(proposal["planId"])["commands"]), 1)

    def test_viewer_tracking_loss_and_reappearance_do_not_change_revision(self):
        proposal = self.propose()
        revision = self.state.revision
        for value in (SNAPSHOT, with_viewer(None), with_viewer({"frames": []}), self.current):
            self.exchange(value)
            self.assertEqual(self.state.revision, revision)
        self.assertEqual(len(self.state.apply_plan(proposal["planId"])["commands"]), 1)

    def test_scene_or_selection_change_during_inference_still_rejects(self):
        for change in ("scene", "selection"):
            with self.subTest(change=change):
                moved = copy.deepcopy(self.current)
                moved["viewer"]["frames"][0]["position"]["x"] += 1
                if change == "scene":
                    moved["scene"]["objects"][0]["transform"]["position"]["x"] += .2
                else:
                    moved["selection"]["position"]["x"] += .2
                def change_during_inference(*_args):
                    self.exchange(moved)
                    return copy.deepcopy(RESPONSE)
                self.exchange(self.current)
                self.transport.side_effect = change_during_inference
                with self.assertRaises(APIError) as raised:
                    self.propose()
                self.assertEqual(raised.exception.status, 409)
                self.assertEqual(len(self.state.pending), 0)
                self.assertEqual(len(self.state.proposals), 0)

    def test_only_viewer_is_excluded_from_apply_revision_comparison(self):
        for change in ("scene", "selection", "assets", "anchors"):
            with self.subTest(change=change):
                self.exchange(self.current)
                proposal = self.propose()
                changed = copy.deepcopy(self.current)
                changed["viewer"]["frames"][0]["position"]["x"] += 1
                if change == "scene":
                    changed["scene"]["objects"][0]["transform"]["position"]["x"] += .2
                elif change == "selection":
                    changed["selection"]["objectId"] = ""
                elif change == "assets":
                    changed["assets"][0]["spawnScale"] = 1.1
                else:
                    changed["anchors"][0]["displayName"] = "Renamed floor"
                self.exchange(changed)
                with self.assertRaises(APIError) as raised:
                    self.state.apply_plan(proposal["planId"])
                self.assertEqual(raised.exception.status, 409)
                self.assertEqual(len(self.state.pending), 0)

    def test_head_updates_cannot_preserve_proposal_across_runtime_lease(self):
        proposal = self.propose()
        self.now[0] += LEASE_SECONDS + 1
        self.exchange(self.current, client="different-runtime")
        with self.assertRaises(APIError) as raised:
            self.state.apply_plan(proposal["planId"])
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(len(self.state.pending), 0)

    def test_unknown_or_clarification_proposal_does_not_claim_captured_viewer(self):
        self.exchange(SNAPSHOT)
        self.assertNotIn("viewerAtRequest", self.propose())
        self.exchange(self.current)
        self.transport.return_value = copy.deepcopy(RESPONSE)
        self.transport.return_value["proposal"]["commands"] = []
        self.transport.return_value["proposal"]["summary"] = "Which object should face you?"
        result = self.propose()
        self.assertFalse(result["requiresApply"])
        self.assertNotIn("viewerAtRequest", result)

    def test_save_excludes_transient_viewer_but_preserves_live_pose(self):
        before = copy.deepcopy(self.state.latest)
        self.assertTrue(self.state.save("ViewerFree")["saved"])
        saved = json.loads((self.state.directory / "ViewerFree.json").read_text())
        self.assertNotIn("viewer", saved)
        self.assertEqual(saved["scene"], before["scene"])
        self.assertEqual(saved["selection"], before["selection"])
        self.assertEqual(self.state.latest, before)

    def test_loading_legacy_saved_viewer_never_restores_the_old_head_pose(self):
        (self.state.directory / "LegacyViewer.json").write_text(json.dumps(self.current), encoding="utf-8")
        moved = copy.deepcopy(self.current)
        moved["viewer"]["frames"][0]["position"]["x"] = 8
        self.exchange(moved)
        queued = self.state.load("LegacyViewer")
        command = queued["commands"][0]
        self.assertEqual(set(command), {"op", "scene", "requestId"})
        self.assertEqual(command["op"], "load")
        self.assertEqual(command["scene"], self.current["scene"])
        self.assertEqual(self.state.latest["viewer"], moved["viewer"])
        acknowledgement = {"requestId": command["requestId"], "ok": True, "error": "", "objectId": ""}
        self.state.exchange({"clientId": "viewer-test-runtime", "snapshot": moved, "results": [acknowledgement]})
        self.assertEqual(self.state.latest["viewer"], moved["viewer"])
        self.assertEqual(len(self.state.pending), 0)

    def test_prefab_orientation_description_reaches_model_context(self):
        value = with_viewer()
        description = "The chair back faces local +Z; the seated occupant faces local -Z."
        value["assets"][0]["description"] = description
        self.exchange(value)
        self.propose()
        self.assertEqual(self.transport.call_args.args[3]["assets"][0]["description"], description)
        self.assertEqual(self.state.latest["assets"][0]["description"], description)
        value["assets"][0]["description"] = "x" * 500
        self.planner.plan("Orient the chair", value, mode="codex-cli")
        self.assertEqual(self.transport.call_args.args[3]["assets"][0]["description"], "x" * 500)

    def test_invalid_or_oversized_asset_description_never_reaches_model(self):
        for description in ("x" * 501, "unexpected\nline", {"instructions": "untrusted"}, True):
            with self.subTest(description_type=type(description).__name__):
                value = with_viewer()
                value["assets"][0]["description"] = description
                self.transport.reset_mock()
                with self.assertRaises(PlannerError):
                    self.planner.plan("Orient the chair", value, mode="codex-cli")
                self.transport.assert_not_called()
                with self.assertRaises(APIError):
                    snapshot(value)


if __name__ == "__main__":
    unittest.main()
