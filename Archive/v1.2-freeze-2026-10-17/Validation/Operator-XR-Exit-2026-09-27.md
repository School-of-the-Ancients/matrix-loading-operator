# Operator in-world VR/AR exit

The shared WebXR Operator panel now puts a mode-specific **EXIT VR** or **EXIT AR**
button in the upper-left of its WORLD page. A controller selection calls the
existing `MatrixView.exitXR()` and `XRSessionController.exit()` path, which ends
the active WebXR session. The ordinary 2D Exit button uses that same path.

The focused panel/controller test checks that the button exists only on WORLD
during an active session, changes label with the mode, does not overlap CODEX,
receives a real controller ray hit, and invokes one session end without
selecting a scene object. The full WebRuntime suite passed **632/632** and the
production Vite build passed; the existing large-chunk warning remains.

The Quest wearer refreshed the isolated `127.0.0.1:18795/web/` page served with
`view-CL5qEG4z.js`, entered VR, tapped Operator → WORLD → EXIT VR, and reported
that it returned to the same 2D browser page. From there, the wearer entered
AR, tapped Operator → WORLD → EXIT AR, and again reported a return to the same
2D page. These are separate wearer checks of the final bundle in both modes.

This control is for a running immersive session. During the separate #91 AR
animation check, removing and replacing the headset once left Quest Browser in
a blank AR state that required a browser restart. The exact button sequence and
cause were not established; the new in-world button was not tested in that
blank state and is not claimed as a recovery for it.
