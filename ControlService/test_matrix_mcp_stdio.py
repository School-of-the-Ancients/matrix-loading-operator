"""Exercise the direct-file stdio entrypoint used by the Agent Portal."""
import asyncio
import importlib.util
from pathlib import Path
import sys
import unittest


@unittest.skipUnless(importlib.util.find_spec("mcp"),
                     "Install requirements-agent-mcp.txt for stdio integration")
class MatrixMCPStdioTests(unittest.TestCase):
    def test_direct_startup_exposes_all_tools_and_dispatches_policy_status(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        import matrix_mcp

        async def check():
            expected = {tool.name for tool in await matrix_mcp.server.list_tools()}
            params = StdioServerParameters(
                command=sys.executable,
                args=[str(Path(__file__).with_name("matrix_mcp.py"))],
                env={"MATRIX_CONTROL_URL": "http://127.0.0.1:1/scene",
                     "MATRIX_CONTROL_TOKEN": "isolated-stdio-test"})
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listed = await session.list_tools()
                    actual = {tool.name for tool in listed.tools}
                    self.assertEqual(actual, expected)
                    self.assertTrue({"matrix_set_manipulation",
                                     "matrix_manipulation_status"} <= actual)
                    # Invalid IDs reject locally without contacting any service.
                    result = await session.call_tool("matrix_manipulation_status",
                                                     {"request_id": "invalid"})
                    self.assertTrue(result.isError)
                    self.assertIn("Invalid manipulation receipt ID",
                                  " ".join(getattr(item, "text", "")
                                           for item in result.content))

        asyncio.run(asyncio.wait_for(check(), timeout=15))
