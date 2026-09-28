"""Selected concept enters one existing Codex turn; receipts prove provenance."""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path
import subprocess
import struct
import tempfile
import threading
import unittest
import urllib.error
import zlib
from unittest.mock import patch

from agent_portal import AgentPortal, AgentPortalError
from content_catalog import ContentError
from matrix_tool_bridge import MatrixToolBridge, record_concept_build, scale_block, spawn_builtin
from procedural_contract import new_recipe
from blender_authoring import BlenderAuthoringError, blender_executable
from server import (APIError, State, agent_portal_action, concept_build_request,
                    readable_blend_source)
from test_matrix_procedural import GENERATOR
from test_web_assets import glb


def png_pixel():
    def chunk(name, data):
        return (struct.pack(">I", len(data)) + name + data +
                struct.pack(">I", zlib.crc32(name + data) & 0xffffffff))
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) +
            chunk(b"IEND", b""))


POSE = {"position": {"x": 0, "y": 0, "z": -2},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": {"x": 1, "y": 1, "z": 1}}
BOUNDS = {"center": {"x": 0, "y": .5, "z": 0},
          "size": {"x": 1, "y": 1, "z": 1}}


class RecordingBackend:
    access_mode = "workspace-write"
    approval_mode = "reviewed"
    enabled_matrix_tools = ("matrix_scene_summary", "matrix_spawn_builtin",
                            "matrix_spawn_status", "matrix_record_concept_build")

    def __init__(self):
        self.sent = []
        self.events = []

    def start(self):
        pass

    def start_conversation(self):
        return "native-thread"

    def resume_conversation(self, identifier):
        return identifier

    def send_text(self, identifier, message, *, image_path=None):
        self.sent.append((identifier, message, image_path))
        return "native-turn" if len(self.sent) == 1 else f"native-turn-{len(self.sent)}"

    def poll(self, cursor):
        return len(self.events), self.events[cursor:]

    def pending_approvals(self):
        return []

    def pending_pc_commands(self):
        return []

    def cancel(self, *_):
        pass

    def close(self):
        pass


class ConceptHandoffTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state = State(self.root / "state", web_assets_directory=self.root / "assets")
        self.backend = RecordingBackend()
        self.state.agent_portal = AgentPortal(self.state.directory / ".agent_portal",
                                               lambda: self.backend)
        self.addCleanup(self.state.agent_portal.close)
        self.session_id = self.state.agent_portal.open()["sessionId"]
        self.concept_id = "a" * 32
        data = png_pixel()
        self.digest = hashlib.sha256(data).hexdigest()
        self.image = self.state.concepts.images / (self.digest + ".png")
        self.image.write_bytes(data)
        def save(document):
            document["sessions"][self.session_id] = {
                "selectedConceptId": self.concept_id,
                "jobs": [{"conceptId": self.concept_id, "version": 2,
                          "parentConceptId": "b" * 32, "status": "ready",
                          "imageFile": self.image.name, "sha256": self.digest,
                          "mimeType": "image/png", "prompt": "Forest temple",
                          "designNotes": "Keep the old grove visible.",
                          "workflowId": "krea2-turbo", "model": ["Krea2"], "seed": 42,
                          "generationMode": "text-to-image"}], "builds": []}
        self.state.concepts._change(save)
        self.room = {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": []},
                     "assets": [{"assetId": "block", "displayName": "Block", "localBounds": BOUNDS}],
                     "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
                     "creatorMode": {"schemaVersion": 1, "mode": "creator",
                                     "simulation": "paused", "revision": 0},
                     "roomContext": {"mode": "white-room", "state": "ready",
                                     "alignmentVerified": False, "message": "Virtual room"},
                     "runtimeDescriptor": {"schemaVersion": 1, "client": "matrix-web",
                                           "renderer": "threejs-webxr", "presentation": "desktop"}}
        self.exchange()

    def exchange(self, *, result=None):
        self.state.exchange({"clientId": "browser", "snapshot": copy.deepcopy(self.room),
                             "results": [result] if result else []})

    def context(self):
        return {"schemaVersion": 1, "inputSource": "text", "clientId": "browser",
                "roomId": self.room["scene"]["roomId"], "selectedObjectId": None,
                "pointingTarget": None, "viewerFrame": None}

    def build(self, request="Now build this in the Matrix", **expected):
        return agent_portal_action(self.state, "/api/agent/turn",
                                   {"sessionId": self.session_id, "text": request,
                                    "context": self.context(), **expected})

    def observed_spawn(self, asset_id, object_id, *, builtin=False):
        request = {"room_id": self.room["scene"]["roomId"],
                   "scene_revision": self.state.revision, "asset_id": asset_id,
                   "transform": copy.deepcopy(POSE)}
        queued = (self.state.agent_spawn_builtin(request) if builtin
                  else self.state.agent_spawn(request))
        self.room["scene"]["objects"].append({"objectId": object_id,
            "assetId": asset_id, "anchorId": "web-floor", "transform": copy.deepcopy(POSE)})
        self.exchange(result={"requestId": queued["requestId"], "ok": True,
                              "error": "", "objectId": object_id})
        self.assertEqual(self.state.agent_spawn_status(queued["requestId"])["status"], "succeeded")
        return queued["requestId"]

    def build_result(self, build, receipt_id, object_id, asset_id, **extra):
        return {"build_request_id": build["buildRequestId"], "concept_id": self.concept_id,
                "strategy": "verified Matrix creation", "receipt_ids": [receipt_id],
                "object_ids": [object_id], "asset_ids": [asset_id], **extra}

    def test_selected_image_and_scene_enter_same_existing_agent_turn(self):
        result = self.build()
        self.assertEqual(result["turnId"], "native-turn")
        self.assertEqual(len(self.backend.sent), 1)
        _, message, image_path = self.backend.sent[0]
        self.assertEqual(Path(image_path).read_bytes(), png_pixel())
        self.assertTrue(message.endswith("User request:\nNow build this in the Matrix"))
        self.assertIn('"conceptId":"' + self.concept_id + '"', message)
        self.assertIn('"parentConceptId":"' + "b" * 32 + '"', message)
        self.assertIn('"designNotes":"Keep the old grove visible."', message)
        self.assertIn('"sceneRevision":', message)
        self.assertIn('"objectCount":0', message)
        self.assertIn("matrix_record_concept_build", message)
        self.assertNotIn(str(self.image), str(result))
        builds = self.state.concepts.status(self.session_id, refresh=False)["builds"]
        self.assertEqual(builds[0]["buildRequestId"], result["buildRequestId"])
        self.assertEqual(builds[0]["conceptId"], self.concept_id)
        self.assertEqual(builds[0]["status"], "requested")
        self.assertEqual(builds[0]["turnId"], "native-turn")

    def test_image_only_and_selection_phrases_do_not_trigger_build(self):
        for request in ("Create an image of a forest temple", "Make another version",
                        "Use version 2", "Show this image", "Place this there",
                        "Build this bridge in Matrix", "Create this spaceship in Matrix",
                        "Build an image viewer"):
            self.assertFalse(concept_build_request(request), request)
        for request in ("Build this", "Build this in Matrix", "Build selected image",
                        "Create this", "Make this",
                        "Make this in Blender", "Create this around what's already here",
                        "Use this design"):
            self.assertTrue(concept_build_request(request), request)

    def test_expected_concept_must_match_current_selection(self):
        with self.assertRaisesRegex(APIError, "Selected concept changed"):
            self.build("Create this", expectedConceptId="b" * 32,
                       expectedConceptVersion=2)
        with self.assertRaisesRegex(APIError, "Selected concept changed"):
            self.build("Create this", expectedConceptId=self.concept_id,
                       expectedConceptVersion=1)
        self.assertEqual(self.backend.sent, [])
        self.assertEqual(self.state.concepts.status(self.session_id, refresh=False)["builds"], [])
        self.build("Create this", expectedConceptId=self.concept_id,
                   expectedConceptVersion=2)
        self.assertEqual(Path(self.backend.sent[0][2]).read_bytes(), png_pixel())

    def test_creation_mode_reaches_same_agent_and_durable_build_record(self):
        result = self.build("Make this in Blender", expectedConceptId=self.concept_id,
                            expectedConceptVersion=2, creationMode="blender")
        self.assertIn('"creationMode":"blender"', self.backend.sent[0][1])
        self.assertIn("editable Blender source", self.backend.sent[0][1])
        self.assertEqual(self.state.concepts.build_provenance(
            self.session_id, result["buildRequestId"])["creationMode"], "blender")

    def test_creation_mode_rejects_invalid_or_non_concept_turn(self):
        with self.assertRaisesRegex(APIError, "Invalid concept creation mode"):
            self.build("Build this", creationMode="automatic")
        with self.assertRaisesRegex(APIError, "Concept build options require"):
            self.build("Build this bridge", creationMode="blender")
        self.assertEqual(self.backend.sent, [])

    def test_procedural_mode_rejects_a_verified_builtin_spawn(self):
        build = self.build("Create this", creationMode="procedural")
        receipt_id = self.observed_spawn("block", "builtin-1", builtin=True)
        with self.assertRaisesRegex(APIError, "Procedural creation mode needs"):
            self.state.agent_record_concept_build(self.build_result(
                build, receipt_id, "builtin-1", "block"))
        self.assertEqual(self.state.concepts.build_provenance(
            self.session_id, build["buildRequestId"])["status"], "requested")

    def test_procedural_mode_accepts_only_a_verified_generator_create(self):
        self.room["assets"].append({"assetId": "matrix:procedural",
                                    "displayName": "Procedural object"})
        self.room["proceduralGenerators"] = [copy.deepcopy(GENERATOR)]
        self.exchange()
        build = self.build("Create this", creationMode="procedural")
        queued = self.state.agent_procedural_action({
            "action": "create", "room_id": self.room["scene"]["roomId"],
            "scene_revision": self.state.revision, "generator_id": "bridge",
            "parameters": {"lengthMeters": 7}, "transform": copy.deepcopy(POSE)})
        self.room["scene"]["objects"].append({
            "objectId": "bridge-1", "assetId": "matrix:procedural",
            "anchorId": "web-floor", "transform": copy.deepcopy(POSE),
            "procedural": new_recipe([GENERATOR], "bridge", {"lengthMeters": 7})})
        self.exchange(result={"requestId": queued["requestId"], "ok": True,
                              "error": "", "objectId": "bridge-1"})
        self.assertEqual(self.state.agent_procedural_status(queued["requestId"])["status"],
                         "succeeded")
        recorded = self.state.agent_record_concept_build(self.build_result(
            build, queued["requestId"], "bridge-1", "matrix:procedural"))
        self.assertEqual(recorded["status"], "completed")
        self.assertEqual(recorded["creationMode"], "procedural")

    def test_blender_mode_rejects_a_verified_builtin_spawn(self):
        build = self.build("Create this", creationMode="blender")
        receipt_id = self.observed_spawn("block", "builtin-1", builtin=True)
        with self.assertRaisesRegex(APIError, "Blender creation mode needs registered GLB"):
            self.state.agent_record_concept_build(self.build_result(
                build, receipt_id, "builtin-1", "block"))

    def test_blender_mode_requires_matching_registered_glb_and_editable_source(self):
        self.state.directory.mkdir(parents=True, exist_ok=True)
        source_glb = self.state.directory / "bridge.glb"
        source_glb.write_bytes(glb())
        build = self.build("Create this", creationMode="blender")
        asset = self.state.web_assets.register(source_glb, "Blender bridge")
        self.room["assets"].append({"assetId": asset["assetId"],
                                    "displayName": asset["displayName"]})
        self.exchange()
        receipt_id = self.observed_spawn(asset["assetId"], "blender-1")
        value = self.build_result(build, receipt_id, "blender-1", asset["assetId"])
        with self.assertRaisesRegex(APIError, "editable .blend source"):
            self.state.agent_record_concept_build(value)
        blend = self.state.directory / "bridge.blend"
        blend.write_bytes(b"not a Blender project")
        value["source_paths"] = [str(blend), str(source_glb)]
        with self.assertRaisesRegex(APIError, "not a readable .blend file"):
            self.state.agent_record_concept_build(value)
        blend.write_bytes(b"BLENDER-v300" + b"\x00" * 32)
        with patch("server.blender_executable", return_value="blender.exe"), \
             patch("server.subprocess.run", return_value=subprocess.CompletedProcess([], 1, b"", b"invalid")):
            with self.assertRaisesRegex(APIError, "not a readable .blend file"):
                self.state.agent_record_concept_build(value)
        wrong_glb = self.state.directory / "other.glb"
        wrong_glb.write_bytes(b"different export")
        value["source_paths"] = [str(blend), str(wrong_glb)]
        # The following assertions isolate GLB receipt/hash validation; raw
        # Blender readability is exercised with an actual save below.
        with patch("server.readable_blend_source", return_value=True):
            with self.assertRaisesRegex(APIError, "does not match the spawned registered asset"):
                self.state.agent_record_concept_build(value)
            value["source_paths"] = [str(blend), str(source_glb)]
            recorded = self.state.agent_record_concept_build(value)
        self.assertEqual(recorded["status"], "completed")
        self.assertEqual(recorded["creationMode"], "blender")

    def test_real_raw_blend_source_must_open_in_blender(self):
        try:
            executable = blender_executable()
        except BlenderAuthoringError:
            self.skipTest("Blender is unavailable for raw-source validation")
        self.state.directory.mkdir(parents=True, exist_ok=True)
        blend = self.state.directory / "raw-source.blend"
        command = [executable, "--background", "--factory-startup", "--disable-autoexec",
                   "--python-expr", "import bpy; bpy.ops.wm.save_as_mainfile(filepath=" +
                   repr(str(blend)) + ", compress=False)"]
        created = subprocess.run(command, cwd=blend.parent, capture_output=True, timeout=60)
        self.assertEqual(created.returncode, 0, created.stderr.decode("utf-8", errors="replace"))
        with blend.open("rb") as source:
            self.assertEqual(source.read(7), b"BLENDER")
        self.assertTrue(readable_blend_source(blend))
        with patch("server.MAX_BLEND_SOURCE_BYTES", 8), \
             patch("server.subprocess.run") as run:
            self.assertFalse(readable_blend_source(blend))
            run.assert_not_called()
        blend.write_bytes(b"BLENDER-v300" + b"\x00" * 32)
        self.assertFalse(readable_blend_source(blend))

    def test_blender_mode_accepts_tracked_compressed_source(self):
        try:
            blender_executable()
        except BlenderAuthoringError:
            self.skipTest("Blender is unavailable for compressed-source validation")
        art = Path(__file__).resolve().parent.parent / "WebRuntime" / "art"
        blend = art / "concept-v4-garden-bridge-animated.blend"
        source_glb = art / "concept-v4-garden-bridge-animated.glb"
        self.assertEqual(blend.read_bytes()[:4], b"\x28\xb5\x2f\xfd")
        build = self.build("Create this", creationMode="blender")
        asset = self.state.web_assets.register(source_glb, "Animated Blender bridge")
        self.room["assets"].append({"assetId": asset["assetId"],
                                    "displayName": asset["displayName"]})
        self.exchange()
        receipt_id = self.observed_spawn(asset["assetId"], "blender-zstd-1")
        value = self.build_result(build, receipt_id, "blender-zstd-1", asset["assetId"])
        value["source_paths"] = [str(blend), str(source_glb)]
        recorded = self.state.agent_record_concept_build(value)
        self.assertEqual(recorded["status"], "completed")
        self.assertEqual(recorded["creationMode"], "blender")

    def test_compressed_blend_requires_exact_loaded_source_and_size_bound(self):
        self.state.directory.mkdir(parents=True, exist_ok=True)
        blend = self.state.directory / "source.blend"
        other = self.state.directory / "other.blend"
        blend.write_bytes(b"\x28\xb5\x2f\xfd" + b"invalid zstd frame")
        other.write_bytes(b"BLENDER-v300")
        completed = subprocess.CompletedProcess([], 0,
            b"MATRIX_BLEND_SOURCE=" + str(other).encode() + b"\n", b"")
        with patch("server.blender_executable", return_value="blender.exe"), \
             patch("server.subprocess.run", return_value=completed) as run:
            self.assertFalse(readable_blend_source(blend))
        command = run.call_args.args[0]
        self.assertIn("--disable-autoexec", command)
        self.assertIn(str(blend), command)
        self.assertEqual(run.call_args.kwargs["timeout"], 60)
        with patch("server.MAX_BLEND_SOURCE_BYTES", 8), \
             patch("server.subprocess.run") as run:
            self.assertFalse(readable_blend_source(blend))
            run.assert_not_called()

    def test_explicit_version_must_match_persisted_selection(self):
        with self.assertRaisesRegex(APIError, "not selected"):
            self.build("Build version 1 in the Matrix")
        self.assertEqual(self.backend.sent, [])
        self.assertEqual(self.state.concepts.status(self.session_id, refresh=False)["builds"], [])
        self.build("Build version two in the Matrix")
        self.assertEqual(len(self.backend.sent), 1)

    def test_explicit_version_with_no_selection_asks_to_select_first(self):
        def clear(document):
            document["sessions"][self.session_id]["selectedConceptId"] = None
        self.state.concepts._change(clear)
        with self.assertRaisesRegex(APIError, "Select a ready concept version"):
            self.build("Build version 2 in the Matrix")
        with self.assertRaisesRegex(APIError, "Select a ready concept version"):
            self.build("Now build this in the Matrix")
        self.assertEqual(self.backend.sent, [])
        self.assertEqual(self.state.concepts.status(self.session_id, refresh=False)["builds"], [])
        self.build("Create a spaceship in the Matrix")
        self.assertEqual(len(self.backend.sent), 1)
        self.assertIsNone(self.backend.sent[0][2])

    def test_tampered_image_cannot_start_agent_turn(self):
        self.image.write_bytes(self.image.read_bytes() + b"tampered")
        with self.assertRaises(ContentError):
            self.build()
        self.assertEqual(self.backend.sent, [])
        self.assertEqual(self.state.concepts.status(self.session_id, refresh=False)["builds"], [])

    def test_store_maximum_prompt_notes_and_large_model_list_still_handoff(self):
        self.state.concepts._set_fields(self.session_id, self.concept_id,
                                        prompt="p" * 4096, designNotes="n" * 2048,
                                        model=["checkpoint-" + "m" * 150] * 12)
        self.build()
        message = self.backend.sent[0][1]
        self.assertIn('"omittedModelCount":4', message)
        self.assertIn('"prompt":"' + "p" * 4096 + '"', message)
        self.assertIn('"designNotes":"' + "n" * 2048 + '"', message)

    def test_scene_change_blocks_first_typed_mutation_even_with_fresh_revision(self):
        self.build()
        self.room["scene"]["objects"].append({"objectId": "unrelated", "assetId": "block",
                                              "anchorId": "web-floor", "transform": copy.deepcopy(POSE)})
        self.exchange()
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with self.assertRaises(urllib.error.HTTPError) as raised:
            spawn_builtin(bridge.url, bridge.token, {
                "room_id": self.room["scene"]["roomId"], "scene_revision": self.state.revision,
                "asset_id": "block", "transform": copy.deepcopy(POSE)})
        self.assertIn("scene changed while the selected concept",
                      raised.exception.read().decode("utf-8"))
        self.assertEqual(len(self.room["scene"]["objects"]), 1)

    def assert_concurrent_turn_preserves_build_guard(self, contender_text):
        entered = threading.Event()
        release = threading.Event()
        accepted = {}

        def paused_send(*args, **kwargs):
            if entered.is_set():
                raise AgentPortalError(409, "Agent is already working")
            entered.set()
            if not release.wait(5):
                raise TimeoutError("Accepted concept turn was not released")
            return {"turnId": "accepted-turn",
                    "buildRequestId": args[3]["buildRequestId"]}

        def submit_accepted():
            try:
                accepted["result"] = self.build()
            except Exception as error:
                accepted["error"] = error

        with patch.object(self.state.agent_portal, "send_text", side_effect=paused_send):
            worker = threading.Thread(target=submit_accepted)
            worker.start()
            try:
                self.assertTrue(entered.wait(3), "Accepted turn did not reach Agent send")
                guard_id = self.state.concept_build_guard["buildRequestId"]
                with self.assertRaises(AgentPortalError) as raised:
                    agent_portal_action(self.state, "/api/agent/turn",
                                        {"sessionId": self.session_id,
                                         "text": contender_text, "context": self.context()})
                self.assertEqual(raised.exception.status, 409)
                self.assertEqual(self.state.concept_build_guard["buildRequestId"], guard_id)
            finally:
                release.set()
                worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertNotIn("error", accepted)
        self.assertEqual(accepted["result"]["buildRequestId"], guard_id)

        self.room["scene"]["objects"].append({"objectId": "unrelated", "assetId": "block",
                                              "anchorId": "web-floor", "transform": copy.deepcopy(POSE)})
        self.exchange()
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with self.assertRaises(urllib.error.HTTPError) as raised:
            spawn_builtin(bridge.url, bridge.token, {
                "room_id": self.room["scene"]["roomId"], "scene_revision": self.state.revision,
                "asset_id": "block", "transform": copy.deepcopy(POSE)})
        self.assertEqual(raised.exception.code, 409)
        self.assertIn("scene changed while the selected concept",
                      raised.exception.read().decode("utf-8"))

    def test_parallel_plain_turn_cannot_clear_accepted_concept_guard(self):
        self.assert_concurrent_turn_preserves_build_guard("Tell me about the room")

    def test_parallel_concept_turn_cannot_replace_accepted_concept_guard(self):
        self.assert_concurrent_turn_preserves_build_guard("Build this in the Matrix")

    def test_scene_change_blocks_scale_proposal_before_client_review(self):
        self.build()
        self.room["scene"]["objects"].append({"objectId": "unrelated", "assetId": "block",
                                              "anchorId": "web-floor", "transform": copy.deepcopy(POSE)})
        self.exchange()
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        with patch.object(self.state, "agent_scale") as propose:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                scale_block(bridge.url, bridge.token, {
                    "room_id": self.room["scene"]["roomId"],
                    "scene_revision": self.state.revision,
                    "object_id": "unrelated", "factors": [1, 1, 1]})
        self.assertEqual(raised.exception.code, 409)
        self.assertIn("scene changed while the selected concept",
                      raised.exception.read().decode("utf-8"))
        propose.assert_not_called()

    def test_catalog_refresh_then_verified_spawn_records_durable_result(self):
        result = self.build()
        # Loading a just-registered asset can advance the broad revision, but
        # does not alter the request-time object layout.
        self.room["assets"].append({"assetId": "orb", "displayName": "Orb", "localBounds": BOUNDS})
        self.exchange()
        bridge = MatrixToolBridge(self.state)
        self.addCleanup(bridge.close)
        spawned = spawn_builtin(bridge.url, bridge.token, {
            "room_id": self.room["scene"]["roomId"], "scene_revision": self.state.revision,
            "asset_id": "block", "transform": copy.deepcopy(POSE)})
        self.assertEqual(spawned["status"], "queued")
        self.assertIsNone(self.state.concept_build_guard)
        receipt_id = spawned["requestId"]
        with self.assertRaises(urllib.error.HTTPError):
            record_concept_build(bridge.url, bridge.token, {
                "build_request_id": result["buildRequestId"], "concept_id": self.concept_id,
                "strategy": "reused built-in asset", "receipt_ids": [receipt_id],
                "object_ids": ["block-new"], "asset_ids": ["block"]})
        self.room["scene"]["objects"].append({"objectId": "block-new", "assetId": "block",
                                              "anchorId": "web-floor", "transform": copy.deepcopy(POSE)})
        self.exchange(result={"requestId": receipt_id, "ok": True, "error": "",
                              "objectId": "block-new"})
        verified = record_concept_build(bridge.url, bridge.token, {
            "build_request_id": result["buildRequestId"], "concept_id": self.concept_id,
            "strategy": "reused built-in asset", "receipt_ids": [receipt_id],
            "object_ids": ["block-new"], "asset_ids": ["block"]})
        self.assertEqual(verified["status"], "completed")
        self.assertEqual(verified["objectIds"], ["block-new"])
        self.assertEqual(verified["receipts"], [receipt_id])
        self.assertEqual(self.state.concepts.build_provenance(
            self.session_id, result["buildRequestId"])["strategy"], "reused built-in asset")

    def test_terminal_turn_closes_only_its_unverified_build(self):
        first = self.build()
        self.assertEqual(self.state.concepts.reconcile_terminal_builds(
            self.session_id, {"sessionId": self.session_id, "activeTurnId": first["turnId"],
                              "transcript": [{"turnId": "unrelated-turn",
                                              "status": "completed"}]}), [])
        self.backend.events.append({"type": "activity", "conversationId": "native-thread",
                                    "turnId": "unrelated-turn", "activity": "completed"})
        self.state.agent_portal_status(self.session_id)
        self.assertEqual(self.state.concepts.build_provenance(
            self.session_id, first["buildRequestId"])["status"], "requested")

        self.backend.events.append({"type": "activity", "conversationId": "native-thread",
                                    "turnId": first["turnId"], "activity": "completed"})
        self.state.agent_portal_status(self.session_id)
        self.assertEqual(self.state.concepts.build_provenance(
            self.session_id, first["buildRequestId"])["status"], "failed")

        second = self.build()
        receipt_id = self.observed_spawn("block", "verified-new", builtin=True)
        completed = self.state.agent_record_concept_build(self.build_result(
            second, receipt_id, "verified-new", "block"))
        self.assertEqual(completed["status"], "completed")
        self.backend.events.append({"type": "activity", "conversationId": "native-thread",
                                    "turnId": second["turnId"], "activity": "completed"})
        self.state.agent_portal_status(self.session_id)
        builds = self.state.concepts.status(self.session_id, refresh=False)["builds"]
        self.assertEqual([(build["buildRequestId"], build["status"]) for build in builds],
                         [(first["buildRequestId"], "failed"),
                          (second["buildRequestId"], "completed")])


if __name__ == "__main__":
    unittest.main()
