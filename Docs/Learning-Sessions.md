# Observation and Scale: connected learning session

This layer connects a real Unity room/object to the canonical `sota-v2` lesson runtime. It adds one authored activity: Explain → Example → Guided practice → Socratic check → Recap → Ended. The existing natural-language proposal flow changes the object; the canonical service records the prediction, acknowledged scale evidence, explanation and reflection. Completion records participation, not mastery.

The [organization review](Organization-Review.md) explains the choice and cites the attached research framework. It does not treat older research plans as instructions to replace the current Quest Pro architecture.

## Start locally

Use sibling checkouts of `matrix-loading-operator` and `sota-v2` with the connected learning changes. Node.js 24+, Python 3.10+, and Unity 6000.6.0f1 are the tested environment. In `sota-v2`, `npm ci` restores the locked frontend dependencies; the Operator server itself uses Node built-ins and the existing TypeScript domain modules.

At the Operator root:

```powershell
./Build-DesktopFixture.ps1
```

This builds an isolated desktop simulation containing authored sandbox code and Unity Input System, without the Meta packages. It runs the core and guide checks. It never builds a Quest APK and does not establish native import or headset compatibility. The full project and its open Editor are left alone.

In separate terminals, run `npm.cmd run dev:operator` in `sota-v2` and `./Start-ControlService.ps1` in the Operator. Keep both terminals open, then run `Builds/Desktop/AR-Sandbox.exe`. Stop each service with Ctrl+C in its own terminal. The core listens on `127.0.0.1:8787`; the optional learning panel is [localhost:8765/learning](http://127.0.0.1:8765/learning). An alternate core port can be selected with `$env:SOTA_CORE_URL='http://127.0.0.1:PORT'` in the PC service environment. The bridge permits local HTTP endpoints only. Existing service-token protection still applies. For Quest, use the built device application instead of the desktop player and set up USB forwarding as described in the MRUK runbook.

## Try the complete activity

1. Load the room. Desktop identifies its simulated table/floor; Quest uses the manually configured device room described in [MRUK-QuestPro.md](MRUK-QuestPro.md).
2. Place a bundled **Terracotta block** at the selected surface. Wait for acknowledgement. Select its entry under Objects, then **Start with selected block**. Starting another attempt preserves prior core records.
3. Read the explanation and example. Record a prediction before continuing to practice. Starting/current X, Y and Z multipliers are visible on the PC panel.
4. Select the bound block in Unity before saying “it.” Under Describe a change, request **Make it twice as big**, create the proposal, review it and apply. Wait for acknowledgement. The default offline parser supports this wording and is explicitly labeled; no live AI access is fabricated.
5. Describe the observed values and choose **Capture room evidence and observation**. Evidence comes from Unity's settled snapshot; browser-supplied transforms are ignored. Every axis must be twice its own baseline within 1% relative tolerance. This is a geometry condition, not an assessment of the written reasoning.
6. Explain the result in the Socratic check, then record a reflection. Hints, sources and recorded responses stay available. Unity displays a read-only guide; input and source links are on the PC.
7. **Save current room** at any stage while the bound block exists. Clear the room, then load that named save. Restore recovers the scene and forks the saved lesson checkpoint after Unity acknowledges load. If you saved earlier than you finished, the later original record remains intact.

## What is durable

- `sota-v2/.sota-data/operator/store.json`: sessions, original responses, authored lesson version/content/sources, evidence, immutable checkpoints and request receipts. Core data is local and excluded from Git.
- `ControlService/scenes/NAME.json`: the ordinary room snapshot plus an optional `learningCheckpoint` reference. Existing scene-only saves still load. Scene names are validated and files are replaced atomically.
- Both locations are needed to restore a learning save. A scene JSON alone is not a portable export of the learning record. Back up both while the services are stopped.

Restarting the PC adapter clears its current presentation binding. Load a saved learning scene to reconnect it. Unsaved sessions remain queryable through the core API, but the PC panel does not offer a general session browser or infer a room association. Learner text is not sent to a model by this authored activity. Using the separately configured AI scene planner sends the data described in [AI-Integration.md](AI-Integration.md).

## Recovery and limits

Core mutations have stable request IDs and revision checks. The browser preserves the request after uncertain transport failures and offers **Retry the same request**. The PC bridge freezes the initial context/evidence for those retries during its process lifetime. A completed old receipt never reactivates an obsolete binding.

A scene load checks its checkpoint before queuing Unity commands. The core checkpoint is restored only after a successful Unity load acknowledgment. If the core is temporarily unavailable afterward, **Retry lesson restore** uses the same ID and cannot create a second fork. If Unity reports failure or the lease expires without acknowledgment, no learning restore is assumed: dismiss the unconfirmed restore, inspect the room, then load the saved scene again. Other edits/saves are blocked while a restore is unresolved. In-flight PC operations are not journaled across a PC crash; after restarting, load the saved checkpoint explicitly.

Changed/missing room UUIDs or anchor bindings fail rather than remap to guessed positions. A missing lesson block pauses guidance. Save before clearing it; a learning checkpoint cannot be created from an absent bound block. The core's file lock and disk fingerprint reject competing writers; see the [canonical API contract](https://github.com/School-of-the-Ancients/sota-v2/blob/codex/operator-learning-sessions/docs/OPERATOR_API.md) for bounded storage, crash recovery and endpoint details.

No cloud deployment, historical persona simulation, downloaded catalog, generated grading, wiki synchronization, live model test or physical headset test is part of this increment. [Learning validation](../Validation/Learning-Validation.md) separates the evidence.
