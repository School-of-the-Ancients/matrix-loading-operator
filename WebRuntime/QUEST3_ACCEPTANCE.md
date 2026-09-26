# Quest 3 WebXR acceptance record

Use an isolated test origin or browser profile and a separate PC service port. Preserve the wearer's existing Matrix browser storage and room anchors. Run VR and AR separately; a pass in one mode does not establish the other. For each run, record date/time, headset OS, Quest Browser version, test URL, service revision, PR head, PC Agent access/approval modes, voice availability, and granted or rejected WebXR features. Record the test object IDs, request/turn IDs, receipts, and wearer observations without publishing private room imagery or credentials.

The results below are **unverified for the current stacked head** until a wearer fills in a mode-specific pass, fail, or unavailable result with evidence. The [September 25 AR trace](../Validation/WebRuntime-Desktop-2026-09-25.md#live-quest-3-ar-trace) records visible animated assets, earlier ray/grab failures, and a limited automatic-approval check. It does not verify the updated ray/grab behavior, Quest microphone transcription, a complete Agent workflow, or VR.

| Run | Device/browser, URL and revision | PC mode and XR permissions | Result/evidence link |
| --- | --- | --- | --- |
| VR | Unverified | Unverified | Unverified |
| AR | Unverified | Unverified | Unverified |

## Agent workflow — record VR and AR independently

Use the same supported select → request → review → revise → interact → save/reopen journey in each mode. Keep a single Agent Portal conversation for the follow-up and reconnect checks. A queued or unconfirmed action is not an executed result.

| Check | Wearer evidence and pass condition | VR result/evidence | AR result/evidence |
| --- | --- | --- | --- |
| Entry and legibility | Record `immersive-vr` or `immersive-ar` entry, granted features, panel distance/contrast, readable conversation and activity text, and any obstruction. | Unverified | Unverified |
| Target, ray, grab | Record selected object ID separately from pointed hit/anchor. Aim the controller ray across the Operator panel, select an animated object, then grab, move and release it. Ray stays visible to the target; selection and grab target the intended object. Record the resulting transform and any applicable receipt. | Unverified | Unverified |
| Request and revision | Send a request using the available headset input, observe activity and the reviewed Matrix action through its receipt, then ask for a change to the same object in the same thread. Record input route, turn IDs, object IDs and any stale-state rejection. | Unverified | Unverified |
| Reviewed approval and denial | With PC approval mode `reviewed`, exercise one bounded XR-reviewable action and one denial. The displayed action is specific, Approve Once/Deny affect only the live request, and denial does not mutate the world. A generic PC command needing detailed review remains an explicit PC handoff; no XR approval is offered for an unreviewable request. | Unverified | Unverified |
| Automatic approvals | With PC-owner-configured mode `automatic`, record the effective mode shown in XR and one eligible PC command plus one Matrix write. Neither requests a native approval; the Matrix write still passes validation and obtains a runtime receipt. Record any external MCP elicitation separately. The headset cannot change PC access or approval policy. | Unverified | Unverified |
| Stop | Interrupt an active turn from XR. Record the turn state and any pending command status; Stop does not silently start another turn or claim rollback of already dispatched work. | Unverified | Unverified |
| Voice | Record microphone permission, hold/release input, transcript, and a follow-up in the same thread as a typed browser request. If unavailable or denied, record the exact status and verify typing remains usable. Speech output, if enabled, is distinguishable from input. | Unverified | Unverified |
| Panel placement | Bring the Operator into view and switch between follow and pinned placement. Check aiming at all required controls without losing the ray, and record whether moving or hiding the panel is available and usable in this build. | Unverified | Unverified |
| Save and reconnect | Save the supported world, close/reopen Quest Browser, and reconnect to the same Agent conversation. Compare object IDs, configuration/game progress, selected target and thread ID; record missing assets or restore errors instead of substituting content. Label the PC backup scene-only. | Unverified | Unverified |

## AR room checks

Run these after the AR Agent journey, using a disposable world for recovery cases. Record **pass**, **fail**, or **unavailable** for each check, with the exact browser error or capability status for failures.

| Check | Evidence to record | Pass condition | AR result/evidence |
| --- | --- | --- | --- |
| AR entry | `immersive-ar` result and granted plane/anchor features | Passthrough is visible behind transparent Three.js objects; unsupported features are reported accurately. | Unverified |
| Saved room | A test object ID, location, persistent handle result, browser close/reopen result | The same test world appears at the same physical origin only after its saved anchor is tracked. | Unverified |
| Origin recovery | Missing handle, restore failure, temporary pose loss and return, retry, both explicit archive choices in a disposable test world | Old content stays hidden and edits stay paused until tracking returns or the wearer confirms a new origin; archived scene and game remain exportable. | Unverified |
| Support footprint | One centered asset, one rotated GLB, and a concave or narrow measured plane | The renderer rejects objects that would extend beyond the measured support. | Unverified |
| Camera probe | Permission result, visible status text with resolution and selection route, camera stop/restart, page hide/show | Mixed capability appears only while a confirmed environment stream is live; denied, unknown, or front cameras remain virtual-only. | Unverified |
| Visual review | Capture receipt and labeled camera/virtual image | Both images are useful for qualitative review and the capture is never described as pixel aligned. | Unverified |
| Game save | Object IDs, role bindings, score, and goal state before and after a browser reopen | The version 2 world restore keeps the same scene and game progress. | Unverified |

Do not reset the wearer's live room origin, clear its site data, or force tracking loss to run this checklist. A desktop build or emulator result does not count as Quest acceptance.
