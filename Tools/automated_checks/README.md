# Bounded development checks (#186)

The merged #191 foundation is extended here with an opt-in rendered/input
fixture under #186. It does not change the published checkpoint or establish
an integrated v1.3 baseline. Full #186/#187 acceptance remains open.

## Production-rendered, emulated input command

With the same prerequisites as the desktop command and the locked development
dependency `iwer` 2.5.0 installed by `npm ci` in `WebRuntime`:

```sh
python Tools/automated_checks/runner.py --mode rendered --output /tmp/matrix-rendered.json
```

The same runner builds a separate entry containing the production `MatrixView`,
Operator panel, world and storage code. It enters VR through the normal entry
button in a disposable Chromium context. Standalone IWER supplies emulated
poses and trigger input through WebXR and Three's controller events. It tests
selectstart -> held controller movement -> selectend -> successful production
movement receipt, the real Operator HIDE ray/hit target, and durable browser
save/reopen in a new page with no session storage. The initial spawn is a typed
fixture command. This does not test natural-language creation, service transport,
approval UI, resize, animation, physical input or grab momentum.
The report records the executed spawn/movement commands and matches each
request/object identity and movement transform to its successful receipt.
The fixture directly calls the production save/restore functions and re-shows
the panel for capture; these are not save-button or panel-recall input tests.
It uses the default virtual background, not a loaded panorama. Production
`main.js` panel status/conversation updates are not exercised; the captured
panel contains its default text, including the room-origin status.

Six PNG artifacts (first-person, left and right, before/after reopen) are saved
alongside the JSON in `<output-stem>.artifacts/`. Each has a SHA-256, dimensions,
timestamp, fixture action revision, stable object IDs, complete snapshot and
independent camera/reference-space metadata. IWER's emulated user agent must
not be interpreted as an actual Quest/browser version; `browserVersion` records
the real host Chromium. Build hashes identify the exact fixture bundles.

`MatrixView`'s explicit `developmentReview` constructor option enables the
`developer-review` capture profile. It preserves the actual virtual background
and optionally the currently visible Operator panel. The bounded inspection
cameras leave the viewer and panel placement unchanged. The target uses the
renderer's output color space; these are independent monocular perspective
images, not stereo/passthrough or the headset compositor. Existing production
shared-image and physical-camera capture defaults are unchanged. This fixture
neither sends images to an AI provider nor creates an autonomous fix loop or a
new Portal surface; the artifacts are suitable inputs for the existing review
workflow's next bounded adapter.

Missing rendered geometry, an incorrect rendered transform and a hidden
required panel are deliberately introduced in fresh fixture pages and must
fail their assertions. A blank/uniform capture throws instead of yielding
successful image evidence. These are deterministic checks, not AI judgments
of quality, readability, occlusion, comfort or visual similarity.

IWER is used only by the separate development entrypoint. Full emulation is
force-installed solely in the owned context because Chromium may expose a
native XRSystem without a usable headset. There is no production query-string
hook, remote-control server, physical pairing, live storage or native override.
Do not install full emulation and a native override on the same XRDevice.
Meta's [native override documentation](https://meta-quest.github.io/immersive-web-emulation-runtime/api/native-webxr-override.html)
describes a later device adapter; it must be installed before session creation,
and browser-owned session entry/visibility and exact device/build association
still need to be verified. The [IWSDK CLI](https://github.com/facebook/immersive-web-sdk/tree/main/packages/cli)
currently distinguishes host-only screenshot/capture tools from physical target
runtime commands. No physical screenshot support is inferred here.

## Desktop command

From the repository root, with the existing WebRuntime npm dependencies,
Python Playwright and its Chromium browser available:

```sh
python Tools/automated_checks/runner.py --output /tmp/matrix-desktop.json
```

An existing system Chromium can be selected with
`--browser-executable /absolute/path/to/chromium`. No dependency or browser is
installed automatically. For developer/CI setup, use the existing WebRuntime
`npm ci` setup and an approved Python Playwright installation (validated here
with 1.62.0). The runner reports missing prerequisites as **blocked**. Do not
change security settings to make a blocked check pass.

The runner builds a separate Vite entrypoint into a temporary directory, serves
only those fixture files on an ephemeral **127.0.0.1** port, launches an isolated
browser context and deletes it afterward. No production runtime entrypoint,
ControlService lease, live profile, save/catalog, credential or approval is used.
There is no debug-port listener. The fixture server explicitly serves JavaScript
modules with a JavaScript MIME type, independent of Windows registry file mappings.
Desktop evaluation uses the owned browser's CDP transport with a 10-second
evaluation limit; ADB/HTTP reads have 3-second
limits and 64 KiB response limits, navigation/readiness waits have 10-second
limits, and the fixture build has a 90-second limit. There are no retries.

The real Chromium fixture executes the repository's `MatrixWorld` and
`scene_store` code: spawn the fixed block → clear/load the scene → move, rotate
and scale → save to browser storage → close the page → reopen in a new page
without session storage. Assertions verify ordered matching successful runtime
receipts, stable object/asset identity, complete expected transform, and equality
of the saved/reopened world. Browser errors fail the check. These are synthetic
typed commands and real browser persistence; they do **not** test the production
UI, rendered appearance, PC command/approval transport or physical input.

## Read-only Quest readiness

Only when the owner has independently authorized and configured a USB Quest and
Quest Browser remote debugging:

```sh
python Tools/automated_checks/runner.py --mode quest-readiness \
  --cdp http://127.0.0.1:9222 --output /tmp/matrix-quest-readiness.json
```

The example port is not created by this command. Missing ADB, disconnected,
unauthorized, offline, ambiguous or unsupported devices block readiness. The
runner reuses `quest_connection.find_adb` and its supported-model set, plus the
USB-only discovery pattern. That helper's `reconnect()` is a **legacy native APK**
path and is never called. No forward/reverse mappings, native config, apps,
permissions, network settings or device state are changed.

CDP reads only `/json/version` and `/json/list` from the explicitly supplied
loopback endpoint. Credentials, paths, redirects and environment proxies are
refused. Unrelated tab URLs/titles are not recorded. A reachable CDP endpoint is
not proof that it belongs to the USB Quest or that Matrix is running. This draft
therefore always reports Quest **execution blocked**, even when discovery passes:
exact running-build attestation, isolated on-device fixture execution and XR
session inspection remain to be implemented. No browser page is attached or
edited. No Quest connection was attempted during this cloud implementation.

## Evidence and regression checks

JSON reports contain pass/fail/blocked checks, expected/actual fixture values,
receipts, logs, elapsed check times, source commit/dirty state and SHA-256s,
exact fixture build hashes, runtime descriptor, browser/Node/Python versions,
and available device model/serial/OS build. Absent device evidence is null.
XR entry, hardware capture/performance and wearer acceptance are explicitly
unrun. Timings are diagnostic check duration, not headset performance metrics.
Report paths are caller-selected; keep private device evidence local.
Exit codes: **0 pass, 1 fail, 2 blocked**. A failure takes precedence over blocked.
Changed source during the run invalidates the result. Preserve reports from the
exact tested commit outside the source tree; do not relabel old evidence.

```sh
python -m unittest discover -s Tools -p 'test_automated_checks.py' -v
# Linux with an existing system browser, if Playwright's browser is absent:
MATRIX_CHECK_BROWSER=/usr/bin/chromium python -m unittest discover -s Tools -p 'test_automated_checks.py' -v
```

The focused suite includes mocked ADB/CDP states, blocked/failure aggregation,
unsafe endpoint refusal, corrupted transform/receipt/reopened-world negative
controls and real desktop browser execution. The negative controls also run in
fresh interpreters with `python -O` and `PYTHONOPTIMIZE=2`; evidence gates use
explicit exceptions and cannot be disabled by Python optimization. Missing browser dependencies fail the regression suite rather
than silently skipping coverage. This repository has no existing CI workflow;
these commands are suitable for its cloud development environment without adding
a new service or production dependency. Continue running the full commands in
`WebRuntime/README.md`, the ControlService JS tests, Tools tests and existing
`Tools/Build-WebXR-Release.py` packaging/extracted smoke checks on final source.
The runner and fixture are excluded by the release builder's existing allowlist.

## Later physical validation and evidence reuse

Keep the existing [consolidated v1.2 headset acceptance record](https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/de7cfb2bcdd0126dce8a7bf5fc86c69accdf123c/Validation/V1.2-Headset-Acceptance.md)
as the single current sprint wearer checklist. This tooling does not invalidate
unchanged evidence or trigger a repeated manual review loop. Do not edit that
candidate's evidence to claim this draft was tested there.

The smallest later hardware step is one authorized USB/read-only readiness run
with Quest Browser already open; verify its reported model/OS/browser versions
and independently confirm the CDP-device association. It still cannot pass Quest
execution in this draft. Keep actual XR entry/session readiness, controller/hand
input, alignment/relocalization, readability/comfort and hardware captures or
performance in the existing acceptance process. Animation, grab momentum,
automated XR input/capture and full Quest execution remain #186 backlog.
