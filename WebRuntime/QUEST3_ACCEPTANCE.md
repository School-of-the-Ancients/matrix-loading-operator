# Quest 3 WebXR acceptance record

Use an isolated test origin or browser profile and a separate PC service port. Preserve the wearer's existing Matrix browser storage and room anchors. Record headset OS and Quest Browser versions, test URL, service revision, and PR head before each run.

| Check | Evidence to record | Pass condition |
| --- | --- | --- |
| AR entry | `immersive-ar` result and granted plane/anchor features | Passthrough is visible behind transparent Three.js objects; unsupported features are reported accurately. |
| Saved room | A test object ID, location, persistent handle result, browser close/reopen result | The same test world appears at the same physical origin only after its saved anchor is tracked. |
| Origin recovery | Missing handle, restore failure, temporary pose loss and return, retry, both explicit archive choices in a disposable test world | Old content stays hidden and edits stay paused until tracking returns or the wearer confirms a new origin; archived scene and game remain exportable. |
| Support footprint | One centered asset, one rotated GLB, and a concave or narrow measured plane | The renderer rejects objects that would extend beyond the measured support. |
| Camera probe | Permission result, visible status text with resolution and selection route, camera stop/restart, page hide/show | Mixed capability appears only while a confirmed environment stream is live; denied, unknown, or front cameras remain virtual-only. |
| Visual review | Capture receipt and labeled camera/virtual image | Both images are useful for qualitative review and the capture is never described as pixel aligned. |
| Game save | Object IDs, role bindings, score, and goal state before and after a browser reopen | The version 2 world restore keeps the same scene and game progress. |

Record **pass**, **fail**, or **unavailable** for each check, with the exact browser error or capability status for failures. Do not reset the wearer's live room origin, clear its site data, or force tracking loss to run this checklist. A desktop build or emulator result does not count as Quest acceptance.
