"""The browser-safe contract contains no opaque Codex or MCP event payloads."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from agent_session import (LocalCodexAgentBackend, MatrixMCPUnavailableError,
                           normalize_event, _approval_description,
                           _mcp_approval_description, _xr_game_summary)
from codex_provider import CodexConfig


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.cwd = Path.cwd()
        self._generated_root = self.cwd / ".codex" / "generated_images"

    def events_since(self, cursor):
        self.calls.append(("events", cursor))
        return [
            {"sequence": 1, "method": "item/agentMessage/delta",
             "params": {"threadId": "thread-1", "turnId": "turn-1", "delta": "Hello", "auth": "secret"}},
            {"sequence": 2, "method": "item/started",
             "params": {"threadId": "thread-1", "turnId": "turn-1",
                        "item": {"type": "mcpToolCall", "server": "blender", "arguments": "secret"}}},
            {"sequence": 3, "method": "item/commandExecution/requestApproval", "requestId": 42,
             "params": {"threadId": "thread-1", "turnId": "turn-1", "command": "echo secret"}},
            {"sequence": 4, "method": "mcpServer/startupStatus/updated", "params": {"token": "secret"}},
            {"sequence": 5, "method": "turn/completed",
             "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}}},
        ]

    def pending_approvals(self):
        return [{"requestId": 42, "method": "item/commandExecution/requestApproval",
                 "params": {"threadId": "thread-1", "turnId": "turn-1", "command": "echo secret"}}]

    def thread_start(self, *, model=None, sandbox="workspace-write", approval_policy="on-request"):
        self.calls.append(("start", model, sandbox, approval_policy))
        return "thread-1"

    def thread_resume(self, identifier, *, sandbox="workspace-write", approval_policy="on-request"):
        self.calls.append(("resume", identifier, sandbox, approval_policy))
        return identifier

    def turn_start(self, identifier, text, *, sandbox, approval_policy, effort=None,
                   image_path=None, skill_path=None):
        self.calls.append(("send", identifier, text, effort, sandbox, approval_policy,
                           image_path, skill_path))
        return "turn-1"

    def respond_approval(self, *args):
        self.calls.append(("approval", *args))

    def turn_interrupt(self, *args):
        self.calls.append(("interrupt", *args))


class AgentSessionTests(unittest.TestCase):
    def test_pc_command_review_requires_complete_untruncated_native_request(self):
        backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
        backend.transport = FakeTransport()
        params = {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1",
                  "command": "blender --background --python create.py SECRET_COMMAND",
                  "cwd": str(Path.cwd()), "reason": "Build a new asset",
                  "networkApprovalContext": {"host": "example.invalid"}}
        approval = {"requestId": 42, "method": "item/commandExecution/requestApproval",
                    "params": params}
        backend.transport.pending_approvals = lambda: [approval]
        pc = backend.pending_pc_commands()
        self.assertEqual(len(pc), 1)
        self.assertEqual(pc[0]["itemId"], "item-1")
        self.assertIn("SECRET_COMMAND", pc[0]["nativeParams"])
        self.assertIn("networkApprovalContext", pc[0]["nativeParams"])
        self.assertFalse(backend.pending_approvals()[0]["reviewable"])
        self.assertNotIn("SECRET_COMMAND", str(backend.pending_approvals()))
        for missing in ("threadId", "turnId", "itemId", "command", "cwd"):
            with self.subTest(missing=missing):
                approval["params"] = {key: value for key, value in params.items() if key != missing}
                self.assertEqual(backend.pending_pc_commands(), [])
        approval["params"] = {**params, "truncated": True}
        self.assertEqual(backend.pending_pc_commands(), [])
        approval["params"] = {**params, "command": "x" * (64 * 1024)}
        self.assertEqual(backend.pending_pc_commands(), [])
        approval["params"] = params
        approval["method"] = "item/fileChange/requestApproval"
        self.assertEqual(backend.pending_pc_commands(), [])

    def test_windows_fallback_is_a_pc_only_codex_process_setting(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / "codex.exe"
            executable.write_bytes(b"MZ test")
            config = CodexConfig(str(executable), windows_sandbox="unelevated",
                                 agent_sandbox="danger-full-access")
            with patch("agent_session.AppServerTransport") as transport:
                backend = LocalCodexAgentBackend(config, folder)
            command = transport.call_args.args[0]
            self.assertEqual(command[:3], [str(executable), "-c", 'windows.sandbox="unelevated"'])
            self.assertEqual(command[-2:], ["app-server", "--stdio"])
            self.assertEqual(backend.access_mode, "danger-full-access")

    def test_automatic_agent_mode_applies_only_from_pc_config(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / "codex.exe"
            executable.write_bytes(b"MZ test")
            bridge = SimpleNamespace(url="http://127.0.0.1:1234/scene", token="PC-only")
            prompted_tools = {"matrix_move_object", "matrix_scale_block", "matrix_reset_block_scale",
                              "matrix_register_glb", "matrix_register_panorama",
                              "matrix_set_environment", "matrix_remove_environment",
                              "matrix_spawn_asset", "matrix_spawn_builtin",
                              "matrix_create_procedural", "matrix_update_procedural",
                              "matrix_bind_game", "matrix_update_game",
                              "matrix_set_display", "matrix_remove_display",
                              "matrix_set_rigid_body", "matrix_remove_rigid_body",
                              "matrix_set_gravity",
                              "matrix_set_control", "matrix_remove_control",
                              "matrix_activate_control",
                              "matrix_begin_grab", "matrix_move_grab", "matrix_release_grab",
                              "matrix_start_new_world", "matrix_restore_world_archive",
                              "matrix_bind_animation", "matrix_publish_component", "matrix_attach_component",
                              "matrix_stop_component", "matrix_remove_component",
                              "matrix_set_physics", "matrix_remove_physics",
                              "matrix_set_interaction", "matrix_remove_interaction"}
            for policy, expected_count in (("on-request", len(prompted_tools)), ("never", 0)):
                with self.subTest(policy=policy), patch("agent_session.AppServerTransport") as transport:
                    config = CodexConfig(str(executable), agent_sandbox="danger-full-access",
                                         agent_approval_policy=policy)
                    backend = LocalCodexAgentBackend(config, folder, bridge)
                    command = transport.call_args.args[0]
                    advertised = next(part.split("=", 1)[1] for part in command
                                      if part.startswith("mcp_servers.matrix_webxr.enabled_tools="))
                    self.assertEqual(list(backend.enabled_matrix_tools), json.loads(advertised))
                    prompt = [part for part in command if '.approval_mode="prompt"' in part]
                    self.assertEqual(len(prompt), expected_count)
                    names = {part.split(".tools.", 1)[1].split(".approval_mode", 1)[0]
                             for part in prompt}
                    self.assertEqual(names, prompted_tools if policy == "on-request" else set())
                    self.assertIn('mcp_servers.matrix_webxr.default_tools_approval_mode="auto"', command)
                    self.assertEqual(backend.approval_mode,
                                     "automatic" if policy == "never" else "reviewed")
                    backend.start_conversation()
                    backend.resume_conversation("thread-1")
                    self.assertEqual(transport.return_value.thread_start.call_args.kwargs["approval_policy"],
                                     policy)
                    self.assertEqual(transport.return_value.thread_resume.call_args.kwargs["approval_policy"],
                                     policy)

    def test_matrix_mcp_dependency_is_checked_before_starting_codex(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / "codex.exe"
            executable.write_bytes(b"MZ test")
            config = CodexConfig(str(executable))
            bridge = SimpleNamespace(url="http://127.0.0.1:1234/scene", token="PC-only")
            with patch("agent_session.AppServerTransport") as transport, \
                    patch("agent_session.importlib.import_module", side_effect=ImportError("missing mcp")):
                backend = LocalCodexAgentBackend(config, folder, bridge)
                with self.assertRaisesRegex(MatrixMCPUnavailableError,
                                            "requirements-agent-mcp.txt"):
                    backend.start()
                transport.return_value.start.assert_not_called()

            with patch("agent_session.AppServerTransport") as transport, \
                    patch("agent_session.importlib.import_module", return_value=object()) as importer:
                backend = LocalCodexAgentBackend(config, folder, bridge)
                backend.start()
                self.assertEqual(importer.call_count, 2)
                transport.return_value.start.assert_called_once_with()

            with patch("agent_session.AppServerTransport") as transport, \
                    patch("agent_session.importlib.import_module", side_effect=ImportError("missing mcp")):
                backend = LocalCodexAgentBackend(config, folder)
                backend.start()
                transport.return_value.start.assert_called_once_with()

    def test_normalizer_drops_tool_arguments_and_credentials(self):
        backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
        backend.config = SimpleNamespace(model="model-test", reasoning_effort="medium",
                                         agent_sandbox="workspace-write", agent_approval_policy="on-request")
        backend.transport = FakeTransport()
        self.assertEqual(backend.start_conversation(), "thread-1")
        self.assertEqual(backend.resume_conversation("thread-1"), "thread-1")
        self.assertIn(("start", "model-test", "workspace-write", "on-request"), backend.transport.calls)
        self.assertIn(("resume", "thread-1", "workspace-write", "on-request"), backend.transport.calls)
        self.assertEqual(backend.send_text("thread-1", "Hello"), "turn-1")
        self.assertIn(("send", "thread-1", "Hello", "medium", "workspace-write",
                       "on-request", None, None), backend.transport.calls)
        events = backend.events_since(0)
        self.assertEqual([event["type"] for event in events],
                         ["text", "activity", "approval", "activity"])
        self.assertEqual(events[1]["activity"], "using_blender")
        self.assertEqual(events[2]["action"], "running_command")
        self.assertTrue(all(event["conversationId"] == "thread-1" for event in events))
        self.assertNotIn("secret", str(events))
        approvals = backend.pending_approvals()
        self.assertEqual(approvals[0]["approvalId"], 42)
        self.assertEqual(approvals[0]["conversationId"], "thread-1")
        self.assertFalse(approvals[0]["reviewable"])
        self.assertNotIn("secret", str(approvals))
        cursor, polled = backend.poll(0)
        self.assertEqual(cursor, 5)
        self.assertEqual(polled, events)
        backend.decide(42, "thread-1", "turn-1", False)
        backend.cancel("thread-1", "turn-1")
        self.assertIn(("approval", 42, "thread-1", "turn-1", "decline"), backend.transport.calls)
        self.assertIn(("interrupt", "thread-1", "turn-1"), backend.transport.calls)

    def test_native_image_turn_restricts_then_restores_automatic_agent_policy(self):
        backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
        backend.config = SimpleNamespace(agent_sandbox="danger-full-access",
                                         agent_approval_policy="never", reasoning_effort="high")
        backend.transport = FakeTransport()
        self.assertEqual(backend.start_native_image("thread-1", "$imagegen A blue orb"), "turn-1")
        self.assertEqual(backend.send_text("thread-1", "Build the selected concept"), "turn-1")
        image, ordinary = [call for call in backend.transport.calls if call[0] == "send"]
        self.assertEqual(image[4:6], ("read-only", "on-request"))
        self.assertEqual(ordinary[4:6], ("danger-full-access", "never"))

    def test_only_known_activity_and_complete_text(self):
        self.assertIsNone(normalize_event({"sequence": 1, "method": "unknown", "params": {"token": "secret"}}))
        event = normalize_event({"sequence": 1, "method": "item/agentMessage/delta",
                                 "params": {"threadId": "thread-1", "delta": "x" * 9000}})
        self.assertEqual(len(event["text"]), 9000)
        cancelled = normalize_event({"sequence": 2, "method": "turn/completed",
                                     "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "interrupted"}}})
        self.assertEqual(cancelled["activity"], "cancelled")
        with self.assertRaises(ValueError):
            backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
            backend.transport = FakeTransport()
            backend.decide(42, "thread-1", "turn-1", "yes")

    def test_only_one_new_literal_file_inside_repo_has_xr_approval_summary(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / "approval-test.txt"
            command = f"[System.IO.File]::WriteAllText('{target}', 'test')"
            summary, reviewable = _approval_description(
                "item/commandExecution/requestApproval", {"command": command}, root)
            self.assertTrue(reviewable)
            self.assertIn("approval-test.txt", summary)
            self.assertNotIn(str(root), summary)
            self.assertNotIn("'test'", summary)
            bundled = root / "codex-runtimes" / "runtime" / "dependencies" / "native" / "powershell" / "pwsh.exe"
            wrapped = f'"{bundled}" -Command "{command}"'
            self.assertTrue(_approval_description(
                "item/commandExecution/requestApproval", {"command": wrapped}, root)[1])
            untrusted_shell = f'"{root / "pwsh.exe"}" -Command "{command}"'
            self.assertFalse(_approval_description(
                "item/commandExecution/requestApproval", {"command": untrusted_shell}, root)[1])
            for unsafe in (command + "; Remove-Item secret", "echo secret",
                           f"[System.IO.File]::WriteAllText('{root.parent / 'outside.txt'}', 'test')"):
                _, reviewable = _approval_description(
                    "item/commandExecution/requestApproval", {"command": unsafe}, root)
                self.assertFalse(reviewable)
            target.write_text("existing", encoding="utf-8")
            self.assertFalse(_approval_description(
                "item/commandExecution/requestApproval", {"command": command}, root)[1])

    def test_mcp_approval_is_redacted_and_only_known_read_tool_is_reviewable(self):
        params = {"threadId": "thread-1", "turnId": "turn-1", "serverName": "matrix_webxr",
                  "mode": "form", "message": 'Allow the matrix_webxr MCP server to run tool "matrix_scene_summary"?',
                  "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {},
                            "secret": "never-forward"}}
        summary, reviewable = _mcp_approval_description(params)
        self.assertTrue(reviewable)
        self.assertNotIn("secret", summary)
        event = normalize_event({"sequence": 1, "method": "mcpServer/elicitation/request",
                                 "requestId": 777, "params": params})
        self.assertEqual(event["action"], "using_tool")
        self.assertNotIn("secret", str(event))
        self.assertFalse(_mcp_approval_description({**params, "serverName": "blender"})[1])
        self.assertFalse(_mcp_approval_description({**params, "message": "run some other tool"})[1])
        self.assertFalse(_mcp_approval_description({**params, "_meta": {**params["_meta"],
                                                                          "tool_params": {"path": "secret"}}})[1])
        backend = LocalCodexAgentBackend.__new__(LocalCodexAgentBackend)
        backend.transport = FakeTransport()
        backend.transport.pending_approvals = lambda: [{"requestId": 777,
            "method": "mcpServer/elicitation/request", "params": params}]
        safe = backend.pending_approvals()[0]
        self.assertEqual(safe["action"], "using_tool")
        self.assertTrue(safe["reviewable"])
        self.assertNotIn("secret", str(safe))

    def test_scale_tool_approval_describes_only_reviewed_proposal(self):
        params = {"serverName": "matrix_webxr", "mode": "form",
                  "message": 'Allow the matrix_webxr MCP server to run tool "matrix_scale_block"?',
                  "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {
                      "room_id": "web-virtual-room-v1", "scene_revision": 4,
                      "object_id": "block-1", "factors": {"x": 2, "y": 3, "z": 4}}}}
        summary, reviewable = _mcp_approval_description(params)
        self.assertTrue(reviewable)
        self.assertIn("owner must still review and Apply", summary)
        self.assertIn("X=2, Y=3, Z=4", summary)
        unsafe = {**params, "_meta": {**params["_meta"], "tool_params": {
            **params["_meta"]["tool_params"], "factors": {"x": 5, "y": 3, "z": 4}}}}
        self.assertFalse(_mcp_approval_description(unsafe)[1])

    def test_creator_tool_approvals_are_bounded_and_describe_the_intent(self):
        def approval(tool, arguments):
            return _mcp_approval_description({
                "serverName": "matrix_webxr", "mode": "form",
                "message": f'Allow the matrix_webxr MCP server to run tool "{tool}"?',
                "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": arguments}})

        common = {"room_id": "web-virtual-room-v1", "scene_revision": 12}
        pose = {"position": {"x": 1, "y": 0, "z": -2},
                "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 1, "y": 1, "z": 1}}
        body = {"schemaVersion": 1, "type": "dynamic", "collider": "bounds-box",
                "restitution": .2, "friction": .8, "sensor": False}
        display = {"schemaVersion": 1, "title": "Challenge",
                   "body": "Deliver the blocks.", "binding": {"kind": "game-progress"}}
        spec = {"schemaVersion": 2, "kind": "game", "title": "Delivery",
                "summary": "Deliver two blocks to the zone.",
                "roles": [{"roleId": "cargo", "kind": "pickup", "assetId": "block", "count": 2},
                          {"roleId": "zone", "kind": "delivery-zone", "assetId": "pedestal", "count": 1},
                          {"roleId": "exit", "kind": "exit", "assetId": "wall", "count": 1}],
                "rules": [{"event": "release-near", "actorRoleId": "cargo",
                           "targetRoleId": "zone", "distanceMeters": 1, "scorePoints": 10}],
                "objectives": [{"kind": "delivered-count", "roleId": "cargo", "targetCount": 2}],
                "consequences": [{"kind": "unlock", "roleId": "exit"}]}
        bindings = {"cargo": ["block-one", "block-two"], "zone": ["zone-one"],
                    "exit": ["exit-one"]}
        inspection = "a" * 32
        grab = {"room_id": common["room_id"], "object_id": "block-one",
                "inspection_request_id": inspection}
        grab_pose = {"position": {"x": 2, "y": 1, "z": -2},
                     "rotation": {"x": 0, "y": 45, "z": 0}}
        cases = {
            "matrix_spawn_builtin": ({**common, "asset_id": "block", "transform": pose}, "Spawn built-in block"),
            "matrix_create_procedural": ({**common, "generator_id": "parametric-bridge",
                "parameters": {"width": 2, "rail": True}, "transform": pose}, "params"),
            "matrix_update_procedural": ({**common, "object_id": "ramp-one",
                "expected_source_revision": "rev-a", "parameters_patch": {"width": 3}}, "Regenerate ramp-one"),
            "matrix_bind_game": ({**common, "spec": spec, "bindings": bindings}, "release-near"),
            "matrix_update_game": ({**common, "spec": spec, "bindings": bindings}, "Revise"),
            "matrix_set_display": ({**common, "object_id": "board-one", "display": display}, "Deliver the blocks"),
            "matrix_remove_display": ({**common, "object_id": "board-one"}, "Remove display"),
            "matrix_set_rigid_body": ({**common, "object_id": "block-one", "rigid_body": body}, "friction 0.8"),
            "matrix_remove_rigid_body": ({**common, "object_id": "block-one"}, "Remove rigid body"),
            "matrix_set_gravity": ({**common, "gravity": {"x": 0, "y": -9.81, "z": 0}}, "-9.81"),
            "matrix_begin_grab": (grab, inspection),
            "matrix_move_grab": ({**grab, "target_pose": grab_pose}, "45"),
            "matrix_release_grab": (grab, "Release block-one")}
        cases.update({
            "matrix_start_new_world": ({**common, "archive_name": "Gravity Lab"},
                                        "Gravity Lab"),
            "matrix_restore_world_archive": ({**common,
                "archive_id": "c71c91e5-bf36-4670-bc19-b0e929ef6b21",
                "archive_name": "Current world"}, "c71c91e5-bf36")})
        for tool, (arguments, expected) in cases.items():
            with self.subTest(tool=tool):
                summary, reviewable = approval(tool, arguments)
                self.assertTrue(reviewable, summary)
                self.assertLessEqual(len(summary), 240)
                self.assertIn(expected, summary)
                self.assertNotIn("secret", summary)

    def test_creator_tool_approvals_reject_unreviewable_or_malformed_requests(self):
        def allowed(tool, arguments):
            return _mcp_approval_description({
                "serverName": "matrix_webxr", "mode": "form",
                "message": f'Allow the matrix_webxr MCP server to run tool "{tool}"?',
                "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": arguments}})[1]

        common = {"room_id": "web-virtual-room-v1", "scene_revision": 1}
        pose = {"position": {"x": 0, "y": 0, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 1, "y": 1, "z": 1}}
        self.assertFalse(allowed("matrix_spawn_builtin", {**common, "asset_id": "matrix:procedural", "transform": pose}))
        self.assertFalse(allowed("matrix_spawn_builtin", {**common, "asset_id": "block", "transform": {**pose, "extra": 1}}))
        self.assertFalse(allowed("matrix_create_procedural", {**common, "generator_id": "bridge",
            "parameters": {"width": float("nan")}, "transform": pose}))
        self.assertFalse(allowed("matrix_update_procedural", {**common, "object_id": "ramp",
            "expected_source_revision": "rev-a", "parameters_patch": {}}))
        self.assertFalse(allowed("matrix_set_display", {**common, "object_id": "board",
            "display": {"schemaVersion": 1, "title": "Board", "body": "x" * 600, "binding": None}}))
        self.assertFalse(allowed("matrix_set_rigid_body", {**common, "object_id": "block",
            "rigid_body": {"schemaVersion": 1, "type": "dynamic", "collider": "bounds-box",
                           "restitution": 0, "friction": 1, "sensor": True}}))
        self.assertFalse(allowed("matrix_set_gravity", {**common, "gravity": {"x": 0, "y": -40, "z": 0}}))
        self.assertFalse(allowed("matrix_move_grab", {"room_id": common["room_id"],
            "object_id": "block", "inspection_request_id": "bad", "target_pose": {
                "position": {"x": 0, "y": 1, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0}}}))
        self.assertFalse(allowed("matrix_remove_display", {**common, "object_id": "board", "extra": True}))
        self.assertFalse(allowed("matrix_remove_rigid_body", {**common, "object_id": "board", "scene_revision": True}))
        self.assertFalse(allowed("matrix_start_new_world", {**common, "archive_name": " "}))
        self.assertFalse(allowed("matrix_restore_world_archive", {**common,
            "archive_id": "missing", "archive_name": "Current world"}))
        spec = {"schemaVersion": 2, "kind": "game", "title": "Delivery", "summary": "Deliver one block.",
                "roles": [{"roleId": "cargo", "kind": "pickup", "assetId": "block", "count": 1},
                          {"roleId": "zone", "kind": "delivery-zone", "assetId": "pedestal", "count": 1}],
                "rules": [{"event": "release-near", "actorRoleId": "cargo",
                           "targetRoleId": "zone", "distanceMeters": 1, "scorePoints": 10}],
                "objectives": [{"kind": "delivered-count", "roleId": "cargo", "targetCount": 1}],
                "consequences": []}
        self.assertFalse(allowed("matrix_bind_game", {**common, "spec": spec,
            "bindings": {"cargo": ["same-id"], "zone": ["same-id"]}}))
        self.assertFalse(allowed("matrix_update_game", {**common,
            "spec": {**spec, "rules": [{**spec["rules"][0], "scorePoints": 1001}]},
            "bindings": {"cargo": ["a"], "zone": ["b"]}}))

    def test_two_specimen_game_approval_shows_both_rules_and_objectives(self):
        spec = {"schemaVersion": 2, "kind": "game", "title": "Gravity Lab Delivery",
                "summary": "Deliver the cube and orb to unlock the exit.",
                "roles": [{"roleId": "cube", "kind": "pickup", "assetId": "block", "count": 1},
                          {"roleId": "orb", "kind": "pickup", "assetId": "orb", "count": 1},
                          {"roleId": "receptacle", "kind": "delivery-zone", "assetId": "pedestal", "count": 1},
                          {"roleId": "exit", "kind": "exit", "assetId": "wall", "count": 1}],
                "rules": [{"event": "release-near", "actorRoleId": role,
                           "targetRoleId": "receptacle", "distanceMeters": 1, "scorePoints": 10}
                          for role in ("cube", "orb")],
                "objectives": [{"kind": "delivered-count", "roleId": role, "targetCount": 1}
                               for role in ("cube", "orb")],
                "consequences": [{"kind": "unlock", "roleId": "exit"}]}
        bindings = {"cube": ["adb88c5f7279483db7ba88c43a7fc783"],
                    "orb": ["84ea5751b5a840e88d926b0a6c2ad85a"],
                    "receptacle": ["c3b18d31c8274246813e1b76c9656a0f"],
                    "exit": ["f04de84e0b1140ffa7e5be217a13cd2f"]}
        params = {"serverName": "matrix_webxr", "mode": "form",
                  "message": 'Allow the matrix_webxr MCP server to run tool "matrix_bind_game"?',
                  "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {
                      "room_id": "web-virtual-room-v1", "scene_revision": 95,
                      "spec": spec, "bindings": bindings}}}
        summary, reviewable = _mcp_approval_description(params)
        raw = _xr_game_summary("matrix_bind_game", params["_meta"]["tool_params"])
        self.assertTrue(reviewable, f"{summary}; raw length={len(raw) if raw else None}: {raw}")
        self.assertLessEqual(len(summary), 240)
        for phrase in ("release-near cube|orb->receptacle", "deliver cube>=1,orb>=1",
                       "cube/block@adb88c5f", "orb/orb@84ea5751",
                       "receptacle/pedestal@c3b18d31", "exit/wall@f04de84e",
                       "4 IDs SHA", "unlock exit"):
            self.assertIn(phrase, summary)
        changed = {**params, "_meta": {**params["_meta"], "tool_params": {
            **params["_meta"]["tool_params"], "bindings": {
                **bindings, "cube": ["bdb88c5f7279483db7ba88c43a7fc783"]}}}}
        changed_summary, changed_reviewable = _mcp_approval_description(changed)
        self.assertTrue(changed_reviewable)
        self.assertIn("cube/block@bdb88c5f", changed_summary)
        self.assertNotEqual(summary, changed_summary)
        collisions = {**params, "_meta": {**params["_meta"], "tool_params": {
            **params["_meta"]["tool_params"], "bindings": {
                **bindings, "cube": ["aaaaaaaaaaaaaaaa1"],
                "orb": ["aaaaaaaaaaaaaaaa2"]}}}}
        self.assertFalse(_mcp_approval_description(collisions)[1])
        self.assertFalse(_mcp_approval_description({**params, "_meta": {
            **params["_meta"], "tool_params": {**params["_meta"]["tool_params"],
                "spec": {**spec, "objectives": spec["objectives"] + [spec["objectives"][0]]}}}})[1])

    def test_exit_display_without_binding_remains_unreviewable(self):
        display = {"schemaVersion": 1, "title": "Exit Marker",
                   "body": "When the challenge is active, deliver the cube and orb to the pedestal to unlock this exit."}
        params = {"serverName": "matrix_webxr", "mode": "form",
                  "message": 'Allow the matrix_webxr MCP server to run tool "matrix_set_display"?',
                  "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {
                      "room_id": "web-virtual-room-v1", "scene_revision": 95,
                      "object_id": "f04de84e0b1140ffa7e5be217a13cd2f", "display": display}}}
        self.assertFalse(_mcp_approval_description(params)[1])
        valid = {**params, "_meta": {**params["_meta"], "tool_params": {
            **params["_meta"]["tool_params"], "display": {**display, "binding": None}}}}
        summary, reviewable = _mcp_approval_description(valid)
        self.assertTrue(reviewable, summary)
        self.assertIn(display["body"], summary)
        self.assertLessEqual(len(summary), 240)


if __name__ == "__main__":
    unittest.main()
