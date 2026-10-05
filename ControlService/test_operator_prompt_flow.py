"""Synthetic two-turn Operator flow through live context and typed Matrix receipts.

The backend records the exact Agent Portal messages. Browser exchanges below are
deliberately simulated; this fixture does not evaluate Codex or visual playback.
"""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from agent_portal import AgentPortal
from matrix_tool_bridge import (MatrixToolBridge, animation_status, bind_animation,
                                list_assets, move_object, move_status, read_scene,
                                spawn_asset, spawn_status)
from server import State, agent_turn_context


DRAGON = Path(__file__).resolve().parent.parent / "WebRuntime" / "art" / "ice-dragon.glb"
ROOM_ID = "web-virtual-room-v1"
OBJECT_ID = "ice-dragon-1"
INITIAL_POSE = {"position": {"x": 0, "y": 1.5, "z": -2},
                "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 0.5, "y": 0.5, "z": 0.5}}
FLIGHT = {"loopClip": "Flight", "selectClip": None}
LOAD_REQUEST = ("Operator, load the existing ice dragon at 0, 1.5, negative 2, "
                "scale 0.5, and bind its flight loop.")
MOVE_REQUEST = ("Move the ice dragon 30 centimeters along the room's positive x-axis "
                "keep its height scale and flight loop report the matrix receipt")


class RecordingBackend:
    """Complete turns without model actions so prompt delivery can be asserted."""

    access_mode = "workspace-write"
    approval_mode = "reviewed"
    enabled_matrix_tools = ("matrix_scene_summary", "matrix_list_assets",
                            "matrix_spawn_asset", "matrix_spawn_status",
                            "matrix_bind_animation", "matrix_animation_status",
                            "matrix_move_object", "matrix_move_status")

    def __init__(self):
        self.sent = []
        self.events = []
        self.starts = 0

    def start(self):
        pass

    def start_conversation(self):
        self.starts += 1
        return "synthetic-codex-thread"

    def resume_conversation(self, identifier):
        return identifier

    def send_text(self, identifier, value):
        self.sent.append((identifier, value))
        turn_id = f"synthetic-turn-{len(self.sent)}"
        self.events.append({"sequence": len(self.events) + 1, "type": "activity",
                            "conversationId": identifier, "turnId": turn_id,
                            "activity": "completed"})
        return turn_id

    def poll(self, cursor):
        return len(self.events), self.events[cursor:]

    def pending_approvals(self):
        return []

    def pending_pc_commands(self):
        return []

    def close(self):
        pass


class OperatorPromptFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = State(root / "state", web_assets_directory=root / "assets")
        self.asset = self.state.web_assets.register(DRAGON, "Ice Dragon")
        self.room = {
            "scene": {"schemaVersion": 1, "roomId": ROOM_ID, "objects": []},
            "assets": [{"assetId": self.asset["assetId"], "displayName": "Ice Dragon",
                        "animationClips": ["Flight", "Frost Burst"]}],
            "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
            "animationSchemaVersion": 1,
            "creatorMode": {"schemaVersion": 1, "mode": "creator",
                            "simulation": "paused", "revision": 0},
            "runtimeDescriptor": {"schemaVersion": 1, "client": "matrix-web",
                                  "renderer": "threejs-webxr", "presentation": "desktop"},
            "roomContext": {"mode": "white-room", "state": "ready",
                            "alignmentVerified": False, "message": "Virtual room"}}
        self.exchange()
        self.bridge = MatrixToolBridge(self.state)
        self.addCleanup(self.bridge.close)
        self.backend = RecordingBackend()
        self.portal = AgentPortal(root / "portal", lambda: self.backend)
        self.addCleanup(self.portal.close)
        self.session_id = self.portal.open()["sessionId"]
        wait = patch("matrix_tool_bridge.MOVE_WAIT", 0.01)
        wait.start()
        self.addCleanup(wait.stop)

    def exchange(self, *, result=None):
        self.state.exchange({"clientId": "web-client", "snapshot": deepcopy(self.room),
                             "results": [result] if result else []})

    def turn(self, request, *, selected=None, input_source="voice_transcript"):
        context = agent_turn_context(self.state, {
            "schemaVersion": 1, "inputSource": input_source, "clientId": "web-client",
            "roomId": ROOM_ID, "selectedObjectId": selected,
            "pointingTarget": None, "viewerFrame": None})
        self.portal.send_text(self.session_id, request, context)
        self.assertEqual(self.portal.status(self.session_id)["activity"], "completed")
        self.assertEqual(self.portal.status(self.session_id)["transcript"][-1]["user"], request)
        message = self.backend.sent[-1][1]
        self.assertTrue(message.endswith("User request:\n" + request))
        self.assertLessEqual(len(message), 16000)
        return context, message

    def spawn_observed_dragon(self):
        current = read_scene(self.bridge.url, self.bridge.token)
        catalog = list_assets(self.bridge.url, self.bridge.token)
        found = [item for item in catalog["assets"]
                 if item["displayName"] == "Ice Dragon"]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["assetId"], self.asset["assetId"])
        self.assertIn("Flight", [clip["name"] for clip in
                                 found[0]["geometry"]["animationClips"]])
        queued = spawn_asset(self.bridge.url, self.bridge.token, {
            "room_id": current["roomId"], "scene_revision": current["sceneRevision"],
            "asset_id": found[0]["assetId"], "transform": deepcopy(INITIAL_POSE)})
        request_id = queued["requestId"]
        self.assertEqual(spawn_status(self.bridge.url, self.bridge.token, request_id)["status"],
                         "queued")
        self.room["scene"]["objects"] = [{"objectId": OBJECT_ID,
                                           "assetId": self.asset["assetId"],
                                           "anchorId": "web-floor",
                                           "transform": deepcopy(INITIAL_POSE)}]
        self.exchange(result={"requestId": request_id, "ok": True, "error": "",
                              "objectId": OBJECT_ID})
        receipt = spawn_status(self.bridge.url, self.bridge.token, request_id)
        self.assertEqual(receipt["requestId"], request_id)
        self.assertEqual(receipt["status"], "succeeded")
        self.assertEqual(receipt["objectId"], OBJECT_ID)
        return receipt

    def bind_flight(self):
        current = read_scene(self.bridge.url, self.bridge.token)
        queued = bind_animation(self.bridge.url, self.bridge.token, {
            "room_id": current["roomId"], "scene_revision": current["sceneRevision"],
            "object_id": OBJECT_ID, "expected_asset_id": self.asset["assetId"],
            "loop_clip": "Flight", "select_clip": None})
        return queued["requestId"]

    def test_two_turn_dragon_load_bind_and_relative_room_move_have_matching_receipts(self):
        first_context, first_message = self.turn(LOAD_REQUEST)
        self.assertEqual(first_context["sceneSummary"]["objectCount"], 0)
        self.assertIn("Detailed world/entity state", first_message)
        self.assertIn("matrix_list_assets", RecordingBackend.enabled_matrix_tools)
        spawn_receipt = self.spawn_observed_dragon()
        bind_id = self.bind_flight()
        self.assertEqual(animation_status(self.bridge.url, self.bridge.token, bind_id)["status"],
                         "queued")
        self.room["scene"]["objects"][0]["animation"] = deepcopy(FLIGHT)
        self.exchange(result={"requestId": bind_id, "ok": True, "error": "",
                              "objectId": OBJECT_ID})
        bind_receipt = animation_status(self.bridge.url, self.bridge.token, bind_id)
        self.assertEqual((bind_receipt["requestId"], bind_receipt["status"],
                          bind_receipt["binding"]), (bind_id, "succeeded", FLIGHT))
        self.assertNotIn("playback", bind_receipt)

        second_context, second_message = self.turn(MOVE_REQUEST, selected=OBJECT_ID)
        self.assertEqual(second_context["selectedObject"]["objectId"], OBJECT_ID)
        self.assertEqual(second_context["selectedObject"]["transform"], INITIAL_POSE)
        self.assertNotIn("matrix_list_assets offset/limit pages", second_message)
        current = read_scene(self.bridge.url, self.bridge.token)
        self.assertEqual(current["sceneRevision"], second_context["sceneRevision"])
        observed = current["objects"][0]
        self.assertEqual(observed["animation"], FLIGHT)
        self.assertEqual(observed["transform"], INITIAL_POSE)
        moved = deepcopy(observed["transform"])
        moved["position"]["x"] += 0.3  # 30 cm along room x, not viewer x.
        queued = move_object(self.bridge.url, self.bridge.token, {
            "room_id": current["roomId"], "scene_revision": current["sceneRevision"],
            "object_id": OBJECT_ID, "expected_asset_id": self.asset["assetId"],
            "position": moved["position"]})
        move_id = queued["requestId"]
        self.assertEqual(move_status(self.bridge.url, self.bridge.token, move_id)["status"],
                         "queued")
        self.assertEqual(self.state.pending[move_id]["transform"], moved)
        self.room["scene"]["objects"][0]["transform"] = moved
        self.exchange(result={"requestId": move_id, "ok": True, "error": "",
                              "objectId": OBJECT_ID})
        move_receipt = move_status(self.bridge.url, self.bridge.token, move_id)
        self.assertEqual((move_receipt["requestId"], move_receipt["status"],
                          move_receipt["transform"]), (move_id, "succeeded", moved))
        self.assertEqual(move_receipt["sceneRevision"], self.state.revision)
        self.assertEqual(read_scene(self.bridge.url, self.bridge.token)["objects"][0]
                         ["animation"], FLIGHT)
        self.assertEqual(len(self.room["scene"]["objects"]), 1)
        self.assertEqual(self.backend.starts, 1)
        self.assertEqual({thread for thread, _ in self.backend.sent},
                         {"synthetic-codex-thread"})
        self.assertEqual(spawn_receipt["objectId"], move_receipt["objectId"])

    def test_unobserved_bind_remains_unconfirmed_and_recovery_does_not_respawn(self):
        self.turn(LOAD_REQUEST)
        self.spawn_observed_dragon()
        bind_id = self.bind_flight()
        self.assertEqual(animation_status(self.bridge.url, self.bridge.token, bind_id)["status"],
                         "queued")
        # A positive browser result without an observed binding cannot prove success.
        self.exchange(result={"requestId": bind_id, "ok": True, "error": "",
                              "objectId": OBJECT_ID})
        self.assertEqual(animation_status(self.bridge.url, self.bridge.token, bind_id)["status"],
                         "unconfirmed")
        self.assertNotIn("animation", read_scene(self.bridge.url, self.bridge.token)["objects"][0])
        self.turn("The ice dragon is here; finish binding its Flight loop.",
                  selected=OBJECT_ID, input_source="text")
        retry_id = self.bind_flight()
        self.assertNotEqual(retry_id, bind_id)
        self.room["scene"]["objects"][0]["animation"] = deepcopy(FLIGHT)
        self.exchange(result={"requestId": retry_id, "ok": True, "error": "",
                              "objectId": OBJECT_ID})
        self.assertEqual(animation_status(self.bridge.url, self.bridge.token, retry_id)["status"],
                         "succeeded")
        self.assertEqual(len(self.state.agent_spawn_ids), 1)
        self.assertEqual(len(read_scene(self.bridge.url, self.bridge.token)["objects"]), 1)


if __name__ == "__main__":
    unittest.main()
