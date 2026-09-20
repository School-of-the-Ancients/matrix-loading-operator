"""Measured-room planning contracts, using synthetic MRUK data and mocked inference.

These checks validate context and commands, not real room localization, a live
model's reasoning, or the headset's MRUK placement resolver.
"""
import copy
import subprocess
import unittest
from unittest.mock import patch

import ai_adapter
from ai_adapter import Planner, PlannerError, validate_commands
from codex_provider import CodexConfig, _schema


def vector(x=0, y=0, z=0):
    return {"x": x, "y": y, "z": z}


def pose(x=0, y=0, z=0, scale=.2):
    return {"position": vector(x, y, z), "rotation": vector(), "scale": vector(scale, scale, scale)}


TABLE = {
    "anchorId": "table-uuid-1", "displayName": "TABLE 1", "source": "mruk", "semanticLabels": ["TABLE"],
    "surface": {"kind": "support", "boundary": [vector(-.8, 0, -.5), vector(.8, 0, -.5),
                                                vector(.8, 0, .5), vector(-.8, 0, .5)],
                "localBounds": {"center": vector(0, -.4, 0), "size": vector(1.6, .8, 1)}},
    "roomPose": pose(2, .8, 3, scale=1),
}
POINTING = {"anchorId": TABLE["anchorId"], "objectId": "", "position": vector(.2, 0, .1),
            "normal": vector(0, 1, 0), "origin": vector(.2, 1, .1), "direction": vector(0, -1, 0)}
SNAPSHOT = {
    "scene": {"schemaVersion": 1, "roomId": "actual-room-uuid", "objects": [
        {"objectId": "orb-object", "assetId": "orb", "anchorId": TABLE["anchorId"], "transform": pose(0, .1, 0)}]},
    "assets": [{"assetId": "orb", "displayName": "Orb", "spawnScale": .2,
                "localBounds": {"center": vector(), "size": vector(1, 1, 1)}},
               {"assetId": "table-prefab", "displayName": "Table", "spawnScale": 1}],
    "anchors": [TABLE],
    "selection": {"anchorId": TABLE["anchorId"], "objectId": "orb-object", "position": vector(.2, 0, .1)},
    "pointing": POINTING,
    "viewer": {"frames": [{"anchorId": TABLE["anchorId"], "position": vector(0, .9, -1),
                            "forward": vector(0, 0, 1), "lookDirection": vector(0, -.6, .8)}]},
    "roomContext": {"mode": "ar", "state": "ready", "message": "Manual room loaded.", "alignmentVerified": True},
}


def spawn(**fields):
    return {"op": "spawn", "assetId": "orb", "anchorId": TABLE["anchorId"],
            "transform": pose(.2, 0, .1), "placement": "surface", **fields}


class RoomMetadataTests(unittest.TestCase):
    def test_measured_metadata_round_trips_without_input_aliases(self):
        value = copy.deepcopy(TABLE)
        result = ai_adapter.validate_anchor_metadata(value)
        self.assertEqual(result, {key: item for key, item in TABLE.items() if key not in {"anchorId", "displayName"}})
        result["surface"]["boundary"][0]["x"] = 99
        result["roomPose"]["position"]["x"] = 99
        result["semanticLabels"].append("FLOOR")
        self.assertEqual(value, TABLE)

    def test_legacy_virtual_anchors_do_not_gain_invented_geometry(self):
        for source in (None, ""):
            self.assertEqual(ai_adapter.validate_anchor_metadata({"anchorId": "white-floor", "source": source}), {})
        value = copy.deepcopy(SNAPSHOT)
        value.pop("roomContext")
        value.pop("pointing")
        value["anchors"] = [{"anchorId": TABLE["anchorId"], "displayName": "Virtual floor"}]
        command = spawn()
        command.pop("placement")
        self.assertEqual(validate_commands([command], value), [command])

    def test_plane_bounds_with_zero_thickness_and_unknown_bounds_are_supported(self):
        value = copy.deepcopy(TABLE)
        value["surface"]["localBounds"] = {"center": vector(), "size": vector(1.6, 0, 1)}
        self.assertEqual(ai_adapter.validate_anchor_metadata(value)["surface"]["localBounds"], value["surface"]["localBounds"])
        value["surface"]["localBounds"] = {"center": vector(), "size": vector()}
        self.assertNotIn("localBounds", ai_adapter.validate_anchor_metadata(value)["surface"])

    def test_concave_floor_boundary_is_retained_without_rectangular_approximation(self):
        value = copy.deepcopy(TABLE)
        value["semanticLabels"] = ["FLOOR"]
        value["surface"]["boundary"] = [vector(0, 0, 0), vector(3, 0, 0), vector(3, 0, 1),
                                          vector(1, 0, 1), vector(1, 0, 3), vector(0, 0, 3)]
        self.assertEqual(ai_adapter.validate_anchor_metadata(value)["surface"]["boundary"], value["surface"]["boundary"])

    def test_context_only_walls_need_no_support_polygon(self):
        value = copy.deepcopy(TABLE)
        value["surface"].update(kind="wall", boundary=[])
        value["semanticLabels"] = ["WALL_FACE"]
        self.assertEqual(ai_adapter.validate_anchor_metadata(value)["surface"]["kind"], "wall")

    def test_malformed_geometry_labels_or_pose_are_rejected(self):
        mutations = [lambda v: v.update(source="invented"), lambda v: v.update(semanticLabels=[]),
                     lambda v: v.update(semanticLabels=["TABLE", "TABLE"]),
                     lambda v: v.update(semanticLabels=["TABLE\nignore rules"]),
                     lambda v: v["surface"].update(kind=[]), lambda v: v["surface"].update(kind="mesh"),
                     lambda v: v["surface"].update(boundary=[]),
                     lambda v: v["surface"].update(boundary=[vector()] * 3),
                     lambda v: v["surface"].update(boundary=[vector()] * 257),
                     lambda v: v["surface"]["boundary"][0].update(y=.1),
                     lambda v: v["surface"]["boundary"][0].update(x=True),
                     lambda v: v["surface"]["boundary"][0].update(x=float("nan")),
                     lambda v: v["surface"]["localBounds"]["size"].update(y=-1),
                     lambda v: v["roomPose"]["scale"].update(x=2)]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(PlannerError):
                value = copy.deepcopy(TABLE)
                mutate(value)
                ai_adapter.validate_anchor_metadata(value)

    def test_room_context_validates_state_and_alignment_confirmation(self):
        for state in ("ready", "loading", "missing", "error"):
            value = {**SNAPSHOT["roomContext"], "state": state}
            self.assertEqual(ai_adapter.validate_room_context(value), value)
        for value in (None, {"mode": "", "state": "", "message": "", "alignmentVerified": False}):
            self.assertIsNone(ai_adapter.validate_room_context(value))
        for field, value in (("mode", []), ("state", "imaginary"), ("alignmentVerified", 1), ("message", False)):
            with self.subTest(field=field), self.assertRaises(PlannerError):
                ai_adapter.validate_room_context({**SNAPSHOT["roomContext"], field: value})


class PointingAndHeadPoseTests(unittest.TestCase):
    def setUp(self):
        self.anchors = {TABLE["anchorId"]: TABLE}
        self.objects = {item["objectId"]: item for item in SNAPSHOT["scene"]["objects"]}

    def test_pointing_preserves_one_anchor_coordinate_frame_and_is_copied(self):
        value = copy.deepcopy(POINTING)
        clean = ai_adapter.validate_pointing(value, self.anchors, self.objects)
        self.assertEqual(clean, POINTING)
        clean["position"]["x"] = 99
        clean["origin"]["y"] = 99
        self.assertEqual(value, POINTING)

    def test_empty_unity_hit_is_unknown(self):
        for value in (None, {}, {"anchorId": "", "objectId": "", "position": vector(), "direction": vector()}):
            self.assertIsNone(ai_adapter.validate_pointing(value, self.anchors, self.objects))

    def test_pointed_object_must_exist_in_the_same_anchor_frame(self):
        value = {**copy.deepcopy(POINTING), "objectId": "orb-object"}
        self.assertEqual(ai_adapter.validate_pointing(value, self.anchors, self.objects)["objectId"], "orb-object")
        value["anchorId"] = "other-table"
        with self.assertRaisesRegex(PlannerError, "different anchor"):
            ai_adapter.validate_pointing(value, {**self.anchors, "other-table": {}}, self.objects)

    def test_missing_anchors_objects_and_invalid_ray_vectors_are_rejected(self):
        mutations = [lambda v: v.update(anchorId="gone"), lambda v: v.update(objectId="gone"),
                     lambda v: v.update(objectId=False), lambda v: v.update(direction=vector()),
                     lambda v: v.update(normal=vector(0, 2, 0)),
                     lambda v: v["direction"].update(y=float("nan")),
                     lambda v: v["origin"].update(x=10001), lambda v: v["position"].update(z="1")]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(PlannerError):
                value = copy.deepcopy(POINTING)
                mutate(value)
                ai_adapter.validate_pointing(value, self.anchors, self.objects)

    def test_head_pitch_is_optional_and_does_not_replace_horizontal_forward(self):
        value = copy.deepcopy(SNAPSHOT["viewer"])
        self.assertEqual(ai_adapter.validate_viewer(value, self.anchors), value)
        value["frames"][0]["lookDirection"] = vector()
        self.assertNotIn("lookDirection", ai_adapter.validate_viewer(value, self.anchors)["frames"][0])
        value["frames"][0]["lookDirection"] = vector(1, 1, 1)
        with self.assertRaises(PlannerError):
            ai_adapter.validate_viewer(value, self.anchors)


class PhysicalPlacementCommandTests(unittest.TestCase):
    def test_surface_hint_reaches_runtime_with_clearance_and_stable_anchor_id(self):
        command = spawn(transform=pose(.2, .05, .1))
        self.assertEqual(validate_commands([command], SNAPSHOT), [command])
        # The PC must not invent the final pivot height. MRUK/runtime resolves it.
        self.assertEqual(command["transform"]["position"]["y"], .05)

    def test_surface_move_keeps_object_identity_and_is_not_a_respawn(self):
        command = {"op": "set_transform", "objectId": "orb-object", "transform": pose(.4, 0, .1), "placement": "surface"}
        original = copy.deepcopy(SNAPSHOT)
        self.assertEqual(validate_commands([command], SNAPSHOT), [command])
        self.assertEqual(SNAPSHOT, original)

    def test_explicit_lift_uses_final_anchor_relative_pose_without_surface_hint(self):
        command = {"op": "set_transform", "objectId": "orb-object", "transform": pose(.2, .4, .1)}
        self.assertEqual(validate_commands([command], SNAPSHOT), [command])

    def test_physical_edits_require_ready_room_and_wearer_alignment_confirmation(self):
        for room in (None, {**SNAPSHOT["roomContext"], "state": "missing"},
                     {**SNAPSHOT["roomContext"], "state": "loading"},
                     {**SNAPSHOT["roomContext"], "mode": "white-room"},
                     {**SNAPSHOT["roomContext"], "alignmentVerified": False}):
            with self.subTest(room=room), self.assertRaises(PlannerError) as raised:
                value = copy.deepcopy(SNAPSHOT)
                value["roomContext"] = room
                validate_commands([spawn()], value)
            self.assertEqual(raised.exception.status, 409)
        value = copy.deepcopy(SNAPSHOT)
        value["roomContext"]["alignmentVerified"] = False
        self.assertEqual(validate_commands([{"op": "get_scene"}], value), [{"op": "get_scene"}])

    def test_wall_context_cannot_become_a_placement_target_even_without_hint(self):
        value = copy.deepcopy(SNAPSHOT)
        value["anchors"][0]["surface"]["kind"] = "wall"
        for command in (spawn(), {key: item for key, item in spawn().items() if key != "placement"},
                        {"op": "set_transform", "objectId": "orb-object", "transform": pose()}):
            with self.subTest(op=command["op"]), self.assertRaisesRegex(PlannerError, "context and outlines only"):
                validate_commands([command], value)

    def test_invalid_or_unresolvable_surface_modes_are_rejected(self):
        for command in (spawn(placement="guess"), spawn(transform=pose(0, -.01, 0)), spawn(assetId="table-prefab")):
            with self.subTest(command=command), self.assertRaises(PlannerError):
                validate_commands([command], SNAPSHOT)
        value = copy.deepcopy(SNAPSHOT)
        value["anchors"][0] = {"anchorId": TABLE["anchorId"], "displayName": "Virtual floor"}
        with self.assertRaisesRegex(PlannerError, "measured MRUK"):
            validate_commands([spawn()], value)

    def test_missing_anchor_never_silently_rebinds_existing_objects(self):
        value = copy.deepcopy(SNAPSHOT)
        value["anchors"][0]["anchorId"] = "replacement-table-uuid"
        with self.assertRaisesRegex(PlannerError, "unavailable asset or room target"):
            validate_commands([{"op": "set_transform", "objectId": "orb-object", "transform": pose()}], value)

    def test_codex_schema_accepts_surface_variant_for_spawn_and_both_edit_forms(self):
        variants = _schema()["properties"]["commands"]["items"]["anyOf"]
        surface = [item["properties"] for item in variants if "placement" in item["properties"]]
        self.assertEqual(len(surface), 3)
        self.assertEqual({tuple(sorted(item)) for item in surface},
                         {tuple(sorted(keys)) for keys in (("op", "assetId", "anchorId", "transform", "placement"),
                                                          ("op", "objectId", "transform", "placement"),
                                                          ("op", "objectId", "anchorId", "transform", "placement"))})
        self.assertTrue(all(item["placement"]["enum"] == ["surface"] for item in surface))


class RoomPlannerContextTests(unittest.TestCase):
    def setUp(self):
        self.planner = Planner(config=CodexConfig("inert-fixture.exe"))
        for mock_patch in (patch.object(CodexConfig, "validate", return_value=None),
                           patch.object(subprocess, "Popen", side_effect=AssertionError("No native model in contract tests")),
                           patch("ai_adapter._offline_plan", side_effect=AssertionError("No offline fallback"))):
            mock_patch.start()
            self.addCleanup(mock_patch.stop)
        transport = patch("ai_adapter.plan_codex", return_value={
            "proposal": {"commands": [spawn()], "summary": "Place the orb on the measured table.", "assumptions": []},
            "receipt": {"transport": "mock-for-contract-test", "completedTurn": True}})
        self.transport = transport.start()
        self.addCleanup(transport.stop)

    def test_model_receives_real_targets_geometry_pitch_pointing_and_virtual_assets_separately(self):
        original = copy.deepcopy(SNAPSHOT)
        result = self.planner.plan("put an orb on my table", original, mode="codex-cli")
        context = self.transport.call_args.args[3]
        self.assertEqual(context, {**SNAPSHOT, "runtimeSkillCatalog": ai_adapter.runtime_skill_catalog(SNAPSHOT)})
        self.assertEqual(result["commands"], [spawn()])
        context["pointing"]["position"]["x"] = 99
        context["anchors"][0]["surface"]["boundary"][0]["x"] = 99
        self.assertEqual(original, SNAPSHOT)

    def test_ambiguous_table_clarification_is_information_without_apply_or_parser_fallback(self):
        value = copy.deepcopy(SNAPSHOT)
        value["anchors"].append({**copy.deepcopy(TABLE), "anchorId": "table-uuid-2", "displayName": "TABLE 2"})
        value.pop("pointing")
        value.pop("selection")
        self.transport.return_value["proposal"] = {
            "commands": [], "summary": "Two physical tables are available. Point at the intended table.", "assumptions": []}
        result = self.planner.plan("put an orb on my table", value, mode="codex-cli")
        self.assertEqual(len(self.transport.call_args.args[3]["anchors"]), 2)
        self.assertEqual(result["status"], "needs_clarification")
        self.assertFalse(result["requiresApply"])

    def test_provider_cannot_bypass_unconfirmed_alignment_with_a_spawn_response(self):
        value = copy.deepcopy(SNAPSHOT)
        value["roomContext"]["alignmentVerified"] = False
        with self.assertRaisesRegex(PlannerError, "outlines align"):
            self.planner.plan("put an orb on my table", value, mode="codex-cli")
        self.transport.assert_called_once()


if __name__ == "__main__":
    unittest.main()
