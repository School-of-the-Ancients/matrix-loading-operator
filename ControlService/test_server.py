"""HTTP end-to-end tests; no headset or live AI provider required."""
import copy
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from server import APIError, LEASE_SECONDS, MAX_BODY, Server, State


SNAPSHOT = {"scene": {"schemaVersion": 1, "roomId": "test-room", "objects": []},
            "assets": [{"assetId": "cube", "displayName": "Cube"}],
            "anchors": [{"anchorId": "floor", "displayName": "Floor"}]}
TRANSFORM = {"position": {"x": 0, "y": 1, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0},
             "scale": {"x": 1, "y": 1, "z": 1}}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = [100.0]
        self.state = State(self.temp.name, clock=lambda: self.now[0])
        self.server = Server(("127.0.0.1", 0), self.state)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.http = urllib.request.build_opener()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, body=None, headers=None, raw=None):
        headers = dict(headers or {})
        data = raw if raw is not None else None if body is None else json.dumps(body).encode()
        if data is not None:
            headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(self.base + path, data=data, headers=headers)
        try:
            response = self.http.open(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            if response.headers.get_content_type() == "text/html":
                return response.status, raw
            return response.status, json.loads(raw)

    def exchange(self, client="client-a", snap=None, results=None):
        return self.request("/api/exchange", {"clientId": client,
                            "snapshot": SNAPSHOT if snap is None else snap, "results": results or []})

    def selected_snapshot(self, with_object=False):
        selected = copy.deepcopy(SNAPSHOT)
        selected["selection"] = {"anchorId": "floor", "objectId": "", "position": {"x": 2, "y": 0.4, "z": 3}}
        if with_object:
            selected["scene"]["objects"] = [{"objectId": "one", "assetId": "cube", "anchorId": "floor", "transform": copy.deepcopy(TRANSFORM)}]
            selected["selection"]["objectId"] = "one"
        return selected

    def offline_plan(self, text):
        code, proposal = self.request("/api/plan", {"text": text, "mode": "offline-rules"})
        self.assertEqual(code, 200, proposal)
        self.assertTrue(proposal["requiresApply"])
        self.assertTrue(proposal["planId"])
        return proposal

    def apply_plan(self, proposal):
        return self.request("/api/apply_plan", {"planId": proposal["planId"]})

    def test_retained_delivery_ack_and_save_load(self):
        self.assertEqual(self.exchange()[0], 200)
        code, queued = self.request("/api/command", {"op": "spawn", "assetId": "cube", "anchorId": "floor", "transform": TRANSFORM})
        self.assertEqual(code, 200)
        request_id = queued["commands"][0]["requestId"]
        self.assertEqual(self.exchange()[1], queued)
        self.assertEqual(self.exchange()[1], queued)  # Lost response: same request IDs.
        self.assertEqual(self.request("/api/save", {"name": "room"})[0], 409)
        snap = copy.deepcopy(SNAPSHOT)
        snap["scene"]["objects"] = [{"objectId": "one", "assetId": "cube", "anchorId": "floor", "transform": TRANSFORM}]
        result = {"requestId": request_id, "ok": True, "error": "", "objectId": "one"}
        self.assertEqual(self.exchange(snap=snap, results=[result])[1], {"commands": []})
        self.assertEqual(self.exchange(snap=snap, results=[result])[1], {"commands": []})
        state = self.request("/api/state")[1]
        self.assertEqual(len(state["results"]), 1)
        self.assertEqual(self.request("/api/save", {"name": "room"})[0], 200)
        self.assertEqual(json.loads(Path(self.temp.name, "room.json").read_text()), snap)
        self.assertEqual(self.request("/api/scenes")[1], {"scenes": ["room"]})
        self.assertEqual(self.request("/api/load", {"name": "room"})[1]["commands"][0]["scene"], snap["scene"])
        self.assertFalse(list(Path(self.temp.name).glob(".saving-*")))

    def test_lease_conflict_and_no_cross_session_commands(self):
        self.exchange()
        queued = self.request("/api/command", {"op": "clear"})[1]
        self.assertEqual(self.exchange(client="client-b")[0], 409)
        self.now[0] += LEASE_SECONDS + 1
        self.assertEqual(self.exchange(client="client-b")[1], {"commands": []})
        status = self.request("/api/state")[1]
        self.assertEqual(status["results"][0]["requestId"], queued["commands"][0]["requestId"])
        self.assertFalse(status["results"][0]["ok"])

    def test_offline_and_validation_are_atomic(self):
        self.assertEqual(self.request("/api/command", {"op": "clear"})[0], 409)
        self.exchange()
        self.assertEqual(self.request("/api/command", {"commands": [{"op": "clear"}, {"op": "eval"}]})[0], 400)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)
        bad = copy.deepcopy(TRANSFORM)
        bad["scale"]["x"] = 0
        self.assertEqual(self.request("/api/command", {"op": "set_transform", "objectId": "one", "transform": bad})[0], 400)
        for name in ("../outside", "C:\\outside", "", "CON", "a/b", "a.json"):
            self.assertEqual(self.request("/api/save", {"name": name})[0], 400)
        self.assertEqual(self.request("/api/command", raw=b'{"op":"spawn","assetId":"cube","transform":NaN}')[0], 400)
        self.assertEqual(self.request("/api/command", raw=b"x" * (MAX_BODY + 1))[0], 413)
        self.assertEqual(self.request("/api/command", raw=b"{")[0], 400)

    def test_auth_origin_host_and_static_page(self):
        self.server.token = "a-long-random-token-for-testing"
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/api/health")[0], 401)
        auth = {"Authorization": "Bearer " + self.server.token}
        self.assertEqual(self.request("/api/health", headers=auth)[0], 200)
        self.assertEqual(self.request("/api/command", {"op": "clear"}, {**auth, "Origin": "https://evil.test"})[0], 403)
        self.assertEqual(self.request("/api/state", headers={**auth, "Host": "evil.test"})[0], 403)
        self.assertEqual(self.request("/api/command", {"op": "clear"}, {**auth, "Content-Type": "text/plain"})[0], 415)
        with self.assertRaises(APIError):
            Server(("0.0.0.0", 0), self.state, "")

    def test_corrupt_or_duplicate_saved_scene_rejected_without_queue(self):
        self.exchange()
        target = Path(self.temp.name, "broken.json")
        target.write_text("{", encoding="utf-8")
        self.assertEqual(self.request("/api/load", {"name": "broken"})[0], 400)
        saved = copy.deepcopy(SNAPSHOT)
        obj = {"objectId": "one", "assetId": "cube", "anchorId": "floor", "transform": TRANSFORM}
        saved["scene"]["objects"] = [obj, obj]
        target.write_text(json.dumps(saved), encoding="utf-8")
        self.assertEqual(self.request("/api/load", {"name": "broken"})[0], 400)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_queue_bounds(self):
        self.exchange()
        for _ in range(3):
            self.assertEqual(self.request("/api/command", {"commands": [{"op": "get_scene"}] * 20})[0], 200)
        self.assertEqual(self.request("/api/command", {"commands": [{"op": "clear"}] * 5})[0], 409)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 60)

    def test_configured_planner_requires_explicit_apply_and_validates_provider_ids(self):
        selected = copy.deepcopy(SNAPSHOT)
        selected["selection"] = {"anchorId": "floor", "objectId": None, "position": {"x": 2, "y": 0.4, "z": 3}}
        self.exchange(snap=selected)
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.request("/api/plan", {"text": "Add a cube", "mode": "openai-compatible"})[0], 503)
        proposal = {"commands": [{"op": "spawn", "assetId": "cube", "anchorId": "floor", "transform": TRANSFORM}]}
        provider = {"choices": [{"message": {"content": json.dumps(proposal)}}]}
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return json.dumps(provider).encode()
        sent = []
        class Opener:
            def open(self, request, timeout):
                sent.append(json.loads(request.data))
                return Response()
        config = {"SANDBOX_AI_BASE_URL": "http://127.0.0.1:9999/v1", "SANDBOX_AI_MODEL": "test", "SANDBOX_AI_KEY": "test"}
        # Patch the provider factory only; this test still reaches the service over HTTP.
        with patch.dict(os.environ, config), patch("ai_adapter.urllib.request.build_opener", return_value=Opener()):
            code, data = self.request("/api/plan", {"text": "Add a cube", "mode": "openai-compatible"})
            self.assertEqual(code, 200)
            self.assertTrue(data["requiresApply"])
            self.assertTrue(data["planId"])
            context = json.loads(sent[0]["messages"][1]["content"])
            self.assertEqual(context["snapshot"]["selection"]["anchorId"], "floor")
            self.assertEqual(context["snapshot"]["selection"]["position"], selected["selection"]["position"])
            self.assertEqual(context["snapshot"]["selection"]["objectId"], "")
            self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)
            provider["choices"][0]["message"]["content"] = json.dumps({"commands": [{"op": "spawn", "assetId": "invented", "anchorId": "floor", "transform": TRANSFORM}]})
            self.assertEqual(self.request("/api/plan", {"text": "Add a cube", "mode": "openai-compatible"})[0], 422)
            provider["choices"][0]["message"]["content"] = json.dumps({"commands": []})
            self.assertEqual(self.request("/api/plan", {"text": "Move it here", "mode": "openai-compatible"})[0], 502)
            self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_explicit_offline_rules_ignore_configured_provider(self):
        self.exchange(snap=self.selected_snapshot())
        config = {"SANDBOX_AI_BASE_URL": "http://127.0.0.1:9999/v1", "SANDBOX_AI_MODEL": "test", "SANDBOX_AI_KEY": "test"}
        with patch.dict(os.environ, config), patch("ai_adapter.urllib.request.build_opener", side_effect=AssertionError("Offline mode contacted a provider")):
            proposal = self.offline_plan("Add a cube here")
            self.assertEqual(proposal["commands"][0]["op"], "spawn")
            self.assertEqual(proposal["commands"][0]["assetId"], "cube")
            self.assertEqual(proposal["commands"][0]["transform"]["position"], self.selected_snapshot()["selection"]["position"])
            self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_planner_status_distinguishes_offline_parser_from_ai(self):
        with patch.dict(os.environ, {}, clear=True):
            code, status = self.request("/api/planner")
            self.assertEqual(code, 200)
            self.assertEqual(status["mode"], "offline-rules")
            self.assertFalse(status["configured"])
            self.assertIn("not an AI model", status["provider"])
            self.assertEqual(status["availableModes"], ["offline-rules"])
        config = {"SANDBOX_AI_BASE_URL": "http://127.0.0.1:9999/v1", "SANDBOX_AI_MODEL": "test-model", "SANDBOX_AI_KEY": "not-a-real-provider-key"}
        with patch.dict(os.environ, config):
            code, status = self.request("/api/planner")
            self.assertEqual(code, 200)
            self.assertEqual(status["mode"], "openai-compatible")
            self.assertTrue(status["configured"])
            self.assertEqual(status["model"], "test-model")
            self.assertIn("offline-rules", status["availableModes"])
            self.assertNotIn(config["SANDBOX_AI_KEY"], json.dumps(status))

    def test_proposal_rejects_changed_scene_or_selection(self):
        for changed_field in ("scene", "selection"):
            with self.subTest(changed_field=changed_field):
                selected = self.selected_snapshot(with_object=True)
                self.exchange(snap=selected)
                proposal = self.offline_plan("Make it twice as big")
                changed = copy.deepcopy(selected)
                if changed_field == "scene":
                    changed["scene"]["objects"][0]["transform"]["position"]["x"] += 0.2
                else:
                    changed["selection"]["position"]["x"] += 0.2
                self.exchange(snap=changed)
                self.assertEqual(self.apply_plan(proposal)[0], 409)
                status = self.request("/api/state")[1]
                self.assertEqual(status["pendingCount"], 0)
                self.assertEqual(status["snapshot"], changed)

    def test_new_commands_use_existing_queue_acknowledgements_and_strict_shapes(self):
        selected = self.selected_snapshot(with_object=True)
        self.exchange(snap=selected)
        for malformed in ({"op": "select"}, {"op": "duplicate"}, {"op": "select", "objectId": "one", "transform": TRANSFORM},
                          {"op": "undo", "objectId": "one"}, {"op": "redo", "scene": selected["scene"]}):
            with self.subTest(malformed=malformed):
                self.assertEqual(self.request("/api/command", malformed)[0], 400)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)
        for command in ({"op": "select", "objectId": "one"}, {"op": "duplicate", "objectId": "one"},
                        {"op": "undo"}, {"op": "redo"}):
            with self.subTest(command=command):
                code, queued = self.request("/api/command", command)
                self.assertEqual(code, 200)
                self.assertEqual(self.exchange(snap=selected)[1], queued)
                self.assertEqual(self.exchange(snap=selected)[1], queued)
                request_id = queued["commands"][0]["requestId"]
                self.exchange(snap=selected, results=[{"requestId": request_id, "ok": True, "objectId": "one"}])
                self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_select_and_duplicate_proposals_reject_context_changes(self):
        for phrase in ("select the cube", "duplicate it", "undo", "redo"):
            with self.subTest(phrase=phrase):
                selected = self.selected_snapshot(with_object=True)
                self.exchange(snap=selected)
                proposal = self.offline_plan(phrase)
                self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)
                changed = copy.deepcopy(selected)
                changed["selection"]["position"]["z"] += 1
                self.exchange(snap=changed)
                self.assertEqual(self.apply_plan(proposal)[0], 409)
                self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_duplicate_acknowledgement_selection_guides_next_edit(self):
        selected = self.selected_snapshot(with_object=True)
        self.exchange(snap=selected)
        proposal = self.offline_plan("duplicate it")
        code, queued = self.apply_plan(proposal)
        self.assertEqual(code, 200)
        self.assertEqual(queued["commands"][0]["objectId"], "one")
        duplicated = copy.deepcopy(selected)
        clone = copy.deepcopy(duplicated["scene"]["objects"][0])
        clone["objectId"] = "two"
        clone["transform"]["position"]["x"] += 0.3
        duplicated["scene"]["objects"].append(clone)
        duplicated["selection"]["objectId"] = "two"
        self.exchange(snap=duplicated, results=[{"requestId": queued["commands"][0]["requestId"], "ok": True, "objectId": "two"}])
        edit = self.offline_plan("make it twice as big")
        self.assertEqual(edit["commands"][0]["objectId"], "two")
        self.assertEqual(self.request("/api/plan", {"text": "select the cube", "mode": "offline-rules"})[0], 422)
        self.assertEqual(self.offline_plan("select one")["commands"], [{"op": "select", "objectId": "one"}])

    def test_load_furniture_and_saved_scene_keep_distinct_reviewed_intents(self):
        selected = self.selected_snapshot()
        selected["assets"].append({"assetId": "bundle-chair", "displayName": "Chair", "spawnScale": 1.0})
        self.exchange(snap=selected)
        self.assertEqual(self.request("/api/save", {"name": "chair"})[0], 200)
        self.assertEqual(self.offline_plan("load chair")["commands"], [{"op": "load_scene", "name": "chair"}])
        for phrase in ("load a chair", "summon a chair"):
            with self.subTest(phrase=phrase):
                command = self.offline_plan(phrase)["commands"][0]
                self.assertEqual((command["op"], command["assetId"]), ("spawn", "bundle-chair"))
                self.assertEqual(command["transform"]["scale"], dict.fromkeys("xyz", 1.0))
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_catalog_spawn_scale_roundtrip_and_validation_preserve_previous_snapshot(self):
        selected = self.selected_snapshot()
        selected["assets"][0]["spawnScale"] = 1.0
        self.assertEqual(self.exchange(snap=selected)[0], 200)
        self.assertEqual(self.request("/api/state")[1]["snapshot"]["assets"], selected["assets"])
        self.assertEqual(self.request("/api/save", {"name": "with-size"})[0], 200)
        self.assertEqual(json.loads(Path(self.temp.name, "with-size.json").read_text())["assets"], selected["assets"])
        for value in (0, -1, 20.01, True, None, "1"):
            bad = copy.deepcopy(selected)
            bad["assets"][0]["spawnScale"] = value
            with self.subTest(value=value):
                self.assertEqual(self.exchange(snap=bad)[0], 400)
                self.assertEqual(self.request("/api/state")[1]["snapshot"], selected)

    def test_proposal_applies_once_and_does_not_replay(self):
        selected = self.selected_snapshot()
        self.exchange(snap=selected)
        proposal = self.offline_plan("Add a cube here")
        code, applied = self.apply_plan(proposal)
        self.assertEqual(code, 200)
        self.assertEqual(len(applied["commands"]), 1)
        self.assertEqual(self.apply_plan(proposal)[0], 409)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 1)
        self.assertEqual(self.exchange(snap=selected)[1], applied)

    def test_proposal_expires_while_client_remains_connected(self):
        selected = self.selected_snapshot()
        self.exchange(snap=selected)
        proposal = self.offline_plan("Add a cube here")
        for _ in range(13):
            self.now[0] += 10
            self.assertEqual(self.exchange(snap=selected)[0], 200)
        self.assertTrue(self.request("/api/state")[1]["online"])
        self.assertEqual(self.apply_plan(proposal)[0], 409)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_proposal_does_not_cross_runtime_sessions(self):
        selected = self.selected_snapshot()
        self.exchange(snap=selected)
        proposal = self.offline_plan("Add a cube here")
        self.now[0] += LEASE_SECONDS + 1
        self.assertEqual(self.exchange(client="client-b", snap=selected)[0], 200)
        self.assertEqual(self.apply_plan(proposal)[0], 409)
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)

    def test_pending_commands_block_planning_and_applying(self):
        selected = self.selected_snapshot()
        self.exchange(snap=selected)
        queued = self.request("/api/command", {"op": "get_scene"})[1]
        self.assertEqual(self.request("/api/plan", {"text": "Add a cube here", "mode": "offline-rules"})[0], 409)
        self.exchange(snap=selected, results=[{"requestId": queued["commands"][0]["requestId"], "ok": True}])
        proposal = self.offline_plan("Add a cube here")
        queued = self.request("/api/command", {"op": "get_scene"})[1]
        self.assertEqual(self.apply_plan(proposal)[0], 409)
        self.assertEqual(self.exchange(snap=selected)[1], queued)

    def test_save_clear_and_load_proposals_complete_roundtrip(self):
        selected = self.selected_snapshot(with_object=True)
        self.exchange(snap=selected)
        save = self.offline_plan("Save as demo")
        self.assertEqual(save["commands"], [{"op": "save_scene", "name": "demo"}])
        self.assertFalse(Path(self.temp.name, "demo.json").exists())
        self.assertEqual(self.apply_plan(save), (200, {"name": "demo", "saved": True}))
        self.assertEqual(self.apply_plan(save)[0], 409)
        self.assertEqual(json.loads(Path(self.temp.name, "demo.json").read_text()), selected)
        clear = self.offline_plan("Clear the scene")
        code, cleared = self.apply_plan(clear)
        self.assertEqual(code, 200)
        self.assertEqual(cleared["commands"][0]["op"], "clear")
        empty = self.selected_snapshot()
        self.exchange(snap=empty, results=[{"requestId": cleared["commands"][0]["requestId"], "ok": True}])
        load = self.offline_plan("Load demo")
        self.assertEqual(load["commands"], [{"op": "load_scene", "name": "demo"}])
        self.assertEqual(self.request("/api/state")[1]["pendingCount"], 0)
        code, restored = self.apply_plan(load)
        self.assertEqual(code, 200)
        self.assertEqual(restored["commands"][0]["scene"], selected["scene"])
        self.exchange(snap=selected, results=[{"requestId": restored["commands"][0]["requestId"], "ok": True}])
        status = self.request("/api/state")[1]
        self.assertEqual(status["snapshot"]["scene"], selected["scene"])
        self.assertEqual(status["pendingCount"], 0)

    def test_selection_roundtrip_validation_and_scene_only_load(self):
        selected = copy.deepcopy(SNAPSHOT)
        selected["scene"]["objects"] = [{"objectId": "one", "assetId": "cube", "anchorId": "floor", "transform": TRANSFORM}]
        selected["selection"] = {"anchorId": "floor", "objectId": "one", "position": {"x": 2, "y": 0.4, "z": 3}}
        self.assertEqual(self.exchange(snap=selected)[0], 200)
        self.assertEqual(self.request("/api/state")[1]["snapshot"]["selection"], selected["selection"])
        self.assertEqual(self.request("/api/save", {"name": "selected"})[0], 200)
        loaded = self.request("/api/load", {"name": "selected"})[1]["commands"][0]
        self.assertEqual(loaded["scene"], selected["scene"])
        self.assertNotIn("selection", loaded["scene"])
        for key in ("anchorId", "objectId"):
            invalid = copy.deepcopy(selected)
            invalid["selection"][key] = "missing"
            self.assertEqual(self.exchange(snap=invalid)[0], 400)
            self.assertEqual(self.request("/api/state")[1]["snapshot"], selected)
        invalid = copy.deepcopy(selected)
        invalid["selection"]["position"]["x"] = 101
        self.assertEqual(self.exchange(snap=invalid)[0], 400)
        selected["selection"]["anchorId"] = None
        selected["selection"]["objectId"] = None
        self.assertEqual(self.exchange(snap=selected)[0], 200)
        selection = self.request("/api/state")[1]["snapshot"]["selection"]
        self.assertEqual((selection["anchorId"], selection["objectId"]), ("", ""))

    def test_unity_null_result_strings_and_runtime_limits(self):
        self.exchange()
        request_id = self.request("/api/command", {"op": "get_scene"})[1]["commands"][0]["requestId"]
        self.assertEqual(self.exchange(results=[{"requestId": request_id, "ok": True, "error": None, "objectId": None}])[0], 200)
        result = self.request("/api/state")[1]["results"][0]
        self.assertEqual((result["error"], result["objectId"]), ("", ""))
        self.assertEqual(self.request("/api/command", {"op": "spawn", "assetId": "cube", "anchorId": "floor"})[0], 400)
        for field, number in (("position", 101), ("rotation", 36001), ("scale", 0.001), ("scale", 21)):
            pose = copy.deepcopy(TRANSFORM)
            pose[field]["x"] = number
            self.assertEqual(self.request("/api/command", {"op": "spawn", "assetId": "cube", "anchorId": "floor", "transform": pose})[0], 400)


if __name__ == "__main__":
    unittest.main()
