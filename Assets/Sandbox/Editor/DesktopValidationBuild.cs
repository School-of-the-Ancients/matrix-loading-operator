using System;
using UnityEngine;

namespace ArSandbox
{
    /// <summary>Validates and builds the isolated desktop simulation project.</summary>
    public static class DesktopValidationBuild
    {
        public static void Run()
        {
#if SANDBOX_CORE_FIXTURE
            SandboxCoreChecks.Run();
            LessonGuideChecks.Run();
            SandboxProjectSetup.BuildDesktop();
            Debug.Log("DESKTOP_FIXTURE_VALIDATION_OK");
#else
            throw new InvalidOperationException("Run Build-DesktopFixture.ps1 to build the isolated simulation project.");
#endif
        }
    }
}
