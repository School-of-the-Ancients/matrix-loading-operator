"""Room-aware PC service lifecycle and persistence contracts.

Synthetic snapshots drive the actual service functions/HTTP handler. No headset,
speech provider, or live AI provider is used by this module.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from server import APIError, LEASE_SECONDS, Server, State, command, plan, snapshot
from test_room_context import POINTING, SNAPSHOT, TABLE, pose, spawn, vector


MISSING = {"mode": "ar", "state": "missing", "message": "No manual room data. Complete Space Setup.",
           "alignmentVerified": False}
EMPTY_UNITY = {"scene": {"schemaVersion": 1, "roomId": "", "objects": []},
               "assets": [], "anchors": [], "selection": {"anchorId": "", "objectId": "", "position": vector()},
               "viewer": {"frames": []}, "pointing": {"anchorId": "", "objectId": "", "position": vector()}}


def recovery_snapshot(context=MISSING):
    value = copy.deepcopy(SNAPSHOT)
    value["roomContext"] = copy.deepcopy(context)
    value["readOnly"] = True
    value.pop("viewer")
    value.pop("pointing")
    return value


class RoomServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = [100.0]
        self.state = State(self.temp.name, clock=lambda: self.now[0])
        for guard in (patch.dict(os.environ, {}, clear=True),
                      patch.object(subprocess, "Popen", side_effect=AssertionError("No live AI in service tests"))):
            guard.start()
            self.addCleanup(guard.stop)
        self.exchange()

    def exchange(self, value=SNAPSHOT, *, runtime=None, results=None, client="room-test-client"):
        body = {"clientId": client, "snapshot": copy.deepcopy(value), "results": results or []}
        if runtime is not None:
            body["runtime"] = copy.deepcopy(runtime)
        return self.state.exchange(body)

    def propose_read(self):
        return plan(self.state, {"text": "show scene", "mode": "offline-rules"})

    def ack(self, queued, value=SNAPSHOT):
        results = [{"requestId": item["requestId"], "ok": True, "error": "", "objectId": ""}
                   for item in queued["commands"]]
        return self.exchange(value, results=results)

    def test_metadata_and_ephemeral_context_survive_service_normalization_as_copies(self):
        original = copy.deepcopy(SNAPSHOT)
        normalized = snapshot(original)
        self.assertEqual(normalized, SNAPSHOT)
        status = self.state.status()
        self.assertEqual(status["runtime"], SNAPSHOT["roomContext"])
        self.assertEqual(status["snapshot"], SNAPSHOT)
        status["snapshot"]["anchors"][0]["surface"]["boundary"][0]["x"] = 99
        status["snapshot"]["pointing"]["origin"]["y"] = 99
        status["runtime"]["alignmentVerified"] = False
        self.assertEqual(self.state.latest, SNAPSHOT)
        self.assertEqual(self.state.runtime, SNAPSHOT["roomContext"])

    def test_malformed_measured_context_is_rejected_without_state_changes(self):
        for field in ("boundary", "pointing", "roomContext"):
            with self.subTest(field=field):
                value = copy.deepcopy(SNAPSHOT)
                if field == "boundary":
                    value["anchors"][0]["surface"]["boundary"] = [vector()] * 3
                elif field == "pointing":
                    value["pointing"]["objectId"] = "deleted-object"
                else:
                    value["roomContext"]["alignmentVerified"] = "yes"
                before = self.state.status()
                with self.assertRaises(APIError) as raised:
                    self.exchange(value)
                self.assertEqual(raised.exception.status, 400)
                self.assertEqual(self.state.status(), before)

    def test_head_and_controller_motion_preserve_proposal_and_request_time_target(self):
        proposal = self.propose_read()
        revision = self.state.revision
        moved = copy.deepcopy(SNAPSHOT)
        moved["viewer"]["frames"][0]["position"]["x"] += .3
        moved["pointing"]["position"]["x"] -= .2
        moved["pointing"]["origin"]["x"] -= .2
        self.exchange(moved)
        self.assertEqual(self.state.revision, revision)
        self.assertEqual(proposal["pointingAtRequest"], POINTING)
        self.assertEqual(proposal["viewerAtRequest"], SNAPSHOT["viewer"])
        self.assertEqual(self.state.latest["pointing"], moved["pointing"])
        queued = self.state.apply_plan(proposal["planId"])
        self.assertEqual(queued["commands"][0]["op"], "get_scene")

    def test_pointing_loss_and_reappearance_do_not_invalidate_proposals(self):
        proposal = self.propose_read()
        revision = self.state.revision
        absent = copy.deepcopy(SNAPSHOT)
        absent.pop("pointing")
        absent.pop("viewer")
        self.exchange(absent)
        self.exchange(SNAPSHOT)
        self.assertEqual(self.state.revision, revision)
        self.assertEqual(self.state.apply_plan(proposal["planId"])["commands"][0]["op"], "get_scene")

    def test_selection_geometry_and_alignment_changes_invalidate_proposals(self):
        for change in ("selection", "geometry", "alignment", "roomPose"):
            with self.subTest(change=change):
                self.exchange(SNAPSHOT)
                proposal = self.propose_read()
                moved = copy.deepcopy(SNAPSHOT)
                if change == "selection":
                    moved["selection"]["objectId"] = ""
                elif change == "geometry":
                    moved["anchors"][0]["surface"]["boundary"][0]["x"] -= .1
                elif change == "alignment":
                    moved["roomContext"]["alignmentVerified"] = False
                else:
                    moved["anchors"][0]["roomPose"]["position"]["x"] += .1
                self.exchange(moved)
                with self.assertRaises(APIError) as raised:
                    self.state.apply_plan(proposal["planId"])
                self.assertEqual(raised.exception.status, 409)
                self.assertFalse(self.state.pending)

    def test_voice_plan_uses_recording_start_pointing_after_controller_motion(self):
        captured = copy.deepcopy(SNAPSHOT)
        context = (self.state.client_id, self.state.revision, captured)
        moved = copy.deepcopy(SNAPSHOT)
        moved["pointing"]["position"]["x"] += .2
        self.exchange(moved)
        with patch("server.Planner") as planner:
            planner.return_value.plan.return_value = {
                "commands": [spawn()], "summary": "Fixture proposal", "requiresApply": True, "status": "ready"}
            proposal = plan(self.state, {"text": "put an orb here", "mode": "codex-cli"}, request_context=context)
            self.assertEqual(planner.return_value.plan.call_args.args[1]["pointing"], captured["pointing"])
        self.assertEqual(proposal["pointingAtRequest"], captured["pointing"])
        self.assertEqual(self.state.apply_plan(proposal["planId"])["commands"][0]["placement"], "surface")

    def test_missing_room_is_an_online_explicit_state_with_no_editable_snapshot(self):
        self.assertEqual(self.exchange(None, runtime=MISSING), {"commands": []})
        status = self.state.status()
        self.assertTrue(status["online"])
        self.assertEqual(status["runtime"], MISSING)
        self.assertIsNone(status["snapshot"])
        for action in (lambda: self.state.queue([{"op": "clear"}]), lambda: self.state.save("NoRoom"), self.propose_read):
            with self.subTest(action=action), self.assertRaises(APIError) as raised:
                action()
            self.assertEqual(raised.exception.status, 409)
            self.assertIn("room", str(raised.exception).lower())
        self.assertFalse(self.state.pending)
        self.assertFalse(list(Path(self.temp.name).glob("*.json")))

    def test_empty_unity_snapshot_requires_explicit_unavailable_ar_state(self):
        for value in (None, EMPTY_UNITY):
            self.exchange(SNAPSHOT)
            for runtime in (None, SNAPSHOT["roomContext"], {**MISSING, "mode": "white-room"}):
                with self.subTest(empty=value is None, runtime=runtime), self.assertRaises(APIError):
                    self.exchange(value, runtime=runtime)
                self.assertEqual(self.state.latest, SNAPSHOT)
            for state in ("loading", "missing", "error"):
                self.exchange(value, runtime={**MISSING, "state": state})
                self.assertIsNone(self.state.latest)

    def test_conflicting_runtime_and_snapshot_contexts_are_rejected_atomically(self):
        for runtime in (MISSING, {**SNAPSHOT["roomContext"], "alignmentVerified": False}):
            with self.subTest(runtime=runtime), self.assertRaisesRegex(APIError, "disagree"):
                self.exchange(SNAPSHOT, runtime=runtime)
            self.assertEqual(self.state.latest, SNAPSHOT)
            self.assertEqual(self.state.runtime, SNAPSHOT["roomContext"])
        unavailable = copy.deepcopy(SNAPSHOT)
        unavailable["roomContext"] = MISSING
        with self.assertRaisesRegex(APIError, "Unavailable room"):
            self.exchange(unavailable, runtime=MISSING)

    def test_room_loss_keeps_received_ack_but_marks_other_pending_outcome_unknown(self):
        queued = self.state.queue([{"op": "get_scene"}, {"op": "list_targets"}])["commands"]
        received = {"requestId": queued[0]["requestId"], "ok": True, "objectId": "", "error": ""}
        response = self.exchange(None, runtime=MISSING, results=[received])
        self.assertEqual(response, {"commands": []})
        results = self.state.status()["results"]
        self.assertEqual(results[0], received)
        self.assertEqual(results[1]["requestId"], queued[1]["requestId"])
        self.assertFalse(results[1]["ok"])
        self.assertIn("outcome unknown", results[1]["error"])
        self.assertFalse(self.state.pending)

    def test_room_loss_discards_proposals_and_does_not_replay_commands_after_recovery(self):
        proposal = self.propose_read()
        self.state.queue([{"op": "get_scene"}])
        self.exchange(None, runtime=MISSING)
        self.assertFalse(self.state.proposals)
        self.assertEqual(self.exchange(), {"commands": []})
        with self.assertRaises(APIError):
            self.state.apply_plan(proposal["planId"])
        self.assertEqual(self.state.latest, SNAPSHOT)

    def test_another_client_cannot_use_missing_room_state_to_take_active_lease(self):
        with self.assertRaises(APIError) as raised:
            self.exchange(None, runtime=MISSING, client="other-client")
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(self.state.latest, SNAPSHOT)
        self.now[0] += LEASE_SECONDS + 1
        self.exchange(None, runtime=MISSING, client="other-client")
        self.assertEqual(self.state.client_id, "other-client")
        self.assertIsNone(self.state.latest)

    def test_alignment_confirmation_is_queued_only_for_ready_real_room_and_requires_ack(self):
        value = copy.deepcopy(SNAPSHOT)
        value["roomContext"]["alignmentVerified"] = False
        self.exchange(value)
        queued = self.state.queue([{"op": "confirm_room"}])
        self.assertFalse(self.state.runtime["alignmentVerified"])
        self.assertEqual(queued["commands"][0]["op"], "confirm_room")
        self.ack(queued, SNAPSHOT)
        self.assertTrue(self.state.runtime["alignmentVerified"])
        self.exchange(None, runtime=MISSING)
        with self.assertRaises(APIError):
            self.state.queue([{"op": "confirm_room"}])
        virtual = copy.deepcopy(SNAPSHOT)
        virtual["roomContext"] = {"mode": "white-room", "state": "ready", "message": "White room"}
        virtual["anchors"] = [{"anchorId": TABLE["anchorId"], "displayName": "Virtual floor"}]
        self.exchange(virtual)
        with self.assertRaises(APIError):
            self.state.queue([{"op": "confirm_room"}])

    def test_unconfirmed_room_allows_inspection_selection_and_clear_but_no_edits(self):
        value = copy.deepcopy(SNAPSHOT)
        value["roomContext"]["alignmentVerified"] = False
        self.exchange(value)
        for item in (spawn(), {"op": "delete", "objectId": "orb-object"}, {"op": "undo"}, {"op": "redo"},
                     {"op": "load", "scene": SNAPSHOT["scene"]}):
            with self.subTest(op=item["op"]), self.assertRaisesRegex(APIError, "outlines"):
                self.state.queue([item])
            self.assertFalse(self.state.pending)
        for item in ({"op": "get_scene"}, {"op": "list_assets"}, {"op": "list_targets"},
                     {"op": "select", "objectId": "orb-object"}, {"op": "clear"}):
            queued = self.state.queue([item])
            self.assertEqual(queued["commands"][0]["op"], item["op"])
            self.ack(queued, value)

    def test_confirmation_and_edit_cannot_bypass_alignment_in_one_batch(self):
        value = copy.deepcopy(SNAPSHOT)
        value["roomContext"]["alignmentVerified"] = False
        self.exchange(value)
        with self.assertRaises(APIError):
            self.state.queue([{"op": "confirm_room"}, spawn()])
        self.assertFalse(self.state.pending)

    def test_planner_cannot_self_confirm_alignment_even_if_it_returns_the_command(self):
        with patch("server.Planner") as planner:
            planner.return_value.plan.return_value = {
                "commands": [{"op": "confirm_room"}], "summary": "Untrusted provider response", "requiresApply": True}
            with self.assertRaisesRegex(APIError, "confirm physical alignment"):
                plan(self.state, {"text": "put an orb on my table", "mode": "codex-cli"})
        self.assertFalse(self.state.proposals)
        self.assertFalse(self.state.pending)

    def test_save_strips_ephemeral_pose_pointing_and_alignment_but_retains_anchor_identity(self):
        self.assertEqual(self.state.save("TableDemo"), {"name": "TableDemo", "saved": True})
        saved = json.loads(Path(self.temp.name, "TableDemo.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["scene"], SNAPSHOT["scene"])
        self.assertEqual(saved["anchors"], SNAPSHOT["anchors"])
        for field in ("viewer", "pointing", "roomContext"):
            self.assertNotIn(field, saved)
            self.assertIn(field, self.state.latest)
        self.assertFalse(list(Path(self.temp.name).glob(".saving-*")))

    def test_load_queues_final_scene_poses_only_and_does_not_restore_live_context(self):
        self.state.save("TableDemo")
        current = copy.deepcopy(SNAPSHOT)
        current["viewer"]["frames"][0]["position"]["x"] += .5
        current["pointing"]["position"]["x"] += .1
        self.exchange(current)
        result = self.state.load("TableDemo")["commands"][0]
        self.assertEqual(set(result), {"op", "scene", "requestId"})
        self.assertEqual(result["scene"], SNAPSHOT["scene"])
        self.assertEqual(result["scene"]["objects"][0]["transform"]["position"]["y"], .1)
        self.assertEqual(self.state.latest, current)

    def test_saved_alignment_cannot_override_current_room_confirmation(self):
        self.state.save("TableDemo")
        target = Path(self.temp.name, "TableDemo.json")
        saved = json.loads(target.read_text(encoding="utf-8"))
        saved["roomContext"] = copy.deepcopy(SNAPSHOT["roomContext"])
        target.write_text(json.dumps(saved), encoding="utf-8")
        current = copy.deepcopy(SNAPSHOT)
        current["roomContext"]["alignmentVerified"] = False
        self.exchange(current)
        with self.assertRaisesRegex(APIError, "outlines"):
            self.state.load("TableDemo")
        self.assertFalse(self.state.runtime["alignmentVerified"])
        self.assertFalse(self.state.pending)

    def test_recovery_snapshot_retains_stored_objects_but_blocks_planning_and_edits(self):
        value = recovery_snapshot()
        self.exchange(value, runtime=MISSING)
        status = self.state.status()
        self.assertTrue(status["online"])
        self.assertTrue(status["snapshot"]["readOnly"])
        self.assertEqual(status["snapshot"]["scene"], SNAPSHOT["scene"])
        self.assertEqual(status["runtime"], MISSING)
        for item in (spawn(), {"op": "select", "objectId": "orb-object"}, {"op": "confirm_room"},
                     {"op": "load", "scene": SNAPSHOT["scene"]}, {"op": "delete", "objectId": "orb-object"},
                     {"op": "undo"}, {"op": "redo"}):
            with self.subTest(op=item["op"]), self.assertRaises(APIError) as raised:
                self.state.queue([item])
            self.assertEqual(raised.exception.status, 409)
        with patch("server.Planner") as planner, self.assertRaises(APIError) as raised:
            self.propose_read()
        self.assertEqual(raised.exception.status, 409)
        self.assertIn("room", str(raised.exception).lower())
        planner.assert_not_called()
        self.assertFalse(self.state.pending)

    def test_readonly_requires_unavailable_ar_context_and_a_real_boolean(self):
        for flag in (1, "true", None, [], {}):
            value = recovery_snapshot()
            value["readOnly"] = flag
            with self.subTest(flag=flag), self.assertRaises(APIError):
                self.exchange(value, runtime=MISSING)
        for context in (SNAPSHOT["roomContext"], {**MISSING, "mode": "white-room"}):
            with self.subTest(context=context), self.assertRaises(APIError):
                self.exchange(recovery_snapshot(context), runtime=context)
        value = recovery_snapshot()
        value.pop("roomContext")
        with self.assertRaises(APIError):
            self.exchange(value)
        self.assertEqual(self.state.latest, SNAPSHOT)

    def test_readonly_false_is_omitted_to_preserve_ready_snapshot_compatibility(self):
        value = {**copy.deepcopy(SNAPSHOT), "readOnly": False}
        self.assertEqual(snapshot(value), SNAPSHOT)
        revision = self.state.revision
        self.exchange(value)
        self.assertNotIn("readOnly", self.state.latest)
        self.assertEqual(self.state.revision, revision)

    def test_recovery_entry_cancels_old_edits_but_clear_and_reads_survive_repeated_polling(self):
        stale = self.state.queue([spawn()])["commands"][0]
        value = recovery_snapshot()
        self.exchange(value, runtime=MISSING)
        self.assertFalse(self.state.pending)
        failed = self.state.status()["results"][-1]
        self.assertEqual(failed["requestId"], stale["requestId"])
        self.assertFalse(failed["ok"])
        self.assertIn("outcome unknown", failed["error"])
        for op in ("clear", "get_scene", "list_assets", "list_targets"):
            with self.subTest(op=op):
                queued = self.state.queue([{"op": op}])
                for _ in range(2):
                    self.assertEqual(self.exchange(value, runtime=MISSING), queued)
                self.ack(queued, value)
                self.assertFalse(self.state.pending)

    def test_recovery_save_clear_then_ready_room_reload_preserves_final_anchor_local_pose(self):
        value = recovery_snapshot()
        self.exchange(value, runtime=MISSING)
        self.state.save("RecoveryBackup")
        saved = json.loads(Path(self.temp.name, "RecoveryBackup.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["scene"], SNAPSHOT["scene"])
        self.assertEqual(saved["anchors"], SNAPSHOT["anchors"])
        for field in ("readOnly", "roomContext", "viewer", "pointing"):
            self.assertNotIn(field, saved)
        with self.assertRaises(APIError):
            self.state.load("RecoveryBackup")
        cleared = copy.deepcopy(value)
        cleared["scene"]["objects"] = []
        cleared["selection"]["objectId"] = ""
        queued = self.state.queue([{"op": "clear"}])
        self.assertEqual(self.exchange(value, runtime=MISSING), queued)
        self.ack(queued, cleared)
        ready = copy.deepcopy(cleared)
        ready.pop("readOnly")
        ready["roomContext"] = copy.deepcopy(SNAPSHOT["roomContext"])
        self.exchange(ready)
        restored = self.state.load("RecoveryBackup")["commands"][0]
        self.assertEqual(restored["scene"], SNAPSHOT["scene"])
        self.assertEqual(restored["scene"]["objects"][0]["anchorId"], TABLE["anchorId"])
        self.assertEqual(restored["scene"]["objects"][0]["transform"], pose(0, .1, 0))
        self.assertNotIn("readOnly", self.state.latest)

    def test_recovery_context_still_must_match_published_runtime_status(self):
        value = recovery_snapshot()
        with self.assertRaisesRegex(APIError, "disagree"):
            self.exchange(value, runtime={**MISSING, "state": "error"})
        self.assertEqual(self.state.latest, SNAPSHOT)
        error = {**MISSING, "state": "error", "message": "Saved table anchor was removed. Save a recovery copy and clear."}
        self.exchange(recovery_snapshot(error), runtime=error)
        self.assertEqual(self.state.status()["runtime"], error)
        self.assertTrue(self.state.latest["readOnly"])

    def test_missing_room_cancels_active_voice_with_explicit_error_instead_of_finished(self):
        for phase in ("transcribing", "planning", "ready"):
            with self.subTest(phase=phase):
                self.exchange(SNAPSHOT)
                self.state.voice_jobs.clear()
                proposal = self.propose_read()
                job = {"clientId": self.state.client_id, "revision": self.state.revision, "cancelled": False,
                       "public": {"jobId": "fixture-voice", "phase": phase, "transcript": "put an orb on my table",
                                  "planId": proposal["planId"], "requiresApply": phase == "ready"}}
                self.state.voice_jobs["fixture-voice"] = job
                self.exchange(None, runtime=MISSING)
                status = self.state.status()["voice"]
                self.assertTrue(job["cancelled"])
                self.assertEqual(status["phase"], "error")
                self.assertFalse(status["requiresApply"])
                self.assertIn("Room became unavailable", status["error"])
                self.assertIn("speak again", status["error"])
                self.assertNotIn(proposal["planId"], self.state.proposals)
                self.exchange(SNAPSHOT)
                self.assertEqual(self.state.status()["voice"]["phase"], "error")

    def test_readonly_recovery_also_cancels_ready_voice_proposal(self):
        proposal = self.propose_read()
        self.state.voice_jobs["fixture-voice"] = {
            "clientId": self.state.client_id, "revision": self.state.revision, "cancelled": False,
            "public": {"jobId": "fixture-voice", "phase": "ready", "planId": proposal["planId"], "requiresApply": True}}
        self.exchange(recovery_snapshot(), runtime=MISSING)
        self.assertEqual(self.state.status()["voice"]["phase"], "error")
        self.assertTrue(self.state.voice_jobs["fixture-voice"]["cancelled"])
        self.assertFalse(self.state.proposals)


class RoomHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = State(self.temp.name)
        self.server = Server(("127.0.0.1", 0), self.state)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, body=None):
        raw = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=raw, headers={"Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_http_surface_command_ack_save_then_missing_room_reports_explicitly(self):
        code, _ = self.request("/api/exchange", {"clientId": "http-room", "snapshot": SNAPSHOT, "results": []})
        self.assertEqual(code, 200)
        code, queued = self.request("/api/command", spawn())
        self.assertEqual(code, 200, queued)
        self.assertEqual(queued["commands"][0]["placement"], "surface")
        result = {"requestId": queued["commands"][0]["requestId"], "ok": True, "objectId": "fixture-orb", "error": ""}
        self.assertEqual(self.request("/api/exchange", {"clientId": "http-room", "snapshot": SNAPSHOT,
                                                       "results": [result]})[0], 200)
        self.assertEqual(self.request("/api/save", {"name": "TableDemo"})[0], 200)
        self.assertEqual(self.request("/api/exchange", {"clientId": "http-room", "snapshot": None,
                                                       "runtime": MISSING, "results": []})[0], 200)
        code, state = self.request("/api/state")
        self.assertEqual(code, 200)
        self.assertTrue(state["online"])
        self.assertIsNone(state["snapshot"])
        self.assertEqual(state["runtime"], MISSING)
        self.assertEqual(self.request("/api/command", {"op": "clear"})[0], 409)
        self.assertEqual(self.request("/api/load", {"name": "TableDemo"})[0], 409)

    def test_http_invalid_room_metadata_and_placement_are_client_errors(self):
        self.request("/api/exchange", {"clientId": "http-room", "snapshot": SNAPSHOT, "results": []})
        bad = copy.deepcopy(SNAPSHOT)
        bad["pointing"]["direction"] = vector()
        self.assertEqual(self.request("/api/exchange", {"clientId": "http-room", "snapshot": bad, "results": []})[0], 400)
        self.assertEqual(self.request("/api/command", spawn(placement="nearest-anything"))[0], 400)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)


if __name__ == "__main__":
    unittest.main()
