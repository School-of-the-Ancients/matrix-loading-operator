"""PC-local read-only Matrix MCP server for the Codex Agent Portal."""
from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from matrix_tool_bridge import move_object, move_status, read_scene


server = FastMCP("matrix-webxr")


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_scene_summary() -> dict:
    """Read the connected Matrix room ID, revision, and bounded virtual object list.

    This is observational. It does not change the room. If offline, the result
    says so and does not return a stale scene as current.
    """
    url = os.environ["MATRIX_CONTROL_URL"]
    token = os.environ["MATRIX_CONTROL_TOKEN"]
    return read_scene(url, token)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_move_object(room_id: str, scene_revision: int, object_id: str,
                       expected_asset_id: str, position: dict[str, float]) -> dict:
    """Move one existing virtual-floor object after native approval.

    Use current room_id and scene_revision from Matrix context or
    matrix_scene_summary. The asset ID must match the object. The runtime must
    acknowledge the command; queued or unconfirmed does not mean moved. This
    first move tool does not operate on physical AR surfaces.
    """
    return move_object(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                       {"room_id": room_id, "scene_revision": scene_revision,
                        "object_id": object_id, "expected_asset_id": expected_asset_id,
                        "position": position})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_move_status(request_id: str) -> dict:
    """Read the runtime receipt for a Matrix move. Never retry a queued move."""
    return move_status(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"], request_id)


if __name__ == "__main__":
    server.run(transport="stdio")
