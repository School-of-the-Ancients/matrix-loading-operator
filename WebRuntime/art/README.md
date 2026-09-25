# Ice Dragon WebXR example

`build_ice_dragon.py` is an editable Blender 5.2 authoring script produced during an isolated Agent Portal test of the request “create a cool flying ice dragon and have it be animated and interactive.” The `.blend` is editable source; the `.glb` is the runtime asset; the PNG is a preview.

The GLB has two validated clips:

- `Flight` loops wing flaps, hovering, and tail sway.
- `Frost Burst` opens the jaw, moves frost shards, and animates the wings once when selected.

Rebuild from a Blender 5.2 installation with:

```powershell
blender -b --factory-startup --python WebRuntime/art/build_ice_dragon.py
```

Register the GLB into the **PC service's chosen WebXR catalog** with:

```powershell
python ControlService/register_web_asset.py WebRuntime/art/ice-dragon.glb --name "Ice Dragon"
```

The catalog records the two clip names. Spawn the registered asset on `web-floor` and bind `loopClip: "Flight"`, `selectClip: "Frost Burst"` through the existing WebXR command or Matrix tools. A desktop click or XR select on that instance triggers Frost Burst. Asset registration and animation binding retain the normal catalog, receipt, and scene persistence checks; copying a GLB into the browser alone does not load it.

Automated tests parse the actual GLB through the Python catalog validator and Three.js `GLTFLoader`/`AnimationMixer`. An isolated desktop `/web/` test registered, spawned, and bound it with successful runtime receipts and visible rendering. Blender MCP was not used for this asset: the Agent Portal's arbitrary Blender MCP approval was not reviewable from XR, so the test used Codex's local Blender script fallback. Quest wearer interaction remains unverified.
