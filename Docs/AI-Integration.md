# Natural-language scene control

The PC service has three explicitly labeled planner modes. Each creates reviewable proposals through the same validated scene-command path; planners do not change Unity objects directly.

- **offline-rules — Offline command parser (not an AI model):** a finite English vocabulary that runs locally without credentials or network inference.
- **openai-compatible:** sends the request, asset catalog, room-target IDs, current objects/transforms, current selection, and saved scene names to the configured Chat Completions provider. The provider proposes structured operations; the service validates them before allowing Apply.
- **codex-cli:** uses the native PC Codex CLI and its saved ChatGPT sign-in to propose scene commands. This is the subscription mode selected by the user; the service validates the output and still requires Apply and a runtime acknowledgement.

The initial API-provider discovery found no compatible key/model configuration. The user subsequently selected ChatGPT/Codex subscription access, and the native CLI reported `Logged in using ChatGPT`. Codex manages that authentication itself; the project does not extract login tokens or reinterpret them as API keys. A live chair proposal was applied and acknowledged on Quest Pro. The following resize proposal returned HTTP 409; the harness recorded **27 checks passed, 1 failed** and restored its three original objects. This establishes a live spawn, not a completed AI save/clear/restore loop. See [the device report](../Validation/codex-headset-loop-results.json).

## Use the selected ChatGPT/Codex mode

Stop any existing Operator service on port 8765, then run in the repository's PowerShell terminal:

```powershell
./Start-CodexControlService.ps1
```

The launcher requires the native `codex.exe`, verifies ChatGPT sign-in, and starts the local service in `codex-cli` mode. Use `-CodexExe` if it is not on PATH; `-Model` optionally selects a model available to the account. If sign-in is missing, run `codex login` on this PC first. Keep the service terminal open, reconnect the Quest with `./Connect-QuestControl.ps1`, and open the Operator page. Review each proposal before Apply; pause controller/browser edits during inference to avoid stale proposals.

OpenAI documents ChatGPT sign-in as subscription access and states that `codex exec` reuses saved CLI authentication. Usage follows the account's available access and limits. The adapter invokes noninteractive Codex for structured output; credentials remain under Codex's management on the PC. [Authentication](https://learn.chatgpt.com/docs/auth), [noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

## White-room sequence

Start the white-room runtime and its PC service. The virtual floor supplies the placement target; this scene does not need MRUK room capture. Click the floor in the desktop runtime to choose a point, or use the white-room controller placement when running on a headset. Enter each request in the PC control page, review and apply its proposal, and wait for the runtime acknowledgement before continuing.

1. `load a chair`
2. `make it twice as big`
3. `move it 20 cm left`
4. `rotate it 45 degrees`
5. `duplicate it`
6. `undo`
7. `redo`
8. `save scene as Demo`
9. `clear the scene`
10. `restore Demo`

`it` means the selected existing object, using its stable scene ID. `here` means the selected anchor and selected point in that anchor's local coordinate frame. Spawning and duplicating select the new object and report its ID. Select an older prop in the runtime or PC object list, or request `select the chair` when exactly one chair exists. With multiple chairs, use the full object ID: `select <objectId>`. The parser rejects missing or ambiguous matches. `delete it` removes the selected object.

The bundled white-room catalog contains chair, table, wall, pedestal, block, orb, and column. It supplies an optional `spawnScale`: furniture uses 1, primitives use 0.2, and older catalogs without the field default to 0.2. The parser applies that value uniformly to all three scale components. Catalog scale must be finite and between 0.01 and 20. The configured provider receives the same catalog and size instruction; every proposed transform still passes local bounds checks.

Save and restore are PC service operations. Saving requires the runtime's queued commands to have finished; restore queues the saved scene through the normal Unity load operation. Neither operation asks the language model to serialize an arbitrary scene file. Reusing a save name replaces that PC save. Restoring requires a known saved name and compatible room/anchor IDs.

For offline `load NAME`, a matching saved scene takes precedence over an asset. Matching ignores case and repeated whitespace, but keeps the complete requested name: `load a chair` restores a save named `a chair`; a save named only `chair` does not match that phrase. If there is no matching save, an unqualified `load` can spawn a known catalog asset. `restore NAME`, `load scene NAME`, and `load room NAME` always mean a saved scene. `summon a chair` always uses the catalog. No mode downloads assets or searches a remote catalog.

## Offline vocabulary

The parser accepts one operation per request. Unsupported wording fails with examples; it does not invent a target or silently approximate a complex request.

| Request | Interpretation |
|---|---|
| `load a chair` / `summon a chair` | Spawn the bundled chair at the selected point; a matching full save name takes precedence for `load` |
| `summon a table here` / `place a wall here` / `load a pedestal` | Spawn another known bundled asset at its catalog scale |
| `place a block here` / `block here` | Use the selected surface and point; block can match a bundled cube |
| `put an orb on the floor` | Place the orb at the uniquely named floor target's origin |
| `select the chair` / `select <objectId>` | Select one existing object by a unique asset match or its full ID |
| `duplicate it` / `copy the chair` | Clone the selected or uniquely matched object and select the new copy |
| `make it twice as big` / `make it half as big` | Multiply the existing scale by 2 / 0.5 |
| `scale it by 1.5` | Multiply each existing scale component by 1.5 |
| `move it 20 cm left` | Subtract 0.2 metres from target-local X |
| `move it 1 m forward` | Add 1 metre to target-local Z |
| `rotate it 45 degrees` | Add 45 degrees to local Y rotation |
| `rotate it 45 degrees left` | Subtract 45 degrees from local Y rotation |
| `delete it` | Delete the selected object |
| `delete the cube` | Delete only if exactly one existing cube matches |
| `undo` / `redo` | Replay one available runtime scene change |
| `save scene as Demo` | Save the acknowledged scene on the PC |
| `clear the scene` | Clear runtime objects; preserve PC saves |
| `restore Demo` / `load scene Demo` / `load Demo` | Restore the known PC save `Demo` |
| `list assets` / `list targets` / `show scene` | Read the available catalog/state |

Directions use the target's local axes, not the user's current gaze. `toward me` is unsupported because the snapshot does not contain a head pose. Multiple matching surfaces or objects, missing selection, unknown assets, and unknown saved names require a more specific request or an explicit selection. Spawning a table creates a prop; it does not register a new placement anchor.

## Duplicate and scene history

Duplicate preserves the source asset, anchor, rotation, and scale, assigns a fresh object ID, and adds 0.3 metres to target-local X, capped at X = 100. At the boundary, the copy can overlap its source. Wait for the acknowledgement before referring to the new copy as `it`.

Unity keeps up to 32 prior scene states in memory. Successful spawn, duplicate, transform, delete, clear, and load commands add a state and clear redo history. Selection, queries, and failed commands preserve history. Undo and redo are separate single-command proposals; the planner cannot inspect history availability, so Unity reports an empty-history error when appropriate. Clear and restore can be undone while that history remains available.

History contains scene objects and transforms, not selection or PC files. If undo removes the selected object, selection clears; redo does not automatically select it again. Saving a file is not undoable. Restarting the runtime or replacing its room clears history; PC scene saves remain available separately.

## Configure an alternative compatible API provider

Start the PC service with these environment variables already set:

| Variable | Meaning |
|---|---|
| `SANDBOX_AI_BASE_URL` | HTTPS API prefix, such as `https://api.openai.com/v1`; the adapter appends `/chat/completions` |
| `SANDBOX_AI_MODEL` | Exact model name available to that provider/account |
| `SANDBOX_AI_KEY` | Provider API key, kept only in the service process environment |

Select `SANDBOX_AI_MODE=openai-compatible` for this route. Explicit provider values above take precedence. Otherwise, `OPENAI_API_KEY` plus `OPENAI_MODEL` are recognized, with optional `OPENAI_BASE_URL`; or `OPENROUTER_API_KEY` plus `OPENROUTER_MODEL`. A key alone does not select a paid model. Local OpenAI-compatible servers may use an HTTP loopback URL and omit a key; remote providers require HTTPS and a key. Redirects are rejected rather than forwarding authorization to another endpoint.

Do not put API keys in Unity assets, scene saves, request text, the web page, or this document. The adapter does not load browser sessions or treat a Codex subscription login as an API key. It does not silently switch to the offline parser if a configured provider request fails. Select **offline-rules** explicitly to use the local parser.

The compatibility transport uses Chat Completions with `response_format: {"type":"json_object"}`. JSON mode produces JSON but does not guarantee the command schema, so every response still receives local shape, operation, identifier, and numeric validation. The provider must support that endpoint and response-format option. See [OpenAI structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) and the [Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Integration contract

`ControlService/ai_adapter.py` exports:

```python
planner = Planner(config=None, allow_offline=True)
status = planner.public_status()  # Does not return a key or base URL.
proposal = planner.plan(
    text,
    snapshot,
    selection=None,             # Otherwise uses snapshot.selection.
    saved_scenes=["Demo"],
    mode="offline-rules",       # None = choose configured provider or offline.
)
```

The proposal contains `commands`, `summary`, `provider`, `mode`, and `requiresApply`. `PlannerError` exposes a sanitized message and HTTP-style `status`. `ProviderConfig(base_url, model, api_key, provider)` can inject a different compatible provider without changing the Unity command executor. `validate_commands(commands, snapshot, saved_scenes=None, selection=None)` is available for independent revalidation.

Allowed scene commands are `spawn`, `set_transform`, `select`, `duplicate`, `delete`, `undo`, `redo`, `clear`, `get_scene`, `list_assets`, and `list_targets`. `select` and `duplicate` accept only `op` and an existing `objectId`; `undo` and `redo` accept only `op`. The service adds a request ID when queuing execution. History commands must be standalone proposals. `save_scene` and `load_scene` are single-operation PC intents and cannot be mixed with scene edits in one proposal. The adapter rejects arbitrary runtime `load` documents and references to newly spawned or duplicated IDs that the runtime has not acknowledged yet.

Validation enforces known IDs, at most 20 proposed operations, at most 100 scene objects including proposed duplicates, finite positions within ±100 metres per axis, rotations within ±36,000 degrees, and positive scale components between 0.01 and 20. Sequential delete/clear operations invalidate their object IDs for later commands in the same proposal. Relative edits preserve unrelated transform components. The same command queue serves the PC controls, planner proposals, and runtime acknowledgements.

The HTTP service exposes `GET /api/planner`, `POST /api/plan`, and `POST /api/apply_plan`. Plans are bound to the current runtime client and scene/selection revision, expire after two minutes, and can be applied once. Creating a proposal is read-only. The service rejects pending-command, stale-state, replayed, and expired applications.

## Validation evidence

From the repository root, run:

```powershell
python -W error::ResourceWarning -m unittest discover -s ControlService -v
```

All **136 PC service and adapter tests passed** in [codex-service-tests.txt](../Validation/codex-service-tests.txt), including Codex CLI boundary tests and the existing HTTP-provider, command, persistence, stale-proposal and learning-recovery coverage. Keys remain excluded from prompts/results/status; provider errors, redirects, refusal, truncation and malformed output fail explicitly.

The unit suite is separate from the live Codex/Quest attempt: its first spawn completed, then HTTP 409 stopped the resize proposal and recovery restored the original scene. The recovery scene showed the new chair at yaw 45 despite the reviewed spawn requesting yaw 0. This supports stale-scene rejection, but the HTTP error body was not captured and the rotation's source is unknown; the exact rejection cause is unconfirmed. No successful full AI loop, live HTTP-provider run, voice, or MRUK hardware result is claimed. See the [session record](../Validation/Quest-Pro-Session.md).
