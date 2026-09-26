"""The agent adapter proposes through the reviewed client ledger, not a new executor."""
import copy
import tempfile
import unittest

from matrix_tool_bridge import MatrixToolBridge, scale_block, scale_status
from server import State


def vec(x=0, y=0, z=0):
    return {"x": x, "y": y, "z": z}


def snapshot():
    return {"scene": {"schemaVersion": 1, "roomId": "web-virtual-room-v1", "objects": [
        {"objectId": "block-1", "assetId": "block", "anchorId": "web-floor",
         "transform": {"position": vec(0, 0, -2), "rotation": vec(), "scale": vec(1, 1, 1)}}]},
        "assets": [{"assetId": "block", "displayName": "Block", "spawnScale": 1,
                    "localBounds": {"center": vec(0, .5, 0), "size": vec(1, 1, 1)}}],
        "anchors": [{"anchorId": "web-floor", "displayName": "Virtual floor"}],
        "selection": {"objectId": "block-1", "anchorId": "web-floor", "position": vec(0, 0, -2)},
        "roomContext": {"mode": "white-room", "state": "ready", "alignmentVerified": False}}


class AgentScaleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.state.exchange({"clientId": "web-client", "snapshot": snapshot(), "results": []})
        self.bridge = MatrixToolBridge(self.state)
        self.addCleanup(self.bridge.close)

    def value(self, **extra):
        return {"room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
                "object_id": "block-1", "factors": vec(2, 3, 4), **extra}

    def test_agent_request_uses_client_proposal_owner_apply_and_same_event(self):
        self.state.client_pairing_enabled = True
        ready = scale_block(self.bridge.url, self.bridge.token, self.value())
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["reviewUrl"], "/clients")
        self.assertEqual(ready["proposal"]["commands"][0]["op"], "set_transform")
        self.assertFalse(self.state.pending, "Agent proposal must not auto Apply")
        self.assertNotIn("clientToken", ready)
        self.assertEqual(self.state.clients.operator_status()["sessions"][0]["clientName"],
                         "Matrix Agent scale tool")
        self.state.clients.apply(ready["sessionId"], ready["requestId"])
        issued = self.state.exchange({"clientId": "web-client", "snapshot": snapshot(), "results": []})["commands"][0]
        observed = copy.deepcopy(snapshot())
        observed["scene"]["objects"][0]["transform"] = copy.deepcopy(issued["transform"])
        self.state.exchange({"clientId": "web-client", "snapshot": observed, "results": [
            {"requestId": issued["requestId"], "ok": True, "objectId": "block-1", "error": ""}]})
        outcome = scale_status(self.bridge.url, self.bridge.token, ready["requestId"])
        self.assertEqual(outcome["status"], "succeeded")
        self.assertEqual(outcome["observationState"], "confirmed")
        self.assertEqual(outcome["experimentEvent"]["mathematicalVolumeRatio"], 24)
        self.assertEqual(outcome["experimentEvent"]["localDimensionsMeters"], vec(2, 3, 4))
        self.assertFalse(outcome["experimentEvent"]["physicalMeasurement"])
        reset = self.state.agent_scale({"room_id": "web-virtual-room-v1", "scene_revision": self.state.revision,
            "object_id": "block-1", "action": "reset", "baseline_request_id": ready["requestId"]})
        self.assertEqual(reset["status"], "ready")
        self.assertEqual(reset["sessionId"], ready["sessionId"])
        self.assertEqual(reset["proposal"]["commands"][0]["transform"]["scale"], vec(1, 1, 1))
        self.assertFalse(self.state.pending, "Reset also requires owner Apply")

    def test_disabled_pairing_and_invalid_factors_never_create_agent_request(self):
        with self.assertRaises(Exception):
            self.state.agent_scale(self.value())
        self.state.client_pairing_enabled = True
        with self.assertRaises(Exception):
            self.state.agent_scale(self.value(factors=vec(5, 1, 1)))
        self.assertEqual(self.state.clients.sessions, {})
        self.assertFalse(self.state.pending)


if __name__ == "__main__":
    unittest.main()
