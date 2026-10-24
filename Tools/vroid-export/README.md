# VRoid native VRM 1.0 export

`export-vrm.patch` extends the MIT-licensed
[brainrom/vroid-studio-mcp](https://github.com/brainrom/vroid-studio-mcp), upstream
commit `a6b0719d01fa6cac9a857956907243d9916390b2`. The upstream license is retained
in `LICENSE.upstream`. VRoid Studio and its models are not distributed here.

Apply with `git apply <path-to-export-vrm.patch>` inside that checkout. Build its
existing project using .NET SDK and `-p:GameDir=<VRoid-2.14.0-directory>` after
BepInEx has generated the interop assemblies. Copy the resulting plugin DLL into
the app's existing `BepInEx/plugins` folder with VRoid closed. Preserve the user's
open character before restarting. No application binary is replaced.

The MCP operation is `export_vrm(path, title)`. It requires an open, settled model,
an absolute `.vrm` output path and an existing output directory. It does not
overwrite an existing destination or prior partial export. It invokes the native
VRM 1.0 coroutine, waits for completion callbacks, and publishes the file only on
success. Matrix independently validates humanoid structure, expressions, embedded
resources, byte/vertex limits and the file hash before registration.

Verified locally with VRoid Studio 2.14.0 / Unity 6000.0.62f1 on Windows. An actual
export retained humanoid bones and speech/blink expressions. Other editor versions need
a compatibility check because this plugin uses the editor's internal API.
