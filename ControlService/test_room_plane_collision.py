"""Synthetic measured-plane guards for room-aware Operator edits."""

import copy
import tempfile
import unittest

from room_plane_collision import volume_intersects_plane
from server import APIError, State
from test_server import SNAPSHOT


def pose(x=0, y=0, z=0, rz=0):
    return {"position": {"x": x, "y": y, "z": z},
            "rotation": {"x": 0, "y": 0, "z": rz},
            "scale": {"x": 1, "y": 1, "z": 1}}


def plane(name, kind, room_pose, extent):
    return {"anchorId": name, "displayName": name.upper(), "source": "webxr",
            "semanticLabels": [name.upper()], "roomPose": room_pose,
            "surface": {"kind": kind, "boundary": [
                {"x": -extent, "y": 0, "z": -extent},
                {"x": extent, "y": 0, "z": -extent},
                {"x": extent, "y": 0, "z": extent},
                {"x": -extent, "y": 0, "z": extent}]}}


class RoomPlaneCollisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = State(self.temp.name)
        self.floor = plane("floor", "support", pose(), 2)
        self.shelf = plane("shelf", "support", pose(y=.6), .4)
        self.wall = plane("wall", "wall", pose(x=1.2, y=.9, rz=-90), 1)
        self.block = {"assetId": "block", "displayName": "Block", "spawnScale": 1,
                      "localBounds": {"center": {"x": 0, "y": .5, "z": 0},
                                      "size": {"x": 1, "y": 1, "z": 1}}}
        self.orb = {"assetId": "orb", "displayName": "Orb", "spawnScale": 1,
                    "localBounds": {"center": {"x": 0, "y": .25, "z": 0},
                                    "size": {"x": .5, "y": .5, "z": .5}}}
        room = copy.deepcopy(SNAPSHOT)
        room["scene"]["roomId"] = "webxr-session-synthetic"
        room["scene"]["objects"] = [{"objectId": "virtual-block", "assetId": "block",
                                     "anchorId": "web-floor", "transform": {
                                         **pose(x=.8),
                                         "scale": {"x": .5, "y": .5, "z": .5}}}]
        room["assets"] = [self.block, self.orb]
        room["anchors"] = [{"anchorId": "web-floor", "displayName": "Virtual floor"},
                           self.floor, self.shelf, self.wall]
        room["roomContext"] = {"mode": "ar", "state": "ready",
                               "message": "aligned", "alignmentVerified": True}
        room["runtimeDescriptor"] = {"schemaVersion": 1, "client": "matrix-web",
                                     "renderer": "threejs-webxr", "presentation": "ar"}
        room["creatorMode"] = {"schemaVersion": 1, "mode": "creator",
                               "simulation": "paused", "revision": 0}
        room["spatialObservation"] = {"schemaVersion": 1, "planeAgeMs": 0,
                                      "trackingEpoch": 3, "webFloorPose": pose()}
        self.state.exchange({"clientId": "synthetic-web", "snapshot": room, "results": []})

    def test_finite_volume_respects_height_and_wall_polygon(self):
        self.assertTrue(volume_intersects_plane(pose(), self.block["localBounds"],
                                                1, pose(), self.shelf))
        self.assertFalse(volume_intersects_plane(pose(), self.orb["localBounds"],
                                                 1, pose(), self.shelf))
        self.assertTrue(volume_intersects_plane(pose(x=1.1),
                                                self.orb["localBounds"],
                                                1, pose(), self.wall))
        self.assertFalse(volume_intersects_plane(pose(x=.7),
                                                 self.orb["localBounds"],
                                                 1, pose(), self.wall))
        self.assertFalse(volume_intersects_plane(pose(x=1.1, z=1.6),
                                                 self.orb["localBounds"],
                                                 1, pose(), self.wall),
                         "an infinite wall plane is not room occupancy")

    def test_agent_preflight_rejects_crossing_without_queuing_and_keeps_tabletop(self):
        spatial = self.state.agent_room_spatial("floor")
        request = {"room_id": spatial["roomId"],
                   "scene_revision": spatial["sceneRevision"],
                   "spatial_token": spatial["planes"][0]["spatialToken"],
                   "anchor_id": "floor", "asset_id": "block",
                   "transform": pose()}
        with self.assertRaises(APIError) as overlap:
            self.state.agent_spawn_surface(request)
        self.assertEqual(overlap.exception.status, 409)
        self.assertIn("Object volume intersects", str(overlap.exception))
        self.assertFalse(self.state.pending)

        request["asset_id"] = "orb"
        self.assertEqual(self.state.agent_spawn_surface(request)["status"], "queued")
        self.state.pending.clear()
        tabletop = self.state.agent_room_spatial("shelf")
        request.update(anchor_id="shelf",scene_revision=tabletop["sceneRevision"],
                       spatial_token=tabletop["planes"][0]["spatialToken"])
        self.assertEqual(self.state.agent_spawn_surface(request)["status"], "queued")
        self.state.pending.clear()

        current = self.state.agent_room_spatial("floor")
        move = {"room_id": current["roomId"],
                "scene_revision": current["sceneRevision"],
                "spatial_token": current["planes"][0]["spatialToken"],
                "anchor_id": "floor", "object_id": "virtual-block",
                "expected_asset_id": "block", "position": {"x": 1.1, "y": 0, "z": 0}}
        with self.assertRaises(APIError) as wall:
            self.state.agent_move_room(move)
        self.assertEqual(wall.exception.status, 409)
        self.assertIn("Object volume intersects", str(wall.exception))
        self.assertFalse(self.state.pending)


if __name__ == "__main__":
    unittest.main()
