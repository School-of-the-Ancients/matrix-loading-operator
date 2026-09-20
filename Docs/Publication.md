# Repository handoff

The user selected the existing public `School-of-the-Ancients/matrix-loading-operator` repository for the AR Sandbox prototype. The original Matrix operator concept and MIT license are retained. The Unity project lives at the repository root.

## Included

- Authored runtime/editor C#, bundled primitive prefabs, desktop/native scenes and materials, with Unity metadata.
- Pinned package manifests, required XR/Oculus project settings, Android build/install scripts and a Windows desktop build entry point.
- Standard-library Python control/persistence service, browser panel, replaceable AI adapter and tests.
- Current run instructions, architectural notes, durable progress log and sanitized validation summaries.

## Local-only data excluded

Unity package caches, generated builds, raw build/player logs, local room save files, Python caches, environment files, runtime connection configuration, Meta session IDs and local agent/upload-tool settings are excluded. A generated Meta local-agent settings asset contained a credential and was omitted together with its metadata. Nothing in the published scene references that asset. Its content must not be copied into this repository later.

The prior workstation's detailed VaM/install inspection notes and absolute local paths are not published. Meta/Unity SDK source or binaries are not vendored; Package Manager restores declared dependencies. Published source does not contain an AI API key or headset connection token.

## Validation boundaries

The original prototype passed 80 Unity fixture checks, 49 PC/AI-adapter tests and 41 actual Windows-player language/save/restore checks. The Unity fixture intentionally omitted Meta packages; room data was simulated and language used an explicit finite offline parser. Provider transport tests used a mock HTTP server. Reports are historical evidence with workstation paths redacted.

The full project's Android build remains blocked by the documented generated Meta assembly quarantine. No APK or real headset test is claimed. Quest Pro manual Space Setup remains the primary target; Quest 3 is optional. No live model provider was configured.

After cloning, follow the README to import/build. Raw local build logs are not part of the repository. Resume by resolving that environment blocker, producing an APK and repeating the full loop on a connected Quest Pro. Keep subsequent source changes in this Git repository; the original unversioned sandbox folder was the import source, not a synchronized checkout.
