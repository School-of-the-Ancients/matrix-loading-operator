"""PC-local read-only Matrix MCP server for the Codex Agent Portal."""
from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from matrix_tool_bridge import read_scene


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


if __name__ == "__main__":
    server.run(transport="stdio")
