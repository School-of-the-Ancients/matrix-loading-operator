"""Standalone sample transport boundaries, with isolated loopback HTTP only."""
import copy
import http.server
import json
from pathlib import Path
import subprocess
import sys
import threading
import unittest
import urllib.error
from unittest.mock import patch

from test_block_scale_client import client, FakeMatrix


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def respond(self):
        payload = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.server.calls.append((self.path, self.headers.get("Authorization"), payload))
        status, headers, body = self.server.responses.pop(0)
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class BlockScaleTransportTests(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        self.server.calls, self.server.responses = [], []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.transport = client.Transport(self.origin)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def response(self, value=None, *, status=200, headers=None, raw=None):
        self.server.responses.append((status, headers or {"Content-Type": "application/json"},
                                      raw if raw is not None else json.dumps(value).encode()))

    def test_local_origin_has_no_credential_path_query_dns_or_proxy_escape(self):
        self.assertEqual(client.local_origin("http://localhost:8765/"), "http://127.0.0.1:8765")
        for url in ("https://127.0.0.1:8765", "http://example.com", "http://127.0.0.1.evil.test",
                    "http://user:secret@127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:65536",
                    "http://127.0.0.1/private", "http://127.0.0.1?token=secret", "http://127.0.0.1/#secret",
                    " http://127.0.0.1", "http://127.0.0.1\n", "http://127.0.0.1\t:8765"):
            with self.subTest(url=url), self.assertRaises(client.argparse.ArgumentTypeError):
                client.Transport(url)
        self.assertFalse(any(isinstance(h, client.urllib.request.ProxyHandler) and h.proxies
                             for h in self.transport.opener.handlers))

    def test_credentials_remain_in_header_or_pairing_body_and_are_not_printed(self):
        self.response({"protocolVersion": "1", "status": "ok"})
        self.transport.token = "private-client-token"
        self.transport("/api/v1/requests/reconcile-id")
        path, auth, body = self.server.calls[0]
        self.assertEqual(path, "/api/v1/requests/reconcile-id")
        self.assertEqual(auth, "Bearer private-client-token")
        self.assertEqual(body, b"")
        self.response({"protocolVersion": "1"})
        self.transport.token = None
        self.transport("/api/v1/sessions", {"pairingCode": "private-one-use-code"})
        self.assertEqual(self.server.calls[1], ("/api/v1/sessions", None, b'{"pairingCode": "private-one-use-code"}'))

    def test_endpoint_override_or_credential_query_is_rejected_before_network(self):
        for path in ("//example.com/api/v1/scene", "/api/v1/scene?token=secret", "/api/command",
                     "/api/v1/requests/id/apply", "/api/v1/requests/../../scene", "/api/v1/requests/%2f"):
            with self.subTest(path=path), self.assertRaises(client.ClientError):
                self.transport(path)
        self.assertEqual(self.server.calls, [])

    def test_redirect_is_not_followed_even_to_same_origin_with_private_token(self):
        self.transport.token = "private-token"
        self.response(status=302, headers={"Location": self.origin + "/api/v1/scene"}, raw=b"")
        with self.assertRaises(client.ClientError) as error:
            self.transport("/api/v1/discovery")
        self.assertIn("redirected", str(error.exception))
        self.assertNotIn("private-token", str(error.exception))
        self.assertEqual(len(self.server.calls), 1)

    def test_errors_use_fixed_useful_descriptions_and_never_echo_server_secrets(self):
        for code in ("invalid_pairing", "stale_scene", "untrusted-code-private-token"):
            self.response({"protocolVersion": "1", "code": code, "error": "private-token and room details"}, status=409)
            with self.subTest(code=code), self.assertRaises(client.ClientError) as error:
                self.transport("/api/v1/scene")
            message = str(error.exception)
            self.assertNotIn("private-token", message)
            self.assertNotIn("room details", message)
            self.assertIn("pairing code" if code == "invalid_pairing" else "scene changed" if code == "stale_scene" else "HTTP 409", message)
        self.assertEqual(len(self.server.calls), 3, "No HTTP failure retries")

    def test_oversized_non_json_malformed_and_wrong_protocol_responses_fail_closed(self):
        for headers, raw in (({"Content-Type": "application/json"}, b" " * (client.MAX_RESPONSE + 1)),
                             ({"Content-Type": "text/html"}, b"<html>private data</html>"),
                             ({"Content-Type": "application/json"}, b'{"protocolVersion":"1","value":NaN}'),
                             ({"Content-Type": "application/json"}, b'{"broken"'),
                             ({"Content-Type": "application/json"}, b'[]'),
                             ({"Content-Type": "application/json"}, b'{"protocolVersion":"2"}')):
            self.response(headers=headers, raw=raw)
            with self.subTest(raw=raw[:60]), self.assertRaises(client.ClientError):
                self.transport("/api/v1/scene")
        self.assertEqual(len(self.server.calls), 6)

    def test_network_failure_has_no_retry_or_private_diagnostic(self):
        with patch.object(self.transport.opener, "open", side_effect=urllib.error.URLError("private-token")) as call:
            with self.assertRaises(client.ClientError) as error:
                self.transport("/api/v1/requests", {"requestId": "review-id"})
        self.assertEqual(call.call_count, 1)
        self.assertIn("outcome may be unknown", str(error.exception))
        self.assertNotIn("private-token", str(error.exception))

    def test_actual_request_status_set_and_correlations_are_checked(self):
        paired = FakeMatrix().paired
        value = {**paired, "requestId": "request-1", "correlationId": client.CORRELATION,
                 "sequence": 2, "status": "error"}
        for status in ("planning", "ready", "queued", "running", "error", "needs_clarification", "review_only",
                       "cancelled", "stale", "succeeded", "failed", "partial", "unconfirmed"):
            self.assertEqual(client.checked_outcome({**value, "status": status}, paired, "request-1")["status"], status)
        for change in ({"status": "expired"}, {"status": []}, {"correlationId": "other"}, {"correlationId": None},
                       {"sequence": 0}, {"sequence": -1}, {"sequence": True}):
            with self.subTest(change=change), self.assertRaises(client.ClientError):
                client.checked_outcome({**value, **change}, paired, "request-1")

    def test_inconsistent_same_sequence_stops_without_reset_or_replay(self):
        class Inconsistent(FakeMatrix):
            def __call__(self, path, body=None):
                value = super().__call__(path, body)
                if path.startswith("/api/v1/requests/"):
                    value["sequence"] = 1
                return value
        api = Inconsistent()
        with self.assertRaises(client.ClientError):
            client.run(api, [2, 2, 2], reset=True, pairing_code=lambda: "one-use-code",
                       emit=lambda _: None, sleep=lambda _: None)
        self.assertEqual(len(api.requests), 1)

    def test_nonfinite_or_overflow_ratio_does_not_claim_confirmation(self):
        value = {"status": "succeeded", "experiment": {"capability": client.CAPABILITY, "observationState": "confirmed",
                 "observation": {"source": "acknowledged-runtime-transform", "physicalMeasurement": False,
                                 "mathematicalVolumeRatio": 8}}}
        for ratio in (True, "8", None, float("nan"), float("inf"), 10 ** 400, 0, -1):
            current = copy.deepcopy(value)
            current["experiment"]["observation"]["mathematicalVolumeRatio"] = ratio
            self.assertIsNone(client.confirmed_ratio(current))

    def test_cli_help_and_useful_nonsecret_failure_exit(self):
        script = Path(__file__).resolve().parents[1] / "Examples" / "block_scale_client.py"
        help_result = subprocess.run([sys.executable, str(script), "--help"], capture_output=True, text=True, timeout=5)
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        self.assertIn("--factors X Y Z", help_result.stdout)
        self.response({"protocolVersion": "1", "pairingAvailable": True, "capabilities": {}, "error": "private-token"})
        result = subprocess.run([sys.executable, str(script), "--url", self.origin], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn("does not offer the block-scale experiment", result.stdout)
        self.assertNotIn("private-token", result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
