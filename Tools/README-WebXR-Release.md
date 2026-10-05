# Freeze a WebXR/PC release

`Build-WebXR-Release.py` packages a **committed Git revision**, builds all three
Vite routes from that revision, and verifies the resulting ZIP after extraction.
It does not tag, upload, publish, or copy local browser/PC state by default.
The manifest labels a stable version such as `v1.0.0` as a release and a
suffixed version such as `v1.0.0-rehearsal` as a prerelease.

GitHub's prerelease/Latest flags are set separately during publication. The
[v1.2.0 checkpoint](https://github.com/School-of-the-Ancients/matrix-loading-operator/releases/tag/v1.2.0)
uses that version label but is published as a GitHub prerelease, with v1.1.0
remaining stable Latest. Its [guide](../Docs/V1.2-Checkpoint.md) records the
frozen source, verified assets and remaining acceptance. Documentation changes
on main do not change the release ZIP; never overwrite a published tag/assets
to incorporate a later documentation or runtime change.
The filenames and root-level bundle layout follow v0.7:

- `Matrix-WebXR-PC-VERSION.zip`
- `Matrix-WebXR-VERSION-manifest.json`
- `Matrix-WebXR-VERSION-SHA256SUMS.txt`

The ZIP contains the matching ControlService source and launchers, WebRuntime
source and locked production Node dependencies for the headless host, prebuilt
`/web/`, `/web/citizens.html`, and `/web/hosted.html`, required docs, and a
`RELEASE-README.md`. The v0.7 client API example and synthetic fixture stay in
their original paths. It omits other test fixtures, credentials, browser storage,
local scenes/catalogs, room imagery, Agent sessions, speech models, and Blender
installation/state. Editable examples under `WebRuntime/art` remain in the
source repository but are omitted from the public ZIP. Their PNG metadata,
Blender files, and authoring scripts can contain local workstation paths; the
runtime does not load these examples as a catalog. The generated
`RELEASE-README.md` links to the examples at the frozen source commit.

## Build

Install Python 3.10+, Git, Node and npm. Use a clean, reviewed commit ID from
the intended branch. In PowerShell, from the repository root:

```powershell
$commit = (git rev-parse HEAD).Trim()
python Tools/Build-WebXR-Release.py --version v1.0.0 `
  --commit $commit --output .\work\release-v1.0.0
```

The tool exports that commit with `git archive`, runs `npm ci` and the Vite
build in the export, installs only locked production packages into the bundle,
then writes a deterministic ZIP with per-file SHA-256 entries in the external
manifest. It extracts that ZIP into a temporary directory, starts an isolated
ControlService and Node world owner with fresh tokens, checks all three Web
routes, checks an advancing Ada/Bo observation, and checks owner/view token
separation. Failed build or smoke checks do not produce release assets. A
`--force` rebuild replaces files of the same version only after a successful
new package has been staged. Review the manifest and ZIP before creating a
tag or draft release. The package includes no claimed Quest acceptance;
record separate VR/AR wearer evidence for the frozen commit.

## Optional sanitized demo

Only provide a demo when its checkpoint and asset catalog have been reviewed
for publication. The checkpoint must be a completed v3 hosted Ada/Bo world with
nested Citizens v15, and the catalog must contain exactly its referenced
registered GLBs, each matching its SHA-256. For example:

```powershell
python Tools/Build-WebXR-Release.py --version v1.0.0 `
  --commit $commit --output .\work\release-v1.0.0 `
  --demo-checkpoint .\sanitized\scenes\world_checkpoints\AdaBo.json `
  --demo-assets .\sanitized\web_assets
```

The demo is placed under `Demo/` in the ZIP and copied only into the isolated
extraction test. It is never read implicitly from `ControlService/scenes`,
`ControlService/web_assets`, or a live service. Unfinished Blender job and
spawn ledgers are excluded: this option is for a completed portable scene,
not migration of in-progress generation. The author must still review every
citizen log and field for private information; field checks and SHA validation
cannot determine whether prose in a world is suitable for publication.

The hosted visitor remains read-only. The PC owner and its Node process need
the owner token, while the visitor uses the distinct view token. `/web/` is
the separate interactive browser-owned world. See
[Persistent-World-Host.md](../Docs/Persistent-World-Host.md) for startup and
the one-addition limit, and
[Versions-And-Submissions.md](../Docs/Versions-And-Submissions.md) for tagging
and submission policy.
