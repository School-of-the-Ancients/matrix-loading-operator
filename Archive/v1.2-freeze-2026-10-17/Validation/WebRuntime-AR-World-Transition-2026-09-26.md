# Quest AR world and VR-to-AR transition — September 26, 2026

This check used Quest 3 (Android 14, Quest Browser
`152.0.0.44.30.1069357998`) over USB ADB reverse. Each port was a separate
browser origin with a disposable PC service scene and copied Ice Dragon GLB
catalog. The normal Matrix service and port-18778 world were not changed.

## Baseline: saved VR world hidden on first AR entry

On merged main `dc386d1b28ba5458938f246da3ade8dd12fd02d6`, port **18782**
served bundle `index-CPeBuvrU.js`. Its saved VR Ice Dragon
`b7b2c88caa184442a105152e7c264a56` was playing `Flight`. When the wearer
entered AR on that same page, Matrix reported `roomContext.mode=ar`,
`state=missing`, `readOnly=true` (revision 15), and kept the Dragon in the
scene data while hiding it. The wearer reported: “dragon missing sceen looks
empty.” No Archive or Reset action was taken. The missing persistent AR anchor
for a VR-created world triggered the protective origin guard.

## Fresh AR creation loop on merged main

Port **18783** served the same merged WebRuntime bundle with a new origin,
empty scene, local speech, and a PC Agent Portal configured for full access
and automatic approvals. The wearer entered AR, saw room outlines, and tapped
**Outlines align — enable editing**. The service reported AR `ready` with 38
measured room planes. In CODEX, the wearer used voice to load the existing Ice
Dragon at `(0, 1.5, -2)`, scale `0.5`, and bind `Flight`. The wearer saw it
appear and animate. The browser acknowledged spawn request
`b9d6636907184fb880e6fb025177aa95` and binding request
`3957f5362b494643aca34d40cb1e841b`, both for object
`f5dd39b12c9d4d4e8ee66483eee2c0ae`.

In the same CODEX conversation, the wearer asked by voice to move the Dragon
30 cm along room positive X and keep Flight. Runtime request
`5bbd691211664da6a0261974b4bb3622` succeeded, the scene position became
`(0.3, 1.5, -2)`, and the wearer saw it move while flapping. The wearer then
confirmed that the blue ray remained visible on the CODEX panel and grabbed,
moved, and released the Dragon. The resulting saved pose was
`(-0.199, 1.528, -1.957)` with the same object ID and `Flight` binding.

The wearer tapped **WORLD → SAVE WORLD** and saw its notice. The PC service
wrote scene-only backup `WebWorld_20260926071454.json`; the browser checkpoint
remained the whole-world save. The wearer exited AR, closed the browser tab,
reopened the same URL and entered AR again. A new runtime client ID connected,
the service reported AR `ready`, and the same Dragon ID, grabbed pose and
`Flight` binding returned. The wearer confirmed the Dragon, animation and
earlier CODEX conversation were visible again. The PC Portal retained
conversation ID `01a0dc8d-9880-72e0-8e75-96a1fbead77f` with two turns.

## Candidate fix: VR world previews in AR

Port **18784** served the initial AR-origin fix commit `a7552e7` and bundle
`index-DcbjZSAC.js` from a separate new browser origin. The wearer entered
VR first. The PC queued one Ice Dragon spawn at `(0, 1.5, -2)`, scale `0.5`,
then bound `Flight`; runtime receipts `100a154b209c4b2bb56b60bc2d694b64`
and `6d4f13dd92254bb39023234a9b19dc28` both succeeded for object
`b85694c11e6f4c09ad3bd822ad092bb8`. The wearer saw it flapping in VR,
exited VR, and entered AR on the same page. Matrix reported AR `ready`,
`readOnly` absent, and the same object and Flight binding at revision 8. The
wearer confirmed it was visible and flapping in both modes.

Code review then found provenance edge cases in that initial commit. The final
branch includes additional fixes and automated coverage; this Quest
observation is evidence for the first VR-to-AR preview path on `a7552e7`, not
a wearer test of every later revision.

## Remaining checks

Quest validation is still needed for temporary room-pose loss and recovery,
missing or mismatched persistent handles, the explicit archive/rebase choices,
measured-surface object hiding, support footprint, camera access, visual
review, and full approval/Stop behavior. None was inferred from the successful
virtual-floor preview or the fresh AR creation loop.
