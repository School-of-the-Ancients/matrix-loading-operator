"""Connect one authorized USB Quest to the existing local Professor service."""
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ControlService'))
from quest_connection import find_adb, QUEST_MODELS


def connect(adb=None, run=subprocess.run):
    adb = adb or find_adb()
    if not adb:
        raise RuntimeError('ADB is unavailable. Install the existing Unity Android SDK or set MATRIX_ADB.')
    def call(*args):
        result = run([adb, *args], capture_output=True, text=True, timeout=12,
                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError('Quest USB command failed. Keep the headset awake and check its USB debugging authorization.')
        return result.stdout
    devices = [line.split()[0] for line in call('devices', '-l').splitlines()[1:]
               if len(line.split()) > 1 and line.split()[1] == 'device' and ':' not in line.split()[0]]
    if len(devices) != 1:
        raise RuntimeError('Connect exactly one USB Quest and accept its USB debugging prompt.')
    serial = devices[0]
    if call('-s', serial, 'shell', 'getprop', 'ro.product.model').strip() not in QUEST_MODELS:
        raise RuntimeError('The connected USB device is not a supported Quest.')
    mappings = call('-s', serial, 'reverse', '--list')
    for line in mappings.splitlines():
        columns = line.split()
        if len(columns) >= 2 and columns[-2] == 'tcp:8765' and columns[-1] != 'tcp:8765':
            raise RuntimeError('Quest port 8765 already serves something else. Its mapping was left unchanged.')
    call('-s', serial, 'reverse', 'tcp:8765', 'tcp:8765')
    if not any(line.split()[-2:] == ['tcp:8765', 'tcp:8765'] for line in call('-s', serial, 'reverse', '--list').splitlines()):
        raise RuntimeError('Quest port mapping could not be verified.')
    return {'url': 'http://127.0.0.1:8765/web/', 'transport': 'USB', 'port': 8765,
            'next': 'Open this address in Quest Browser. Keep USB connected. Choose Professor, select your lesson and appearance, then enter AR.'}


if __name__ == '__main__':
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=5) as response:
            if not json.load(response).get('ok'):
                raise RuntimeError('The local Matrix service is not ready.')
        print(json.dumps(connect()))
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error))
