"""Selected concept enters one existing Codex turn; receipts prove provenance."""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
import urllib.error
import zlib

from agent_portal import AgentPortal
from content_catalog import ContentError
from matrix_tool_bridge import MatrixToolBridge, record_concept_build, spawn_builtin
from server import APIError, State, agent_portal_action, concept_build_request


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

    def start(self):
        pass

    def start_conversation(self):
        return "native-thread"

    def resume_conversation(self, identifier):
        return identifier

    def send_text(self, identifier, message, *, image_path=None):
        self.sent.append((identifier, message, image_path))
        return "native-turn"

    def poll(self, cursor):
        return cursor, []

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

    def build(self, request="Now build this in the Matrix"):
        return agent_portal_action(self.state, "/api/agent/turn",
                                   {"sessionId": self.session_id, "text": request,
                                    "context": self.context()})

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
                        "Use version 2", "Show this image"):
            self.assertFalse(concept_build_request(request), request)
        for request in ("Build this spaceship", "Make this in Blender",
                        "Create this around what's already here", "Use this design"):
            self.assertTrue(concept_build_request(request), request)

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
        self.assertEqual(self.backend.sent, [])
        self.assertEqual(self.state.concepts.status(self.session_id, refresh=False)["builds"], [])

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


if __name__ == "__main__":
    unittest.main()
