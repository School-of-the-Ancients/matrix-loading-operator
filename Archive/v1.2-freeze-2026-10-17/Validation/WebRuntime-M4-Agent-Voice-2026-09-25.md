# WebRuntime M4 Agent voice check — 2026-09-25

Source tested: `d69d7defe11e43a1fdb38340989d909355786b4f` on PR #89,
stacked on the PR #86 Quest acceptance checklist. This test used a separate
PC service and browser origin at `http://127.0.0.1:18770/web/`, with fresh
scene and asset directories. The existing Quest Matrix service on port 18767
and the `v0.6.0-preview.1` release were unchanged.

## Device and service

- Quest 3 over USB ADB, with `tcp:18770` reversed to the isolated PC service.
- Device reported Android 14; the installed Quest Browser package reported
  version `152.0.0.44.30.1069357998`.
- The service returned HTTP 200 for `/api/health` and `/web/`; `/api/planner`
  reported local Codex and PC Whisper configured. The isolated service used
  the owner's full-access, automatic-approval preference.

## Wearer observation

In **AR**, the wearer opened the isolated origin, selected the CODEX panel,
held and released its in-world voice button, and reported that the microphone,
release, and busy labels changed visibly and exactly one Codex turn appeared
from that action. The isolated PC Agent Portal persisted a completed turn with
a reply after the test. This is wearer evidence for the previously silent
Codex-panel push-to-talk path, separate from the earlier Chat-panel voice test.

The wearer also reported that VR now opens. This check does not yet establish
that the same Codex voice interaction was exercised in VR.

No room imagery or conversation text is included here. This run did not test
the broader M4 approval/Stop, room-origin recovery, comfort, or save/reopen
acceptance paths.
