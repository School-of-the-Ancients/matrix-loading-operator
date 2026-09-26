"""PC-local Matrix MCP server for the Codex Agent Portal."""
from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from matrix_tool_bridge import (animation_status, bind_animation, component_action, component_status,
                                interaction_action, interaction_status,
                                list_assets, list_components,
                                move_object, move_status, publish_component, read_scene, register_glb,
                                physics_action, physics_status, scale_block, scale_status,
                                spawn_asset, spawn_status)


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
                       expected_asset_id: str, position: dict[str, float],
                       rotation: dict[str, float] | None = None) -> dict:
    """Move or turn one existing virtual-floor object after native approval.

    Use current room_id and scene_revision from Matrix context or
    matrix_scene_summary. Position is the target in room metres. Optional
    rotation is a complete x/y/z Euler-degrees target; omitted rotation keeps
    the current orientation. The asset ID must match the object. The runtime
    must acknowledge and show the whole requested transform; queued or
    unconfirmed does not mean changed. This tool does not operate on physical
    AR surfaces.
    """
    value = {"room_id": room_id, "scene_revision": scene_revision,
             "object_id": object_id, "expected_asset_id": expected_asset_id,
             "position": position}
    if rotation is not None:
        value["rotation"] = rotation
    return move_object(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                       value)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_move_status(request_id: str) -> dict:
    """Read the runtime receipt for a Matrix move. Never retry a queued move."""
    return move_status(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_scale_block(room_id: str, scene_revision: int, object_id: str,
                       factors: dict[str, float], baseline_request_id: str | None = None) -> dict:
    """Propose X/Y/Z factors for a built-in block in the Matrix Web virtual room.

    Read the current room/revision with matrix_scene_summary. Each factor must
    be 0.25–4 relative to a captured baseline. The proposal awaits owner review
    and Apply on /clients; this tool never applies it. Supply a confirmed prior
    request ID to keep its original baseline. Use matrix_scale_status to read
    the acknowledged dimensions and mathematical volume ratio. No physical
    volume or physics measurement is claimed.
    """
    value = {"room_id": room_id, "scene_revision": scene_revision,
             "object_id": object_id, "factors": factors}
    if baseline_request_id is not None:
        value["baseline_request_id"] = baseline_request_id
    return scale_block(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"], value)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_reset_block_scale(room_id: str, scene_revision: int, object_id: str,
                             baseline_request_id: str) -> dict:
    """Propose restoring a block to the baseline of a confirmed scale request.

    Owner review and Apply on /clients is still required. The request chain is
    process-local; after restart, explicitly capture a new baseline.
    """
    return scale_block(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                       {"room_id": room_id, "scene_revision": scene_revision,
                        "object_id": object_id, "action": "reset",
                        "baseline_request_id": baseline_request_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_scale_status(request_id: str) -> dict:
    """Read one reviewed scale request and its normalized observed event."""
    return scale_status(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_spawn_asset(room_id: str, scene_revision: int, asset_id: str,
                       transform: dict) -> dict:
    """Spawn a registered GLB in the connected virtual Matrix room after approval.

    The browser must already list this validated asset. Use current room/revision
    from matrix_scene_summary and a bounded position/rotation/scale transform.
    Check matrix_spawn_status; queued or unconfirmed does not mean spawned.
    Physical-surface placement is a separate capability.
    """
    return spawn_asset(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                       {"room_id": room_id, "scene_revision": scene_revision,
                        "asset_id": asset_id, "transform": transform})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_spawn_status(request_id: str) -> dict:
    """Read a runtime receipt and observed object ID for a Matrix GLB spawn."""
    return spawn_status(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_bind_animation(room_id: str, scene_revision: int, object_id: str,
                          expected_asset_id: str, loop_clip: str | None,
                          select_clip: str | None) -> dict:
    """Bind validated GLB clips to one virtual-floor object after native approval.

    loop_clip repeats at rest; select_clip plays once on object selection then
    returns to the loop. Use exact names from matrix_list_assets. Both null
    removes the binding. This persists the binding, not current playback phase.
    A queued or unconfirmed result is not a completed world change.
    """
    return bind_animation(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                          {"room_id": room_id, "scene_revision": scene_revision,
                           "object_id": object_id, "expected_asset_id": expected_asset_id,
                           "loop_clip": loop_clip, "select_clip": select_clip})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_animation_status(request_id: str) -> dict:
    """Read the runtime receipt and observed state for a GLB clip binding."""
    return animation_status(os.environ["MATRIX_CONTROL_URL"],
                            os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_set_physics(room_id: str, scene_revision: int, object_id: str,
                       expected_asset_id: str, restitution: float = 0.4) -> dict:
    """Drop one registered GLB onto the Matrix Web White Room's virtual floor.

    The bounded approximation uses gravity 9.81 m/s² and a catalog bounds box.
    Restitution is 0–0.75. The GLB must be loaded, upright, within 5 m of the
    floor, and have no competing transform writer. Check matrix_physics_status:
    the command receipt confirms configuration; contact requires a matching
    observed physics state. No real-floor or object collision is measured.
    """
    return physics_action(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                          {"action": "set", "room_id": room_id,
                           "scene_revision": scene_revision, "object_id": object_id,
                           "expected_asset_id": expected_asset_id, "restitution": restitution})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_remove_physics(room_id: str, scene_revision: int, object_id: str,
                          expected_asset_id: str) -> dict:
    """Stop the floor simulation and remove its saved configuration from one GLB."""
    return physics_action(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                          {"action": "remove", "room_id": room_id,
                           "scene_revision": scene_revision, "object_id": object_id,
                           "expected_asset_id": expected_asset_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_physics_status(request_id: str) -> dict:
    """Read the exact floor physics receipt and any matching observed contact."""
    return physics_status(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_set_interaction(room_id: str, scene_revision: int, object_id: str,
                           expected_asset_id: str, interaction: dict) -> dict:
    """Author a rest or eat affordance on one registered static Matrix Web GLB.

    Read matrix_scene_summary and matrix_list_assets first. The descriptor must
    name the exact installed asset SHA and use local floor X/Z poses. The PC
    checks geometry and asset bytes; the browser checks rendered bounds. Native
    approval reviews the bounded effect. Check matrix_interaction_status:
    queued or unconfirmed does not mean the world changed.
    """
    return interaction_action(os.environ["MATRIX_CONTROL_URL"],
                              os.environ["MATRIX_CONTROL_TOKEN"],
                              {"action": "set", "room_id": room_id,
                               "scene_revision": scene_revision, "object_id": object_id,
                               "expected_asset_id": expected_asset_id,
                               "interaction": interaction})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_remove_interaction(room_id: str, scene_revision: int, object_id: str,
                              expected_asset_id: str) -> dict:
    """Remove one saved GLB affordance, including when its catalog is stale."""
    return interaction_action(os.environ["MATRIX_CONTROL_URL"],
                              os.environ["MATRIX_CONTROL_TOKEN"],
                              {"action": "remove", "room_id": room_id,
                               "scene_revision": scene_revision, "object_id": object_id,
                               "expected_asset_id": expected_asset_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_interaction_status(request_id: str) -> dict:
    """Read the runtime receipt and observed descriptor for an affordance edit."""
    return interaction_status(os.environ["MATRIX_CONTROL_URL"],
                              os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_list_assets(offset: int = 0, limit: int = 24) -> dict:
    """List a bounded page of validated Matrix WebXR GLB catalog assets."""
    return list_assets(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                       offset, limit)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_register_glb(source_path: str, expected_sha256: str, name: str,
                        description: str = "", spawn_scale: float = 1,
                        local_bounds: dict | None = None) -> dict:
    """Register an already exported PC-local GLB through Matrix's existing validator.

    First compute the source file SHA-256 with a PC tool, then pass the exact
    digest here. This does not spawn or change any scene object. Codex app-server
    requests native approval before the catalog write.
    """
    return register_glb(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                        {"source_path": source_path, "expected_sha256": expected_sha256,
                         "name": name, "description": description,
                         "spawn_scale": spawn_scale, "local_bounds": local_bounds})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=True, openWorldHint=False))
def matrix_publish_component(package: dict) -> dict:
    """Publish an immutable Matrix numeric component package after native approval.

    Schema 1 has name, schemaVersion=1 and outputs mapping transform channels to
    bounded expression trees. Nodes: const(value), time, self(path), target(path),
    sin(arg), cos(arg), add(args), mul(args). No executable JavaScript is accepted.
    Publishing alone does not change the live scene. Repeating identical content
    returns the same component ID.
    """
    return publish_component(os.environ["MATRIX_CONTROL_URL"],
                             os.environ["MATRIX_CONTROL_TOKEN"], package)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_list_components(offset: int = 0, limit: int = 24) -> dict:
    """List published Matrix WebXR component versions and output channels."""
    return list_components(os.environ["MATRIX_CONTROL_URL"],
                           os.environ["MATRIX_CONTROL_TOKEN"], offset, limit)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_attach_component(room_id: str, scene_revision: int, object_id: str,
                            expected_asset_id: str, component_id: str,
                            target_object_id: str) -> dict:
    """Attach a published component to one virtual-floor object after native approval.

    Use current room ID and revision from matrix_scene_summary. The target must
    be a different virtual-floor object. Check the returned receipt; queued or
    unconfirmed does not mean the behavior is running.
    """
    return component_action(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                            {"action": "attach", "room_id": room_id, "scene_revision": scene_revision,
                             "object_id": object_id, "expected_asset_id": expected_asset_id,
                             "component_id": component_id, "target_object_id": target_object_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_stop_component(room_id: str, scene_revision: int, object_id: str,
                          expected_asset_id: str, component_id: str) -> dict:
    """Stop one running component and restore its object's saved base transform."""
    return component_action(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                            {"action": "stop", "room_id": room_id, "scene_revision": scene_revision,
                             "object_id": object_id, "expected_asset_id": expected_asset_id,
                             "component_id": component_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_remove_component(room_id: str, scene_revision: int, object_id: str,
                            expected_asset_id: str, component_id: str) -> dict:
    """Remove the exact attached component, including a stopped or failed one."""
    return component_action(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                            {"action": "remove", "room_id": room_id, "scene_revision": scene_revision,
                             "object_id": object_id, "expected_asset_id": expected_asset_id,
                             "component_id": component_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_component_status(request_id: str) -> dict:
    """Read an attach/stop/remove runtime receipt and observed component state."""
    return component_status(os.environ["MATRIX_CONTROL_URL"],
                            os.environ["MATRIX_CONTROL_TOKEN"], request_id)


if __name__ == "__main__":
    server.run(transport="stdio")
