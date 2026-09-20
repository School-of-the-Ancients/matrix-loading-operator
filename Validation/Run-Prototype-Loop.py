"""Exercise natural language -> actual Unity player -> PC save/clear/restore.

Runs a bundled Windows simulation, never claims real MRUK/headset validation.
The offline language mode is explicit; provider HTTP behavior has separate tests.
"""
import copy
import datetime
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'ControlService'))
from server import Server, State


def main():
    checks = []
    report = {'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'Actual Windows Unity player with simulated room and PC HTTP service',
              'languageMode': 'offline-rules (not a model)', 'hardwareTested': False}
    player = None
    temporary = tempfile.TemporaryDirectory(prefix='ar-sandbox-loop-')
    service = Server(('127.0.0.1', 0), State(Path(temporary.name) / 'scenes'))
    thread = threading.Thread(target=service.serve_forever, daemon=True)
    thread.start()
    base = 'http://127.0.0.1:' + str(service.server_port)

    def check(condition, description):
        if not condition:
            raise AssertionError(description)
        checks.append(description)

    def request(path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    def wait(predicate, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            current = request('/api/state')
            if predicate(current):
                return current
            time.sleep(.15)
        raise TimeoutError('Runtime did not reach expected state')

    def language(prompt):
        proposal = request('/api/plan', {'text': prompt, 'mode': 'offline-rules'})
        check(proposal['mode'] == 'offline-rules', prompt + ': mode explicitly offline')
        check(request('/api/state')['pendingCount'] == 0, prompt + ': proposal does not execute before Apply')
        response = request('/api/apply_plan', {'planId': proposal['planId']})
        ids = {c['requestId'] for c in response.get('commands', [])}
        if ids:
            current = wait(lambda s: s['pendingCount'] == 0 and ids <= {r['requestId'] for r in s['results']})
            check(all(r['ok'] for r in current['results'] if r['requestId'] in ids), prompt + ': runtime acknowledged success')
        else:
            check(response.get('saved'), prompt + ': PC save acknowledged')
        return request('/api/state')['snapshot']

    try:
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        player = subprocess.Popen([str(PROJECT / 'Builds/Desktop/AR-Sandbox.exe'), '-batchmode', '-nographics',
                                   '-serviceUrl', base, '-logFile', str(PROJECT / 'Validation/prototype-player.log')],
                                  startupinfo=startup)
        current = wait(lambda s: s['online'])['snapshot']
        check(current['scene']['roomId'] == 'simulated-room-v1', 'Simulation is explicitly identified')
        check(len(current['assets']) == 3 and len(current['anchors']) == 2, 'Bundled props and simulated room targets loaded')
        current = language('Put a block here')
        first = current['scene']['objects'][0]
        first_id = first['objectId']
        check(current['selection']['objectId'] == first_id, 'Spawned object selected by stable identity')
        current = language('Make it twice as big')
        changed = current['scene']['objects'][0]
        check(changed['objectId'] == first_id and abs(changed['transform']['scale']['x'] - first['transform']['scale']['x'] * 2) < 1e-5,
              'Natural language scales the existing object without respawning')
        current = language('Move it 20 cm left')
        check(abs(current['scene']['objects'][0]['transform']['position']['x'] - (first['transform']['position']['x'] - .2)) < 1e-5,
              'Natural language applies a 20 cm relative translation in the surface frame')
        current = language('Rotate it 45 degrees')
        check(abs(current['scene']['objects'][0]['transform']['rotation']['y'] - 45) < 1e-4,
              'Natural language rotates the same object')
        current = language('Put an orb here')
        second_id = current['selection']['objectId']
        check(second_id != first_id and len(current['scene']['objects']) == 2, 'Second prop receives a distinct identity')
        current = language('Delete it')
        check([o['objectId'] for o in current['scene']['objects']] == [first_id], 'Natural language deletes only the selected second object')
        saved_scene = copy.deepcopy(current['scene'])
        language('Save as PrototypeLoop')
        saved = Path(temporary.name) / 'scenes/PrototypeLoop.json'
        check(saved.is_file(), 'Natural language writes a real scene file on the PC')
        check(json.loads(saved.read_text())['scene'] == saved_scene, 'Saved document contains exact IDs assets anchors and transforms')
        current = language('Clear the scene')
        check(current['scene']['objects'] == [], 'Scene cleared in the running player')
        current = language('Load PrototypeLoop')
        check(current['scene'] == saved_scene, 'Restore exactly preserves IDs asset choices room anchors and local transforms')
        check(player.poll() is None, 'Full loop ran without application restart or Unity rebuild')
        log = (PROJECT / 'Validation/prototype-player.log').read_text(encoding='utf-8', errors='replace')
        check('Exception:' not in log, 'Actual player log contains no runtime exceptions')
        report.update(passed=len(checks), failed=0)
    except Exception as error:
        report.update(passed=len(checks), failed=1, error=str(error))
        raise
    finally:
        report['checks'] = checks
        report['completedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (PROJECT / 'Validation/prototype-loop-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        if player and player.poll() is None:
            player.terminate()
            player.wait(timeout=10)
        service.shutdown()
        service.server_close()
        thread.join(timeout=5)
        temporary.cleanup()
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
