# Matrix Boulder MB-0 desktop spike

MB-0 is an isolated Windows desktop scene for [roadmap #38](https://github.com/School-of-the-Ancients/matrix-loading-operator/issues/38). It streams Google Photorealistic 3D Tiles through Cesium ion as a **visual backdrop**. It does not save, extract, or interpret map geometry as Matrix world data. White Room and Room AR have their own scene generators and build fixtures.

## Requirements

- Unity 6000.6.0f1 with Windows build support.
- Internet access and a Cesium ion account with Google Photorealistic 3D Tiles enabled.
- A Cesium ion access token allowed to read asset **2275207**. Keep its privileges to the needed asset. Usage may incur Cesium ion charges.

The project pins Cesium for Unity **1.25.1** from its official scoped registry. Unity resolves its transitive dependencies on import. The generated scene is `Assets/Sandbox/MatrixBoulder/Scenes/MatrixBoulder.unity`. The build command prepares an ignored `.matrix-boulder-fixture/` Unity project containing only Boulder code and Cesium, then copies the generated scene and GUIDs back to this repository. This follows the repo's isolated White Room/Room AR build pattern.

## Local token setup

Create an access token in [Cesium ion](https://ion.cesium.com/tokens), with access to Google Photorealistic 3D Tiles. Choose one of these local methods:

1. In the PowerShell session that launches Unity or the player, set `$env:MATRIX_BOULDER_CESIUM_ION_TOKEN = '<your token>'`.
2. Put the token alone in `.matrix-boulder-token` at the project root. That file is Git-ignored. For a built player, put it next to `MatrixBoulder.exe` instead.

The token is read at Play Mode startup, assigned to the disabled tileset, then the tileset is activated. It is never written to the scene. A Unity Editor already running from Hub will not see a newly set PowerShell environment variable; use the ignored local file or relaunch Unity from the configured shell.

## Generate, play, build

1. Run `.\Build-MatrixBoulder.ps1` from the repository root. It generates the dedicated scene and builds `Builds\MatrixBoulder\MatrixBoulder.exe`. It does not replace White Room or Room AR scenes.
2. For Play Mode, open the prepared `.matrix-boulder-fixture/` project in Unity 6000.6.0f1. Open `Assets/Sandbox/MatrixBoulder/Scenes/MatrixBoulder.unity`, and place `.matrix-boulder-token` at the **fixture** root if using a file. Enter Play Mode and wait for tiles to stream. The camera begins above central Boulder near 40.0150° N, 105.2705° W.
3. Use **W/A/S/D** to fly, **Q/E** to descend/ascend, mouse to look, and the mouse wheel to change speed. Cesium's globe anchor and origin shift keep the camera near the Unity origin during long flights.
4. For a Windows player, launch `Builds\MatrixBoulder\MatrixBoulder.exe` with a token supplied as above. The token file goes next to that executable.

Cesium's default credit UI is created at runtime, and the tileset forces its required credits onto the screen. Check that the visible attribution updates while tiles are loaded. If the scene remains blank, check the in-game token message and Unity Console for ion authorization, asset permission, or network errors.

## Validation boundary

The scene generator checks the georeference, asset ID, blank serialized token, forced attribution, and Cesium flight/origin components. The build script requires a fresh Unity success marker and a nonempty executable. A live acceptance check still needs Play Mode with authorized provider credentials: recognize Boulder and fly several kilometers without visible jitter. These checks do not establish MB-1 persistence, Quest performance, or AR registration.

Sources: [Cesium for Unity quickstart](https://cesium.com/learn/unity/unity-quickstart/), [Google Photorealistic 3D Tiles tutorial](https://cesium.com/learn/unity/unity-photorealistic-3d-tiles/), [Cesium release notes](https://github.com/CesiumGS/cesium-unity/blob/main/CHANGES.md).
