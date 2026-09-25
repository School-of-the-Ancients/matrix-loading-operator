"""Independent standard-library Matrix client. No School service is required.

Run: python Examples/matrix_client.py --url http://127.0.0.1:8765
Create a pairing code in the Matrix /clients page and enter it when prompted.
"""
import argparse
import getpass
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--text", default="Place a block here.")
    parser.add_argument("--mode", choices=("offline-rules", "codex-cli"), default="offline-rules",
                        help="Codex uses the Operator's configuration and requires its advertised capability")
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        parser.error("Use the local Matrix service base URL, for example http://127.0.0.1:8765")
    token = None

    def request(path, body=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        call = urllib.request.Request(args.url.rstrip("/") + path, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
        with urllib.request.urlopen(call, timeout=15) as response:
            return json.load(response)

    discovery = request("/api/v1/discovery")
    if discovery.get("protocolVersion") != "1" or not discovery.get("pairingAvailable"):
        parser.error(discovery.get("pairingReason") or "Client API version 1 is unavailable")
    modes = discovery.get("capabilities", {}).get("scene.propose_text", {}).get("modes", [])
    if args.mode not in modes:
        parser.error("Requested scene planning mode is not advertised by this Matrix service")
    paired = request("/api/v1/sessions", {"pairingCode": getpass.getpass("Pairing code from the Operator: ")})
    token = paired["clientToken"]
    scene = request("/api/v1/scene")
    request_id = uuid.uuid4().hex
    print("Request ID:", request_id, "— retain this ID if the connection is interrupted.")
    outcome = request("/api/v1/requests", {"requestId": request_id, "correlationId": "sample-client",
                      "expected": {"runtimeSessionId": scene["runtimeSessionId"], "revision": scene["revision"]},
                      "intent": {"text": args.text, "mode": args.mode}})
    print("Request:", request_id, "—", outcome["status"])
    print(json.dumps(outcome["proposal"], indent=2))
    print("Review and Apply in the Operator /clients page. Ctrl+C stops polling, not dispatched work.")
    last_sequence = outcome["sequence"]
    deadline = time.monotonic() + 180
    while outcome["status"] in {"planning", "ready", "queued", "running"} and time.monotonic() < deadline:
        time.sleep(1)
        updated = request("/api/v1/requests/" + request_id)
        if updated["sequence"] >= last_sequence:
            outcome, last_sequence = updated, updated["sequence"]
    print(json.dumps(outcome, indent=2))
    if outcome["status"] in {"queued", "running", "unconfirmed"}:
        print("Execution is not confirmed. Reconcile this request; do not automatically submit it again.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        print("Matrix rejected the request:", error.read(4096).decode("utf-8", "replace"))
        raise SystemExit(1)
    except (OSError, ValueError) as error:
        print("Matrix is unavailable or returned an invalid response. No automatic request retry.")
        raise SystemExit(1) from error
