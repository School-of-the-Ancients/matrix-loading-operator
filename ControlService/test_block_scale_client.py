"""Standalone client behavior at the reviewed request/evidence boundary."""
import copy
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("block_scale_client", Path(__file__).resolve().parents[1] / "Examples" / "block_scale_client.py")
client = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(client)


class FakeMatrix:
    def __init__(self, *, confirmed=True, fail_post=False, unsupported=False):
        self.calls, self.requests, self.token = [], [], None
        self.confirmed, self.fail_post, self.unsupported = confirmed, fail_post, unsupported
        self.paired = {"protocolVersion": "1", "sessionId": "pair-1", "runtimeSessionId": "runtime-1", "clientToken": "private-test-token"}

    def __call__(self, path, body=None):
        self.calls.append((path, copy.deepcopy(body)))
        common = {key: self.paired[key] for key in ("protocolVersion", "sessionId", "runtimeSessionId")}
        common["correlationId"] = "block-scale-sample"
        if path.endswith("/discovery"):
            return {"protocolVersion": "1", "pairingAvailable": True, "capabilities": {} if self.unsupported else {client.CAPABILITY: {"version": 1}}}
        if path.endswith("/sessions"):
            return copy.deepcopy(self.paired)
        if path.endswith("/scene"):
            return {**common, "revision": len(self.requests), "snapshot": {"selection": {"objectId": "block-1"},
                    "scene": {"objects": [{"objectId": "block-1", "assetId": "block"}]}}}
        if path == "/api/v1/requests":
            self.requests.append(copy.deepcopy(body))
            if self.fail_post:
                raise OSError("response was lost after dispatch")
            return {**common, "requestId": body["requestId"], "sequence": 1, "status": "ready", "proposal": {"commands": []}}
        if path.startswith("/api/v1/requests/") and body is None:
            record = self.requests[-1]
            is_reset = record["intent"]["action"] == "reset"
            return {**common, "requestId": record["requestId"], "sequence": 2, "status": "succeeded", "experiment": {
                "capability": client.CAPABILITY, "observationState": "confirmed" if self.confirmed else "unconfirmed",
                "observation": {"source": "acknowledged-runtime-transform", "physicalMeasurement": False,
                                "mathematicalVolumeRatio": 1 if is_reset else 8} if self.confirmed else None}}
        raise AssertionError("Unexpected path: " + path)


class BlockScaleClientTests(unittest.TestCase):
    def run_sample(self, api, reset=True):
        output = []
        result = client.run(api, [2, 2, 2], reset=reset, pairing_code=lambda: "one-use-code",
                            emit=output.append, sleep=lambda _: None)
        return result, output

    def test_confirmed_configure_can_propose_separate_reset_with_original_request_identity(self):
        api = FakeMatrix()
        result, output = self.run_sample(api)
        self.assertEqual(len(api.requests), 2)
        configure, reset = api.requests
        self.assertNotEqual(configure["requestId"], reset["requestId"])
        self.assertEqual(reset["intent"]["baselineRequestId"], configure["requestId"])
        self.assertEqual(configure["intent"]["factors"], {"x": 2, "y": 2, "z": 2})
        self.assertEqual(reset["expected"]["revision"], 1)
        self.assertEqual(client.confirmed_ratio(result), 1)
        self.assertFalse(any("apply" in path for path, _ in api.calls))
        self.assertNotIn("private-test-token", "\n".join(output))
        self.assertEqual(api.token, "private-test-token")

    def test_successful_receipt_without_confirmed_observation_never_resets_or_claims_ratio(self):
        api = FakeMatrix(confirmed=False)
        result, output = self.run_sample(api)
        self.assertEqual(result["status"], "succeeded")
        self.assertIsNone(client.confirmed_ratio(result))
        self.assertEqual(len(api.requests), 1)
        self.assertFalse(any(line.startswith("Confirmed mathematical") for line in output))

    def test_lost_post_response_prints_reconciliation_id_and_never_retries(self):
        api, output = FakeMatrix(fail_post=True), []
        with self.assertRaises(OSError):
            client.run(api, [2, 2, 2], reset=True, pairing_code=lambda: "one-use-code", emit=output.append)
        self.assertEqual(len(api.requests), 1)
        self.assertIn(api.requests[0]["requestId"], output[0])
        self.assertEqual(sum(body is not None for _, body in api.calls), 2)  # pairing and one proposal

    def test_unsupported_server_never_consumes_pairing_code_or_proposes(self):
        api = FakeMatrix(unsupported=True)
        with self.assertRaises(client.ClientError):
            client.run(api, [2, 2, 2], pairing_code=lambda: self.fail("Code should not be requested"))
        self.assertEqual(len(api.calls), 1)

    def test_identity_or_regressive_sequence_does_not_allow_new_action(self):
        paired = FakeMatrix().paired
        outcome = {**paired, "requestId": "request-1", "correlationId": "block-scale-sample", "sequence": 3, "status": "succeeded"}
        for field, invalid in (("sessionId", "other"), ("runtimeSessionId", "other"), ("requestId", "other"),
                               ("sequence", 1), ("sequence", True), ("protocolVersion", "2"), ("status", "unknown")):
            with self.subTest(field=field, invalid=invalid), self.assertRaises(client.ClientError):
                client.checked_outcome({**outcome, field: invalid}, paired, "request-1", 2)

    def test_poll_deadline_returns_unconfirmed_without_replay_or_reset(self):
        api = FakeMatrix()
        output = []
        result = client.run(api, [2, 2, 2], reset=True, pairing_code=lambda: "code", emit=output.append, wait_seconds=0)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(len(api.requests), 1)
        self.assertFalse(any(path.startswith("/api/v1/requests/") for path, _ in api.calls))


if __name__ == "__main__":
    unittest.main()
