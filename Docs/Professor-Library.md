# Reusable professor and exhibit assets

Enter VR/AR and speak a learning goal with Professor selected. With no active lesson,
the first utterance creates the normal School quest and is saved as the first learner
transcript event. School remains responsible for teacher identity and teaching.

Appearance preparation runs independently of the introduction. It first reuses an
exact teacher match in the local catalog, then asks for a suitable existing human
representation. If none fits, a durable asset-only Operator job creates a VRoid model.
The temporary professor can teach while that job runs. Manual choices always take
precedence over late automatic results.

The job saves both an editable `.vroid` source and exported VRM 1.0. The VRoid MCP
needs the export patch in `Tools/vroid-export/`. The existing Matrix validator checks
the model before library registration. A completed Operator turn without a registered
model is a failed avatar job, not success.

`matrix_search_library` searches existing registered avatars and exhibits.
`matrix_register_library_asset` retains metadata for generated files; registration
does not place them in a scene. Existing Blender asset registrations automatically
appear in the exhibit library, including animation metadata. Operator instructions
prefer existing scene objects, library assets and built-in prefabs before generation.

The JSON metadata index lives beside the user's existing WebAssetCatalog manifest.
Immutable model files and editable source projects stay local and outside Git.
Matching is approximate and does not claim historical likeness or scientific validity.

The WebRuntime attaches a selected ready avatar and updates the same professor object
when a replacement becomes ready. It preserves the lesson binding and transform,
defers replacement during speech/grabs, and rejects results from another lesson/world.

## Local API

- `GET /api/professor/library?query=...&kind=avatar|exhibit|any`
- `POST /api/professor/library`: validate/register a local file and its metadata.
- `POST /api/professor/avatar-jobs`: teacher identity, visual description and lesson ID.
- `GET /api/professor/avatar-jobs/{id}`: queued/running/ready/failed/unconfirmed.

These APIs use the existing local authentication and same-origin boundary. No API
keys or MCP credentials are sent to the headset or the teaching persona.

## Validation

An actual VRoid 2.14.0 export was registered as a local avatar and rendered through
the existing VRM renderer with synthetic speech and pointing. A native School
lesson selected that saved appearance with `method=library`, preserving existing
lesson conversations. The existing Vitruvian exhibit was found by library search.
Checks passed: 851 WebRuntime tests, 41 focused ControlService tests, 76 School
server tests, 10 focused School UI tests, School typecheck and both browser builds.
Missing-model queueing, manual-pin precedence and stale-world rejection have
automated coverage. Full unattended modeling for arbitrary people and the updated
Quest experience still need wearer/runtime acceptance; preset quality varies.
