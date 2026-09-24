# Matrix Boulder v0.1 — Product and Implementation Plan

**Status:** Proposed implementation slice  
**Date:** 2026-09-23  
**Repository:** `School-of-the-Ancients/matrix-loading-operator`

## 1. Product idea

Matrix Boulder is a persistent virtual reconstruction of Boulder, Colorado that exists independently of any one headset.

The same world can be viewed in different ways:

- **Desktop/VR:** enter the complete virtual Boulder.
- **AR:** stand in physical Boulder and see the corresponding nearby portion of virtual Boulder aligned to the real city.
- **AI citizens:** live continuously in the virtual world using persistent world coordinates, schedules, homes, jobs, objects, and relationships.
- **Future robotics:** a virtual citizen may optionally control a physical embodiment while preserving the same identity and world state.

The key design principle is:

> **Build the persistent virtual world first. AR is a registration/view layer into that world, not a separate collection of AR objects.**

This document defines only the first small, testable implementation slice.

---

## 2. Relationship to existing Matrix roadmaps

Matrix Boulder does not replace the existing Matrix Loader or NPC roadmaps.

- **#12 — Matrix Loader foundations** owns content loading, scene editing, stable identity, finite actions, persistence, room alignment, and reusable runtime behavior.
- **#29 — AI NPCs** owns autonomous characters, needs, schedules, navigation, GOAP, memory, social behavior, and simulation persistence.
- **Matrix Boulder** owns world-scale geospatial coordinates, city data, streaming/rendering, and the mapping between Matrix entities and positions on Earth.

This separation allows Boulder to be loaded before autonomous NPCs are complete, and allows NPC development to continue in small test scenes without requiring a city-scale renderer.

---

## 3. v0.1 objective

Create a desktop-first Unity scene that loads a recognizable, correctly georeferenced Boulder and proves that Matrix entities can be stored in Earth coordinates rather than fragile Unity-local coordinates.

### v0.1 user story

A developer launches **Matrix Boulder** on Windows and can:

1. load a 3D representation of Boulder;
2. fly around the city;
3. inspect the current latitude / longitude / height;
4. place a Matrix marker/entity at a geodetic coordinate;
5. quit and reload;
6. see that entity return at the same real-world location.

A single test NPC may be represented by a capsule/placeholder in v0.1. Autonomous behavior is not required for acceptance.

---

## 4. Non-goals for v0.1

Do **not** block the first milestone on:

- Quest performance optimization;
- Android XR / XREAL Aura support;
- city-wide NavMesh generation;
- realistic pedestrians or traffic;
- AI dialogue;
- GOAP;
- fully modeled building interiors;
- real-time multiplayer;
- robotics;
- procedural world reskinning;
- downloading/caching Google Photorealistic 3D Tiles for offline ownership.

These belong to later milestones.

---

## 5. World architecture

```text
                    MATRIX WORLD STATE
                           |
          persistent IDs + WGS84/ECEF geospatial poses
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
   City renderer       NPC simulation      AR registration
   Unity/Cesium        #29 autonomy        Android XR later
        |                  |                  |
        +------------------+------------------+
                           |
                    VIRTUAL BOULDER
                           |
               registered to physical Earth
```

### Canonical coordinates

World-scale entities must not use Unity `Vector3` as their canonical position.

Use a serializable geospatial pose such as:

```json
{
  "entityId": "npc_0001",
  "latitudeDegrees": 40.0,
  "longitudeDegrees": -105.0,
  "heightMeters": 1600.0,
  "headingDegrees": 0.0
}
```

Unity transforms are a rendered projection of this state.

For planet-scale conversion and origin handling, use Cesium's georeferencing/ECEF support rather than inventing a custom floating-origin system in v0.1.

---

## 6. Data-source strategy

### Layer A — visual bootstrap

Use **Cesium for Unity** with streamed **Google Photorealistic 3D Tiles** or another Cesium-compatible visual tileset to get Boulder visible quickly.

Purpose:

- visually recognizable city;
- terrain and buildings;
- rapid VR/desktop prototype;
- validate world scale and georeferencing.

Google data is a visualization source only. Do not derive, trace, scrape, machine-interpret, or build the canonical Matrix database from Google's Photorealistic 3D Tiles. Do not implement unauthorized offline caching.

References:

- https://cesium.com/learn/unity/unity-photorealistic-3d-tiles/
- https://developers.google.com/maps/documentation/tile/policies

### Layer B — persistent semantic Boulder

Build durable world semantics from sources that permit reuse.

Initial candidates:

- City of Boulder Open Data (CC0);
- City of Boulder ArcGIS services;
- Boulder LiDAR products;
- OpenStreetMap for roads, paths, buildings, and POIs where appropriate.

The City of Boulder states its open-data catalog is CC0 and permits use, modification, and redistribution.

References:

- https://bouldercolorado.gov/services/open-data
- https://gis.bouldercolorado.gov/ags_svr1/rest/services/general/LiDARTileIndex/MapServer

This semantic layer eventually answers questions such as:

- What building is this?
- Is this a sidewalk?
- Which parcel is this?
- What objects belong to this location?
- Where may an NPC walk?
- What virtual interior belongs to this building?

---

## 7. Proposed repository structure

Keep the initial slice additive and isolated.

```text
Assets/
  Sandbox/
    MatrixBoulder/
      Runtime/
        GeoPose.cs
        GeoEntity.cs
        MatrixBoulderBootstrap.cs
        GeoEntityPersistence.cs
      Editor/
      Prefabs/
      Scenes/
        MatrixBoulder.unity

Docs/
  Matrix-Boulder-PRD.md
```

Exact paths may change after inspecting the generated-project/build architecture. Do not duplicate an existing identity or persistence abstraction merely to match this sketch.

---

## 8. Technical decisions for the first spike

### Unity

Stay on the repository's current **Unity 6000.6.0f1** baseline unless Cesium proves incompatible.

### Cesium

Start with a pinned Cesium for Unity release compatible with Unity 6 and Android. MB-0 pins Cesium for Unity v1.25.1; its isolated Unity 6000.6.0f1 desktop fixture compiles and builds. Android compatibility is outside MB-0 validation.

Do not silently upgrade unrelated Unity or Meta XR packages as part of this spike.

### Secrets

No Cesium ion token or Google API key may be committed.

Use a local configuration path appropriate to the existing project, and document setup. Prefer editor/local config or environment-injected values for the spike.

### Persistence

Reuse Matrix stable identity/persistence concepts where practical.

The important new primitive is a geospatial pose that survives:

- Unity origin changes;
- client changes;
- VR vs AR rendering;
- future server-side simulation.

---

## 9. Implementation milestones

### MB-0 — Cesium feasibility spike

**Goal:** Render Boulder in the existing Unity project on Windows.

Tasks:

- add/pin Cesium for Unity;
- create isolated Matrix Boulder scene;
- create CesiumGeoreference centered in Boulder;
- stream a compatible 3D city/terrain tileset;
- add free-flight desktop camera;
- show required attribution;
- document local token setup;
- verify existing Matrix scenes/build scripts still work.

Acceptance:

- Boulder visibly loads in Play Mode;
- camera can move several kilometers without obvious coordinate instability;
- existing White Room / Room AR sources remain intact.

### MB-1 — Geospatial Matrix entities

**Goal:** Matrix objects live at Earth coordinates.

Tasks:

- define/reuse a serializable `GeoPose`;
- map `GeoPose` to Cesium/local Unity transforms;
- spawn a marker from latitude/longitude/height;
- persist the marker;
- reload it after restart;
- add a debug panel showing geodetic coordinates.

Acceptance:

- a saved entity returns to the same recognizable location after app restart;
- canonical saved state contains geodetic position rather than only Unity-local `Vector3`.

### MB-2 — Semantic Boulder proof

**Goal:** Begin separating world meaning from the rendered Google/Cesium backdrop.

Tasks:

- ingest one small public Boulder GeoJSON/ArcGIS dataset;
- render a diagnostic overlay;
- preserve source/license metadata;
- create a semantic query API such as `GetFeaturesNear(GeoPose, radius)`.

Suggested first dataset: parcels, trails, or another simple polygon/line layer.

Acceptance:

- an independently sourced open-data feature aligns plausibly with the visual city;
- semantic data can be queried without inspecting the Google visual mesh.

### MB-3 — First resident

**Goal:** Connect #29 to real-world coordinates without requiring full city AI.

Tasks:

- spawn one placeholder resident with stable ID + `GeoPose`;
- assign a named virtual home/location reference;
- persist the resident;
- optionally move it between two known geospatial points using a deliberately simple test path.

Acceptance:

- the same resident identity can be found at the same world location after reload;
- resident state is independent of camera/client.

---

## 10. Later milestones

### Matrix Boulder VR

- Quest/PCVR presentation of the geospatial city;
- appropriate LOD/performance controls;
- teleport/fly/vehicle locomotion;
- virtual interiors that override/augment exterior city tiles where authored.

### Matrix Boulder AR

The AR client does not create a second world.

It estimates the user's physical geospatial pose and computes the corresponding Matrix location:

```text
physical headset pose
       +
GPS / VPS / anchors
       |
       v
Earth geospatial pose
       |
       v
query Matrix entities nearby
       |
       v
render those same virtual entities in AR
```

Use multiple registration methods over time:

- global geospatial pose;
- terrain/rooftop/geospatial anchors;
- local visual/spatial anchors;
- manually verified control points for important spaces;
- private locally configured anchors for places such as the user's home.

Do not put private precise home coordinates in the public repository.

### Robotics

Treat robot bodies as optional physical embodiments of an existing Matrix identity. Robotics must have a separate safety/control contract and is explicitly outside the current milestone.

---

## 11. World ownership model

A Matrix location should eventually have multiple layers:

```text
Earth coordinate
├── visual basemap / city mesh
├── semantic geography
│   ├── road
│   ├── sidewalk
│   ├── parcel
│   └── building
├── Matrix-authored world
│   ├── virtual objects
│   ├── interiors
│   ├── portals
│   └── reskin/theme
└── inhabitants
    ├── humans
    ├── virtual AI citizens
    └── optional robotic embodiments
```

The visual basemap is replaceable. Persistent Matrix IDs, semantic features, authored content, and inhabitants are the durable layer.

---

## 12. Risks

### Performance

City-scale photogrammetry can exceed Quest/mobile budgets. Desktop is the first acceptance target. Later clients need aggressive tileset LOD, visibility radii, and possibly different representations.

### Navigation

Photogrammetric meshes are not automatically usable NPC navigation surfaces. City navigation should ultimately come from semantic road/sidewalk graphs and authored interaction points, not a giant NavMesh baked across raw photogrammetry.

### Licensing

Google Photorealistic 3D Tiles are for visualization and carry attribution/caching/extraction restrictions. Open city/OSM/LiDAR sources should back durable Matrix semantics.

### Alignment

GPS alone is not sufficient for convincing AR registration. Later AR milestones must combine global geospatial coordinates with VPS/local anchors/control points.

### Privacy

Private spaces and personal anchors must remain local/private by default and never be published into the public Boulder dataset accidentally.

---

## 13. Definition of done for Matrix Boulder v0.1

Matrix Boulder v0.1 is complete when:

- [ ] an isolated desktop Matrix Boulder scene loads a recognizable georeferenced Boulder;
- [ ] a developer can navigate around it;
- [ ] one Matrix entity is placed using geodetic coordinates;
- [ ] the entity persists and restores at the same world location;
- [ ] tokens/secrets are not committed;
- [ ] required map attribution is visible;
- [ ] Google imagery/mesh is treated only as a visualization layer;
- [ ] at least one open Boulder semantic data source is documented for MB-2;
- [ ] existing Matrix White Room / Room AR behavior is not regressed.

---

## 14. First Codex implementation task

Implement **MB-0 only** first.

> In `School-of-the-Ancients/matrix-loading-operator`, create an isolated Matrix Boulder desktop feasibility slice without changing the working White Room/Room AR behavior. Inspect the existing Unity project/build architecture before editing. Pin a Cesium for Unity version compatible with Unity 6000.6.0f1, add a Matrix Boulder scene centered on Boulder, configure a streamed georeferenced city/terrain tileset using local/uncommitted credentials, add simple desktop fly navigation and required attribution, and document exact setup/run steps. Do not implement NPC AI, AR registration, Google-data extraction, offline caching, or large refactors. Add deterministic/editor checks where practical and report anything that requires manual Unity or provider credential setup. The acceptance test is that Boulder visibly loads in Play Mode and can be navigated while existing Matrix modes remain intact.

Do not proceed to MB-1 until MB-0 is visibly validated.
