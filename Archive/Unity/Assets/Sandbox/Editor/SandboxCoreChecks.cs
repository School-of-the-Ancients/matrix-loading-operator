using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using Object = UnityEngine.Object;

namespace ArSandbox
{
    /// <summary>Runs against real Unity objects in Editor batch mode, without NUnit or production assets.</summary>
    public static class SandboxCoreChecks
    {
        [Serializable]
        private sealed class CheckResult
        {
            public string name;
            public bool passed;
            public string detail;
        }

        [Serializable]
        private sealed class Report
        {
            public string startedUtc;
            public string completedUtc;
            public string unityVersion;
            public string projectPath;
            public int passed;
            public int failed;
            public List<CheckResult> checks = new List<CheckResult>();
        }

        private sealed class Fixture : IDisposable
        {
            public readonly GameObject root;
            public readonly Transform room;
            public readonly Transform anchor;
            public readonly Transform secondAnchor;
            public readonly GameObject source;
            public readonly SandboxWorld world;

            public Fixture()
            {
                root = new GameObject("Sandbox core validation fixture");
                room = Child("Room", root.transform);
                anchor = Child("Anchor", room);
                secondAnchor = Child("Other anchor", room);
                secondAnchor.localPosition = new Vector3(2f, 0.8f, -1f);
                var objectRoot = Child("Objects", root.transform);
                source = new GameObject("Validation prefab source");
                source.transform.SetParent(root.transform, false);
                source.SetActive(false);
                world = new SandboxWorld("test-room", objectRoot,
                    new[]
                    {
                        new PrefabEntry { assetId = "cube", displayName = "Cube", prefab = source },
                        new PrefabEntry { assetId = "sphere", displayName = "Sphere", prefab = source }
                    },
                    new[]
                    {
                        new RoomTarget { anchorId = "floor", displayName = "Floor", origin = anchor },
                        new RoomTarget { anchorId = "table", displayName = "Table", origin = secondAnchor }
                    });
            }

            private static Transform Child(string name, Transform parent)
            {
                var result = new GameObject(name).transform;
                result.SetParent(parent, false);
                return result;
            }

            public string Spawn(string assetId = "cube", string anchorId = "floor")
            {
                CommandResult result = world.Execute(new SandboxCommand
                {
                    requestId = "test-request",
                    op = "spawn",
                    assetId = assetId,
                    anchorId = anchorId,
                    transform = SandboxWorld.DefaultTransform()
                });
                if (!result.ok)
                    throw new Exception("Fixture spawn failed: " + result.error);
                return result.objectId;
            }

            public void Dispose()
            {
                world.Dispose();
                if (root != null)
                    Object.DestroyImmediate(root);
            }
        }

        private static Report report;

        private sealed class SurfaceFixture : IDisposable
        {
            public readonly GameObject root = new GameObject("Physical support fixture");
            public readonly Transform anchor;
            public readonly GameObject orb;
            public readonly GameObject block;
            public readonly GameObject unknown;
            public readonly RoomTarget target;
            public SandboxWorld world;
            public bool localized = true;
            public bool planeSamples = true;
            public int surfaceQueries;

            public SurfaceFixture()
            {
                anchor = new GameObject("Table anchor").transform;
                anchor.SetParent(root.transform, false);
                anchor.localPosition = new Vector3(2f, .8f, -1f);
                orb = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                orb.name = "Center pivot orb";
                orb.transform.SetParent(root.transform, false);
                orb.SetActive(false);
                block = GameObject.CreatePrimitive(PrimitiveType.Cube);
                block.transform.SetParent(root.transform, false);
                block.SetActive(false);
                unknown = new GameObject("Unknown bounds");
                unknown.transform.SetParent(root.transform, false);
                unknown.SetActive(false);
                target = new RoomTarget
                {
                    anchorId = "physical-table", displayName = "Table", origin = anchor, source = "mruk",
                    semanticLabels = new[] { "TABLE" }, roomPose = SandboxWorld.DefaultTransform(),
                    surface = new RoomSurfaceData
                    {
                        kind = "support", boundary = Polygon(-4f, -4f, 4f, -4f, 4f, 4f, -4f, 4f),
                        localBounds = new BoundsData { center = new Float3(0f, 0f, 0f), size = new Float3(8f, 0f, 8f) }
                    },
                    surfaceValidator = point => { surfaceQueries++; planeSamples &= Mathf.Abs(point.y) < .00001f; return localized; }
                };
                Rebuild();
            }

            public void Rebuild()
            {
                world?.Dispose();
                world = new SandboxWorld("physical-room", root.transform,
                    new[] { new PrefabEntry { assetId = "orb", prefab = orb }, new PrefabEntry { assetId = "block", prefab = block },
                        new PrefabEntry { assetId = "unknown", prefab = unknown } }, new[] { target });
            }

            public SandboxCommand Spawn(string assetId = "orb", bool surface = true)
            {
                return new SandboxCommand { op = "spawn", assetId = assetId, anchorId = target.anchorId,
                    transform = SandboxWorld.DefaultTransform(), placement = surface ? "surface" : null };
            }

            public void Dispose()
            {
                world?.Dispose();
                Object.DestroyImmediate(root);
            }
        }

        private static List<Float3> Polygon(params float[] coordinates)
        {
            var points = new List<Float3>();
            for (int i = 0; i < coordinates.Length; i += 2) points.Add(new Float3(coordinates[i], 0f, coordinates[i + 1]));
            return points;
        }

        public static void Run()
        {
            string projectPath = Directory.GetParent(Application.dataPath).FullName;
            string outputPath = Path.Combine(projectPath, "Validation", "core-results.json");
            string[] args = Environment.GetCommandLineArgs();
            for (int index = 0; index < args.Length; index++)
            {
                if (args[index] != "-validationOutput")
                    continue;
                if (index + 1 >= args.Length || string.IsNullOrWhiteSpace(args[index + 1]))
                    throw new ArgumentException("-validationOutput requires a file path.");
                outputPath = Path.GetFullPath(args[index + 1]);
                break;
            }

            report = new Report
            {
                startedUtc = DateTime.UtcNow.ToString("O"),
                unityVersion = Application.unityVersion,
                projectPath = projectPath
            };
            Group("Command targeting and stable IDs", CheckCommands);
            Group("Snapshot and command isolation", CheckDtoIsolation);
            Group("Transactional load rejection", CheckLoadRejection);
            Group("Successful save and load", CheckLoadSuccess);
            Group("Finite and bounded transforms", CheckTransformBounds);
            Group("Anchor local coordinates", CheckAnchorLocalMotion);
            Group("Unavailable anchors", CheckUnavailableAnchors);
            Group("Object capacity and disposal", CheckCapacityAndDisposal);
            Group("Application selection and full edit loop", CheckApplicationLoop);
            Group("Selection and duplicate commands", CheckSelectionAndDuplicate);
            Group("Scene history and stable identity", CheckSceneHistory);
            Group("History rejection and capacity", CheckHistoryRejectionAndCapacity);
            Group("Application history selection and room lifecycle", CheckApplicationHistory);
            Group("Catalog spawn scale defaults and validation", CheckCatalogScale);
            Group("Catalog geometry and JSON compatibility", CheckCatalogBounds);
            Group("Bundled prefab geometry", CheckBundledBounds);
            Group("Miniature content registration and placement", CheckMiniatureCatalog);
            Group("Selectable light and hinge with undo and restore", CheckMiniatureInteractions);
            Group("Live viewer context", CheckViewerContext);
            Group("Bounded voice audio encoding", CheckVoiceAudio);
            Group("Room loading voice presentation lifecycle", CheckVoiceRoomLoading);
            Group("Unity JSON wire command compatibility", CheckWireCommands);
            Group("Physical support placement and persistence", CheckSurfacePlacement);
            Group("Physical support footprint and rejection", CheckSurfaceRejection);
            Group("Room metadata isolation and target queries", CheckRoomMetadata);
            Group("AR alignment gates and retained scene recovery", CheckRoomRecovery);
            Group("Pointing after object deletion and reanchoring", CheckPointingLifecycle);
            Group("Behavior commands and isolated configuration", CheckBehaviorCommands);
            Group("Behavior rejection and atomic scene loading", CheckBehaviorRejection);
            Group("Behavior history and backward-compatible persistence", CheckBehaviorPersistence);
            Group("Behavior presentation composition and stable placement", CheckBehaviorAnimation);
            Group("Waypoint motion, interruption and persistence", CheckPathBehavior);
            Group("On-demand rendered scene and camera lifecycle", CheckRenderedScene);
            Group("Runtime content packs", () => SandboxContentChecks.Run(Check));

            report.completedUtc = DateTime.UtcNow.ToString("O");
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
            File.WriteAllText(outputPath, JsonUtility.ToJson(report, true));
            Debug.Log("Sandbox core validation: " + report.passed + " passed, " + report.failed + " failed. Report: " + outputPath);
            if (report.failed > 0)
                throw new Exception("Sandbox core validation failed; see " + outputPath);
        }

        private static void CheckCommands()
        {
            using (var fixture = new Fixture())
            {
                string first = fixture.Spawn();
                string second = fixture.Spawn("sphere", "table");
                Check("spawn assigns distinct GUID object IDs", first != second && Guid.TryParseExact(first, "N", out _));
                Check("spawned instances are active", fixture.world.TryGetObject(first, out GameObject firstObject) && firstObject.activeInHierarchy);
                Check("get_scene acknowledges request ID", fixture.world.Execute(new SandboxCommand { op = "get_scene", requestId = "read-1" }).requestId == "read-1");
                Check("list_assets succeeds", fixture.world.Execute(new SandboxCommand { op = "list_assets" }).ok);
                Check("list_targets succeeds", fixture.world.Execute(new SandboxCommand { op = "list_targets" }).ok);
                Check("registered assets and targets are listed", fixture.world.Capture().assets.Count == 2 && fixture.world.Capture().anchors.Count == 2);

                TransformData moved = SandboxWorld.DefaultTransform();
                moved.position = new Float3(1f, 2f, 3f);
                CommandResult move = fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = first, transform = moved });
                Check("set_transform targets stable ID", move.ok && move.objectId == first && firstObject.transform.localPosition == new Vector3(1f, 2f, 3f));
                Check("set_transform preserves omitted anchor", Find(fixture.world.Capture().scene, first).anchorId == "floor");
                Check("other object is unchanged by targeted edit", Find(fixture.world.Capture().scene, second).transform.position.x == 0f);
                var reanchor = fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = first, anchorId = "table", transform = moved });
                Check("set_transform can target another registered anchor", reanchor.ok && firstObject.transform.parent == fixture.secondAnchor);

                RejectedPreserves("spawn rejects caller supplied objectId", fixture.world, new SandboxCommand
                { op = "spawn", objectId = "caller-id", assetId = "cube", anchorId = "floor", transform = moved });
                RejectedPreserves("unknown command is rejected", fixture.world, new SandboxCommand { op = "execute_csharp" });
                RejectedPreserves("unknown object ID is rejected", fixture.world, new SandboxCommand { op = "set_transform", objectId = "missing", transform = moved });
                RejectedPreserves("path-shaped asset ID is rejected", fixture.world, new SandboxCommand { op = "spawn", assetId = "../custom.dll", anchorId = "floor", transform = moved });
                RejectedPreserves("oversized ID is rejected", fixture.world, new SandboxCommand { op = "delete", objectId = new string('x', 129) });
                RejectedPreserves("null command is rejected", fixture.world, null);

                Check("delete removes only specified ID", fixture.world.Execute(new SandboxCommand { op = "delete", objectId = first }).ok &&
                    !fixture.world.TryGetObject(first, out _) && fixture.world.TryGetObject(second, out _));
                Check("EditMode deletion destroys the instance immediately", firstObject == null);
                Check("clear removes all owned objects", fixture.world.Execute(new SandboxCommand { op = "clear" }).ok && fixture.world.Capture().scene.objects.Count == 0);
            }
        }

        private static void CheckDtoIsolation()
        {
            using (var fixture = new Fixture())
            {
                TransformData pose = SandboxWorld.DefaultTransform();
                var command = new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = pose };
                CommandResult spawned = fixture.world.Execute(command);
                Check("DTO isolation setup succeeds", spawned.ok);
                pose.position.x = 50f;
                pose.scale.y = 9f;
                command.assetId = "changed";
                SceneObjectData captured = fixture.world.Capture().scene.objects[0];
                Check("accepted spawn command DTO is cloned", captured.transform.position.x == 0f && captured.transform.scale.y == 1f && captured.assetId == "cube");

                SandboxSnapshot snapshot = fixture.world.Capture();
                snapshot.scene.objects[0].transform.position.x = 42f;
                snapshot.scene.objects[0].assetId = "changed";
                snapshot.assets[0].displayName = "changed";
                snapshot.anchors[0].anchorId = "changed";
                Check("returned snapshot is detached from world state", fixture.world.Capture().scene.objects[0].transform.position.x == 0f &&
                    fixture.world.Capture().scene.objects[0].assetId == "cube" && fixture.world.Capture().assets[0].displayName != "changed" && fixture.world.Capture().anchors[0].anchorId != "changed");

                TransformData edited = SandboxWorld.DefaultTransform();
                edited.position.z = 3f;
                Check("set_transform isolation setup succeeds", fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = spawned.objectId, transform = edited }).ok);
                edited.position.z = 99f;
                Check("accepted transform DTO is cloned", fixture.world.Capture().scene.objects[0].transform.position.z == 3f);
            }
        }

        private static void CheckLoadRejection()
        {
            using (var fixture = new Fixture())
            {
                fixture.Spawn();
                fixture.Spawn("sphere", "table");
                SceneData scene = fixture.world.Capture().scene;
                scene.roomId = "other-room";
                RejectLoad("load preserves scene when room ID changes", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.schemaVersion = 2;
                RejectLoad("load rejects unsupported schema", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects[1].objectId = scene.objects[0].objectId;
                RejectLoad("load rejects duplicate IDs before replacing objects", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects[1].assetId = "unregistered";
                RejectLoad("load rejects unknown asset after valid first entry", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects[1].anchorId = "missing-anchor";
                RejectLoad("load rejects unknown anchor after valid first entry", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects[1].anchorId = null;
                RejectLoad("load rejects missing anchor ID", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects[1].transform.position.y = float.NaN;
                RejectLoad("load rejects nonfinite data after valid first entry", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects[1].transform.scale = null;
                RejectLoad("load rejects incomplete transforms", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects.Add(null);
                RejectLoad("load rejects null object entries", fixture.world, scene);
                scene = fixture.world.Capture().scene;
                scene.objects = null;
                RejectLoad("load rejects a missing object array", fixture.world, scene);
                RejectLoad("load rejects a missing scene document", fixture.world, null);
            }
        }

        private static void CheckLoadSuccess()
        {
            using (var fixture = new Fixture())
            {
                string originalId = fixture.Spawn();
                fixture.world.TryGetObject(originalId, out GameObject originalObject);
                SceneData scene = fixture.world.Capture().scene;
                scene.objects[0].anchorId = "table";
                scene.objects[0].transform.position = new Float3(1f, 2f, 3f);
                scene.objects[0].transform.rotation = new Float3(10f, 20f, 30f);
                scene.objects[0].transform.scale = new Float3(0.3f, 0.4f, 0.5f);
                string serialized = JsonUtility.ToJson(scene);
                SceneData parsed = JsonUtility.FromJson<SceneData>(serialized);
                Check("JSON scene round-trip loads successfully", fixture.world.Execute(new SandboxCommand { op = "load", scene = parsed }).ok);
                Check("successful load preserves stable object IDs", fixture.world.TryGetObject(originalId, out GameObject replacement));
                Check("successful load replaces old Unity instances", originalObject == null && replacement != null);
                Check("loaded transforms use the selected anchor", replacement.transform.parent == fixture.secondAnchor && replacement.transform.localPosition == new Vector3(1f, 2f, 3f));
                Check("loaded scale and rotation are applied", replacement.transform.localScale == new Vector3(0.3f, 0.4f, 0.5f) &&
                    Quaternion.Angle(replacement.transform.localRotation, Quaternion.Euler(10f, 20f, 30f)) < 0.001f);
                parsed.objects[0].transform.position.x = 90f;
                Check("accepted load document is cloned", fixture.world.Capture().scene.objects[0].transform.position.x == 1f);
                var empty = new SceneData { roomId = "test-room", objects = new List<SceneObjectData>() };
                Check("valid empty scene intentionally clears objects", fixture.world.Execute(new SandboxCommand { op = "load", scene = empty }).ok && fixture.world.Capture().scene.objects.Count == 0);
            }
        }

        private static void CheckTransformBounds()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                var invalidPoses = new List<TransformData>();
                var names = new List<string>();
                TransformData pose = SandboxWorld.DefaultTransform(); pose.position.x = float.NaN; invalidPoses.Add(pose); names.Add("NaN position");
                pose = SandboxWorld.DefaultTransform(); pose.rotation.y = float.PositiveInfinity; invalidPoses.Add(pose); names.Add("infinite rotation");
                pose = SandboxWorld.DefaultTransform(); pose.position.z = SandboxWorld.MaximumPosition + 1f; invalidPoses.Add(pose); names.Add("out-of-range position");
                pose = SandboxWorld.DefaultTransform(); pose.scale.x = 0f; invalidPoses.Add(pose); names.Add("zero scale");
                pose = SandboxWorld.DefaultTransform(); pose.scale.y = -1f; invalidPoses.Add(pose); names.Add("negative scale");
                pose = SandboxWorld.DefaultTransform(); pose.scale.z = SandboxWorld.MaximumScale + 1f; invalidPoses.Add(pose); names.Add("oversized scale");
                pose = SandboxWorld.DefaultTransform(); pose.rotation = null; invalidPoses.Add(pose); names.Add("missing rotation vector");
                invalidPoses.Add(null); names.Add("missing transform");
                for (int index = 0; index < invalidPoses.Count; index++)
                    RejectedPreserves("set_transform rejects " + names[index], fixture.world, new SandboxCommand { op = "set_transform", objectId = id, transform = invalidPoses[index] });

                pose = SandboxWorld.DefaultTransform();
                pose.position = new Float3(-SandboxWorld.MaximumPosition, 0f, SandboxWorld.MaximumPosition);
                pose.scale = new Float3(SandboxWorld.MinimumScale, 1f, SandboxWorld.MaximumScale);
                Check("documented transform limits are inclusive", fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = pose }).ok);
            }
        }

        private static void CheckAnchorLocalMotion()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                TransformData pose = SandboxWorld.DefaultTransform();
                pose.position = new Float3(0.5f, 1f, -0.25f);
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = pose });
                fixture.world.TryGetObject(id, out GameObject instance);
                Vector3 before = instance.transform.position;
                fixture.room.position += new Vector3(6f, 2f, -3f);
                fixture.room.rotation = Quaternion.Euler(0f, 73f, 0f);
                Vector3 expected = fixture.anchor.TransformPoint(new Vector3(0.5f, 1f, -0.25f));
                Check("objects follow translated and rotated room origins", Vector3.Distance(instance.transform.position, expected) < 0.0001f && Vector3.Distance(instance.transform.position, before) > 1f);
                Check("room motion preserves saved anchor-local pose", fixture.world.Capture().scene.objects[0].transform.position.x == 0.5f && instance.transform.localPosition == new Vector3(0.5f, 1f, -0.25f));
                SceneData saved = fixture.world.Capture().scene;
                Check("scene reload uses current anchor pose", fixture.world.Execute(new SandboxCommand { op = "load", scene = saved }).ok && fixture.world.TryGetObject(id, out instance) && Vector3.Distance(instance.transform.position, expected) < 0.0001f);
            }
        }

        private static void CheckUnavailableAnchors()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                SceneData saved = fixture.world.Capture().scene;
                fixture.anchor.gameObject.SetActive(false);
                RejectedPreserves("inactive anchor blocks spawn", fixture.world, new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                RejectedPreserves("inactive anchor blocks move", fixture.world, new SandboxCommand { op = "set_transform", objectId = id, transform = SandboxWorld.DefaultTransform() });
                RejectLoad("inactive anchor blocks restore without removing objects", fixture.world, saved);
                fixture.anchor.gameObject.SetActive(true);
                Check("reactivated original anchor permits restore", fixture.world.Execute(new SandboxCommand { op = "load", scene = saved }).ok);
                Object.DestroyImmediate(fixture.anchor.gameObject);
                RejectedPreserves("destroyed anchor blocks spawn", fixture.world, new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                RejectLoad("destroyed anchor blocks restore without losing saved data", fixture.world, saved);
                Check("destroyed anchor does not fall back to world origin", !fixture.world.TryGetObject(id, out _) && fixture.world.Capture().scene.objects.Count == 1);
                Check("delete can remove state after anchor destruction", fixture.world.Execute(new SandboxCommand { op = "delete", objectId = id }).ok && fixture.world.Capture().scene.objects.Count == 0);
            }
        }

        private static void CheckCapacityAndDisposal()
        {
            using (var fixture = new Fixture())
            {
                for (int index = 0; index < SandboxWorld.MaximumObjects; index++)
                    fixture.Spawn();
                Check("capacity accepts the documented maximum", fixture.world.Capture().scene.objects.Count == SandboxWorld.MaximumObjects);
                RejectedPreserves("duplicate above capacity preserves existing objects", fixture.world,
                    new SandboxCommand { op = "duplicate", objectId = fixture.world.Capture().scene.objects[0].objectId });
                RejectedPreserves("spawn above capacity preserves existing objects", fixture.world,
                    new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                SceneData overCapacity = fixture.world.Capture().scene;
                overCapacity.objects.Add(new SceneObjectData { objectId = "extra", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                RejectLoad("load above capacity preserves existing objects", fixture.world, overCapacity);
                string id = fixture.world.Capture().scene.objects[0].objectId;
                fixture.world.TryGetObject(id, out GameObject instance);
                fixture.world.Dispose();
                fixture.world.Dispose();
                Check("dispose destroys owned instances and is idempotent", instance == null && !fixture.world.TryGetObject(id, out _));
                Check("disposed world rejects commands", !fixture.world.Execute(new SandboxCommand { op = "spawn" }).ok);
            }
        }

        private static void CheckApplicationLoop()
        {
            using (var fixture = new Fixture())
            {
                var appObject = new GameObject("Application loop validation");
                appObject.transform.SetParent(fixture.root.transform, false);
                var app = appObject.AddComponent<SandboxApp>();
                app.prefabs = new[] { new PrefabEntry { assetId = "cube", displayName = "Cube", prefab = fixture.source } };
                var targets = new[] { new RoomTarget { anchorId = "floor", displayName = "Floor", origin = fixture.anchor } };
                app.InitializeWorld("test-room", targets);
                CommandResult first = app.Execute(new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                Check("app selects newly spawned stable object ID", first.ok && app.SelectedObjectId == first.objectId);
                CommandResult second = app.Execute(new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                app.SelectObject(first.objectId);
                Check("deleting another object preserves selection", app.Execute(new SandboxCommand { op = "delete", objectId = second.objectId }).ok && app.SelectedObjectId == first.objectId);
                app.SelectObject("missing-object");
                Check("unknown selection preserves the valid selected object", app.SelectedObjectId == first.objectId);

                app.EditSelected(new Vector3(0.25f, 0.1f, -0.5f), 45f, 0.4f);
                SceneData saved = app.World.Capture().scene;
                SceneObjectData edited = saved.objects[0];
                Check("manual edits revise the selected ID without another spawn", edited.objectId == first.objectId && saved.objects.Count == 1 &&
                    edited.transform.position.x == 0.25f && edited.transform.rotation.y == 45f && Mathf.Approximately(edited.transform.scale.x, 0.4f));
                Check("restoring a still-selected ID preserves selection", app.Execute(new SandboxCommand { op = "load", scene = saved }).ok && app.SelectedObjectId == first.objectId);
                string serialized = JsonUtility.ToJson(saved);
                Check("clear removes objects and clears selection", app.Execute(new SandboxCommand { op = "clear" }).ok && app.SelectedObjectId == null && app.World.Capture().scene.objects.Count == 0);
                fixture.room.position = new Vector3(4f, 0.2f, -3f);
                fixture.room.rotation = Quaternion.Euler(0f, 35f, 0f);
                Check("clear then JSON restore succeeds in the same app", app.Execute(new SandboxCommand { op = "load", scene = JsonUtility.FromJson<SceneData>(serialized) }).ok &&
                    app.World.TryGetObject(first.objectId, out _));
                app.World.TryGetObject(first.objectId, out GameObject restored);
                Check("restored edited object follows the current room frame", restored != null &&
                    Vector3.Distance(restored.transform.position, fixture.anchor.TransformPoint(new Vector3(0.25f, 0.1f, -0.5f))) < 0.0001f &&
                    Quaternion.Angle(restored.transform.localRotation, Quaternion.Euler(0, 45, 0)) < 0.001f &&
                    Vector3.Distance(restored.transform.localScale, Vector3.one * 0.4f) < 0.0001f);
                app.SelectObject(first.objectId);
                SandboxWorld previous = app.World;
                bool rejected = false;
                try { app.InitializeWorld("test-room", new[] { new RoomTarget { anchorId = "broken", origin = null } }); }
                catch (ArgumentException) { rejected = true; }
                Check("invalid room replacement preserves live objects and selection", rejected && app.World == previous && app.SelectedObjectId == first.objectId &&
                    app.World.TryGetObject(first.objectId, out GameObject retained) && retained == restored);
                Check("deleting the selected object clears selection", app.Execute(new SandboxCommand { op = "delete", objectId = first.objectId }).ok && app.SelectedObjectId == null);
                app.InvalidateRoom("Reload failed; room is unavailable.");
                Check("invalidated room exposes no stale world or placement", app.World == null && app.Targets.Count == 0 && app.SelectedAnchorId == null && app.SelectedObjectId == null);
                Check("invalidated room rejects commands", !app.Execute(new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() }).ok);
                app.InitializeWorld("test-room", targets);
                Check("fresh room initialization recovers from invalidation", app.World != null && app.Execute(new SandboxCommand { op = "load", scene = saved }).ok);
            }
        }

        private static void CheckSelectionAndDuplicate()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn("sphere", "table");
                var pose = SandboxWorld.DefaultTransform();
                pose.position = new Float3(2f, 0.5f, -3f);
                pose.rotation = new Float3(15f, 40f, 5f);
                pose.scale = new Float3(0.4f, 0.6f, 0.8f);
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = pose });
                string before = JsonUtility.ToJson(fixture.world.Capture().scene);
                int undoBefore = fixture.world.UndoCount;
                CommandResult selected = fixture.world.Execute(new SandboxCommand { op = "select", objectId = id, requestId = "select-1" });
                Check("select returns known stable ID without changing scene or history",
                    selected.ok && selected.objectId == id && selected.requestId == "select-1" &&
                    before == JsonUtility.ToJson(fixture.world.Capture().scene) && fixture.world.UndoCount == undoBefore);
                RejectedPreserves("select rejects unknown object IDs", fixture.world, new SandboxCommand { op = "select", objectId = "missing" });
                RejectedPreserves("select rejects transform payload", fixture.world, new SandboxCommand { op = "select", objectId = id, transform = pose });
                RejectedPreserves("duplicate rejects overriding the asset", fixture.world, new SandboxCommand { op = "duplicate", objectId = id, assetId = "cube" });
                CommandResult duplicate = fixture.world.Execute(new SandboxCommand { op = "duplicate", objectId = id });
                SceneData duplicatedScene = fixture.world.Capture().scene;
                SceneObjectData copy = Find(duplicatedScene, duplicate.objectId);
                Check("duplicate assigns a distinct stable ID and retains source",
                    duplicate.ok && duplicate.objectId != id && Guid.TryParseExact(duplicate.objectId, "N", out _) &&
                    duplicatedScene.objects.Count == 2 && JsonUtility.ToJson(Find(duplicatedScene, id)) ==
                    JsonUtility.ToJson(JsonUtility.FromJson<SceneData>(before).objects[0]));
                Check("duplicate copies asset anchor rotation scale and offsets local X",
                    copy.assetId == "sphere" && copy.anchorId == "table" && Mathf.Approximately(copy.transform.position.x, 2.3f) &&
                    copy.transform.position.y == 0.5f && copy.transform.position.z == -3f &&
                    copy.transform.rotation.y == 40f && copy.transform.scale.x == 0.4f && copy.transform.scale.z == 0.8f &&
                    fixture.world.TryGetObject(duplicate.objectId, out GameObject instance) && instance.transform.parent == fixture.secondAnchor);
                string duplicatedJson = JsonUtility.ToJson(duplicatedScene);
                Check("undo duplicate restores original scene exactly", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == before);
                Check("redo duplicate restores its original new ID and pose", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == duplicatedJson && fixture.world.TryGetObject(duplicate.objectId, out _));
                pose.position.x = SandboxWorld.MaximumPosition;
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = pose });
                CommandResult boundary = fixture.world.Execute(new SandboxCommand { op = "duplicate", objectId = id });
                Check("duplicate clamps offset at the scene boundary", boundary.ok &&
                    Find(fixture.world.Capture().scene, boundary.objectId).transform.position.x == SandboxWorld.MaximumPosition);
            }
        }

        private static void CheckSceneHistory()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                Check("undo spawn removes its object", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    fixture.world.Capture().scene.objects.Count == 0);
                Check("redo spawn restores the same ID", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    fixture.world.TryGetObject(id, out _));
                var pose = SandboxWorld.DefaultTransform();
                pose.position = new Float3(3f, 1f, 2f);
                pose.scale = new Float3(2f, 3f, 4f);
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, anchorId = "table", transform = pose });
                string edited = JsonUtility.ToJson(fixture.world.Capture().scene);
                Check("undo transform restores pose and original anchor", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    Find(fixture.world.Capture().scene, id).anchorId == "floor" &&
                    fixture.world.TryGetObject(id, out GameObject original) && original.transform.localScale == Vector3.one);
                Check("redo transform restores exact edited scene", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == edited);
                fixture.world.Execute(new SandboxCommand { op = "delete", objectId = id });
                Check("undo delete restores ID asset anchor and pose", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == edited && fixture.world.TryGetObject(id, out _));
                Check("redo delete removes the restored ID", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    fixture.world.Capture().scene.objects.Count == 0);
                fixture.world.Execute(new SandboxCommand { op = "undo" });
                string second = fixture.Spawn("sphere");
                SceneData saved = fixture.world.Capture().scene;
                string savedJson = JsonUtility.ToJson(saved);
                fixture.world.Execute(new SandboxCommand { op = "clear" });
                Check("undo clear restores all stable IDs and poses", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == savedJson && fixture.world.TryGetObject(second, out _));
                Check("redo clear returns to the empty scene", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    fixture.world.Capture().scene.objects.Count == 0);
                fixture.world.Execute(new SandboxCommand { op = "load", scene = saved });
                saved.objects[0].transform.position.x = 88f;
                Check("undo load restores its prior scene", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    fixture.world.Capture().scene.objects.Count == 0);
                Check("redo load restores IDs with isolated snapshot data", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == savedJson);
            }
        }

        private static void CheckHistoryRejectionAndCapacity()
        {
            using (var fixture = new Fixture())
            {
                RejectedPreserves("empty undo is rejected without mutation", fixture.world, new SandboxCommand { op = "undo" });
                RejectedPreserves("empty redo is rejected without mutation", fixture.world, new SandboxCommand { op = "redo" });
                string id = fixture.Spawn();
                var pose = SandboxWorld.DefaultTransform();
                pose.position.x = 1f;
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = pose });
                fixture.world.Execute(new SandboxCommand { op = "undo" });
                int undo = fixture.world.UndoCount;
                int redo = fixture.world.RedoCount;
                var invalid = SandboxWorld.DefaultTransform();
                invalid.scale.x = -1f;
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = invalid });
                fixture.world.Execute(new SandboxCommand { op = "delete", objectId = "missing" });
                fixture.world.Execute(new SandboxCommand { op = "duplicate", objectId = "missing" });
                fixture.world.Execute(new SandboxCommand { op = "load", scene = new SceneData { roomId = "wrong", objects = new List<SceneObjectData>() } });
                fixture.world.Execute(new SandboxCommand { op = "select", objectId = id });
                fixture.world.Execute(new SandboxCommand { op = "get_scene" });
                fixture.world.Execute(new SandboxCommand { op = "list_assets" });
                fixture.world.Execute(new SandboxCommand { op = "list_targets" });
                Check("failed mutations queries and selection preserve both history stacks",
                    fixture.world.UndoCount == undo && fixture.world.RedoCount == redo);
                RejectedPreserves("undo rejects object fields", fixture.world, new SandboxCommand { op = "undo", objectId = id });
                RejectedPreserves("redo rejects scene fields", fixture.world, new SandboxCommand { op = "redo", scene = fixture.world.Capture().scene });
                Check("rejected history command does not consume history", fixture.world.UndoCount == undo && fixture.world.RedoCount == redo);
                Check("redo remains usable after rejected edits", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    Find(fixture.world.Capture().scene, id).transform.position.x == 1f);
                fixture.world.Execute(new SandboxCommand { op = "undo" });
                pose.position.x = 2f;
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = pose });
                Check("a new successful mutation invalidates redo", fixture.world.RedoCount == 0 &&
                    !fixture.world.Execute(new SandboxCommand { op = "redo" }).ok);
                fixture.world.Execute(new SandboxCommand { op = "clear" });
                undo = fixture.world.UndoCount;
                fixture.anchor.gameObject.SetActive(false);
                Check("failed history replay preserves scene and both stacks", !fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    fixture.world.Capture().scene.objects.Count == 0 && fixture.world.UndoCount == undo && fixture.world.RedoCount == 0);
                fixture.anchor.gameObject.SetActive(true);
                Check("history replay succeeds when the original anchor recovers", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    fixture.world.TryGetObject(id, out _));
            }
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                for (int index = 1; index <= 40; index++)
                {
                    var pose = SandboxWorld.DefaultTransform();
                    pose.position.x = index;
                    fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = pose });
                }
                Check("undo history retains at most 32 snapshots", fixture.world.UndoCount == SandboxWorld.MaximumHistory);
                bool allUndone = true;
                for (int index = 0; index < SandboxWorld.MaximumHistory; index++)
                    allUndone &= fixture.world.Execute(new SandboxCommand { op = "undo" }).ok;
                Check("bounded undo stops at the oldest retained snapshot", allUndone && fixture.world.UndoCount == 0 &&
                    fixture.world.RedoCount == SandboxWorld.MaximumHistory && Find(fixture.world.Capture().scene, id).transform.position.x == 8f &&
                    !fixture.world.Execute(new SandboxCommand { op = "undo" }).ok);
                bool allRedone = true;
                for (int index = 0; index < SandboxWorld.MaximumHistory; index++)
                    allRedone &= fixture.world.Execute(new SandboxCommand { op = "redo" }).ok;
                Check("bounded redo restores the latest scene", allRedone && fixture.world.RedoCount == 0 &&
                    fixture.world.UndoCount == SandboxWorld.MaximumHistory && Find(fixture.world.Capture().scene, id).transform.position.x == 40f);
                fixture.world.Dispose();
                Check("disposing a room removes its history", fixture.world.UndoCount == 0 && fixture.world.RedoCount == 0);
            }
        }

        private static void CheckApplicationHistory()
        {
            using (var fixture = new Fixture())
            {
                var appObject = new GameObject("Application history validation");
                appObject.transform.SetParent(fixture.root.transform, false);
                var app = appObject.AddComponent<SandboxApp>();
                app.prefabs = new[] { new PrefabEntry { assetId = "cube", displayName = "Cube", prefab = fixture.source } };
                var targets = new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } };
                app.InitializeWorld("test-room", targets);
                CommandResult first = app.Execute(new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                CommandResult duplicate = app.Execute(new SandboxCommand { op = "duplicate", objectId = first.objectId });
                Check("app selects the new duplicate ID", duplicate.ok && app.SelectedObjectId == duplicate.objectId);
                Check("undo clears selection when its object disappears", app.Execute(new SandboxCommand { op = "undo" }).ok &&
                    app.SelectedObjectId == null && !app.World.TryGetObject(duplicate.objectId, out _));
                app.Execute(new SandboxCommand { op = "select", objectId = first.objectId });
                Check("app select command updates the selected ID", app.SelectedObjectId == first.objectId);
                Check("redo preserves selection of an ID still present", app.Execute(new SandboxCommand { op = "redo" }).ok &&
                    app.SelectedObjectId == first.objectId && app.World.TryGetObject(duplicate.objectId, out _));
                app.Execute(new SandboxCommand { op = "delete", objectId = duplicate.objectId });
                Check("undo delete preserves another selected ID", app.Execute(new SandboxCommand { op = "undo" }).ok &&
                    app.SelectedObjectId == first.objectId);
                SandboxWorld previous = app.World;
                app.InitializeWorld("test-room", targets);
                Check("room reinitialization creates empty history and clears selection",
                    app.World != previous && previous.UndoCount == 0 && app.World.UndoCount == 0 && app.World.RedoCount == 0 &&
                    app.SelectedObjectId == null && !app.Execute(new SandboxCommand { op = "undo" }).ok);
            }
        }

        private static void CheckCatalogScale()
        {
            using (var fixture = new Fixture())
            {
                Check("existing prefab entries retain a 0.2 default spawn scale",
                    new PrefabEntry().spawnScale == 0.2f && new AssetInfo().spawnScale == 0.2f &&
                    JsonUtility.FromJson<PrefabEntry>("{\"assetId\":\"legacy\"}").spawnScale == 0.2f &&
                    JsonUtility.FromJson<AssetInfo>("{\"assetId\":\"legacy\"}").spawnScale == 0.2f &&
                    fixture.world.Capture().assets[0].spawnScale == 0.2f);
                var entry = new PrefabEntry { assetId = "furniture", displayName = "Furniture", description = "Front is local -Z.", prefab = fixture.source, spawnScale = 1f };
                var targets = new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } };
                using (var world = new SandboxWorld("test-room", fixture.root.transform, new[] { entry }, targets))
                {
                    entry.spawnScale = 9f;
                    Check("catalog copies authored spawn scale", world.Capture().assets[0].spawnScale == 1f);
                    SandboxSnapshot snapshot = world.Capture();
                    snapshot.assets[0].spawnScale = 12f;
                    Check("captured spawn scale cannot mutate registry", world.Capture().assets[0].spawnScale == 1f);
                    entry.description = "changed";
                    snapshot.assets[0].description = "changed";
                    Check("authored catalog descriptions are copied into isolated snapshots",
                        world.Capture().assets[0].description == "Front is local -Z.");
                }
                bool invalidRejected = true;
                foreach (float scale in new[] { float.NaN, float.PositiveInfinity, 0f, -1f, 20.1f })
                {
                    entry.spawnScale = scale;
                    try
                    {
                        using (var world = new SandboxWorld("test-room", fixture.root.transform, new[] { entry }, targets))
                            invalidRejected = false;
                    }
                    catch (ArgumentException) { }
                }
                Check("catalog rejects nonfinite and out of range spawn scales", invalidRejected);
                entry.spawnScale = 1f;
                entry.description = new string('x', 501);
                bool descriptionRejected = false;
                try { using (var world = new SandboxWorld("test-room", fixture.root.transform, new[] { entry }, targets)) { } }
                catch (ArgumentException) { descriptionRejected = true; }
                Check("catalog descriptions respect the 500-character wire limit", descriptionRejected);
                entry.description = null;
                var appObject = new GameObject("Catalog spawn validation");
                appObject.transform.SetParent(fixture.root.transform, false);
                var app = appObject.AddComponent<SandboxApp>();
                entry.spawnScale = 1f;
                app.prefabs = new[] { entry };
                app.InitializeWorld("test-room", targets);
                app.SpawnSelected();
                Check("app uses authored scale when spawning selected furniture", app.SelectedAssetScale == 1f &&
                    app.World.TryGetObject(app.SelectedObjectId, out GameObject furniture) && furniture.transform.localScale == Vector3.one);
            }
        }

        private static void CheckCatalogBounds()
        {
            using (var fixture = new Fixture())
            {
                Check("meshless catalog entries retain unknown geometry", fixture.world.Capture().assets[0].localBounds == null);
                string unknownWire = JsonUtility.ToJson(fixture.world.Capture().assets[0]);
                Check("unknown geometry stays null or empty zero data on the actual Unity JSON wire",
                    UnknownBounds(JsonUtility.FromJson<AssetInfo>(unknownWire).localBounds));
                report.checks[report.checks.Count - 1].detail = "Actual unknown-geometry JSON: " + unknownWire;
                Check("legacy asset JSON without localBounds retains unknown geometry",
                    UnknownBounds(JsonUtility.FromJson<AssetInfo>("{\"assetId\":\"legacy\",\"displayName\":\"Legacy\"}").localBounds));

                var prefab = new GameObject("Bounds source");
                prefab.transform.SetParent(fixture.root.transform, false);
                prefab.transform.localPosition = new Vector3(13f, -7f, 5f);
                prefab.transform.localRotation = Quaternion.Euler(17f, 31f, 9f);
                prefab.transform.localScale = new Vector3(2f, 3f, 4f);
                prefab.SetActive(false); // Spawn activates the root, but preserves descendant active states.
                var group = new GameObject("Nested geometry").transform;
                group.SetParent(prefab.transform, false);
                group.localPosition = new Vector3(2f, 1f, -3f);
                group.localRotation = Quaternion.Euler(0f, 90f, 0f);
                group.localScale = new Vector3(2f, 3f, 4f);
                var part = GameObject.CreatePrimitive(PrimitiveType.Cube);
                part.transform.SetParent(group, false);
                part.transform.localPosition = new Vector3(.25f, .5f, -.5f);
                part.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
                part.transform.localScale = new Vector3(-1f, 2f, .5f);
                var hiddenParent = new GameObject("Inactive geometry");
                hiddenParent.transform.SetParent(prefab.transform, false);
                hiddenParent.SetActive(false);
                var hidden = GameObject.CreatePrimitive(PrimitiveType.Cube);
                hidden.transform.SetParent(hiddenParent.transform, false);
                hidden.transform.localPosition = Vector3.one * 50f;
                var disabled = GameObject.CreatePrimitive(PrimitiveType.Cube);
                disabled.transform.SetParent(prefab.transform, false);
                disabled.transform.localPosition = Vector3.one * -50f;
                disabled.GetComponent<MeshRenderer>().enabled = false;
                var entries = new[] {
                    new PrefabEntry { assetId = "geometry", prefab = prefab, spawnScale = 3f },
                    new PrefabEntry { assetId = "shared", prefab = prefab, spawnScale = .2f }
                };
                var targets = new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } };
                var center = new Vector3(0f, 2.5f, -3.5f);
                var size = new Vector3(2f, 3f, 4f);
                using (var world = new SandboxWorld("test-room", fixture.root.transform, entries, targets))
                {
                    SandboxSnapshot capture = world.Capture();
                    Check("bounds handle nested rotation nonuniform and mirrored child scale in root coordinates",
                        BoundsMatch(capture.assets[0].localBounds, center, size));
                    Check("bounds exclude root pose spawn scale disabled renderers and inactive descendants",
                        BoundsMatch(capture.assets[1].localBounds, center, size));
                    string wire = JsonUtility.ToJson(capture);
                    Check("known bounds survive actual snapshot JSON serialization",
                        BoundsMatch(JsonUtility.FromJson<SandboxSnapshot>(wire).assets[0].localBounds, center, size));
                    report.checks[report.checks.Count - 1].detail = "Actual known-geometry JSON: " + JsonUtility.ToJson(capture.assets[0]);
                    capture.assets[0].localBounds.center.x = 999f;
                    capture.assets[0].localBounds.size.y = 999f;
                    Check("captured bounds vectors cannot mutate registry or another shared-prefab entry",
                        BoundsMatch(world.Capture().assets[0].localBounds, center, size) &&
                        BoundsMatch(capture.assets[1].localBounds, center, size));
                    group.localPosition += Vector3.one * 10f;
                    Check("bounds are cached at registration rather than remeasured during capture",
                        BoundsMatch(world.Capture().assets[0].localBounds, center, size));
                    group.localPosition -= Vector3.one * 10f;
                    var command = new SandboxCommand { op = "spawn", assetId = "geometry", anchorId = "floor", transform = SandboxWorld.DefaultTransform() };
                    CommandResult spawned = world.Execute(command);
                    world.TryGetObject(spawned.objectId, out GameObject instance);
                    Check("geometry metadata does not change the spawn pose or serialized scene schema",
                        spawned.ok && instance.transform.localScale == Vector3.one && world.Capture().scene.schemaVersion == 1 &&
                        !JsonUtility.ToJson(world.Capture().scene).Contains("localBounds"));
                }

                var second = GameObject.CreatePrimitive(PrimitiveType.Cube);
                second.transform.SetParent(prefab.transform, false);
                second.transform.localPosition = new Vector3(4f, .5f, 0f);
                var combinedCenter = new Vector3(1.75f, 2f, -2.5f);
                var combinedSize = new Vector3(5.5f, 4f, 6f);
                using (var world = new SandboxWorld("test-room", fixture.root.transform, entries, targets))
                    Check("new registry combines separated renderers without moving the pivot",
                        BoundsMatch(world.Capture().assets[0].localBounds, combinedCenter, combinedSize));
                var procedural = new GameObject("Unsupported procedural renderer");
                procedural.transform.SetParent(prefab.transform, false);
                procedural.AddComponent<LineRenderer>();
                using (var world = new SandboxWorld("test-room", fixture.root.transform, entries, targets))
                    Check("unsupported visible geometry yields unknown bounds instead of a partial estimate",
                        world.Capture().assets[0].localBounds == null);
                procedural.SetActive(false);
                second.transform.localScale = Vector3.zero;
                group.gameObject.SetActive(false);
                using (var world = new SandboxWorld("test-room", fixture.root.transform, entries, targets))
                    Check("zero-volume geometry is unknown rather than an invalid known size",
                        world.Capture().assets[0].localBounds == null);
            }
        }

        private static void CheckBundledBounds()
        {
            // Core-only fixtures need no production assets. White-room builds run
            // this group after their existing generator creates the seven prefabs.
            const string path = "Assets/Sandbox/WhiteRoom/Prefabs/";
            if (!Directory.Exists(path)) return;
            string[] ids = { "chair", "table", "wall", "pedestal", "block", "orb", "column" };
            Vector3[] sizes = { new Vector3(.5f, 1.04f, .5f), new Vector3(1.4f, .79f, .8f),
                new Vector3(2.5f, 2.5f, .12f), new Vector3(.65f, 1f, .65f), Vector3.one,
                Vector3.one, new Vector3(.55f, 1f, .55f) };
            using (var fixture = new Fixture())
            {
                for (int i = 0; i < ids.Length; i++)
                {
                    var prefab = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>(path + ids[i] + ".prefab");
                    if (prefab == null) throw new Exception("Missing bundled bounds fixture: " + ids[i]);
                    using (var world = new SandboxWorld("test-room", fixture.root.transform,
                        new[] { new PrefabEntry { assetId = ids[i], prefab = prefab, spawnScale = i < 4 ? 1f : .2f } },
                        new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } }))
                    {
                        AssetInfo asset = world.Capture().assets[0];
                        Check("bundled " + ids[i] + " exposes authored dimensions and bottom-center pivot",
                            BoundsMatch(asset.localBounds, new Vector3(0f, sizes[i].y / 2f, 0f), sizes[i]));
                        report.checks[report.checks.Count - 1].detail = JsonUtility.ToJson(asset);
                    }
                }
            }
        }

        private static void CheckMiniatureCatalog()
        {
            const string path = "Assets/Sandbox/WhiteRoom/Prefabs/";
            if (!Directory.Exists(path)) return;
            string[] ids = { "grass_tile", "dirt_tile", "road_straight", "road_corner", "pine_tree",
                "oak_tree", "shrub", "rock", "boulder", "cottage", "tower", "fence",
                "bridge", "well", "street_lamp", "chest" };
            using (var fixture = new Fixture())
            {
                foreach (string id in ids)
                {
                    var prefab = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>(path + id + ".prefab");
                    Check("miniature prefab exists: " + id, prefab != null);
                    using (var world = new SandboxWorld("test-room", fixture.root.transform,
                        new[] { new PrefabEntry { assetId = id, prefab = prefab, spawnScale = 1f } },
                        new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } }))
                    {
                        AssetInfo info = world.Capture().assets[0];
                        Check("miniature has finite rendered bounds and 1:1 miniature default: " + id,
                            info.localBounds != null && info.localBounds.size.x > 0 && info.localBounds.size.y > 0 &&
                            info.localBounds.size.z > 0 && info.localBounds.size.x <= .25f &&
                            info.localBounds.center.y >= 0 && info.spawnScale == 1f);
                        var command = new SandboxCommand { op = "spawn", assetId = id, anchorId = "floor",
                            transform = SandboxWorld.DefaultTransform() };
                        CommandResult result = world.Execute(command);
                        Check("miniature spawns and can be selected: " + id, result.ok &&
                            world.TryGetObject(result.objectId, out GameObject placed) &&
                            world.TryGetObjectId(placed.transform.GetChild(0), out string selected) && selected == result.objectId);
                    }
                }
            }
        }

        private static void CheckMiniatureInteractions()
        {
            const string path = "Assets/Sandbox/WhiteRoom/Prefabs/";
            if (!Directory.Exists(path)) return;
            foreach (string id in new[] { "street_lamp", "chest" })
            {
                using (var fixture = new Fixture())
                {
                    var prefab = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>(path + id + ".prefab");
                    string mode = id == "street_lamp" ? "light" : "hinge";
                    using (var world = new SandboxWorld("test-room",fixture.root.transform,
                        new[] { new PrefabEntry { assetId = id, prefab = prefab, spawnScale = 1f, interactionMode = mode } },
                        new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } }))
                    {
                        CommandResult created = world.Execute(new SandboxCommand { op = "spawn", assetId = id,
                            anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                        Check("interactive miniature spawned: " + id,created.ok);
                        string objectId = created.objectId;
                        Check("selection trigger config accepted: " + id,world.Execute(BehaviorCommand(objectId,
                            new BehaviorData { kind = "select_toggle" })).ok);
                        world.TryGetObject(objectId,out GameObject placed);
                        Transform part = placed.transform.GetChild(0).Find("InteractivePart");
                        Check("selection returns receipt: " + id,world.Execute(new SandboxCommand { op = "select",objectId = objectId }).ok);
                        Check("selection changes authored interaction: " + id,mode == "light" ? part.GetComponent<Light>().enabled :
                            Quaternion.Angle(part.localRotation,Quaternion.identity) > 90f);
                        string saved = JsonUtility.ToJson(world.Capture().scene);
                        Check("toggle state is present in scene: " + id,Find(world.Capture().scene,objectId).behaviors[0].toggled);
                        Check("undo restores prior switch state: " + id,world.Execute(new SandboxCommand { op = "undo" }).ok &&
                            !Find(world.Capture().scene,objectId).behaviors[0].toggled);
                        Check("redo restores switch state: " + id,world.Execute(new SandboxCommand { op = "redo" }).ok &&
                            JsonUtility.ToJson(world.Capture().scene) == saved);
                        world.Execute(new SandboxCommand { op = "clear" });
                        Check("saved interaction restores after clear: " + id,world.Execute(new SandboxCommand { op = "load",
                            scene = JsonUtility.FromJson<SceneData>(saved) }).ok &&
                            JsonUtility.ToJson(world.Capture().scene) == saved);
                    }
                }
            }
        }

        private static bool BoundsMatch(BoundsData value, Vector3 center, Vector3 size)
        {
            return value != null && value.center != null && value.size != null &&
                Vector3.Distance(new Vector3(value.center.x, value.center.y, value.center.z), center) < .0001f &&
                Vector3.Distance(new Vector3(value.size.x, value.size.y, value.size.z), size) < .0001f;
        }

        private static bool UnknownBounds(BoundsData value)
        {
            return value == null || (ZeroVector(value.center) && ZeroVector(value.size));
        }

        private static bool ZeroVector(Float3 value)
        {
            return value == null || (value.x == 0f && value.y == 0f && value.z == 0f);
        }

        private static void CheckViewerContext()
        {
            using (var fixture = new Fixture())
            {
                var appObject = new GameObject("Viewer context validation");
                appObject.transform.SetParent(fixture.root.transform, false);
                var app = appObject.AddComponent<SandboxApp>();
                app.prefabs = new[] { new PrefabEntry { assetId = "cube", prefab = fixture.source } };
                var targets = new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor },
                    new RoomTarget { anchorId = "table", origin = fixture.secondAnchor } };
                app.InitializeWorld("test-room", targets);
                Check("a room without a published viewer pose reports unknown viewer context", app.CaptureViewer() == null);
                fixture.room.position = new Vector3(5f, 1f, -7f);
                fixture.room.rotation = Quaternion.Euler(0f, 90f, 0f);
                fixture.room.localScale = new Vector3(2f, 3f, 4f);
                Vector3 worldPosition = fixture.anchor.TransformPoint(new Vector3(1f, 1.6f, 2f));
                Vector3 worldForward = fixture.anchor.TransformVector(new Vector3(1f, .3f, 2f));
                app.SetPlacement("floor", new Vector3(7f, 0f, 8f));
                string selectedAnchor = app.SelectedAnchorId;
                Vector3 placement = app.Placement;
                string scene = JsonUtility.ToJson(app.World.Capture().scene);
                app.SetViewerPose(worldPosition, worldForward);
                ViewerData viewer = app.CaptureViewer();
                Check("viewer eye position uses translated rotated and scaled anchor-local units",
                    viewer != null && viewer.frames.Count == 2 && viewer.frames[0].anchorId == "floor" &&
                    Near(viewer.frames[0].position, new Vector3(1f, 1.6f, 2f)));
                Check("each horizontal placement anchor receives its own viewer position",
                    viewer.frames[1].anchorId == "table" && Near(viewer.frames[1].position, new Vector3(-1f, .8f, 3f)));
                Check("viewer heading is horizontal and normalized in the anchor frame",
                    Near(viewer.frames[0].forward, new Vector3(1f, 0f, 2f).normalized));
                Check("publishing viewer context does not move placement or change portable scene state",
                    app.SelectedAnchorId == selectedAnchor && app.Placement == placement && JsonUtility.ToJson(app.World.Capture().scene) == scene);
                viewer.frames[0].position.x = 999f;
                viewer.frames[1].forward.z = 999f;
                viewer.frames.RemoveAt(1);
                Check("viewer snapshots do not share mutable frames or vectors",
                    app.CaptureViewer().frames.Count == 2 && Near(app.CaptureViewer().frames[0].position, new Vector3(1f, 1.6f, 2f)));
                SandboxSnapshot wireSnapshot = app.World.Capture();
                wireSnapshot.viewer = app.CaptureViewer();
                Check("live viewer context survives actual snapshot JSON serialization",
                    Near(JsonUtility.FromJson<SandboxSnapshot>(JsonUtility.ToJson(wireSnapshot)).viewer.frames[0].forward,
                        new Vector3(1f, 0f, 2f).normalized));
                Check("world snapshots and portable scene JSON do not restore a live viewer pose",
                    app.World.Capture().viewer == null && !JsonUtility.ToJson(wireSnapshot.scene).Contains("viewer"));
                app.ClearViewerPose();
                Check("clearing viewer pose removes previously valid context", app.CaptureViewer() == null);

                bool invalidRejected = true;
                foreach (Vector3 direction in new[] { Vector3.zero, Vector3.up, new Vector3(.0001f, 1f, 0f),
                    new Vector3(float.NaN, 0f, 1f), new Vector3(0f, 0f, float.PositiveInfinity) })
                {
                    app.SetViewerPose(worldPosition, worldForward);
                    app.SetViewerPose(worldPosition, direction);
                    invalidRejected &= app.CaptureViewer() == null;
                }
                app.SetViewerPose(new Vector3(float.NaN, 0f, 0f), worldForward);
                invalidRejected &= app.CaptureViewer() == null;
                Check("invalid positions and missing or near-vertical gaze clear viewer context", invalidRejected);
                app.SetViewerPose(worldPosition, worldForward);
                fixture.anchor.gameObject.SetActive(false);
                Check("inactive anchors are excluded without discarding valid horizontal frames",
                    app.CaptureViewer().frames.Count == 1 && app.CaptureViewer().frames[0].anchorId == "table");
                fixture.secondAnchor.localRotation = Quaternion.Euler(0f, 0f, 90f);
                Check("no available horizontal frames means unknown viewer context", app.CaptureViewer() == null);
                fixture.anchor.gameObject.SetActive(true);
                fixture.secondAnchor.localRotation = Quaternion.identity;
                fixture.anchor.localScale = Vector3.zero;
                fixture.secondAnchor.localPosition = Vector3.one * 100000f;
                Check("singular and excessively distant anchor frames are excluded", app.CaptureViewer() == null);
                fixture.anchor.localScale = Vector3.one;
                fixture.secondAnchor.localPosition = new Vector3(2f, .8f, -1f);
                app.RoomReloading = true;
                Check("room reload suppresses viewer context immediately", app.CaptureViewer() == null);
                app.RoomReloading = false;
                app.InitializeWorld("test-room", targets);
                Check("room reinitialization discards the previous room's viewer pose", app.CaptureViewer() == null);
                app.SetViewerPose(worldPosition, worldForward);
                app.enabled = false;
                bool disabledUnknown = app.CaptureViewer() == null;
                app.SetViewerPose(worldPosition, worldForward);
                app.enabled = true;
                Check("disabled app suppresses viewer context and rejects pose publication", disabledUnknown && app.CaptureViewer() == null);
                app.SetViewerPose(worldPosition, worldForward);
                System.Threading.Thread.Sleep(1100); // Exercise real unscaled freshness without exposing a mutable test clock.
                Check("viewer poses expire after one real second even without another publisher update", app.CaptureViewer() == null);
                app.SetViewerPose(worldPosition, worldForward);
                app.InvalidateRoom("Validation invalidation");
                Check("room invalidation clears viewer context", app.CaptureViewer() == null);
                SandboxSnapshot missing = fixture.world.Capture();
                string nullWire = JsonUtility.ToJson(missing);
                // Match the actual bridge: null app pose becomes explicit empty frames.
                missing.viewer = app.CaptureViewer() ?? new ViewerData();
                string unknownWire = JsonUtility.ToJson(missing);
                ViewerData decoded = JsonUtility.FromJson<SandboxSnapshot>(unknownWire).viewer;
                Check("unknown viewer is explicit empty frames on the actual bridge JSON wire",
                    decoded != null && decoded.frames != null && decoded.frames.Count == 0 && unknownWire.Contains("\"viewer\":{\"frames\":[]}"));
                report.checks[report.checks.Count - 1].detail = "Raw null-viewer JSON: " + nullWire + "\nActual bridge unknown-viewer JSON: " + unknownWire;
            }
        }

        private static bool Near(Float3 actual, Vector3 expected)
        {
            return actual != null && Vector3.Distance(new Vector3(actual.x, actual.y, actual.z), expected) < .0001f;
        }

        private static void CheckVoiceAudio()
        {
            var source = new[] { -1f, 0f, 1f, .5f };
            byte[] mono = SandboxVoiceInput.EncodePcm16Wave(source, 1, 16000, source.Length);
            using (var reader = new BinaryReader(new MemoryStream(mono)))
            {
                Check("voice WAV uses interoperable RIFF WAVE chunk sizes",
                    new string(reader.ReadChars(4)) == "RIFF" && reader.ReadInt32() == mono.Length - 8 &&
                    new string(reader.ReadChars(4)) == "WAVE" && new string(reader.ReadChars(4)) == "fmt " && reader.ReadInt32() == 16);
                Check("voice WAV declares PCM16 mono at 16 kHz",
                    reader.ReadInt16() == 1 && reader.ReadInt16() == 1 && reader.ReadInt32() == 16000 &&
                    reader.ReadInt32() == 32000 && reader.ReadInt16() == 2 && reader.ReadInt16() == 16 &&
                    new string(reader.ReadChars(4)) == "data" && reader.ReadInt32() == source.Length * 2);
                Check("voice PCM amplitudes retain sign silence and range",
                    reader.ReadInt16() == -32767 && reader.ReadInt16() == 0 && reader.ReadInt16() == 32767 && reader.ReadInt16() == 16384 &&
                    reader.BaseStream.Position == reader.BaseStream.Length);
            }
            Check("voice encoding does not modify captured samples", source[0] == -1f && source[1] == 0f && source[2] == 1f && source[3] == .5f);
            byte[] stereo = SandboxVoiceInput.EncodePcm16Wave(new[] { -1f, 1f, .5f, .5f }, 2, 16000, 2);
            Check("voice stereo downmix averages channel energy without doubling duration",
                stereo.Length == 48 && BitConverter.ToInt16(stereo, 44) == 0 && BitConverter.ToInt16(stereo, 46) == 16384);
            byte[] downsampled = SandboxVoiceInput.EncodePcm16Wave(new[] { -1f, -1f, -1f, 0f, 0f, 0f, 1f, 1f, 1f }, 1, 48000, 9);
            Check("voice 48 kHz capture becomes the correct 16 kHz duration",
                downsampled.Length == 50 && BitConverter.ToInt16(downsampled, 44) == -32767 &&
                BitConverter.ToInt16(downsampled, 46) == 0 && BitConverter.ToInt16(downsampled, 48) == 32767);
            byte[] upsampled = SandboxVoiceInput.EncodePcm16Wave(new[] { -1f, 1f }, 1, 8000, 2);
            Check("voice lower-rate capture interpolates and bounds its final sample",
                upsampled.Length == 52 && BitConverter.ToInt16(upsampled, 44) == -32767 && BitConverter.ToInt16(upsampled, 46) == 0 &&
                BitConverter.ToInt16(upsampled, 48) == 32767 && BitConverter.ToInt16(upsampled, 50) == 32767);
            byte[] invalid = SandboxVoiceInput.EncodePcm16Wave(new[] { float.NaN, float.PositiveInfinity, float.NegativeInfinity, -2f, 2f }, 1, 16000, 5);
            Check("voice nonfinite samples become silence and excessive amplitudes are clipped",
                BitConverter.ToInt16(invalid, 44) == 0 && BitConverter.ToInt16(invalid, 46) == 0 && BitConverter.ToInt16(invalid, 48) == 0 &&
                BitConverter.ToInt16(invalid, 50) == -32767 && BitConverter.ToInt16(invalid, 52) == 32767);
            byte[] partial = SandboxVoiceInput.EncodePcm16Wave(new[] { 1f, 0f, -1f }, 1, 16000, 2);
            Check("voice ignores unrecorded trailing buffer samples", partial.Length == 48 && BitConverter.ToInt16(partial, 46) == 0);
            int maximumFrames = 16000 * SandboxVoiceInput.MaximumSeconds;
            Check("voice maximum recording fits the bounded WAV upload", SandboxVoiceInput.EncodePcm16Wave(new float[maximumFrames], 1, 16000, maximumFrames).Length == 480044);
            Check("voice rejects empty truncated and oversized recordings",
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(null, 1, 16000, 1)) &&
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(new float[1], 1, 16000, 0)) &&
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(new float[1], 2, 16000, 1)) &&
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(new float[maximumFrames + 1], 1, 16000, maximumFrames + 1)));
            Check("voice rejects unsupported channel and sample-rate metadata",
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(new float[9], 0, 16000, 1)) &&
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(new float[9], 9, 16000, 1)) &&
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(new float[1], 1, 7999, 1)) &&
                RejectsAudio(() => SandboxVoiceInput.EncodePcm16Wave(new float[1], 1, 192001, 1)));
        }

        private static void CheckVoiceRoomLoading()
        {
            var root = new GameObject("Voice room lifecycle validation");
            try
            {
                var voice = root.AddComponent<SandboxVoiceInput>();
                string ready = voice.Status;
                voice.BeginRoomLoading();
                Check("room loading owns an explicit voice presentation phase", voice.Phase == "room_loading" && voice.Status.Contains("Room loading"));
                voice.SetInputReady(false);
                Check("unavailable input does not erase pending room loading notice", voice.Phase == "room_loading");
                voice.EndRoomLoading(true);
                Check("localized room clears stale loading and restores voice instructions", voice.Phase == "idle" && voice.Status == ready && !voice.HudText.Contains("Room loading"));
                voice.BeginRoomLoading();
                voice.EndRoomLoading(false);
                Check("failed room load replaces loading with actionable room guidance", voice.Phase == "idle" && voice.Status.Contains("localized room") && !voice.Status.Contains("Room loading"));
                voice.BeginRoomLoading();
                voice.BeginRecording(); // Missing input produces the normal public error path.
                string error = voice.Status;
                voice.EndRoomLoading(true);
                Check("room completion preserves a newer voice error", voice.Phase == "error" && voice.Status == error);
                voice.BeginRoomLoading();
                voice.Cancel("Voice cancelled by the wearer.");
                voice.EndRoomLoading(true);
                Check("room completion preserves a newer cancellation notice", voice.Status == "Voice cancelled by the wearer.");
                voice.BeginRoomLoading();
                voice.EndRoomLoading(true);
                voice.EndRoomLoading(false);
                Check("repeated reload recovers and duplicate completion cannot overwrite readiness", voice.Phase == "idle" && voice.Status == ready);
            }
            finally { Object.DestroyImmediate(root); }
        }

        private static bool RejectsAudio(Action action)
        {
            try { action(); return false; }
            catch (ArgumentException) { return true; }
        }

        private static void CheckWireCommands()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                SandboxCommand selected = JsonUtility.FromJson<SandboxCommand>("{\"op\":\"select\",\"objectId\":\"" + id + "\"}");
                Check("wire select accepts Unity defaults for omitted fields", fixture.world.Execute(selected).ok);
                SandboxCommand duplicate = JsonUtility.FromJson<SandboxCommand>("{\"op\":\"duplicate\",\"objectId\":\"" + id + "\"}");
                CommandResult copied = fixture.world.Execute(duplicate);
                Check("wire duplicate accepts omitted fields and returns a new ID", copied.ok && copied.objectId != id);
                Check("wire undo accepts Unity defaults for omitted fields",
                    fixture.world.Execute(JsonUtility.FromJson<SandboxCommand>("{\"op\":\"undo\"}")).ok &&
                    fixture.world.Capture().scene.objects.Count == 1);
                Check("wire redo restores the same duplicated ID",
                    fixture.world.Execute(JsonUtility.FromJson<SandboxCommand>("{\"op\":\"redo\"}")).ok &&
                    fixture.world.TryGetObject(copied.objectId, out _));
            }
        }

        private static void CheckSurfacePlacement()
        {
            using (var fixture = new SurfaceFixture())
            {
                SandboxCommand spawn = fixture.Spawn();
                spawn.transform.scale = new Float3(.2f, .2f, .2f);
                CommandResult created = fixture.world.Execute(spawn);
                Check("surface orb places its bottom on the table from a centered prefab pivot", created.ok &&
                    Near(Find(fixture.world.Capture().scene, created.objectId).transform.position, new Vector3(0f, .1f, 0f)));
                Check("surface validation queries live MRUK corners and center in the target plane",
                    fixture.surfaceQueries >= 9 && fixture.planeSamples);
                Check("surface resolution does not mutate the caller's clearance transform", spawn.transform.position.y == 0f);
                fixture.world.TryGetObject(created.objectId, out GameObject orb);
                Check("surface object uses its stable physical anchor transform", orb != null && orb.transform.parent == fixture.anchor &&
                    Mathf.Abs(orb.GetComponentInChildren<Renderer>().bounds.min.y - fixture.anchor.position.y) < .0001f);

                var moved = SandboxWorld.DefaultTransform();
                moved.position = new Float3(.3f, .05f, -.2f);
                moved.scale = new Float3(.4f, .4f, .4f);
                CommandResult edited = fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = created.objectId,
                    transform = moved, placement = "surface" });
                Check("surface resize resolves a new pivot while preserving requested clearance and object ID", edited.ok && edited.objectId == created.objectId &&
                    Near(Find(fixture.world.Capture().scene, created.objectId).transform.position, new Vector3(.3f, .25f, -.2f)));
                Check("physical edit undo restores the prior resolved pose and same object ID", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    Near(Find(fixture.world.Capture().scene, created.objectId).transform.position, new Vector3(0f, .1f, 0f)));
                Check("physical edit redo restores resolved placement without applying clearance twice", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    Near(Find(fixture.world.Capture().scene, created.objectId).transform.position, new Vector3(.3f, .25f, -.2f)));

                SceneData saved = JsonUtility.FromJson<SceneData>(JsonUtility.ToJson(fixture.world.Capture().scene));
                string savedWire = JsonUtility.ToJson(saved);
                Check("physical saves contain resolved transforms without placement hints or room metadata", !savedWire.Contains("placement") &&
                    !savedWire.Contains("surface") && !savedWire.Contains("semanticLabels"));
                fixture.world.Execute(new SandboxCommand { op = "clear" });
                fixture.anchor.position = new Vector3(-3f, 1.2f, 7f);
                fixture.anchor.rotation = Quaternion.Euler(0f, 75f, 0f);
                CommandResult restored = fixture.world.Execute(new SandboxCommand { op = "load", scene = saved });
                fixture.world.TryGetObject(created.objectId, out GameObject replacement);
                Check("physical restore retains exact local pose after room origin translation and rotation", restored.ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == savedWire && replacement != null &&
                    Vector3.Distance(replacement.transform.position, fixture.anchor.TransformPoint(new Vector3(.3f, .25f, -.2f))) < .0001f);

                var floating = SandboxWorld.DefaultTransform();
                floating.position.y = 1f;
                Check("physical floating edit can omit the placement hint when geometry remains above its support", fixture.world.Execute(new SandboxCommand
                    { op = "set_transform", objectId = created.objectId, transform = floating }).ok);
            }
            using (var fixture = new SurfaceFixture())
            {
                // Replace the registered block with a nested, transformed mesh. The
                // world already measures nested root-local bounds at registration.
                Object.DestroyImmediate(fixture.block.GetComponent<MeshRenderer>());
                Object.DestroyImmediate(fixture.block.GetComponent<MeshFilter>());
                var group = new GameObject("Nested part").transform;
                group.SetParent(fixture.block.transform, false);
                group.localPosition = new Vector3(0f, 1f, 0f);
                group.localRotation = Quaternion.Euler(0f, 0f, 90f);
                group.localScale = new Vector3(1f, 2f, 1f);
                var geometry = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
                geometry.SetParent(group, false);
                geometry.localPosition = new Vector3(0f, .25f, 0f);
                geometry.localScale = new Vector3(.5f, 1f, .25f);
                fixture.Rebuild();
                SandboxCommand spawn = fixture.Spawn("block");
                spawn.transform.rotation.z = 90f;
                spawn.transform.scale = new Float3(.5f, 2f, 1f);
                CommandResult result = fixture.world.Execute(spawn);
                fixture.world.TryGetObject(result.objectId, out GameObject instance);
                Check("surface placement accounts for nested geometry and rotated nonuniform scaled bounds", result.ok && instance != null &&
                    Mathf.Abs(instance.transform.localPosition.y - .75f) < .0001f &&
                    Mathf.Abs(instance.GetComponentInChildren<Renderer>().bounds.min.y - fixture.anchor.position.y) < .0001f);
            }
        }

        private static void CheckSurfaceRejection()
        {
            using (var fixture = new SurfaceFixture())
            {
                SandboxCommand command = fixture.Spawn();
                CommandResult first = fixture.world.Execute(command);
                Check("physical rejection fixture starts with a valid existing object", first.ok);
                command.transform.position.x = 3.75f;
                RejectedPreserves("physical footprint rejects a pivot inside the table when bounds cross its edge", fixture.world, command);
                command.transform.position.x = 0f;
                command.transform.position.y = -.01f;
                RejectedPreserves("surface placement rejects negative clearance", fixture.world, command);
                command.placement = null;
                command.transform.position.y = 0f;
                RejectedPreserves("physical placement without a hint rejects geometry below the surface", fixture.world, command);
                command.placement = "surface";
                command.assetId = "unknown";
                RejectedPreserves("physical placement rejects unknown prefab bounds", fixture.world, command);
                command.assetId = "orb";
                command.placement = "guess";
                RejectedPreserves("physical placement rejects unrecognized placement modes", fixture.world, command);
                RejectedPreserves("read commands reject misplaced surface hints", fixture.world,
                    new SandboxCommand { op = "get_scene", placement = "surface" });
                fixture.localized = false;
                command.placement = "surface";
                RejectedPreserves("live MRUK surface rejection preserves existing objects", fixture.world, command);
                fixture.localized = true;
                SceneData saved = fixture.world.Capture().scene;
                saved.objects.Add(new SceneObjectData { objectId = "missing-table-object", assetId = "orb", anchorId = "removed-anchor",
                    transform = SandboxWorld.DefaultTransform() });
                RejectLoad("missing physical anchor rejects the entire restore after a valid first object", fixture.world, saved);
                saved = fixture.world.Capture().scene;
                saved.objects[0].transform.position.y = 0f;
                RejectLoad("physical restore revalidates support penetration without clearing the live scene", fixture.world, saved);
                fixture.anchor.gameObject.SetActive(false);
                RejectedPreserves("unavailable physical support rejects edits before mutation", fixture.world,
                    new SandboxCommand { op = "set_transform", objectId = first.objectId, transform = SandboxWorld.DefaultTransform(), placement = "surface" });
                fixture.anchor.gameObject.SetActive(true);
                command.transform.position = new Float3(3.4f, 0f, 0f);
                CommandResult nearEdge = fixture.world.Execute(command);
                Check("a physical object can fit near the edge before duplication", nearEdge.ok);
                RejectedPreserves("physical duplicate validates its offset footprint", fixture.world,
                    new SandboxCommand { op = "duplicate", objectId = nearEdge.objectId });
            }
            using (var fixture = new SurfaceFixture())
            {
                // Narrow notch misses all four outer footprint corners and its
                // center. Edge-interior validation must still reject the crossing.
                fixture.target.surface.boundary = Polygon(-4f, -4f, 4f, -4f, 4f, 4f, 2f, 4f, 2f, .5f, 1f, .5f, 1f, 4f, -4f, 4f);
                fixture.Rebuild();
                SandboxCommand broad = fixture.Spawn("block");
                broad.transform.scale = new Float3(6f, .2f, 2f);
                RejectedPreserves("concave support rejects an edge crossing even with every corner and center inside", fixture.world, broad);
                broad.transform.scale = new Float3(.2f, .2f, .2f);
                Check("concave support permits a small footprint contained in one continuous region", fixture.world.Execute(broad).ok);
                fixture.target.surface.kind = "wall";
                fixture.Rebuild();
                RejectedPreserves("wall anchors remain context but reject unsupported prop placement", fixture.world, fixture.Spawn());
                fixture.target.surface.kind = "support";
                fixture.target.surface.boundary = Polygon(-1f, -1f, 1f, 1f, -1f, 1f, 1f, -1f);
                fixture.Rebuild();
                RejectedPreserves("invalid self-intersecting support geometry fails explicitly", fixture.world, fixture.Spawn());
                fixture.target.surface.boundary = Polygon(-4f, -4f, 4f, -4f, 4f, 4f, -4f, 4f);
                fixture.target.surfaceValidator = null;
                fixture.Rebuild();
                RejectedPreserves("physical placement requires a current MRUK geometry validator", fixture.world, fixture.Spawn());
            }
            using (var fixture = new Fixture())
            {
                Check("legacy white-room targets still allow unknown bounds and unrestricted anchor-local poses", fixture.Spawn() != null);
                RejectedPreserves("legacy targets cannot pretend to resolve physical surface placement", fixture.world,
                    new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform(), placement = "surface" });
            }
        }

        private static void CheckRoomMetadata()
        {
            using (var fixture = new SurfaceFixture())
            {
                fixture.target.semanticLabels[0] = "changed-source";
                fixture.target.surface.boundary[0].x = -100f;
                fixture.target.surface.localBounds.size.x = 999f;
                fixture.target.roomPose.position.x = 999f;
                AnchorInfo first = fixture.world.Capture().anchors[0];
                Check("room registry clones semantic labels geometry and pose from adapter input", first.source == "mruk" &&
                    first.semanticLabels[0] == "TABLE" && first.surface.boundary[0].x == -4f && first.surface.localBounds.size.x == 8f && first.roomPose.position.x == 0f);
                first.semanticLabels[0] = "changed-snapshot";
                first.surface.boundary[0].x = -50f;
                first.surface.localBounds.size.x = 888f;
                first.roomPose.position.x = 888f;
                AnchorInfo fresh = fixture.world.Capture().anchors[0];
                Check("anchor snapshots cannot mutate physical registry metadata", fresh.semanticLabels[0] == "TABLE" &&
                    fresh.surface.boundary[0].x == -4f && fresh.surface.localBounds.size.x == 8f && fresh.roomPose.position.x == 0f);
                SandboxSnapshot decoded = JsonUtility.FromJson<SandboxSnapshot>(JsonUtility.ToJson(fixture.world.Capture()));
                Check("room anchor metadata survives actual Unity snapshot serialization", decoded.anchors[0].source == "mruk" &&
                    decoded.anchors[0].semanticLabels[0] == "TABLE" && decoded.anchors[0].surface.kind == "support" &&
                    decoded.anchors[0].surface.boundary.Count == 4 && decoded.anchors[0].roomPose.scale.x == 1f);
                CommandResult created = fixture.world.Execute(fixture.Spawn());
                fixture.world.TryGetObject(created.objectId, out GameObject instance);
                var hitChild = new GameObject("Hit child").transform;
                hitChild.SetParent(instance.transform, false);
                Check("pointer hit lookup returns the same stable object ID for root and descendant", fixture.world.TryGetObjectId(instance.transform, out string rootId) &&
                    fixture.world.TryGetObjectId(hitChild, out string childId) && rootId == created.objectId && childId == rootId);
                Check("pointer target query returns the active anchor frame without snapshot capture", fixture.world.TryGetTarget("physical-table", out RoomTarget target) &&
                    target.origin == fixture.anchor && !fixture.world.TryGetTarget("absent", out _));
                Check("unowned pointer hit has no scene object ID", !fixture.world.TryGetObjectId(fixture.root.transform, out _));
                fixture.anchor.gameObject.SetActive(false);
                Check("unavailable anchor and inactive object are excluded from pointer lookup", !fixture.world.TryGetTarget("physical-table", out _) &&
                    !fixture.world.TryGetObjectId(hitChild, out _));
            }
        }

        private static void CheckRoomRecovery()
        {
            using (var fixture = new Fixture())
            {
                var appObject = new GameObject("AR gate validation");
                appObject.transform.SetParent(fixture.root.transform, false);
                var app = appObject.AddComponent<SandboxApp>();
                app.prefabs = new[] { new PrefabEntry { assetId = "cube", prefab = fixture.source } };
                app.InitializeWorld("test-room", new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } });
                app.SetRoomContext("ready", "Inspect loaded outlines.");
                var spawn = new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() };
                Check("AR alignment gate blocks placement before explicit confirmation", !app.RoomEditingAllowed &&
                    !app.Execute(spawn).ok && app.World.Capture().scene.objects.Count == 0);
                app.RoomReloading = true;
                Check("room confirmation cannot approve a reload still in progress", !app.Execute(new SandboxCommand { op = "confirm_room" }).ok);
                app.RoomReloading = false;
                app.SetRoomContext("missing", "Room missing.");
                Check("room confirmation cannot approve missing room data", !app.Execute(new SandboxCommand { op = "confirm_room" }).ok);
                app.SetRoomContext("ready", "Inspect loaded outlines.");
                Check("explicit room confirmation opens the existing editing gate", app.Execute(new SandboxCommand { op = "confirm_room" }).ok && app.RoomEditingAllowed);
                CommandResult created = app.Execute(spawn);
                Check("confirmed room accepts commands through the existing executor", created.ok && app.SelectedObjectId == created.objectId);
                app.SetViewerPose(fixture.anchor.TransformPoint(new Vector3(0f, 1.6f, 0f)), Vector3.forward);
                app.SetPointingTarget("floor", created.objectId, Vector3.zero, Vector3.up, Vector3.up, Vector3.down);
                SandboxSnapshot ready = app.CaptureSnapshot();
                string savedScene = JsonUtility.ToJson(ready.scene);
                Check("ready room snapshot remains editable and carries live context", !ready.readOnly && ready.viewer.frames.Count == 1 &&
                    ready.pointing.objectId == created.objectId);
                app.SetRoomContext("error", "Room geometry changed. Save and clear before reload.");
                SandboxSnapshot retained = app.CaptureSnapshot();
                Check("unavailable room retains saveable poses while removing live viewer and pointing context", retained != null && retained.readOnly &&
                    retained.roomContext.state == "error" && !retained.roomContext.alignmentVerified &&
                    JsonUtility.ToJson(retained.scene) == savedScene && retained.viewer.frames.Count == 0 && string.IsNullOrEmpty(retained.pointing.anchorId));
                Check("recovery snapshot explicitly marks read-only on the Unity JSON wire", JsonUtility.ToJson(retained).Contains("\"readOnly\":true"));
                Check("unavailable room blocks spawn select load and undo while preserving retained poses", !app.Execute(spawn).ok &&
                    !app.Execute(new SandboxCommand { op = "select", objectId = created.objectId }).ok &&
                    !app.Execute(new SandboxCommand { op = "load", scene = retained.scene }).ok &&
                    !app.Execute(new SandboxCommand { op = "undo" }).ok && JsonUtility.ToJson(app.World.Capture().scene) == savedScene);
                Object.DestroyImmediate(fixture.anchor.gameObject);
                retained = app.CaptureSnapshot();
                Check("destroyed native anchor cannot erase the retained recovery snapshot", retained != null && retained.readOnly &&
                    JsonUtility.ToJson(retained.scene) == savedScene && !app.World.TryGetObject(created.objectId, out _));
                Check("unavailable room still permits explicit scene reads", app.Execute(new SandboxCommand { op = "get_scene" }).ok);
                Check("explicit clear releases the nonempty scene guard after anchor loss", app.Execute(new SandboxCommand { op = "clear" }).ok &&
                    app.World.Capture().scene.objects.Count == 0 && app.CaptureSnapshot().readOnly && app.CaptureSnapshot().scene.objects.Count == 0);
                app.RoomReloading = true;
                Check("active room reload publishes no stale recovery snapshot", app.CaptureSnapshot() == null);
                app.RoomReloading = false;
                app.InvalidateRoom("Reloading after explicit clear.");
                Check("empty scene can release old room state for a fresh discovery", app.World == null && app.CaptureSnapshot() == null);
            }
        }

        private static void CheckPointingLifecycle()
        {
            using (var fixture = new Fixture())
            {
                var appObject = new GameObject("Pointing lifecycle validation");
                appObject.transform.SetParent(fixture.root.transform, false);
                var app = appObject.AddComponent<SandboxApp>();
                app.prefabs = new[] { new PrefabEntry { assetId = "cube", prefab = fixture.source } };
                app.InitializeWorld("test-room", new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor },
                    new RoomTarget { anchorId = "table", origin = fixture.secondAnchor } });
                CommandResult created = app.Execute(new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor",
                    transform = SandboxWorld.DefaultTransform() });
                app.SetPointingTarget("floor", created.objectId, Vector3.zero, Vector3.up, Vector3.up, Vector3.down);
                Check("pointing context initially resolves the live stable object", app.CapturePointing()?.objectId == created.objectId);
                app.Execute(new SandboxCommand { op = "delete", objectId = created.objectId });
                Check("deleted object is removed from pointing before the next pointer update", app.CapturePointing() == null &&
                    string.IsNullOrEmpty(app.CaptureSnapshot().pointing.objectId));
                app.Execute(new SandboxCommand { op = "undo" });
                app.SetPointingTarget("floor", created.objectId, Vector3.zero, Vector3.up, Vector3.up, Vector3.down);
                app.Execute(new SandboxCommand { op = "set_transform", objectId = created.objectId, anchorId = "table",
                    transform = SandboxWorld.DefaultTransform() });
                Check("object moved to a different anchor invalidates its old pointing frame", app.CapturePointing() == null);
            }
        }

        private static SceneObjectData Find(SceneData scene, string objectId)
        {
            foreach (SceneObjectData data in scene.objects)
                if (data.objectId == objectId)
                    return data;
            throw new Exception("Expected object ID not found: " + objectId);
        }

        private static SandboxCommand BehaviorCommand(string objectId, BehaviorData behavior)
        {
            return new SandboxCommand { op = "set_behavior", objectId = objectId, behavior = behavior };
        }

        private static void CheckBehaviorCommands()
        {
            using (var fixture = new Fixture())
            {
                string first = fixture.Spawn(), second = fixture.Spawn();
                Check("new player advertises only implemented behavior kinds",
                    string.Join(",", fixture.world.Capture().behaviorKinds) == "rotate,bob,path,select_toggle");
                var rotate = new BehaviorData { kind = "rotate" };
                Check("set_behavior edits the stable object ID", fixture.world.Execute(BehaviorCommand(first, rotate)).objectId == first);
                rotate.speedDegreesPerSecond = 99f;
                Check("accepted behavior config is detached from caller", Find(fixture.world.Capture().scene, first).behaviors[0].speedDegreesPerSecond == 30f);
                var captured = fixture.world.Capture();
                Find(captured.scene, first).behaviors[0].axis = "x";
                captured.behaviorKinds[0] = "invented";
                Check("behavior snapshots and capabilities cannot mutate runtime", Find(fixture.world.Capture().scene, first).behaviors[0].axis == "y" && fixture.world.Capture().behaviorKinds[0] == "rotate");
                Check("bob composes with rotation", fixture.world.Execute(BehaviorCommand(first, new BehaviorData { kind = "bob" })).ok &&
                    Find(fixture.world.Capture().scene, first).behaviors.Count == 2 && Find(fixture.world.Capture().scene, second).behaviors.Count == 0);
                Check("setting the same kind replaces configuration without duplication", fixture.world.Execute(BehaviorCommand(first,
                    new BehaviorData { kind = "rotate", speedDegreesPerSecond = -60f, axis = "z", paused = true })).ok &&
                    Find(fixture.world.Capture().scene, first).behaviors.Count == 2 && Find(fixture.world.Capture().scene, first).behaviors[0].paused);
                Check("one behavior can be removed while the other remains", fixture.world.Execute(new SandboxCommand
                    { op = "remove_behavior", objectId = first, behaviorKind = "rotate" }).ok &&
                    Find(fixture.world.Capture().scene, first).behaviors.Count == 1 && Find(fixture.world.Capture().scene, first).behaviors[0].kind == "bob");
                Check("remove all leaves object identity and transform intact", fixture.world.Execute(new SandboxCommand
                    { op = "remove_behavior", objectId = first, behaviorKind = "all" }).ok &&
                    Find(fixture.world.Capture().scene, first).behaviors.Count == 0 && fixture.world.TryGetObject(first, out _));
                SandboxCommand wire = JsonUtility.FromJson<SandboxCommand>("{\"op\":\"set_behavior\",\"objectId\":\"" + first +
                    "\",\"behavior\":{\"kind\":\"rotate\",\"enabled\":true,\"paused\":false,\"axis\":\"y\",\"speedDegreesPerSecond\":30,\"amplitudeMeters\":0.05,\"frequencyHz\":0.5}}");
                Check("full behavior config works through actual Unity JSON", fixture.world.Execute(wire).ok);
                Check("wire remove accepts omitted inline DTO defaults", fixture.world.Execute(JsonUtility.FromJson<SandboxCommand>(
                    "{\"op\":\"remove_behavior\",\"objectId\":\"" + first + "\",\"behaviorKind\":\"all\"}")).ok);
            }
        }

        private static void CheckBehaviorRejection()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "rotate" }));
                var invalid = new List<BehaviorData>
                {
                    null, new BehaviorData { kind = "script" }, new BehaviorData { kind = "rotate", axis = "world" },
                    new BehaviorData { kind = "rotate", speedDegreesPerSecond = float.NaN },
                    new BehaviorData { kind = "bob", speedDegreesPerSecond = float.PositiveInfinity },
                    new BehaviorData { kind = "rotate", amplitudeMeters = float.NaN },
                    new BehaviorData { kind = "bob", frequencyHz = float.NegativeInfinity },
                    new BehaviorData { kind = "rotate", speedDegreesPerSecond = 181f },
                    new BehaviorData { kind = "bob", speedDegreesPerSecond = -181f },
                    new BehaviorData { kind = "bob", amplitudeMeters = -.01f },
                    new BehaviorData { kind = "rotate", amplitudeMeters = .251f },
                    new BehaviorData { kind = "bob", frequencyHz = .049f },
                    new BehaviorData { kind = "rotate", frequencyHz = 2.01f }
                };
                int history = fixture.world.UndoCount;
                for (int i = 0; i < invalid.Count; i++)
                    RejectedPreserves("invalid behavior config " + i + " is atomic", fixture.world, BehaviorCommand(id, invalid[i]));
                Check("invalid behavior commands do not consume history", history == fixture.world.UndoCount);
                foreach (string op in new[] { "get_scene", "spawn", "select", "duplicate", "set_transform", "delete", "clear", "load", "undo", "redo", "remove_behavior" })
                    RejectedPreserves("foreign behavior field rejected by " + op, fixture.world,
                        new SandboxCommand { op = op, objectId = id, behavior = new BehaviorData { kind = "bob" } });
                RejectedPreserves("set_behavior rejects a foreign removal kind", fixture.world,
                    new SandboxCommand { op = "set_behavior", objectId = id, behavior = new BehaviorData { kind = "bob" }, behaviorKind = "all" });
                RejectedPreserves("behavior command rejects unrelated transform edits", fixture.world,
                    new SandboxCommand { op = "set_behavior", objectId = id, behavior = new BehaviorData { kind = "bob" }, transform = SandboxWorld.DefaultTransform() });
                RejectedPreserves("remove_behavior rejects unknown kinds", fixture.world,
                    new SandboxCommand { op = "remove_behavior", objectId = id, behaviorKind = "fly" });
                RejectedPreserves("set_behavior requires an existing stable object", fixture.world, BehaviorCommand("missing", new BehaviorData { kind = "bob" }));
                SceneData duplicate = fixture.world.Capture().scene;
                duplicate.objects[0].behaviors.Add(new BehaviorData { kind = "rotate" });
                RejectLoad("duplicate behavior kinds reject the whole load", fixture.world, duplicate);
                SceneData oversized = fixture.world.Capture().scene;
                oversized.objects[0].behaviors.Add(new BehaviorData { kind = "bob" });
                oversized.objects[0].behaviors.Add(new BehaviorData { kind = "rotate" });
                RejectLoad("oversized behavior array rejects the whole load", fixture.world, oversized);
                SceneData unknown = fixture.world.Capture().scene;
                unknown.objects[0].behaviors[0].kind = "execute_code";
                RejectLoad("unknown behavior in a saved scene rejects the whole load", fixture.world, unknown);
                foreach (float sign in new[] { -1f, 1f })
                    Check("behavior bounds accept endpoint " + sign, fixture.world.Execute(BehaviorCommand(id,
                        new BehaviorData { kind = "rotate", speedDegreesPerSecond = sign * 180f,
                            amplitudeMeters = sign < 0 ? 0f : .25f, frequencyHz = sign < 0 ? .05f : 2f })).ok);
            }
        }

        private static void CheckBehaviorPersistence()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                string legacy = JsonUtility.ToJson(fixture.world.Capture().scene).Replace(",\"behaviors\":[]", "");
                Check("schema-1 saves without behaviors still load as no behavior", fixture.world.Execute(new SandboxCommand
                    { op = "load", scene = JsonUtility.FromJson<SceneData>(legacy) }).ok && Find(fixture.world.Capture().scene, id).behaviors.Count == 0);
                SceneData withNull = fixture.world.Capture().scene;
                withNull.objects[0].behaviors = null;
                Check("explicit null behaviors retain legacy compatibility", fixture.world.Execute(new SandboxCommand { op = "load", scene = withNull }).ok);
                string before = JsonUtility.ToJson(fixture.world.Capture().scene);
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "rotate", speedDegreesPerSecond = -45f }));
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "bob", amplitudeMeters = .1f, paused = true }));
                string configured = JsonUtility.ToJson(fixture.world.Capture().scene);
                Check("undo behavior addition leaves the previous behavior", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    Find(fixture.world.Capture().scene, id).behaviors.Count == 1);
                Check("undo all behavior additions restores exact original state", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == before);
                fixture.world.Execute(new SandboxCommand { op = "redo" });
                Check("redo restores exact behavior parameters and paused state", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == configured);
                CommandResult duplicate = fixture.world.Execute(new SandboxCommand { op = "duplicate", objectId = id });
                Check("duplicate retains detached behavior configs with a new identity", duplicate.ok && duplicate.objectId != id &&
                    Find(fixture.world.Capture().scene, duplicate.objectId).behaviors.Count == 2);
                fixture.world.Execute(BehaviorCommand(duplicate.objectId, new BehaviorData { kind = "rotate", speedDegreesPerSecond = 90f }));
                Check("editing duplicate behavior leaves the original configuration", Find(fixture.world.Capture().scene, id).behaviors[0].speedDegreesPerSecond == -45f);
                string saved = JsonUtility.ToJson(fixture.world.Capture().scene);
                fixture.world.Execute(new SandboxCommand { op = "clear" });
                Check("JSON save clear load preserves exact IDs poses and behavior configs", fixture.world.Execute(new SandboxCommand
                    { op = "load", scene = JsonUtility.FromJson<SceneData>(saved) }).ok && JsonUtility.ToJson(fixture.world.Capture().scene) == saved);
                fixture.world.Execute(new SandboxCommand { op = "remove_behavior", objectId = id, behaviorKind = "all" });
                Check("undo removal restores both configurations", fixture.world.Execute(new SandboxCommand { op = "undo" }).ok &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == saved);
                Check("redo removal leaves the same object without behaviors", fixture.world.Execute(new SandboxCommand { op = "redo" }).ok &&
                    Find(fixture.world.Capture().scene, id).behaviors.Count == 0);
            }
        }

        private static void CheckBehaviorAnimation()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                fixture.world.TryGetObject(id, out GameObject placed);
                Transform child = placed.transform.GetChild(0);
                SandboxBehaviorVisual visual = placed.GetComponent<SandboxBehaviorVisual>();
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "rotate", speedDegreesPerSecond = 90f }));
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "bob", amplitudeMeters = .1f, frequencyHz = 1f }));
                string baseline = JsonUtility.ToJson(fixture.world.Capture().scene);
                visual.Tick(.5f);
                Check("rotation and bob visibly compose on one prefab child", Quaternion.Angle(child.localRotation, Quaternion.Euler(0f,45f,0f)) < .001f &&
                    Vector3.Distance(child.position - placed.transform.position, Vector3.up * .1f) < .0001f);
                Check("animated presentation never changes placed root or saved scene", placed.transform.localPosition == Vector3.zero &&
                    placed.transform.localRotation == Quaternion.identity && JsonUtility.ToJson(fixture.world.Capture().scene) == baseline);
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "rotate", speedDegreesPerSecond = 90f, paused = true }));
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "bob", amplitudeMeters = .1f, frequencyHz = 1f, paused = true }));
                Quaternion frozenRotation = child.localRotation;
                Vector3 frozenPosition = child.localPosition;
                visual.Tick(10f);
                Check("paused behaviors hold their current visual pose", Quaternion.Angle(child.localRotation, frozenRotation) < .001f &&
                    Vector3.Distance(child.localPosition, frozenPosition) < .0001f);
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "rotate", speedDegreesPerSecond = 90f }));
                Check("resuming rotation keeps its phase without a visual jump", Quaternion.Angle(child.localRotation, frozenRotation) < .001f);
                visual.Tick(.5f);
                Check("resumed rotation continues while bob stays paused", Quaternion.Angle(child.localRotation, Quaternion.Euler(0f,90f,0f)) < .001f &&
                    Vector3.Distance(child.localPosition, frozenPosition) < .0001f);
                TransformData moved = SandboxWorld.DefaultTransform();
                moved.position = new Float3(2f, 1f, -3f); moved.scale = new Float3(.2f, .4f, .6f); moved.rotation = new Float3(20f, 40f, 10f);
                fixture.world.Execute(new SandboxCommand { op = "set_transform", objectId = id, transform = moved });
                visual.Tick(0f);
                Check("moving and resizing root preserves actual bob meters along anchor normal", Vector3.Distance(child.position - placed.transform.position, fixture.anchor.up * .1f) < .0001f);
                string movedBaseline = JsonUtility.ToJson(fixture.world.Capture().scene);
                for (int i = 0; i < 1000; i++) visual.Tick(.016f);
                Check("many animation frames do not drift persistence or placed baseline", JsonUtility.ToJson(fixture.world.Capture().scene) == movedBaseline &&
                    Vector3.Distance(placed.transform.localPosition, new Vector3(2f,1f,-3f)) < .0001f);
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "rotate", enabled = false }));
                Check("disabled rotation removes only its visual contribution", Quaternion.Angle(child.localRotation, Quaternion.identity) < .001f &&
                    Vector3.Distance(child.position - placed.transform.position, fixture.anchor.up * .1f) < .0001f);
                fixture.world.Execute(new SandboxCommand { op = "remove_behavior", objectId = id, behaviorKind = "all" });
                Check("removing all behaviors resets visual child without moving edited root", child.localPosition == Vector3.zero &&
                    Quaternion.Angle(child.localRotation, Quaternion.identity) < .001f && placed.transform.localScale == new Vector3(.2f,.4f,.6f));
                fixture.world.Execute(BehaviorCommand(id, new BehaviorData { kind = "rotate", speedDegreesPerSecond = -90f, axis = "x" }));
                visual.Tick(.5f);
                Check("removed then readded rotation starts a fresh signed phase", Quaternion.Angle(child.localRotation, Quaternion.Euler(-45f,0f,0f)) < .001f);
                Check("animated collider descendant still resolves the stable placed identity", fixture.world.TryGetObjectId(child, out string pointed) && pointed == id);
            }
        }

        private static void CheckPathBehavior()
        {
            using (var fixture = new Fixture())
            {
                string id = fixture.Spawn();
                var path = new BehaviorData { kind = "path", waypointA = new Float3(0,0,0),
                    waypointB = new Float3(.2f,0,0), speedMetersPerSecond = .1f };
                Check("bounded path is accepted", fixture.world.Execute(BehaviorCommand(id,path)).ok);
                fixture.world.TryGetObject(id,out GameObject placed);
                var animation = placed.GetComponent<SandboxBehaviorVisual>();
                Transform child = placed.transform.GetChild(0);
                string saved = JsonUtility.ToJson(fixture.world.Capture().scene);
                animation.Tick(1f);
                Check("one second moves visual and collider ten centimetres without moving saved root",
                    Vector3.Distance(child.localPosition,new Vector3(.1f,0,0)) < .0001f &&
                    JsonUtility.ToJson(fixture.world.Capture().scene) == saved);
                animation.Tick(2f);
                Check("path reverses at endpoint", Vector3.Distance(child.localPosition,new Vector3(.1f,0,0)) < .0001f);
                fixture.world.Execute(BehaviorCommand(id,new BehaviorData { kind = "path", waypointA = path.waypointA,
                    waypointB = path.waypointB, speedMetersPerSecond = .1f, paused = true }));
                animation.Tick(2f);
                Check("pause holds path phase", Vector3.Distance(child.localPosition,new Vector3(.1f,0,0)) < .0001f);
                var invalid = new BehaviorData { kind = "path", waypointA = new Float3(0,0,0),
                    waypointB = new Float3(2,0,0), speedMetersPerSecond = .1f };
                RejectedPreserves("out-of-bounds path is atomic",fixture.world,BehaviorCommand(id,invalid));
                Check("undo path reconfiguration succeeds",fixture.world.Execute(new SandboxCommand { op = "undo" }).ok);
                Check("load restores path configuration",fixture.world.Execute(new SandboxCommand { op = "load",
                    scene = JsonUtility.FromJson<SceneData>(saved) }).ok);
                Check("path survives save and restore with stable identity",JsonUtility.ToJson(fixture.world.Capture().scene) == saved);
                Check("deletion during motion succeeds",fixture.world.Execute(new SandboxCommand { op = "delete",objectId = id }).ok &&
                    !fixture.world.TryGetObject(id,out _));
            }
        }

        private static void CheckRenderedScene()
        {
            using (var fixture = new Fixture())
            {
                var appObject = new GameObject("Rendered scene validation");
                appObject.transform.SetParent(fixture.root.transform, false);
                var app = appObject.AddComponent<SandboxApp>();
                app.prefabs = new[] { new PrefabEntry { assetId = "cube", prefab = fixture.source } };
                app.InitializeWorld("capture-room", new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } });
                var request = new SceneCaptureRequest { captureId = "capture-check", revision = 17 };
                SceneCaptureResult unavailable = new SandboxSceneCapture().Capture(app, request, "runtime-check");
                Check("capture without current camera fails explicitly", !unavailable.ok && !string.IsNullOrEmpty(unavailable.error) && unavailable.dataBase64 == null);
                var camera = new GameObject("Capture source camera").AddComponent<Camera>();
                camera.transform.SetParent(fixture.root.transform, false);
                camera.transform.position = new Vector3(0, 0, -4);
                camera.transform.rotation = Quaternion.identity;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.blue;
                camera.cullingMask = 1 << 30;
                camera.fieldOfView = 45;
                camera.aspect = 1.25f;
                app.SetViewerPose(camera.transform.position, Vector3.down, camera);
                Check("vertical gaze remains capturable without horizontal placement context", app.CaptureCamera == camera && app.CaptureViewer() == null);
                // Simulate an XR pose refinement after the controls' LateUpdate.
                app.SetViewerPose(new Vector3(2, 0, -4), Vector3.left, camera);
                var capture = new SandboxSceneCapture();
                RenderTexture activeBefore = RenderTexture.active;
                int camerasBefore = Resources.FindObjectsOfTypeAll<Camera>().Length;
                SceneCaptureResult result = capture.Capture(app, request, "runtime-check");
                if (SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null)
                    Check("headless graphics fails without fabricating pixels", !result.ok && result.error.Contains("graphics device"));
                else
                {
                    Check("render succeeds with session revision and paired scene", result.ok && result.clientId == "runtime-check" && result.captureId == request.captureId &&
                        result.revision == 17 && JsonUtility.ToJson(result.snapshot.scene) == JsonUtility.ToJson(app.World.Capture().scene));
                    byte[] jpeg = Convert.FromBase64String(result.dataBase64);
                    Check("capture is a bounded JPEG", result.mimeType == "image/jpeg" && jpeg.Length > 4 && jpeg[0] == 0xff && jpeg[1] == 0xd8 &&
                        jpeg.Length == result.byteLength && jpeg.Length <= SandboxSceneCapture.MaximumBytes && result.width <= 1280 && result.height <= 1280);
                    Check("capture identifies virtual center eye with finite timing", !result.includesPassthrough && result.source == "unity_center_eye" &&
                        DateTime.TryParse(result.capturedAtUtc, out _) && result.renderMs >= 0 && result.encodeMs >= 0 &&
                        result.camera.position.z == -4 && result.camera.fieldOfView == 45);
                    ViewerFrame capturedViewer = result.snapshot.viewer.frames.Find(frame => frame.anchorId == "floor");
                    Check("paired viewer context uses final render pose after XR refinement", capturedViewer != null &&
                        capturedViewer.position.x == 0 && capturedViewer.position.z == -4 && capturedViewer.forward.z == 1);
                    Check("render restores source camera and active render target", camera.targetTexture == null && camera.aspect == 1.25f &&
                        camera.stereoTargetEye == StereoTargetEyeMask.Both && RenderTexture.active == activeBefore &&
                        Resources.FindObjectsOfTypeAll<Camera>().Length == camerasBefore);
                    var prop = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    prop.transform.SetParent(fixture.source.transform, false);
                    prop.layer = 30;
                    var material = new Material(Shader.Find("Unlit/Color"));
                    material.color = Color.red;
                    prop.GetComponent<Renderer>().sharedMaterial = material;
                    try
                    {
                        CommandResult spawn = app.Execute(new SandboxCommand { op = "spawn", assetId = "cube", anchorId = "floor", transform = SandboxWorld.DefaultTransform() });
                        app.Execute(BehaviorCommand(spawn.objectId, new BehaviorData { kind = "bob", amplitudeMeters = .25f, frequencyHz = 1 }));
                        app.World.TryGetObject(spawn.objectId, out GameObject instance);
                        app.SetViewerPose(camera.transform.position, camera.transform.forward, camera);
                        SceneCaptureResult before = new SandboxSceneCapture().Capture(app, request, "runtime-check");
                        instance.GetComponent<SandboxBehaviorVisual>().Tick(.5f);
                        app.SetViewerPose(camera.transform.position, camera.transform.forward, camera);
                        SceneCaptureResult after = new SandboxSceneCapture().Capture(app, request, "runtime-check");
                        Check("rendered pixels include current behavior offsets while saved placement stays stable", before.ok && after.ok &&
                            before.dataBase64 != after.dataBase64 && JsonUtility.ToJson(before.snapshot.scene) == JsonUtility.ToJson(after.snapshot.scene));
                    }
                    finally { Object.DestroyImmediate(material); }
                }
                // Use a fast failed attempt so slow first-time shader compilation
                // cannot make this timing assertion depend on the test machine.
                var limiter = new SandboxSceneCapture();
                limiter.Capture(null, request, "runtime-check");
                SceneCaptureResult limited = limiter.Capture(null, new SceneCaptureRequest { captureId = "second", revision = 17 }, "runtime-check");
                Check("repeated captures are rate bounded", !limited.ok && limited.error.Contains("two seconds"));
                app.ClearViewerPose();
                Check("tracking clear also invalidates capture camera", app.CaptureCamera == null);
                app.SetViewerPose(camera.transform.position, camera.transform.forward, camera);
                camera.enabled = false;
                Check("disabled camera cannot supply capture", app.CaptureCamera == null);
                camera.enabled = true;
                app.RoomReloading = true;
                Check("room reload prevents stale capture", !new SandboxSceneCapture().Capture(app, request, "runtime-check").ok);
                Check("capture receipt JSON preserves snapshot and explicit passthrough absence", JsonUtility.FromJson<SceneCaptureResult>(JsonUtility.ToJson(result)).includesPassthrough == false);
            }
        }

        private static void RejectLoad(string name, SandboxWorld world, SceneData scene)
        {
            RejectedPreserves(name, world, new SandboxCommand { op = "load", scene = scene });
        }

        private static void RejectedPreserves(string name, SandboxWorld world, SandboxCommand command)
        {
            SceneData before = world.Capture().scene;
            string serialized = JsonUtility.ToJson(before);
            var originalObjects = new Dictionary<string, GameObject>();
            var activeStates = new Dictionary<string, bool>();
            foreach (SceneObjectData item in before.objects)
            {
                if (!world.TryGetObject(item.objectId, out GameObject original))
                    continue;
                originalObjects.Add(item.objectId, original);
                activeStates.Add(item.objectId, original.activeSelf);
            }
            CommandResult result = world.Execute(command);
            bool preserved = !result.ok && !string.IsNullOrEmpty(result.error) && JsonUtility.ToJson(world.Capture().scene) == serialized;
            foreach (KeyValuePair<string, GameObject> pair in originalObjects)
                preserved &= world.TryGetObject(pair.Key, out GameObject current) && current == pair.Value && current.activeSelf == activeStates[pair.Key];
            Check(name, preserved);
        }

        private static void Group(string name, Action action)
        {
            try { action(); }
            catch (Exception exception)
            {
                report.failed++;
                report.checks.Add(new CheckResult { name = name, passed = false, detail = exception.ToString() });
                Debug.LogError("FAIL " + name + ": " + exception.Message);
            }
        }

        private static void Check(string name, bool condition)
        {
            if (!condition)
                throw new Exception("Assertion failed: " + name);
            report.passed++;
            report.checks.Add(new CheckResult { name = name, passed = true });
            Debug.Log("PASS " + name);
        }
    }
}
