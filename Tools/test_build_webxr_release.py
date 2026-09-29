"""Focused release-builder checks; the builder itself runs extracted smoke."""

import importlib.util
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
import unittest
import zipfile
import zlib


SCRIPT = Path(__file__).with_name("Build-WebXR-Release.py")
LAUNCHER = SCRIPT.parents[1] / "Start-CodexControlService.ps1"
SPEECH_INSTALLER = SCRIPT.parents[1] / "Setup-LocalSpeech.ps1"
SPEC = importlib.util.spec_from_file_location("build_webxr_release", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class ReleaseBuilderTests(unittest.TestCase):
    def test_source_allowlist_keeps_owner_and_excludes_private_state(self):
        self.assertTrue(builder.eligible_source(
            PurePosixPath("ControlService/agent_session.py")))
        self.assertTrue(builder.eligible_source(
            PurePosixPath("WebRuntime/src/host_world.js")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("ControlService/scenes/private.json")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("ControlService/test_hosted_world.py")))
        self.assertTrue(builder.eligible_source(
            PurePosixPath("ControlService/content-config.example.json")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("ControlService/content-config.json")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("ControlService/review-workflow.json")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("Docs/Content-Catalogs.md")))
        self.assertFalse(builder.eligible_source(
            PurePosixPath("WebRuntime/test/fixtures/loopback-test.key")))
        for name in ("preview.png", "source.py", "editable.blend", "model.glb",
                     "README.md"):
            with self.subTest(name=name):
                self.assertFalse(builder.eligible_source(
                    PurePosixPath("WebRuntime/art/examples") / name))

    def test_public_copy_and_manifest_omit_plain_and_compressed_art_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, bundle = root / "source", root / "bundle"
            for name in (*builder.ROOT_FILES, *builder.DOC_FILES,
                         *builder.COMPAT_FILES, "ControlService/server.py",
                         "WebRuntime/src/host_world.js", "WebRuntime/hosted.html",
                         "WebRuntime/package-lock.json"):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("public fixture", encoding="utf-8")
            owner_path = b"C:\\Users\\release-owner\\private-work\\example.blend"
            art = source / "WebRuntime/art"
            art.mkdir()
            (art / "build_example.py").write_bytes(b"SOURCE = r'" + owner_path + b"'")
            (art / "preview.png").write_bytes(b"PNG metadata: " + owner_path)
            compressed = zlib.compress(owner_path)
            self.assertNotIn(owner_path, compressed)
            (art / "editable.blend").write_bytes(b"BLENDER-opaque" + compressed)

            builder.copy_release_source(source, bundle)
            self.assertTrue((bundle / "WebRuntime/src/host_world.js").is_file())
            self.assertFalse((bundle / "WebRuntime/art").exists())
            inventory = builder.add_zip(bundle, root / "public.zip")
            self.assertNotIn("WebRuntime/art/", "\n".join(inventory))
            with zipfile.ZipFile(root / "public.zip") as archive:
                self.assertEqual(set(archive.namelist()), set(inventory))
                self.assertFalse(any(name.startswith("WebRuntime/art/")
                                     for name in archive.namelist()))

    def test_zip_and_extraction_reject_art_added_after_source_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            art = bundle / "WebRuntime/art"
            art.mkdir(parents=True)
            payload = zlib.compress(b"C:\\Users\\release-owner\\private-work")
            (art / "editable.blend").write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "WebRuntime/art"):
                builder.add_zip(bundle, root / "rejected.zip")
            archive_path = root / "foreign.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("WebRuntime/art/editable.blend", payload)
            manifest = {"WebRuntime/art/editable.blend": hashlib.sha256(payload).hexdigest()}
            with self.assertRaisesRegex(ValueError, "WebRuntime/art"):
                builder.verify_extracted(archive_path, manifest, None, 0.1)
            for disguised in ("WebRuntime/Art/editable.blend",
                              "WebRuntime\\art\\editable.blend",
                              "./WebRuntime/art/editable.blend",
                              "WebRuntime//art/editable.blend",
                              "WebRuntime/./art/editable.blend"):
                with self.subTest(disguised=disguised), self.assertRaisesRegex(
                        ValueError, "WebRuntime/art"):
                    builder.reject_private_art([disguised])
                with self.subTest(extraction=disguised):
                    with zipfile.ZipFile(archive_path, "w") as archive:
                        archive.writestr(disguised, payload)
                    disguised_manifest = {disguised: hashlib.sha256(payload).hexdigest()}
                    with self.assertRaisesRegex(ValueError, "WebRuntime/art"):
                        builder.verify_extracted(archive_path, disguised_manifest, None, 0.1)

    def test_release_paths_reject_traversal_and_noncanonical_zip_entries(self):
        for unsafe in ("../WebRuntime/src/host_world.js",
                       "WebRuntime/../WebRuntime/src/host_world.js",
                       "/WebRuntime/src/host_world.js",
                       "C:/WebRuntime/src/host_world.js"):
            with self.subTest(unsafe=unsafe):
                self.assertFalse(builder.eligible_source(PurePosixPath(unsafe)))
                with self.assertRaisesRegex(ValueError, "Unsafe release path"):
                    builder.reject_private_art([unsafe])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = b"safe source"
            archive_path = root / "noncanonical.zip"
            for disguised in ("./WebRuntime/src/host_world.js",
                              "WebRuntime//src/host_world.js",
                              "WebRuntime/./src/host_world.js"):
                with self.subTest(disguised=disguised):
                    with zipfile.ZipFile(archive_path, "w") as archive:
                        archive.writestr(disguised, payload)
                    manifest = {disguised: hashlib.sha256(payload).hexdigest()}
                    with self.assertRaisesRegex(ValueError, "unsafe or corrupt"):
                        builder.verify_extracted(archive_path, manifest, None, 0.1)
            for unsafe in ("../WebRuntime/src/host_world.js",
                           "WebRuntime/../WebRuntime/src/host_world.js",
                           "/WebRuntime/src/host_world.js",
                           "C:/WebRuntime/src/host_world.js"):
                with self.subTest(extraction=unsafe):
                    with zipfile.ZipFile(archive_path, "w") as archive:
                        archive.writestr(unsafe, payload)
                    manifest = {unsafe: hashlib.sha256(payload).hexdigest()}
                    with self.assertRaisesRegex(ValueError, "Unsafe release path"):
                        builder.verify_extracted(archive_path, manifest, None, 0.1)

    def test_demo_copies_only_explicit_checkpoint_and_referenced_catalog(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root / "input-assets"
            catalog.mkdir()
            (catalog / "manifest.json").write_text("[]", encoding="utf-8")
            (catalog / "owner-token.txt").write_text("must stay out", encoding="utf-8")
            checkpoint = root / "AdaBo.json"
            checkpoint.write_text(json.dumps({
                "schemaVersion": 1, "hostedWorldId": "AdaBo",
                "world": {"version": 3, "game": None,
                          "scene": {"roomId": "web-virtual-room-v1"},
                          "citizens": {"schemaVersion": 15,
                                       "residents": [{"id": "ada"}, {"id": "bo"}]}},
                "dependencies": []}), encoding="utf-8")
            bundle = root / "bundle"
            self.assertEqual(builder.load_demo(checkpoint, catalog, bundle), "AdaBo")
            self.assertEqual(sorted(p.relative_to(bundle).as_posix()
                                    for p in bundle.rglob("*") if p.is_file()),
                             ["Demo/scenes/world_checkpoints/AdaBo.json",
                              "Demo/web_assets/manifest.json"])
            document = json.loads(checkpoint.read_text(encoding="utf-8"))
            document["ownerToken"] = "secret"
            checkpoint.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "sensitive field"):
                builder.load_demo(checkpoint, catalog, root / "second")

    def test_zip_bytes_and_inventory_are_repeatable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            (bundle / "WebRuntime").mkdir(parents=True)
            (bundle / "WebRuntime" / "hosted.html").write_text("hosted", encoding="utf-8")
            (bundle / "RELEASE-README.md").write_text("read me", encoding="utf-8")
            one, two = root / "one.zip", root / "two.zip"
            self.assertEqual(builder.add_zip(bundle, one), builder.add_zip(bundle, two))
            self.assertEqual(builder.file_digest(one), builder.file_digest(two))

    def test_v1_release_instructions_use_bundled_docs_and_external_data(self):
        versions = {"node": "test", "npm": "test", "python": "test"}
        readme = builder.release_readme("v1.0.0", "a" * 40, versions, None)
        for reference in ("ControlService/content-config.example.json",
                          "ControlService/AGENT_PORTAL.md",
                          "Docs/Matrix-Environments.md"):
            with self.subTest(reference=reference):
                self.assertTrue(builder.eligible_source(PurePosixPath(reference)))
                self.assertIn(reference, readme)
        for requirement in ("$env:LOCALAPPDATA", "MATRIX_CONTENT_CONFIG",
                            "MATRIX_CONTENT_CACHE", "-Scenes", "-WebAssets",
                            "-WebEnvironments", "/api/content/providers/test",
                            "CODEX → IMAGE PREVIEWS", "environment receipt",
                            "Setup-LocalSpeech.ps1", "-SpeechRoot",
                            "Set-Clipboard -Value $env:SANDBOX_TOKEN",
                            "Service token", "Start or resume Codex",
                            "VISUAL CONCEPTS → Image source",
                            "select the option beginning **ComfyUI**",
                            "before entering VR"):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, readme)
        self.assertLess(readme.index("VISUAL CONCEPTS → Image source"),
                        readme.index("CODEX → IMAGE PREVIEWS"))
        html = (SCRIPT.parents[1] / "WebRuntime/index.html").read_text(encoding="utf-8")
        self.assertIn('label for="token">Service token', html)
        self.assertIn('label for="concept-provider">Image source', html)
        self.assertIn('id="agent-connect">Start or resume Codex', html)
        self.assertNotIn("Docs/Content-Catalogs.md", readme)
        self.assertNotIn("Start the interactive Creator", builder.release_readme(
            "v0.8.0-preview.1", "a" * 40, versions, None))

    @unittest.skipUnless(shutil.which("powershell.exe"), "Windows PowerShell 5.1 required")
    def test_launcher_forwards_optional_data_paths_and_preserves_defaults(self):
        script = r'''
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $env:MATRIX_TEST_LAUNCHER, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$function = $ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-ControlServiceArguments'
}, $true) | Select-Object -First 1
if (-not $function) { throw 'Launcher argument function is missing' }
. ([scriptblock]::Create($function.Extent.Text))
$parameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
foreach ($required in @('Scenes', 'WebAssets', 'WebEnvironments')) {
    if ($parameters -notcontains $required) { throw "Missing launcher parameter $required" }
}
@{
    default = @(Get-ControlServiceArguments -ServicePort 8765)
    external = @(Get-ControlServiceArguments -ServicePort 18796 `
        -ScenesPath 'C:\Review Data\scenes' `
        -WebAssetsPath 'C:\Review Data\assets' `
        -WebEnvironmentsPath 'C:\Review Data\environments')
} | ConvertTo-Json -Compress
'''
        result = subprocess.run(
            [shutil.which("powershell.exe"), "-NoProfile", "-NonInteractive",
             "-Command", script], capture_output=True, text=True,
            env={**os.environ, "MATRIX_TEST_LAUNCHER": str(LAUNCHER)},
            check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        arguments = json.loads(result.stdout)
        self.assertEqual(arguments["default"], ["--port", "8765"])
        self.assertEqual(arguments["external"], [
            "--port", "18796", "--scenes", r"C:\Review Data\scenes",
            "--web-assets", r"C:\Review Data\assets",
            "--web-environments", r"C:\Review Data\environments"])

    @unittest.skipUnless(shutil.which("powershell.exe"), "Windows PowerShell 5.1 required")
    def test_v1_powershell_startup_example_parses(self):
        readme = builder.release_readme("v1.0.0", "a" * 40,
                                        {"node": "test", "npm": "test",
                                         "python": "test"}, None)
        example = readme.split("```powershell\n", 1)[1].split("\n```", 1)[0]
        script = r'''
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseInput(
    $env:MATRIX_TEST_STARTUP_EXAMPLE, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
'''
        result = subprocess.run(
            [shutil.which("powershell.exe"), "-NoProfile", "-NonInteractive",
             "-Command", script], capture_output=True, text=True,
            env={**os.environ, "MATRIX_TEST_STARTUP_EXAMPLE": example},
            check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(shutil.which("powershell.exe"), "Windows PowerShell 5.1 required")
    def test_optional_speech_installer_accepts_external_root(self):
        script = r'''
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $env:MATRIX_TEST_SPEECH_INSTALLER, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
@($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) |
    ConvertTo-Json -Compress
'''
        result = subprocess.run(
            [shutil.which("powershell.exe"), "-NoProfile", "-NonInteractive",
             "-Command", script], capture_output=True, text=True,
            env={**os.environ, "MATRIX_TEST_SPEECH_INSTALLER": str(SPEECH_INSTALLER)},
            check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["Python", "Root"])


if __name__ == "__main__":
    unittest.main()
