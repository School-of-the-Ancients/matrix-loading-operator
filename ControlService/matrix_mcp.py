"""PC-local read-only Matrix MCP server for the Codex Agent Portal."""
from __future__ import annotations

import json
import os
import urllib.request

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations


server = FastMCP("matrix-webxr")


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_scene_summary() -> dict:
    """Read the connected Matrix room ID, revision, and bounded virtual object list.

    This is observational. It does not change the room. If offline, the result
    says so and does not return a stale scene as current.
    """
    url = os.environ["MATRIX_CONTROL_URL"]
    token = os.environ["MATRIX_CONTROL_TOKEN"]
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(request, timeout=3) as response:
        raw = response.read(64 * 1024 + 1)
    if len(raw) > 64 * 1024:
        raise ValueError("Matrix scene summary exceeded its limit")
    return json.loads(raw)


if __name__ == "__main__":
    server.run(transport="stdio")
