# Meta Building Blocks and MRUK inspection

Inspected on 2026-09-20. Both installed package manifests report **205.0.0**: `com.meta.xr.sdk.core` and `com.meta.xr.mrutilitykit`. Source references below are relative to those packages, with line numbers from the inspected version. The local PackageCache suffixes were `c0efcbf2ba70` and `2979546e7179`, respectively; cache suffixes are not package versions.

This is a source and documentation review. It adds no runtime integration and establishes no headset or live-provider result. No provider requests, credential values, builds, quarantine restores, or antivirus changes were part of this inspection.

## Minimum reuse for the current demo

Follow the user's order: validate the actual headset first, then establish live AI access through the existing typed PC panel, then validate MRUK against manually configured Quest Pro room data. Current behavior and evidence belong in [White-Room-Validation.md](../Validation/White-Room-Validation.md).

The current PC planner already produces reviewed proposals, checks identifiers and transform bounds, and queues commands through `PcBridge` to `SandboxWorld`. Keep that path for the typed demo. A new Unity AI transport is unnecessary for this step and would add a dependency on the Meta AIBlocks assembly involved in the [historical quarantine](Security-Block.md).

For the later room stage, reuse MRUK's existing loader and geometric queries to calculate placement, then submit `spawn` or `set_transform` through the same executor. The existing [QuestRoomAdapter](../Assets/Sandbox/Runtime/QuestRoomAdapter.cs) already calls `LoadSceneFromDevice(..., MRUK.SceneModel.V1)` at line 110 and `MRUKRoom.Raycast` at line 207. Its registered placement frames convert world positions to anchor-local coordinates at line 217. Preserve that conversion, stable IDs, history, and save/load ownership.

## AI Building Blocks: reusable, but optional here

| Installed source | Finding and implication |
|---|---|
| Core: `Scripts/BuildingBlocks/AIBlocks/Agents/LlmAgent.cs:35,129,145,178,217` | A reusable prompt/response component delegates to `IChatTask` and emits UnityEvents. The overload taking an explicit null image supports text-only use. It does not execute scene commands. |
| Core: `Scripts/BuildingBlocks/AIBlocks/Tasks/IChatTask.cs:40,76` | Requests contain text and optional images; responses contain text and raw provider data. The task interface does not define tool calls or structured scene commands. |
| Core: `Scripts/BuildingBlocks/AIBlocks/Providers/OpenAIProvider.cs:43,176,217` | The stock provider requires a serialized API key and posts a single input message to `/responses`. Its chat payload includes model, input, and streaming fields, without tool definitions or a JSON schema. It is not a drop-in adapter for the current PC planner API. |
| Core: `Scripts/BuildingBlocks/AIBlocks/Providers/OllamaProvider.cs:34,66,93,173` | The stock local-server provider uses `/api/generate` with an explicitly configured host/model. It is reusable if a real Ollama server and suitable model are available; installation alone establishes neither. |
| Core: `Scripts/BuildingBlocks/AIBlocks/Providers/UnityInferenceEngineProvider.cs:69,113,173` | On-device inference requires the inference package, model asset/configuration, and model loading. No usable local model or Quest Pro performance result was established here. |

If headset prompt input becomes a requirement later, reuse `LlmAgent` with a small `AIProviderBase`/`IChatTask` adapter to the PC proposal service, retaining explicit Apply and the existing executor. This is a future option, not implemented or required for the current typed loop. Meta documents this extension point in [Adding New Providers](https://developers.meta.com/horizon/documentation/unity/unity-ai-add-new-provider/) and the agent event model in [Agents and Building Blocks](https://developers.meta.com/horizon/documentation/unity/unity-ai-agents/).

## PC-only credential contract

Provider secrets stay in the PC service configuration/process. Scene saves, Unity provider assets, the APK, and headset prompts must not contain those secrets. The current provider adapter remains responsible for authenticated inference and validating the returned proposal; a model response never directly mutates Unity objects.

Meta's `CredentialStorage` is a serialized `ScriptableObject`, not a server-side secret proxy: `Scripts/BuildingBlocks/AIBlocks/Providers/CredentialStorage.cs:58–67`. Its editor copies a central key into the provider's serialized field: `Editor/BuildingBlocks/BlockData/AIBlocks/Providers/AIProviderEditorBase.cs:108–125`. Therefore assigning a stock cloud provider asset to a shipped headset component would conflict with this project's PC-only contract. Meta's [AI FAQ](https://developers.meta.com/horizon/documentation/unity/unity-ai-faq/) also advises against shipping API credentials in builds or repositories. No credential asset contents were inspected.

## MRUK placement reuse

| Installed MRUK source | Appropriate use |
|---|---|
| `Core/Scripts/MRUKRoom.cs:749,1245,1316` | `GetBestPoseFromRaycast`, `GenerateRandomPositionInRoom`, and `GenerateRandomPositionOnSurface` provide geometry queries. Use successful results to create a validated executor command. |
| `Core/Scripts/AnchorPrefabSpawnerUtilities.cs:114,368` | Volume/plane transformation utilities supply alignment and scale calculations without taking ownership of scene objects. Convert the resulting pose into the registered target frame before applying it. |
| `Core/Scripts/FindSpawnPositions.cs:158,237,272–281` | The ready-made component searches for positions, then directly instantiates or moves GameObjects. Direct use on managed props would bypass `SandboxWorld` state. Also, the inspected surface-query failure branch can fall through toward a zero pose; explicitly handle query failure when using the underlying MRUK APIs. This observation was not runtime-tested. |
| `Core/Scripts/AnchorPrefabSpawner.cs:286,588–669` | The component creates and tracks one prefab per anchor. Use its calculations for editable props; direct component spawning is more suitable for separate environment dressing than the multi-object, undoable sandbox registry. |

## Quest Pro boundary

Keep manual room data on **Scene Model V1**. The installed `MRUK.LoadSceneFromDevice` defaults to V1 (`Core/Scripts/MRUK.cs:1052`); high-fidelity V2 is a separate choice. These placement utilities work with loaded room/anchor geometry and do not themselves require a depth-camera feed. Meta documents Quest Pro spatial-data permission support and the permission requirement before manual `LoadSceneFromDevice` calls in [Spatial Data Permission](https://developers.meta.com/horizon/documentation/unity/unity-spatial-data-perm/); the [v205 MRUK API reference](https://developers.meta.com/horizon/reference/mruk/v205/class_meta_x_r_m_r_utility_kit_m_r_u_k/) describes the scene-model selection.

Raw passthrough-camera input and depth-based environment raycasts are separate features. Installed `PassthroughCameraAccess.cs:405` names Quest 3/3S, while `EnvironmentRaycastManager.cs:157` requires Quest 3 or newer. Meta's [Passthrough Camera API overview](https://developers.meta.com/horizon/documentation/spatial-sdk/spatial-sdk-pca-overview/) likewise describes Quest 3/3S camera access. Do not make those features a dependency of the Quest Pro text-and-manual-room loop. Actual room loading, controller behavior, and placement still require the staged headset test.
