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
            Group("Unity JSON wire command compatibility", CheckWireCommands);

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
                var entry = new PrefabEntry { assetId = "furniture", displayName = "Furniture", prefab = fixture.source, spawnScale = 1f };
                var targets = new[] { new RoomTarget { anchorId = "floor", origin = fixture.anchor } };
                using (var world = new SandboxWorld("test-room", fixture.root.transform, new[] { entry }, targets))
                {
                    entry.spawnScale = 9f;
                    Check("catalog copies authored spawn scale", world.Capture().assets[0].spawnScale == 1f);
                    SandboxSnapshot snapshot = world.Capture();
                    snapshot.assets[0].spawnScale = 12f;
                    Check("captured spawn scale cannot mutate registry", world.Capture().assets[0].spawnScale == 1f);
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

        private static SceneObjectData Find(SceneData scene, string objectId)
        {
            foreach (SceneObjectData data in scene.objects)
                if (data.objectId == objectId)
                    return data;
            throw new Exception("Expected object ID not found: " + objectId);
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
