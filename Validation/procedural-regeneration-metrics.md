# Procedural regeneration and instance isolation

Measured September 26, 2026 on the isolated Creator/Citizens branch with Node.js v24.16.0 on Windows. Run `cd WebRuntime` and `node --test test/procedural_view.test.js` to repeat the fixed-input sample. The test creates each reviewed recipe four times for warmup, then records 28 `makeProcedural` calls. Each call includes recipe validation, geometry generation, Three.js buffer construction, and vertex-normal computation; it disposes its meshes after measuring. Median and nearest-rank p95 are reported as diagnostics, without a timing assertion that would vary across machines.

| Recipe | Parts | Vertices | Triangles | Contract buffer bytes | Median | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Curved bench, 2.2 m / 90° | 4 | 448 | 224 | 8,064 | 0.834 ms | 1.154 ms |
| Sloped bridge, 8 m × 2 m / 1 m rise | 11 | 264 | 132 | 4,752 | 0.714 ms | 1.227 ms |

Both outputs remain below the enforced generator limits of 32 parts, 4,096 vertices, 8,192 triangles, and 131,072 contract buffer bytes. The contract byte count describes generated positions and indices; it is not total renderer or GPU memory.

The view regression creates two real Matrix procedural instances from the same curved-bench generator, revises one eight times, and calls `MatrixView.sync()` after each accepted revision. It checks that the other instance keeps the same root, geometry and material objects and unchanged vertex/color data, with **zero** dispose events. The revised instance gets new meshes on every edit; its prior four geometries and four materials emit dispose events each time. This assertion failed before selective reuse because `sync()` disposed every root.

These are local CPU measurements and Three.js resource-lifecycle checks. They do not measure GPU upload, rendered frames, headset comfort, or Quest performance.
