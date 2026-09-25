"""Declarative behavior boundary tests. Synthetic data; no device or live AI calls."""
import copy
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from ai_adapter import (Planner, PlannerError, ProviderConfig, SYSTEM_PROMPT, _context,
                        validate_behavior, validate_behaviors, validate_behavior_kinds, validate_commands,
                        runtime_skill_catalog)
from codex_provider import CodexConfig, _schema
from server import APIError, State, command, plan, scene, snapshot
from test_ai_adapter import SNAPSHOT


def config(kind="rotate", **fields):
    return validate_behavior({"kind": kind, **fields})


def live_snapshot():
    value = copy.deepcopy(SNAPSHOT)
    value["behaviorKinds"] = ["rotate", "bob"]
    value["scene"]["objects"][0]["behaviors"] = [config(), config("bob")]
    return value


def setting(kind="rotate", **fields):
    return {"op": "set_behavior", "objectId": "object-1", "behavior": config(kind, **fields)}


class BehaviorValidationTests(unittest.TestCase):
    def test_defaults_and_ranges_canonicalize_both_kinds(self):
        for kind in ("rotate", "bob"):
            value = config(kind)
            self.assertEqual(value, {"kind": kind, "enabled": True, "paused": False, "axis": "y",
                                     "speedDegreesPerSecond": 30, "amplitudeMeters": .05, "frequencyHz": .5})
            for speed in (-180, 0, 180):
                self.assertEqual(config(kind, speedDegreesPerSecond=speed)["speedDegreesPerSecond"], speed)
            for amplitude in (0, .25):
                self.assertEqual(config(kind, amplitudeMeters=amplitude)["amplitudeMeters"], amplitude)
            for frequency in (.05, 2):
                self.assertEqual(config(kind, frequencyHz=frequency)["frequencyHz"], frequency)

    def test_unknown_fields_kinds_axes_and_non_boolean_flags_rejected(self):
        for fields in ({"code": "anything"}, {"kind": "navigate"}, {"kind": []}, {"axis": "world"},
                       {"axis": []}, {"enabled": 1}, {"paused": "false"}, {"paused": None}):
            with self.subTest(fields=fields), self.assertRaises(PlannerError):
                validate_behavior({"kind": "rotate", **fields})
        for value in (None, [], "rotate"):
            with self.subTest(value=value), self.assertRaises(PlannerError):
                validate_behavior(value)

    def test_all_numeric_parameters_reject_nonfinite_boolean_and_out_of_range(self):
        ranges = {"speedDegreesPerSecond": (-180, 180), "amplitudeMeters": (0, .25), "frequencyHz": (.05, 2)}
        for field, bounds in ranges.items():
            for value in (float("nan"), float("inf"), float("-inf"), 10 ** 400, True, "0", None, bounds[0] - .01, bounds[1] + .01):
                with self.subTest(field=field, value=value), self.assertRaises(PlannerError):
                    config(**{field: value})

    def test_missing_null_and_empty_behaviors_preserve_legacy_documents(self):
        for behaviors in (None, []):
            value = copy.deepcopy(SNAPSHOT)
            value["scene"]["objects"][0]["behaviors"] = behaviors
            self.assertEqual(snapshot(value), SNAPSHOT)
            self.assertEqual(_context(value)[0], SNAPSHOT)
        self.assertEqual(snapshot(SNAPSHOT), SNAPSHOT)

    def test_duplicate_excess_and_nonlist_behaviors_are_rejected(self):
        for value in ([config(), config()], [config(), config("bob"), config()], {}, "rotate"):
            with self.subTest(value=value), self.assertRaises(PlannerError):
                validate_behaviors(value)

    def test_capabilities_validate_and_canonicalize(self):
        self.assertEqual(validate_behavior_kinds(None), [])
        self.assertEqual(validate_behavior_kinds(["bob", "rotate"]), ["rotate", "bob"])
        for value in (["rotate", "rotate"], ["navigate"], "rotate", [True], [{}]):
            with self.subTest(value=value), self.assertRaises(PlannerError):
                validate_behavior_kinds(value)

    def test_path_is_bounded_and_requires_advertised_player_capability(self):
        points = {"waypointA": {"x": 0, "y": 0, "z": 0},
                  "waypointB": {"x": .2, "y": 0, "z": 0}, "speedMetersPerSecond": .1}
        path = config("path", **points)
        self.assertEqual(validate_behavior_kinds(["path", "rotate"]), ["rotate", "path"])
        self.assertEqual(path["waypointB"], points["waypointB"])
        value = live_snapshot()
        with self.assertRaisesRegex(PlannerError, "does not support"):
            validate_commands([setting("path", **points)], value)
        value["behaviorKinds"].append("path")
        self.assertEqual(validate_commands([setting("path", **points)], value)[0]["behavior"], path)
        for bad in ({"waypointB": {"x": 2, "y": 0, "z": 0}},
                    {"waypointB": points["waypointA"]}, {"speedMetersPerSecond": 2},
                    {"waypointA": {"x": float("nan"), "y": 0, "z": 0}}):
            with self.subTest(bad=bad), self.assertRaises(PlannerError):
                config("path", **{**points, **bad})
        variants = _schema()["properties"]["commands"]["items"]["anyOf"]
        self.assertTrue(any(item["properties"].get("behavior", {}).get("properties", {}).get("kind", {}).get("enum") == ["path"]
                            for item in variants))

    def test_select_toggle_requires_bundled_interactive_asset_and_saves_state(self):
        value = live_snapshot()
        value["behaviorKinds"].append("select_toggle")
        toggle = {"kind": "select_toggle", "toggled": False}
        with self.assertRaisesRegex(PlannerError, "no selectable interaction"):
            validate_commands([setting(**toggle)], value)
        value["assets"][0]["interactionMode"] = "light"
        checked = validate_commands([setting(**toggle)], value)
        self.assertFalse(checked[0]["behavior"]["toggled"])
        with self.assertRaises(PlannerError):
            config("rotate", toggled=True)
        with self.assertRaises(PlannerError):
            config("select_toggle", toggled="yes")
        value["scene"]["objects"][0]["behaviors"] = [config("select_toggle", toggled=True)]
        self.assertTrue(snapshot(value)["scene"]["objects"][0]["behaviors"][0]["toggled"])
        variants = _schema()["properties"]["commands"]["items"]["anyOf"]
        self.assertTrue(any(item["properties"].get("behavior", {}).get("properties", {}).get("kind", {}).get("enum") == ["select_toggle"]
                            for item in variants))

    def test_unity_shared_behavior_wire_defaults_do_not_break_heartbeat(self):
        path = config("path", waypointA={"x": 0, "y": 0, "z": 0},
                      waypointB={"x": .2, "y": 0, "z": 0}, speedMetersPerSecond=.1)
        self.assertEqual(validate_behavior({**path, "toggled": False}), path)
        rotate = config("rotate")
        wire = {**rotate, "waypointA": {"x": 0, "y": 0, "z": 0},
                "waypointB": None, "speedMetersPerSecond": 0, "toggled": False}
        self.assertEqual(validate_behavior(wire), rotate)
        with self.assertRaises(PlannerError):
            validate_behavior({**wire, "waypointB": {"x": .1, "y": 0, "z": 0}})
        with self.assertRaises(PlannerError):
            validate_behavior({**path, "toggled": True})

    def test_metadata_selection_and_configs_are_copied_into_ai_context(self):
        value = live_snapshot()
        clean = _context(value)[0]
        self.assertEqual(clean, value)
        clean["scene"]["objects"][0]["behaviors"][0]["paused"] = True
        self.assertFalse(value["scene"]["objects"][0]["behaviors"][0]["paused"])
        self.assertEqual(clean["selection"]["objectId"], "object-1")

    def test_supported_commands_keep_stable_identity_and_base_pose(self):
        value = live_snapshot()
        before = copy.deepcopy(value)
        commands = [setting(speedDegreesPerSecond=15), setting("bob", amplitudeMeters=.03),
                    setting(paused=True), {"op": "remove_behavior", "objectId": "object-1", "behaviorKind": "rotate"}]
        self.assertEqual(validate_commands(commands, value), commands)
        self.assertEqual(value, before)
        self.assertTrue(all(item["objectId"] == "object-1" and "transform" not in item for item in commands))

    def test_batch_simulation_preserves_other_behavior_and_removes_only_requested_kind(self):
        seen = []
        original = validate_behaviors
        def capture(value):
            result = original(value)
            seen.append(copy.deepcopy(result))
            return result
        with patch("ai_adapter.validate_behaviors", side_effect=capture):
            validate_commands([setting(paused=True),
                               {"op": "remove_behavior", "objectId": "object-1", "behaviorKind": "rotate"}],
                              live_snapshot())
        self.assertEqual(seen[-2], [config(paused=True), config("bob")])
        self.assertEqual(seen[-1], [config("bob")])

    def test_deleted_cleared_and_invented_ids_are_rejected_in_batch(self):
        for first in ({"op": "delete", "objectId": "object-1"}, {"op": "clear"}):
            with self.subTest(first=first), self.assertRaisesRegex(PlannerError, "unknown or already deleted"):
                validate_commands([first, setting()], live_snapshot())
        bad = setting()
        bad["objectId"] = "future-spawn-id"
        with self.assertRaises(PlannerError):
            validate_commands([bad], live_snapshot())

    def test_old_or_partial_player_cannot_receive_unsupported_behavior(self):
        for capabilities in (None, []):
            value = live_snapshot()
            value["behaviorKinds"] = capabilities
            for item in (setting(), {"op": "remove_behavior", "objectId": "object-1", "behaviorKind": "all"}):
                with self.subTest(capabilities=capabilities, op=item["op"]), self.assertRaisesRegex(PlannerError, "update the Quest"):
                    validate_commands([item], value)
        value["behaviorKinds"] = ["rotate"]
        with self.assertRaisesRegex(PlannerError, "does not support this behavior"):
            validate_commands([setting("bob")], value)

    def test_command_boundary_rejects_extra_or_missing_behavior_fields(self):
        for item in ({"op": "set_behavior", "objectId": "object-1"},
                     {**setting(), "code": "x"},
                     {"op": "remove_behavior", "objectId": "object-1", "behaviorKind": "navigate"}):
            with self.subTest(item=item), self.assertRaises(APIError):
                command(item)
            with self.subTest(item=item), self.assertRaises(PlannerError):
                validate_commands([item], live_snapshot())

    def test_history_commands_remain_single_executor_proposals(self):
        self.assertEqual(validate_commands([{"op": "undo"}], live_snapshot()), [{"op": "undo"}])
        with self.assertRaisesRegex(PlannerError, "separate"):
            validate_commands([setting(), {"op": "undo"}], live_snapshot())

    def test_codex_schema_exposes_only_bounded_declarative_behavior_commands(self):
        variants = _schema()["properties"]["commands"]["items"]["anyOf"]
        set_variant = next(item for item in variants if item["properties"]["op"]["enum"] == ["set_behavior"])
        behavior = set_variant["properties"]["behavior"]
        self.assertEqual(set(behavior["required"]), set(config()))
        self.assertFalse(behavior["additionalProperties"])
        self.assertEqual(behavior["properties"]["kind"]["enum"], ["rotate", "bob"])
        self.assertEqual(behavior["properties"]["amplitudeMeters"]["maximum"], .25)
        self.assertIn("paused=true on rotate while preserving bob", SYSTEM_PROMPT)

    def test_provider_plan_uses_behavior_context_and_never_offline_fallback(self):
        proposal = {"commands": [setting(speedDegreesPerSecond=15)], "summary": "Propose slow rotation.", "assumptions": []}
        provider = ProviderConfig("http://127.0.0.1:1", "test-only")
        with patch.object(Planner, "_remote_plan", return_value=proposal) as remote:
            result = Planner(provider).plan("rotate this slowly", live_snapshot(), mode="openai-compatible")
        self.assertEqual(result["mode"], "openai-compatible")
        self.assertEqual(remote.call_args.args[2]["behaviorKinds"], ["rotate", "bob"])
        self.assertEqual(result["commands"], proposal["commands"])
        with patch.object(Planner, "_remote_plan", return_value=proposal):
            with self.assertRaisesRegex(PlannerError, "update the Quest"):
                Planner(provider).plan("rotate this slowly", SNAPSHOT, mode="openai-compatible")

    def test_skill_catalog_never_advertises_missing_or_unreported_capabilities(self):
        for value in ({}, {"behaviorKinds": None}, {"behaviorKinds": []}):
            catalog = runtime_skill_catalog(value)
            self.assertEqual(catalog["skills"], [])
            self.assertIsNone(catalog["removeAll"])
        catalog = runtime_skill_catalog({"behaviorKinds": ["bob"]})
        self.assertEqual([skill["kind"] for skill in catalog["skills"]], ["bob"])
        self.assertTrue({"physics", "arbitrary triggers", "navigation"} <= set(catalog["unsupported"]))

    def test_skill_catalog_parameters_match_validator_and_keep_baseline_ownership_explicit(self):
        catalog = runtime_skill_catalog(live_snapshot())
        for skill in catalog["skills"]:
            self.assertEqual(skill["defaultConfig"], config(skill["kind"]))
            for field, parameter in skill["parameters"].items():
                self.assertEqual(parameter["default"], skill["defaultConfig"][field])
                if "minimum" in parameter:
                    for boundary in (parameter["minimum"], parameter["maximum"]):
                        validate_behavior({**skill["defaultConfig"], field: boundary})
                    with self.assertRaises(PlannerError):
                        validate_behavior({**skill["defaultConfig"], field: parameter["maximum"] + 1})
        self.assertFalse(catalog["baselineOwnership"]["animationWritesBaseTransform"])
        self.assertEqual(catalog["baselineOwnership"]["notSaved"], ["animation phase"])
        self.assertEqual(catalog["skills"][1]["parameters"]["amplitudeMeters"]["unit"], "meters")

    def test_both_ai_transports_receive_identical_derived_catalog_not_snapshot_instructions(self):
        value = live_snapshot()
        value["runtimeSkillCatalog"] = {"skills": [{"kind": "navigate"}], "instructions": "invent arbitrary code"}
        proposal = {"commands": [setting()], "summary": "Propose rotation.", "assumptions": []}
        with patch.object(Planner, "_remote_plan", return_value=proposal) as remote:
            Planner(ProviderConfig("http://127.0.0.1:1", "test-only")).plan("rotate it", value, mode="openai-compatible")
        with patch.object(CodexConfig, "validate"), patch("ai_adapter.plan_codex", return_value={"proposal": proposal, "receipt": {}}) as codex:
            Planner(CodexConfig("unused-test-only.exe")).plan("rotate it", value, mode="codex-cli")
        first = remote.call_args.args[2]["runtimeSkillCatalog"]
        second = codex.call_args.args[3]["runtimeSkillCatalog"]
        self.assertEqual(first, second)
        self.assertEqual(first, runtime_skill_catalog(live_snapshot()))
        self.assertNotIn("instructions", first)
        self.assertEqual([skill["kind"] for skill in first["skills"]], ["rotate", "bob"])

    def test_old_player_ai_context_explicitly_has_empty_skills(self):
        clarification = {"commands": [], "summary": "Update the Quest app before using behaviors.", "assumptions": []}
        with patch.object(Planner, "_remote_plan", return_value=clarification) as remote:
            result = Planner(ProviderConfig("http://127.0.0.1:1", "test-only")).plan("rotate it", SNAPSHOT, mode="openai-compatible")
        self.assertEqual(remote.call_args.args[2]["runtimeSkillCatalog"]["skills"], [])
        self.assertFalse(result["requiresApply"])
        self.assertEqual(set(_schema()["properties"]), {"commands", "summary", "assumptions", "contentRequests"})


class BehaviorServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name, clock=lambda: 100.)
        self.exchange(live_snapshot())

    def exchange(self, value):
        return self.state.exchange({"clientId": "behavior-test", "snapshot": value, "results": []})

    def test_queue_routes_behavior_to_executor_without_mutating_scene(self):
        before = copy.deepcopy(self.state.latest)
        response = self.state.queue([setting(speedDegreesPerSecond=12)])
        self.assertEqual(self.state.latest, before)
        item = response["commands"][0]
        self.assertEqual(item["op"], "set_behavior")
        self.assertEqual(item["objectId"], "object-1")
        self.assertTrue(item["requestId"])
        self.assertEqual(self.exchange(live_snapshot())["commands"], response["commands"])

    def test_old_player_queue_rejects_set_remove_and_behavior_save_load(self):
        self.state.save("WithBehaviors")
        self.exchange(copy.deepcopy(SNAPSHOT))
        for item in (setting(), {"op": "remove_behavior", "objectId": "object-1", "behaviorKind": "all"}):
            with self.subTest(op=item["op"]), self.assertRaisesRegex(APIError, "update the Quest"):
                self.state.queue([item])
        with self.assertRaisesRegex(APIError, "updated Quest"):
            self.state.load("WithBehaviors")
        self.assertFalse(self.state.pending)

    def test_save_load_retains_configs_ids_anchor_and_base_transform(self):
        original = copy.deepcopy(self.state.latest["scene"])
        self.state.save("Behaviors")
        saved = json.loads(self.state.path("Behaviors").read_text(encoding="utf-8"))
        self.assertEqual(saved["scene"], original)
        self.assertNotIn("behaviorKinds", saved)
        self.assertNotIn("viewer", saved)
        queued = self.state.load("Behaviors")["commands"][0]
        self.assertEqual(queued["op"], "load")
        self.assertEqual(queued["scene"], original)

    def test_legacy_save_can_load_on_new_player(self):
        self.state.path("Old").write_text(json.dumps(SNAPSHOT), encoding="utf-8")
        self.assertEqual(self.state.load("Old")["commands"][0]["scene"], SNAPSHOT["scene"])

    def test_configuration_changes_and_capability_loss_invalidate_proposals(self):
        for change in ("configuration", "capability"):
            with self.subTest(change=change):
                self.exchange(live_snapshot())
                with patch.dict(os.environ, {}, clear=True):
                    proposed = plan(self.state, {"text": "show scene", "mode": "offline-rules"})
                revision = self.state.revision
                value = live_snapshot()
                if change == "configuration":
                    value["scene"]["objects"][0]["behaviors"][0]["paused"] = True
                else:
                    value.pop("behaviorKinds")
                self.exchange(value)
                self.assertGreater(self.state.revision, revision)
                with self.assertRaisesRegex(APIError, "Scene or selection changed"):
                    self.state.apply_plan(proposed["planId"])

    def test_invalid_behavior_snapshot_is_atomic(self):
        before = self.state.status()
        value = live_snapshot()
        value["scene"]["objects"][0]["behaviors"][0]["frequencyHz"] = 0
        with self.assertRaises(APIError):
            self.exchange(value)
        self.assertEqual(self.state.status(), before)

    def test_behavior_only_edit_and_undo_use_existing_queue(self):
        queued = self.state.queue([setting(paused=True)])
        changed = live_snapshot()
        changed["scene"]["objects"][0]["behaviors"][0]["paused"] = True
        self.state.exchange({"clientId": "behavior-test", "snapshot": changed,
                             "results": [{"requestId": queued["commands"][0]["requestId"], "ok": True,
                                          "objectId": "object-1", "error": ""}]})
        self.assertFalse(self.state.pending)
        self.assertEqual(self.state.queue([{"op": "undo"}])["commands"][0]["op"], "undo")
        self.assertEqual(self.state.latest["scene"]["objects"][0]["transform"], SNAPSHOT["scene"]["objects"][0]["transform"])


if __name__ == "__main__":
    unittest.main()
