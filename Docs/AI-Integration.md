# Natural-language scene control

The PC service has two explicitly labeled planner modes. Both create reviewable proposals and use the same validated scene-command path. Neither planner changes Unity objects directly.

- **offline-rules — Offline command parser (not an AI model):** a finite English vocabulary that runs locally without credentials or network inference.
- **openai-compatible:** sends the request, asset catalog, room-target IDs, current objects/transforms, current selection, and saved scene names to the configured Chat Completions provider. The provider proposes structured operations; the service validates them before allowing Apply.

No compatible provider/model configuration was found during the narrow September 20, 2026 inspection of process, user, and machine API environment variables or the checked standard Continue/OpenCode/Aider/LM Studio config paths. No Codex login credentials were read or reused. The external model route was tested against a local mock HTTP provider, not a live AI model. Offline mode is available for the prototype's complete typed-command demo.

## Prototype sequence

Select a real floor/table placement in the headset, then enter each request in the PC control page. Review and apply each proposal; wait until the runtime acknowledges it before continuing.

1. `place a block here`
2. `make it twice as big`
3. `move it 20 cm left`
4. `rotate it 45 degrees`
5. `save scene as Demo`
6. `clear the scene`
7. `restore Demo`

`it` means the selected existing object, using its stable scene ID. `here` means the selected room anchor and selected point in that anchor's local coordinate frame. After spawning, the Unity client selects the newly created object and reports its ID. Point at an older prop and press the selection trigger to edit that prop instead. `delete it` removes the selected object.

Save and restore are PC service operations. A save waits for the runtime's commands to finish; restore queues the saved scene through the normal Unity load operation. Neither operation asks the language model to serialize an arbitrary scene file. Reusing a save name replaces that PC save. Restoring requires a known saved name and compatible room/anchor IDs.

## Offline vocabulary

The parser accepts one operation per request. Unsupported wording fails with examples; it does not invent a target or silently approximate a complex request.

| Request | Interpretation |
|---|---|
| `place a block here` / `block here` | Use the selected surface and point; block can match a bundled cube |
| `put a ball on the floor` | Use a uniquely named floor; ball can match a bundled sphere |
| `make it twice as big` / `make it half as big` | Multiply the existing scale by 2 / 0.5 |
| `scale it by 1.5` | Multiply each existing scale component by 1.5 |
| `move it 20 cm left` | Subtract 0.2 metres from target-local X |
| `move it 1 m forward` | Add 1 metre to target-local Z |
| `rotate it 45 degrees` | Add 45 degrees to local Y rotation |
| `rotate it 45 degrees left` | Subtract 45 degrees from local Y rotation |
| `delete it` | Delete the selected object |
| `delete the cube` | Delete only if exactly one existing cube matches |
| `save scene as Demo` | Save the acknowledged scene on the PC |
| `clear the scene` | Clear runtime objects; preserve PC saves |
| `restore Demo` / `load scene Demo` | Restore a known PC save |
| `list assets` / `list targets` / `show scene` | Read the available catalog/state |

Directions use the target's local axes, not the user's current gaze. `toward me` is unsupported because the snapshot does not contain a head pose. Multiple tables, duplicate object types, missing selection, unknown assets, and unknown saved names require a more specific request or headset selection.

## Configure a model provider

Start the PC service with these environment variables already set:

| Variable | Meaning |
|---|---|
| `SANDBOX_AI_BASE_URL` | HTTPS API prefix, such as `https://api.openai.com/v1`; the adapter appends `/chat/completions` |
| `SANDBOX_AI_MODEL` | Exact model name available to that provider/account |
| `SANDBOX_AI_KEY` | Provider API key, kept only in the service process environment |

Explicit `SANDBOX_AI_*` values take precedence. Otherwise, `OPENAI_API_KEY` plus `OPENAI_MODEL` are recognized, with optional `OPENAI_BASE_URL`; or `OPENROUTER_API_KEY` plus `OPENROUTER_MODEL`. A key alone does not select a paid model. Local OpenAI-compatible servers may use an HTTP loopback URL and omit a key; remote providers require HTTPS and a key. Redirects are rejected rather than forwarding authorization to another endpoint.

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

Allowed scene commands are `spawn`, `set_transform`, `delete`, `clear`, `get_scene`, `list_assets`, and `list_targets`. `save_scene` and `load_scene` are single-operation PC intents and cannot be mixed with scene edits in one proposal. The adapter rejects arbitrary runtime `load` documents and references to newly spawned IDs that the runtime has not created yet.

Validation enforces known IDs, at most 20 proposed operations, at most 100 scene objects, finite positions within ±100 metres per axis, rotations within ±36,000 degrees, and positive scale components between 0.01 and 20. Sequential delete/clear operations invalidate their object IDs for later commands in the same proposal. Relative edits preserve unrelated transform components.

The HTTP service exposes `GET /api/planner`, `POST /api/plan`, and `POST /api/apply_plan`. Plans are bound to the current runtime client and scene/selection revision, expire after two minutes, and can be applied once. Creating a proposal is read-only. The service rejects pending-command, stale-state, replayed, and expired applications.

## Validation evidence

`python -m unittest test_ai_adapter -v` covers offline selection/placement, edits by existing identity, save/clear/restore intents, ambiguous references, unknown IDs, bounds, strict proposal structure, provider configuration, and the actual HTTP request/response path against a local mock. It also checks that keys are excluded from prompts/results/status, HTTP errors do not expose response bodies, redirects are blocked, and provider refusal/truncation/malformed JSON fails explicitly.

The initial 31 tests passed; after adding a malformed-choice regression and closing HTTP error responses, all nine mock-provider tests plus the numeric-bound regression passed with `ResourceWarning` treated as an error. This is adapter/transport validation, not proof of a live model connection or a hardware demo.
