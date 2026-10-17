# Concept #91: selected Comfy v2 to continuing Agent to Matrix

Date: 2026-09-27. This trace used a copied acceptance scene and asset catalog on an isolated loopback ControlService at port `19870`, with a separate owner token and browser origin. The original acceptance data and existing review services were not used for writes. The ready Comfy image was reused; no Comfy generation or configuration was started.

## Selected image and native Agent input

- Continued the existing Agent session `107c243008e941c09e8e7a7b871fd718` and native conversation `01a0e4be-7a58-7fd2-bcc1-fda94a5a3ec3`. The session had five completed turns before this run; it did not start a new conversation.
- Selected ready ComfyUI concept `e96a86c8becb497b893791392fd406a9`, version `2`, parent `e445627be262427686d855fa5b43a399`. Its source record names `fleet-comfy`, workflow `krea2-turbo`, workflow SHA-256 `2e261f4a556c89758ff137a801478a29cd208042e9a925571f1fd89491dbc408`, and seed `393938399`.
- The copied selected PNG hashes to SHA-256 `ac6157b482f70b89aa93b4bcd7881a7ecb5f7503451eeb0b888453b3f3e400d6` (1,122,169 bytes). The same continuing native conversation's new user input contained an `input_image` PNG; decoding those input bytes independently produced the same length and SHA-256. This verifies that the actual selected Comfy v2 image entered the Agent turn, rather than only its text description.

## Reviewed build and observed receipts

The copied `Concept 91 Blender bridge acceptance` checkpoint supplied the baseline scene. Before the build, the connected browser reported revision `3`, no pending commands, Block `e647674f24c541758de23075de9561c1` at `(0, 0, -2)`, and the earlier version 4 GLB `0b8d7b29509943898939e9f01ab83a14` at `(-3, 0, -2)`.

One explicit selected-version-2 procedural build request started Agent turn `01a0e652-b6ef-7dd2-9417-7e9e1c0a1aec` and build request `b7158ecc29ab44d9a5de46dbe3aadc35`. The turn used the reviewed/on-request approval gate. Two approvals were reviewed against exact summaries and live scene revisions:

| Action | Typed receipt | Observed result |
| --- | --- | --- |
| Create `bridge-v1` at `(3, 0, -2)`, length `3.4 m`, width `1.2 m`, deck height `0.55 m`, rise `0.22 m`, railings and supports | `464aedf075b44b0bb437c7b01ce395e6` | `ok: true`; object `fb2853c93aa540afaefef60ca0ef1e14` appeared in live scene state |
| Set static procedural mesh rigid body, friction `0.8`, restitution `0`, sensor `false` | `fbd8f500afb643ca9e8159da1b0cfafe` | `ok: true`; rigid state `static` for the same object |

After the receipts, live scene revision `7` had three objects and zero pending commands. The original Block and version 4 GLB retained their IDs and transforms. The Agent turn completed with no pending approval. The copied ConceptStore recorded build `b7158ecc29ab44d9a5de46dbe3aadc35` as `completed`, bound to concept `e96a86c8becb497b893791392fd406a9`, version `2`, the PNG SHA-256 above, the same Agent turn, `bridge-v1`, the new object ID, and the creation receipt. The collider receipt is separately confirmed by live state; the build record lists the creation receipt.

## Durability and limits

The three-object copied world was saved as `Concept 91 Comfy v2 selected acceptance`, then reopened through the PC checkpoint control. The saved checkpoint SHA-256 is `5289864e22e64bf545dab33c6bda30b84c4f5d861efa7bd7cdeba323ca2732a8`. After reopen, the browser still reported all three exact IDs and transforms, one rigid state, and zero pending commands. After stopping and restarting **only** the isolated `19870` service, `POST /api/agent/session` resumed the same session and conversation idle, with the v2 selection and completed ConceptStore build intact; the connected browser still reported all three objects.

The original acceptance portal, concept store, and asset manifest remained byte-identical at the end of the run (SHA-256 respectively `dadd3f7aea388f825e5a34202e8d53e5aa0f9b7882c19b053bdfe5a18165aeaf`, `354fbe5c33d71956bc504f4507dc975b52c0eebad7cfcd293af02fcf84af73de`, and `dabb87a36a98d45d4d76df9a11033dd99d7ddc745590c6a7b5a94eb640131ff0`).

The reviewed generator produces a gentle slope, not the image's centered arch. Its fixed materials omit the turquoise trim, amber light accents, and closely spaced rail bars. The static collider is configured and observed; human traversal was not tested. This isolated desktop trace does not establish Quest wearer comfort, physical room alignment, or AR behavior.
