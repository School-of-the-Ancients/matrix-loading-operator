"""Real Codex -> actual Windows player behavior acceptance using isolated saves.

Runs only with --run. This does not test a Quest display, controller or microphone.
Uses the existing command executor and the same provider adapter as headset voice.
"""
import argparse
import copy
import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("behavior_desktop_base", Path(__file__).with_name("Run-Composition-Desktop-Loop.py"))
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


def run(args):
    report = {"status": "failed", "startedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope": "Real Codex, actual Windows player, isolated PC persistence",
              "headsetTested": False, "voiceCaptureTested": False, "visualInspection": False,
              "checks": [], "inferences": []}
    workspace = Path(tempfile.mkdtemp(prefix="matrix-behaviors-"))
    service = player = None
    last_plan_mutations = 0
    log = (workspace / "service.log").open("wb")

    def check(condition, label):
        report["checks"].append({"name": label, "passed": bool(condition)})
        if not condition:
            raise RuntimeError(label)

    def api(path, body=None, timeout=15):
        request = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)

    def ready():
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            state = api('/api/state')
            if state['online'] and state['pendingCount'] == 0:
                return state
            time.sleep(.2)
        raise RuntimeError('Owned runtime did not become ready')

    def confirm(response):
        ids = {command['requestId'] for command in response['commands']}
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            state = api('/api/state')
            replies = {item['requestId']: item for item in state['results']}
            if ids.issubset(replies):
                check(all(replies[key]['ok'] for key in ids), 'Actual Windows player acknowledged queued command')
                return state
            time.sleep(.2)
        raise RuntimeError('Runtime acknowledgement timed out')

    def command(value):
        return confirm(api('/api/command', value))

    def obj(state=None):
        state = state or ready()
        return state['snapshot']['scene']['objects'][0]

    def configs(item):
        return {b['kind']: b for b in item.get('behaviors', [])}

    def plan(text):
        nonlocal last_plan_mutations
        proposal = api('/api/plan', {'text': text, 'mode': 'codex-cli',
                                   'codex': {'model': args.model, 'reasoningEffort': args.reasoning}}, timeout=150)
        check(proposal.get('status') == 'ready' and proposal.get('requiresApply'), 'Real AI produced reviewed proposal: ' + text)
        inference = proposal.get('inference') or {}
        check(proposal.get('mode') == 'codex-cli' and inference.get('completedTurn'), 'Real Codex completed inference without offline substitution')
        check(api('/api/state')['pendingCount'] == 0, 'Proposal did not execute before Apply')
        report['inferences'].append({'request': text, 'summary': proposal.get('summary'), 'receipt': inference,
                                     'operations': [c['op'] for c in proposal['commands']]})
        last_plan_mutations = sum(c['op'] in {'set_behavior', 'remove_behavior', 'set_transform', 'spawn', 'duplicate', 'delete', 'clear'}
                                  for c in proposal['commands'])
        print('Reviewed real AI proposal: ' + text, flush=True)
        return confirm(api('/api/apply_plan', {'planId': proposal['planId']}))

    try:
        env = desktop.child_environment(argparse.Namespace(codex_exe=None, model=None))
        service = subprocess.Popen([sys.executable, '-u', str(ROOT / 'ControlService/server.py'), '--port', '0',
                                    '--scenes', str(workspace / 'scenes')], cwd=ROOT, env=env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, **desktop.hidden_options())
        url = desktop.wait_for_service(service, workspace / 'service.log')
        player = subprocess.Popen([str(ROOT / 'Builds/WhiteRoomDesktop/MatrixOperator.exe'), '-batchmode', '-nographics',
                                   '-serviceUrl', url, '-logFile', str(workspace / 'player.log')], cwd=ROOT, env=env,
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  **desktop.hidden_options())
        initial = ready()
        check(set(initial['snapshot'].get('behaviorKinds', [])) == {'rotate', 'bob'}, 'Updated actual player advertises behavior support')
        check(initial['snapshot']['scene']['objects'] == [], 'Owned player starts empty; user scene untouched')
        state = command({'op':'spawn', 'assetId':'orb', 'anchorId':'white-floor', 'transform': {
            'position': {'x':0,'y':1,'z':2}, 'rotation': {'x':0,'y':0,'z':0}, 'scale': {'x':.2,'y':.2,'z':.2}}})
        original = copy.deepcopy(obj(state)); object_id = original['objectId']
        state = plan('Make this orb rotate slowly.')
        check('rotate' in configs(obj(state)), 'Rotation configuration applied to existing orb')
        state = plan('Make it float gently above its placed baseline, keeping its rotation.')
        animated = copy.deepcopy(obj(state))
        check(set(configs(animated)) == {'rotate','bob'}, 'Rotation and bob coexist')
        check(animated['objectId'] == object_id and animated['transform'] == original['transform'], 'Adding behaviors preserves identity and baseline')
        time.sleep(1.2)
        check(obj() == animated, 'Running animation does not change portable root placement or configuration')
        moved_pose = copy.deepcopy(animated['transform']); moved_pose['position']['x'] += .25
        state = command({'op':'set_transform','objectId':object_id,'transform':moved_pose})
        check(obj(state)['objectId'] == object_id and obj(state)['transform'] == moved_pose and configs(obj(state)) == configs(animated),
              'Moving animated object preserves identity and both behaviors')
        rotate = copy.deepcopy(configs(obj(state))['rotate']); rotate['paused'] = True
        state = command({'op':'set_behavior','objectId':object_id,'behavior':rotate})
        check(configs(obj(state))['rotate']['paused'] and not configs(obj(state))['bob']['paused'], 'Pause rotation independently of bob')
        rotate['paused'] = False
        state = command({'op':'set_behavior','objectId':object_id,'behavior':rotate})
        check(not configs(obj(state))['rotate']['paused'], 'Resume rotation')
        rotate['enabled'] = False
        state = command({'op':'set_behavior','objectId':object_id,'behavior':rotate})
        check(not configs(obj(state))['rotate']['enabled'], 'Disable preserves configuration')
        rotate['enabled'] = True
        state = command({'op':'set_behavior','objectId':object_id,'behavior':rotate})
        before_stop = copy.deepcopy(obj(state))
        state = plan('Stop the bobbing but keep it rotating.')
        active = configs(obj(state)); bob = active.get('bob')
        check((bob is None or not bob['enabled'] or bob['paused']) and active['rotate']['enabled'] and not active['rotate']['paused'],
              'AI stops bob while preserving active rotation')
        check(last_plan_mutations > 0, 'Stop-bob proposal recorded a scene edit')
        for _ in range(last_plan_mutations):
            state = command({'op':'undo'})
        check(obj(state) == before_stop, 'Undo behavior edit restores previous configuration and placement')
        bob = copy.deepcopy(configs(obj(state))['bob']); bob['paused'] = True
        state = command({'op':'set_behavior','objectId':object_id,'behavior':bob})
        saved_scene = copy.deepcopy(state['snapshot']['scene'])
        check(api('/api/save', {'name':'BehaviorAcceptance'})['saved'], 'PC saves animated scene')
        disk = json.loads((workspace / 'scenes/BehaviorAcceptance.json').read_text())
        check(disk['scene'] == saved_scene and 'behaviorKinds' not in disk and 'viewer' not in disk,
              'Save contains exact placement/configuration without live capability or viewer data')
        state = command({'op':'clear'})
        check(state['snapshot']['scene']['objects'] == [], 'Clear removes animated object')
        state = confirm(api('/api/load', {'name':'BehaviorAcceptance'}))
        check(state['snapshot']['scene'] == saved_scene, 'Restore preserves IDs, placement, enabled state and paused behavior settings')
        command({'op':'select','objectId':object_id})
        state = plan('Remove its animations.')
        check(not configs(obj(state)) and obj(state)['transform'] == moved_pose, 'AI removes all animations without changing baseline')
        check(last_plan_mutations > 0, 'Remove-animations proposal recorded a scene edit')
        for _ in range(last_plan_mutations):
            state = command({'op':'undo'})
        check(state['snapshot']['scene'] == saved_scene, 'Undo animation removal restores saved configuration')
        report['status'] = 'passed'
    except Exception as error:
        report['error'] = str(error)
    finally:
        report['ownedProcessesStopped'] = all([desktop.stop_owned_process(player), desktop.stop_owned_process(service)])
        log.close()
        report['passed'] = sum(c['passed'] for c in report['checks'])
        report['failed'] = sum(not c['passed'] for c in report['checks']) + int(report['status'] != 'passed' and not any(not c['passed'] for c in report['checks']))
        report['completedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        report['localDiagnosticsRetained'] = True
        args.report.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
        print(json.dumps({'status':report['status'],'passed':report['passed'],'failed':report['failed'],
                          'error':report.get('error'),'ownedProcessesStopped':report['ownedProcessesStopped']}), flush=True)
    return 0 if report['status'] == 'passed' and report['ownedProcessesStopped'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--model', default='gpt-5.6-sol')
    parser.add_argument('--reasoning', default='xhigh')
    parser.add_argument('--report', type=Path, default=ROOT / 'Validation/behavior-desktop-results.json')
    args = parser.parse_args()
    if not args.run:
        parser.error('Supply --run to authorize isolated player edits and four real Codex requests')
    sys.exit(run(args))
