# Operator panel recall — Quest 3 check, September 26, 2026

PR #97 adds an in-world **HIDE** control and an `xr-standard` controller
thumbstick-click shortcut to recall a pinned Operator panel, hide a following
panel, or show a hidden panel. This check used an empty disposable WebRuntime
scene on port **18785**, separate from the wearer's other Matrix scenes.

## Build and setup

- Source: `471350f6ade15c3a3d29d8051256be9cc4a5ebdf` on
  `codex/m4-panel-recall`; served bundle `index-ZWZw6F05.js`.
- Quest 3: Android 14, Quest Browser `152.0.0.44.30.1069357998`, connected
  through USB ADB reverse to `http://127.0.0.1:18785/web/`.
- The isolated PC service had local speech and a full-access, automatic-approval
  Agent Portal configured, but this check did not start an Agent turn or modify
  a scene object. The AR runtime reported `ready` with 38 measured room planes.
- `npm test` passed **130/130** tests; `npm run build` and `git diff --check`
  passed before the headset run.

## Wearer observations

| Mode | Action | Observation |
| --- | --- | --- |
| VR | Pin Operator, turn until it is out of view, click a thumbstick to recall, tap HIDE, then click again to show | Wearer reported all actions worked and the blue controller ray remained visible on the controls. |
| AR | Exit VR and enter AR on the same page, pin Operator to a wall, aim at its controls, click to recall, tap HIDE, then click to show | Wearer reported all actions worked in AR, including the wall pin and visible blue ray. |

This is wearer evidence for the new panel controls in both modes. It does not
measure text readability or verify that a long CODEX reply stays on the same
page, or that an active Agent turn survives hide/show. Approval and Stop
behavior were not exercised in this run; their Quest acceptance rows remain
open.
