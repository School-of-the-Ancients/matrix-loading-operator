"""Opt-in development checks. No production imports of this module or live edits."""
from __future__ import annotations

import argparse
from functools import partial
from datetime import datetime, timezone
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.error import URLError
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ControlService"))
from quest_connection import find_adb, QUEST_MODELS  # Discovery only; never reconnect().

MAX_BYTES = 65536


class Blocked(Exception):
    """A prerequisite is unavailable; this is not a successful check."""


def command(args, timeout=10):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True,
                          stdin=subprocess.DEVNULL, timeout=timeout, check=True).stdout.strip()


def hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob('*')) if p.is_file()}


def source_evidence():
    return {"commit": command(['git', 'rev-parse', 'HEAD']),
            "dirty": bool(command(['git', 'status', '--porcelain', '--untracked-files=normal'])),
            "runtimeVersion": json.loads((ROOT / 'WebRuntime/package.json').read_text())['version'],
            "runtimeSourceSha256": hashes(ROOT / 'WebRuntime/src'),
            "fixtureSourceSha256": {name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                                    for name in ('runner.py', 'build.mjs', 'fixture.js', 'index.html')},
            "pythonVersion": sys.version,
            "nodeVersion": command(['node', '--version']),
            "lockSha256": hashlib.sha256((ROOT / 'WebRuntime/package-lock.json').read_bytes()).hexdigest()}


class Report:
    def __init__(self, mode):
        self.value = {"schemaVersion": 1, "startedAt": datetime.now(timezone.utc).isoformat(), "mode": mode, "status": "blocked",
                      "source": None, "build": None, "runtime": None, "device": None,
                      "checks": [], "logs": [], "artifacts": [],
                      "excludedChecks": [{"name": name, "status": "unrun"} for name in
                                         ('xr-entry', 'hardware-capture', 'hardware-performance', 'wearer-acceptance')],
                      "limits": ["No XR entry, hardware capture/performance, or wearer acceptance.",
                                 "Desktop fixture uses actual MatrixWorld and browser storage, not the production UI or PC receipt transport."]}

    def check(self, name, action):
        start = time.monotonic()
        try:
            evidence = action()
            status, reason = 'pass', None
        except Blocked as error:
            status, reason, evidence = 'blocked', str(error), None
        except Exception as error:
            status, reason, evidence = 'fail', f'{type(error).__name__}: {error}', None
        self.value['checks'].append(dict(name=name, status=status, reason=reason,
                                        evidence=evidence, elapsedMs=round((time.monotonic()-start)*1000)))
        self.value['status'] = ('fail' if any(c['status']=='fail' for c in self.value['checks'])
                                else 'blocked' if any(c['status']=='blocked' for c in self.value['checks']) else 'pass')
        return status == 'pass'


def unavailable(reason):
    raise Blocked(reason)


def quest_device(adb=None, run=command):
    adb = adb or find_adb()
    if not adb:
        raise Blocked('ADB unavailable; no installation or security changes attempted.')
    def read(*args):
        try:
            result = run([adb, *args], timeout=3)
        except (OSError, subprocess.SubprocessError) as error:
            raise Blocked(f'ADB read unavailable ({type(error).__name__}); no recovery attempted.') from None
        if len(result.encode()) > MAX_BYTES:
            raise ValueError('Oversized ADB response')
        return result
    lines = [line.split() for line in read('devices', '-l').splitlines()
             if line.strip() and not line.startswith('List of devices')]
    if len(lines) != 1 or len(lines[0]) < 2:
        raise Blocked('Require exactly one authorized USB Quest.')
    serial, state = lines[0][:2]
    if state != 'device':
        raise Blocked(f'Device state is {state}; USB authorization/readiness missing.')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,128}', serial) or serial.startswith('emulator-'):
        raise Blocked('Not a USB Quest serial.')
    if read('-d', 'get-serialno') != serial:
        raise Blocked('Device is not the single USB target.')
    model = read('-s', serial, 'shell', 'getprop', 'ro.product.model')
    if model not in QUEST_MODELS:
        raise Blocked('Unsupported device model.')
    return {"serial": serial, "model": model,
            "osBuild": read('-s', serial, 'shell', 'getprop', 'ro.build.fingerprint'),
            "transport": "authorized-usb-read-only", "adb": adb}


def cdp_base(value):
    url = urlsplit(value)
    if (url.scheme != 'http' or url.hostname != '127.0.0.1' or not url.port
            or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment):
        raise Blocked('CDP must be an explicit credential-free http://127.0.0.1:PORT base URL.')
    return value.rstrip('/')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Blocked('CDP redirect refused.')


def read_json(url):
    # Ignore proxy environment and never follow redirects away from the reviewed endpoint.
    try:
        with build_opener(ProxyHandler({}), NoRedirect()).open(url, timeout=3) as response:
            raw = response.read(MAX_BYTES + 1)
    except (URLError, TimeoutError) as error:
        raise Blocked(f'CDP endpoint unavailable ({type(error).__name__}).') from None
    if len(raw) > MAX_BYTES:
        raise ValueError('Oversized CDP response')
    return json.loads(raw)


def cdp_readiness(endpoint, read=read_json):
    if not endpoint:
        raise Blocked('No existing loopback Quest Browser CDP endpoint supplied; forwarding is never configured automatically.')
    base = cdp_base(endpoint)
    version = read(base + '/json/version')
    targets = read(base + '/json/list')
    if not isinstance(version, dict) or not isinstance(targets, list):
        raise ValueError('Malformed CDP discovery response')
    if not version.get('Browser') or not version.get('Protocol-Version'):
        raise Blocked('CDP browser/protocol version missing.')
    # Do not retain unrelated tab URLs/titles or attach to a wearer's page.
    pages = [t for t in targets if isinstance(t, dict) and t.get('type') == 'page']
    if not pages:
        raise Blocked('No browser page target available.')
    return {"browser": version['Browser'], "protocol": version['Protocol-Version'],
            "pageCount": len(pages), "endpoint": base,
            "deviceAssociation": "unverified: discovery alone cannot bind CDP to the USB device"}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def evaluate(context, page, expression):
    """Bounded CDP seam on an owned disposable page; no externally supplied code."""
    session = context.new_cdp_session(page)
    try:
        response = session.send('Runtime.evaluate', {'expression': expression,
            'returnByValue': True, 'awaitPromise': True, 'timeout': 10000})
        if response.get('exceptionDetails'):
            raise AssertionError(f"Fixture exception: {response['exceptionDetails']}")
        return response['result']['value']
    finally:
        session.detach()


def desktop(report, browser_executable=None):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise Blocked('Python Playwright is unavailable; no automatic install attempted.') from None
    if not (ROOT / 'WebRuntime/node_modules/vite').is_dir():
        raise Blocked('Existing WebRuntime Vite dependency unavailable; run the documented development setup.')
    with tempfile.TemporaryDirectory(prefix='matrix-check-') as tmp:
        output = Path(tmp) / 'fixture'
        command(['node', str(Path(__file__).with_name('build.mjs')), str(output)], timeout=90)
        report.value['build'] = {"kind": "isolated-browser-contract-fixture", "sha256": hashes(output)}
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(output)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                executable = Path(browser_executable or playwright.chromium.executable_path)
                if not executable.is_absolute() or not executable.is_file():
                    raise Blocked('Playwright Chromium unavailable; no browser installation attempted.')
                browser = playwright.chromium.launch(executable_path=str(executable))
                try:
                    context = browser.new_context()
                    context.set_default_timeout(10000)
                    errors = []
                    def observe(page):
                        page.on('pageerror', lambda error: errors.append(str(error)[:1000]))
                        page.on('console', lambda msg: report.value['logs'].append(
                            {"source": "desktop-browser", "level": msg.type, "text": msg.text[:1000]})
                            if len(report.value['logs']) < 100 else None)
                    page = context.new_page()
                    observe(page)
                    url = f'http://127.0.0.1:{server.server_port}/'
                    page.goto(url)
                    page.wait_for_function('Boolean(window.matrixCheck)')
                    report.value['runtime'] = evaluate(context, page, 'matrixCheck.ready()')
                    report.value['runtime']['browserVersion'] = browser.version
                    report.value['runtime']['browserExecutable'] = str(executable)
                    report.value['runtime']['url'] = url
                    expected_descriptor = {"schemaVersion": 1, "client": "matrix-web",
                                           "renderer": "threejs-webxr", "presentation": "desktop"}
                    if report.value['runtime']['descriptor'] != expected_descriptor:
                        raise AssertionError('Desktop runtime descriptor mismatch')
                    before = evaluate(context, page, 'matrixCheck.exercise()')
                    report.value['observations'] = {'expectedTransform': TARGET, 'beforeReopen': before}
                    assert_scene(before['scene'])
                    expected_ids = ['check-spawn', 'check-clear', 'check-load', 'check-transform']
                    assert [r['requestId'] for r in before['receipts']] == expected_ids, 'Receipt identity mismatch'
                    assert all(r['ok'] is True for r in before['receipts']), 'Incomplete runtime receipt'
                    page.close()
                    page = context.new_page()
                    observe(page)
                    page.goto(url)
                    page.wait_for_function('Boolean(window.matrixCheck)')
                    after = evaluate(context, page, 'matrixCheck.reopen()')
                    report.value['observations']['afterReopen'] = after
                    assert_scene(after['scene'])
                    assert before['saved'] == after['world'], 'Saved world differs after new-page reopen'
                    assert not errors, f'Browser exceptions: {errors}'
                    assert not any(log['level']=='error' for log in report.value['logs']), 'Browser console errors'
                    return {"expected": {"receiptIds": expected_ids, "objectId": 'automated-check-block',
                                         "transform": TARGET, "savedWorldEqualsReopened": True},
                            "actual": {"receipts": before['receipts'], "reopenedScene": after['scene'],
                                       "savedWorldEqualsReopened": before['saved'] == after['world']},
                            "input": "synthetic typed commands", "storage": "disposable browser context; new page"}
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


TARGET = {"position": {"x": 2, "y": .5, "z": -3}, "rotation": {"x": 15, "y": 45, "z": 30},
          "scale": {"x": 2, "y": 3, "z": 4}}


def assert_scene(scene):
    assert len(scene['objects']) == 1, 'Unexpected object count'
    obj = scene['objects'][0]
    assert obj['objectId'] == 'automated-check-block', 'Stable identity changed'
    assert obj['assetId'] == 'block', 'Asset identity changed'
    assert obj['transform'] == TARGET, 'Observed transform differs from expected'


def verify_source(before):
    after = source_evidence()
    if before != after:
        raise AssertionError('Source changed during checks; rerun on a stable source tree.')
    return {'unchanged': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['desktop', 'quest-readiness'], default='desktop')
    parser.add_argument('--cdp', help='Already configured Quest Browser loopback CDP base URL; read-only discovery')
    parser.add_argument('--browser-executable', type=Path, help='Existing absolute Chromium executable (desktop only)')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = Report(args.mode)
    def provenance():
        report.value['source'] = source_evidence()
        return {"commit": report.value['source']['commit'], "dirty": report.value['source']['dirty']}
    if report.check('source', provenance):
        if args.mode == 'desktop':
            report.check('load-transform-save-reopen', lambda: desktop(report, args.browser_executable))
        else:
            def device():
                report.value['device'] = quest_device()
                return report.value['device']
            if report.check('usb-readiness', device):
                def browser():
                    report.value['runtime'] = cdp_readiness(args.cdp)
                    return report.value['runtime']
                report.check('cdp-readiness', browser)
            else:
                report.check('cdp-readiness', lambda: unavailable('USB prerequisite blocked; CDP was not contacted.'))
            report.check('quest-execution', lambda: unavailable(
                'Quest fixture execution and exact running-build attestation are not implemented in this draft; no live page attached.'))
    if report.value['source']:
        report.check('source-unchanged', lambda: verify_source(report.value['source']))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report.value, indent=2) + '\n')
    print(json.dumps({"status": report.value['status'], "report": str(args.output)}))
    return {'pass': 0, 'fail': 1, 'blocked': 2}[report.value['status']]


if __name__ == '__main__':
    sys.exit(main())
