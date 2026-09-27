"""PC-local Matrix MCP server for the Codex Agent Portal."""
from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from matrix_tool_bridge import (animation_status, bind_animation, bind_game,
                                game_status, display_action, display_status,
                                control_action, control_status,
                                entity_action, entity_status, inspect_entity, list_entities,
                                update_game,
                                component_action, component_status,
                                interaction_action, interaction_status,
                                list_assets, list_components,
                                list_procedural_generators, procedural_action, procedural_status,
                                move_object, move_status, publish_component, read_scene, register_glb,
                                physics_action, physics_status, scale_block, scale_status,
                                rigid_action, rigid_status,
                                spawn_asset, spawn_builtin, spawn_status,
                                world_archive_action, world_archive_status)


server = FastMCP("matrix-webxr")


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_scene_summary() -> dict:
    """Read the connected Matrix runtime, room, revision, and bounded virtual object list.

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
                       rotation: dict[str, float] | None = None,
                       scale: dict[str, float] | None = None) -> dict:
    """Move, turn, or resize one existing virtual-floor object after native approval.

    Use current room_id and scene_revision from Matrix context or
    matrix_scene_summary. Position is the target in room metres. Optional
    rotation is a complete x/y/z Euler-degrees target; omitted rotation keeps
    the current orientation. Optional scale is a complete x/y/z unitless
    target in [0.01, 20]; omitted scale keeps the current scale. Requires
    paused Creator Mode. The asset ID and observed transform must still match
    when the browser executes. A succeeded receipt includes the complete
    observed transform; queued or unconfirmed does not mean changed. This
    tool does not operate on physical AR surfaces.
    """
    value = {"room_id": room_id, "scene_revision": scene_revision,
             "object_id": object_id, "expected_asset_id": expected_asset_id,
             "position": position}
    if rotation is not None:
        value["rotation"] = rotation
    if scale is not None:
        value["scale"] = scale
    return move_object(os.environ["MATRIX_CONTROL_URL"], os.environ["MATRIX_CONTROL_TOKEN"],
                       value)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_move_status(request_id: str) -> dict:
    """Read the receipt and complete observed transform. Never retry a queued move."""
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
def matrix_spawn_builtin(room_id: str, scene_revision: int, asset_id: str,
                         transform: dict) -> dict:
    """Spawn a built-in asset advertised in the live Matrix scene summary.

    Requires paused Creator Mode. Use a current built-in asset ID and inspect
    matrix_spawn_status plus the observed scene after the matching receipt.
    """
    return spawn_builtin(os.environ["MATRIX_CONTROL_URL"],
                         os.environ["MATRIX_CONTROL_TOKEN"],
                         {"room_id": room_id, "scene_revision": scene_revision,
                          "asset_id": asset_id, "transform": transform})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_list_procedural_generators() -> dict:
    """Discover the reviewed versioned generators loaded by the current Matrix Web runtime.

    The response includes parameter names, types, bounds and defaults. A saved
    generator version absent from this list is unavailable, not silently upgraded.
    """
    return list_procedural_generators(os.environ["MATRIX_CONTROL_URL"],
                                      os.environ["MATRIX_CONTROL_TOKEN"])


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_create_procedural(room_id: str, scene_revision: int,
                             generator_id: str, parameters: dict,
                             transform: dict) -> dict:
    """Create one procedural object with a reviewed generator in the virtual world.

    Read matrix_list_procedural_generators and matrix_scene_summary first. This
    queues a normal Matrix command and returns a receipt status; inspect
    matrix_procedural_status before claiming the object exists. The generator
    implementation cannot be supplied in the request and is never eval'd.
    """
    return procedural_action(os.environ["MATRIX_CONTROL_URL"],
                             os.environ["MATRIX_CONTROL_TOKEN"],
                             {"action": "create", "room_id": room_id,
                              "scene_revision": scene_revision,
                              "generator_id": generator_id,
                              "parameters": parameters, "transform": transform})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_update_procedural(room_id: str, scene_revision: int,
                             object_id: str, expected_source_revision: str,
                             parameters_patch: dict) -> dict:
    """Regenerate a selected procedural object's parameters with the same ID.

    Read the current object, recipe and revision in matrix_scene_summary. The
    PC binds the complete old recipe and transform as stale edit preconditions.
    Only parameters change; changing generator code follows reviewed deployment.
    A queued or unconfirmed status is not a completed revision.
    """
    return procedural_action(os.environ["MATRIX_CONTROL_URL"],
                             os.environ["MATRIX_CONTROL_TOKEN"],
                             {"action": "update", "room_id": room_id,
                              "scene_revision": scene_revision, "object_id": object_id,
                              "expected_source_revision": expected_source_revision,
                              "parameters_patch": parameters_patch})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_procedural_status(request_id: str) -> dict:
    """Read the matching runtime receipt and observed recipe for a procedural edit."""
    return procedural_status(os.environ["MATRIX_CONTROL_URL"],
                             os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_bind_game(room_id: str, scene_revision: int, spec: dict,
                     bindings: dict) -> dict:
    """Bind a supported declarative challenge to existing Matrix object IDs.

    Inspect the current scene, object IDs and capability first. This requires
    paused Creator Mode, a version-2 game specification and explicit role
    bindings. It queues a reviewed Matrix command; check matrix_game_status
    for the matching receipt and observed state before claiming completion.
    """
    return bind_game(os.environ["MATRIX_CONTROL_URL"],
                     os.environ["MATRIX_CONTROL_TOKEN"],
                     {"room_id": room_id, "scene_revision": scene_revision,
                      "spec": spec, "bindings": bindings})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_game_status(request_id: str) -> dict:
    """Read a game's exact binding receipt and observed shared progress."""
    return game_status(os.environ["MATRIX_CONTROL_URL"],
                       os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_update_game(room_id: str, scene_revision: int,
                       spec: dict, bindings: dict) -> dict:
    """Revise a bound version-2 challenge while preserving compatible progress.

    This derives exact old spec and binding preconditions from the observed
    scene. Earned events require unchanged roles and rules; the complete saved
    ledger must remain valid. Check matrix_game_status and the live scene.
    """
    return update_game(os.environ["MATRIX_CONTROL_URL"],
                       os.environ["MATRIX_CONTROL_TOKEN"],
                       {"room_id": room_id, "scene_revision": scene_revision,
                        "spec": spec, "bindings": bindings})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_set_display(room_id: str, scene_revision: int, object_id: str,
                       display: dict) -> dict:
    """Set versioned plain-text display content or a live Matrix state binding.

    Inspect the current object first. Requires paused Creator Mode; the request
    carries the exact observed old descriptor and returns a receipt to verify.
    Bindings include object-transform (objectId), which shows a referenced
    object's live pose, unitless scale, and available local dimensions in metres.
    Inspect the board entity to read the same current observation as the display.
    """
    return display_action(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"],
                          {"action": "set", "room_id": room_id,
                           "scene_revision": scene_revision, "object_id": object_id,
                           "display": display})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_remove_display(room_id: str, scene_revision: int,
                          object_id: str) -> dict:
    """Remove one observed display descriptor from an existing Matrix object."""
    return display_action(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"],
                          {"action": "remove", "room_id": room_id,
                           "scene_revision": scene_revision, "object_id": object_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_display_status(request_id: str) -> dict:
    """Read the matching runtime receipt and observed display descriptor."""
    return display_status(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_set_control(room_id: str, scene_revision: int, object_id: str,
                       control: dict) -> dict:
    """Author a finite in-world Play control on a static virtual-floor entity.

    Currently supports cycle-values on a target object's transform.scale.
    The PC derives unchanged descriptor and pose guards; inspect the receipt
    and live scene before claiming the control exists.
    """
    return control_action(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"],
                          {"action": "set", "room_id": room_id,
                           "scene_revision": scene_revision, "object_id": object_id,
                           "control": control})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_remove_control(room_id: str, scene_revision: int, object_id: str) -> dict:
    """Remove one observed control in paused Creator Mode."""
    return control_action(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"],
                          {"action": "remove", "room_id": room_id,
                           "scene_revision": scene_revision, "object_id": object_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_control_status(request_id: str) -> dict:
    """Read the matching control authoring receipt and observed descriptor."""
    return control_status(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_set_rigid_body(room_id: str, scene_revision: int, object_id: str,
                          rigid_body: dict) -> dict:
    """Author a reviewed Rapier body on a virtual Matrix object in Creator Mode.

    Uses the current transform and old body as stale-edit preconditions. Read
    matrix_rigid_status and the scene before claiming the body is active.
    """
    return rigid_action(os.environ["MATRIX_CONTROL_URL"],
                        os.environ["MATRIX_CONTROL_TOKEN"],
                        {"action": "set-body", "room_id": room_id,
                         "scene_revision": scene_revision, "object_id": object_id,
                         "rigid_body": rigid_body})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_remove_rigid_body(room_id: str, scene_revision: int,
                             object_id: str) -> dict:
    """Remove an authored rigid body after an exact observed precondition."""
    return rigid_action(os.environ["MATRIX_CONTROL_URL"],
                        os.environ["MATRIX_CONTROL_TOKEN"],
                        {"action": "remove-body", "room_id": room_id,
                         "scene_revision": scene_revision, "object_id": object_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_set_gravity(room_id: str, scene_revision: int, gravity: dict) -> dict:
    """Change bounded virtual-world gravity in paused Creator Mode.

    This edits virtual physics, not an observed physical-room property.
    """
    return rigid_action(os.environ["MATRIX_CONTROL_URL"],
                        os.environ["MATRIX_CONTROL_TOKEN"],
                        {"action": "set-gravity", "room_id": room_id,
                         "scene_revision": scene_revision, "gravity": gravity})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_rigid_status(request_id: str) -> dict:
    """Read the matching rigid edit receipt and observed body or gravity."""
    return rigid_status(os.environ["MATRIX_CONTROL_URL"],
                        os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_list_entities(offset: int = 0, limit: int = 24) -> dict:
    """Page through every authored entity in the connected Matrix room.

    Use offset 0–100 and limit 1–24. Follow nextOffset until null. Each page
    includes current room and revision; restart discovery if those change.
    """
    return list_entities(os.environ["MATRIX_CONTROL_URL"],
                         os.environ["MATRIX_CONTROL_TOKEN"], offset, limit)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_inspect_entity(room_id: str, scene_revision: int,
                          object_id: str) -> dict:
    """Read an entity through the browser's live state/action interface.

    This queues a read-only inspection command. Check matrix_entity_status for
    the matching typed outcome before using its receipt ID for an action.
    """
    return inspect_entity(os.environ["MATRIX_CONTROL_URL"],
                          os.environ["MATRIX_CONTROL_TOKEN"],
                          {"room_id": room_id, "scene_revision": scene_revision,
                           "object_id": object_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_begin_grab(room_id: str, object_id: str,
                      inspection_request_id: str) -> dict:
    """Begin a bounded agent grab of an inspected dynamic virtual object.

    The PC derives unchanged transform/mode guards from one unconsumed live
    inspection receipt. Check matrix_entity_status before moving or releasing.
    """
    return entity_action(os.environ["MATRIX_CONTROL_URL"],
                         os.environ["MATRIX_CONTROL_TOKEN"],
                         {"action": "begin", "room_id": room_id,
                          "object_id": object_id,
                          "inspection_request_id": inspection_request_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_move_grab(room_id: str, object_id: str,
                     inspection_request_id: str, target_pose: dict) -> dict:
    """Move an agent-held body at most three metres from its inspected pose.

    Inspect again after begin or each move. The PC derives the active grab ID
    and guards from the exact receipt; it never guesses or retries a lease.
    """
    return entity_action(os.environ["MATRIX_CONTROL_URL"],
                         os.environ["MATRIX_CONTROL_TOKEN"],
                         {"action": "move", "room_id": room_id,
                          "object_id": object_id,
                          "inspection_request_id": inspection_request_id,
                          "target_pose": target_pose})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_release_grab(room_id: str, object_id: str,
                        inspection_request_id: str) -> dict:
    """Release one inspected agent-held body and observe any game event.

    Inspect again after the last move. A release receipt may include delivery
    credit and unlock state; queued or unconfirmed is not proof of release.
    """
    return entity_action(os.environ["MATRIX_CONTROL_URL"],
                         os.environ["MATRIX_CONTROL_TOKEN"],
                         {"action": "release", "room_id": room_id,
                          "object_id": object_id,
                          "inspection_request_id": inspection_request_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_activate_control(room_id: str, object_id: str,
                            inspection_request_id: str) -> dict:
    """Activate a Play control once using an unconsumed live entity inspection.

    The PC derives exact descriptor, target pose, mode and control-state
    preconditions. Read matrix_entity_status and inspect again before a repeat.
    """
    return entity_action(os.environ["MATRIX_CONTROL_URL"],
                         os.environ["MATRIX_CONTROL_TOKEN"],
                         {"action": "activate", "room_id": room_id,
                          "object_id": object_id,
                          "inspection_request_id": inspection_request_id})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_entity_status(request_id: str) -> dict:
    """Read one typed live entity inspection or grab action receipt."""
    return entity_status(os.environ["MATRIX_CONTROL_URL"],
                         os.environ["MATRIX_CONTROL_TOKEN"], request_id)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_list_world_archives(room_id: str, scene_revision: int,
                               offset: int = 0) -> dict:
    """Read one page of browser-local saved worlds through the live runtime.

    Use matrix_world_archive_status with the returned requestId. This reads
    bounded metadata only; the archived world contents remain in the browser.
    """
    return world_archive_action(os.environ["MATRIX_CONTROL_URL"],
                                os.environ["MATRIX_CONTROL_TOKEN"],
                                {"action": "list", "room_id": room_id,
                                 "scene_revision": scene_revision, "offset": offset})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_start_new_world(room_id: str, scene_revision: int,
                           archive_name: str) -> dict:
    """Archive the current whole world and start a blank world in paused Creator Mode.

    The browser verifies the archive before switching. The service supplies
    exact inspected scene, game, gravity, Creator, and Citizens preconditions.
    Check the receipt before making further edits; do not retry an uncertain switch.
    """
    return world_archive_action(os.environ["MATRIX_CONTROL_URL"],
                                os.environ["MATRIX_CONTROL_TOKEN"],
                                {"action": "new", "room_id": room_id,
                                 "scene_revision": scene_revision,
                                 "archive_name": archive_name})


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                         idempotentHint=False, openWorldHint=False))
def matrix_restore_world_archive(room_id: str, scene_revision: int,
                                 archive_id: str, archive_name: str) -> dict:
    """Archive the active world and restore one browser-local world by its ID.

    Read matrix_list_world_archives first, then review this switch and its
    matrix_world_archive_status receipt. The current world is archived first.
    """
    return world_archive_action(os.environ["MATRIX_CONTROL_URL"],
                                os.environ["MATRIX_CONTROL_TOKEN"],
                                {"action": "restore", "room_id": room_id,
                                 "scene_revision": scene_revision,
                                 "archive_id": archive_id,
                                 "archive_name": archive_name})


@server.tool(annotations=ToolAnnotations(readOnlyHint=True))
def matrix_world_archive_status(request_id: str) -> dict:
    """Read one exact browser world archive list/switch receipt."""
    return world_archive_status(os.environ["MATRIX_CONTROL_URL"],
                                os.environ["MATRIX_CONTROL_TOKEN"], request_id)


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
