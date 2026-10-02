"""Runner regression checks, including the actual disposable Chromium fixture."""
import copy
import os
import subprocess
import sys
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('automated_runner',
    Path(__file__).with_name('automated_checks') / 'runner.py')
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def transport(self, state='device', model='Quest 3', serial='usb123', usb='usb123'):
        calls = []
        responses = {('devices', '-l'): f'List of devices attached\n{serial} {state}\n',
                     ('-d', 'get-serialno'): usb,
                     ('-s', serial, 'shell', 'getprop', 'ro.product.model'): model,
                     ('-s', serial, 'shell', 'getprop', 'ro.build.fingerprint'): 'test-os-build'}
        def run(args, timeout):
            self.assertEqual(timeout, 3)
            calls.append(tuple(args[1:]))
            return responses[tuple(args[1:])]
        return run, calls

    def test_authorized_usb_discovery_is_read_only(self):
        run, calls = self.transport()
        value = runner.quest_device('/trusted/adb', run)
        self.assertEqual(value['model'], 'Quest 3')
        self.assertEqual(value['osBuild'], 'test-os-build')
        self.assertEqual(len(calls), 4)
        self.assertFalse(any('reverse' in c or 'forward' in c or 'reconnect' in c for c in calls))

    def test_missing_adb_blocked(self):
        with patch.object(runner, 'find_adb', return_value=None), self.assertRaises(runner.Blocked):
            runner.quest_device()

    def test_unavailable_unauthorized_offline_wrong_device_blocked(self):
        for kwargs in ({'state':'unauthorized'}, {'state':'offline'}, {'model':'Phone'},
                       {'usb':'other'}, {'serial':'emulator-5554'}, {'serial':'192.168.1.2:5555'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(runner.Blocked):
                runner.quest_device('/trusted/adb', self.transport(**kwargs)[0])

    def test_no_or_multiple_devices_blocked(self):
        for text in ('List of devices attached\n', 'a device\nb device\n'):
            with self.subTest(text=text), self.assertRaises(runner.Blocked):
                runner.quest_device('/trusted/adb', lambda *a, **kw: text)

    def test_oversized_transport_fails(self):
        with self.assertRaises(ValueError):
            runner.quest_device('/trusted/adb', lambda *a, **kw: 'x' * (runner.MAX_BYTES+1))

    def test_loopback_cdp_only(self):
        for url in ('http://example.com:9222', 'https://127.0.0.1:9222',
                    'http://user:secret@127.0.0.1:9222', 'http://127.0.0.1:9222/path',
                    'http://127.0.0.1:9222?token=a', 'http://127.0.0.1:9222#fragment',
                    'http://127.0.0.1'):
            with self.subTest(url=url), self.assertRaises(runner.Blocked):
                runner.cdp_readiness(url, lambda url: self.fail('Must not contact invalid URL'))

    def test_cdp_readiness_does_not_claim_usb_association(self):
        calls = []
        def read(url):
            calls.append(url)
            return ({'Browser':'Mock/1', 'Protocol-Version':'1.3'} if url.endswith('/version')
                    else [{'type':'page', 'url':'https://private.example', 'title':'private'}])
        value = runner.cdp_readiness('http://127.0.0.1:9222/', read)
        self.assertEqual(len(calls), 2)
        self.assertEqual(value['browser'], 'Mock/1')
        self.assertIn('unverified', value['deviceAssociation'])
        self.assertNotIn('private', str(value))

    def test_missing_cdp_or_target_blocked(self):
        with self.assertRaises(runner.Blocked):
            runner.cdp_readiness(None)
        with self.assertRaises(runner.Blocked):
            runner.cdp_readiness('http://127.0.0.1:9222', lambda url:
                {'Browser':'Mock/1','Protocol-Version':'1.3'} if url.endswith('version') else [])

    def test_redirect_refused(self):
        with self.assertRaises(runner.Blocked):
            runner.NoRedirect().redirect_request(None, None, None, None, None, 'http://remote')

    def test_report_preserves_failure_and_blocked(self):
        report = runner.Report('test')
        report.check('blocked', lambda: runner.unavailable('No device'))
        self.assertEqual(report.value['status'], 'blocked')
        report.check('ready', lambda: {'expected':1,'actual':1})
        self.assertEqual(report.value['status'], 'blocked')
        report.check('failure', lambda: 1/0)
        self.assertEqual(report.value['status'], 'fail')
        self.assertEqual(report.value['checks'][0]['reason'], 'No device')

    def test_deliberate_transform_corruption_fails(self):
        scene = {'objects':[{'objectId':'automated-check-block', 'assetId':'block',
                             'transform':copy.deepcopy(runner.TARGET)}]}
        runner.assert_scene(scene)
        scene['objects'][0]['transform']['position']['x'] += 1
        report = runner.Report('negative-control')
        report.check('load-transform-save-reopen', lambda: runner.assert_scene(scene))
        self.assertEqual(report.value['status'], 'fail')
        self.assertIn('transform', report.value['checks'][0]['reason'])

    def test_adb_timeout_is_blocked(self):
        def timeout(*args, **kwargs):
            raise runner.subprocess.TimeoutExpired('adb', 3)
        with self.assertRaises(runner.Blocked):
            runner.quest_device('/trusted/adb', timeout)

    def test_cdp_evaluation_timeout_and_exceptions(self):
        from unittest.mock import Mock
        session = Mock()
        context = Mock()
        context.new_cdp_session.return_value = session
        session.send.return_value = {'exceptionDetails': {'text':'fixture failure'}}
        with self.assertRaises(AssertionError):
            runner.evaluate(context, object(), 'matrixCheck.exercise()')
        self.assertEqual(session.send.call_args.args[1]['timeout'], 10000)
        session.detach.assert_called_once()

    def test_real_browser_detects_wrong_expected_transform(self):
        report = runner.Report('negative-control')
        wrong = copy.deepcopy(runner.TARGET)
        wrong['scale']['x'] = 9
        with patch.object(runner, 'TARGET', wrong):
            report.check('negative-control', lambda: runner.desktop(report, os.environ.get('MATRIX_CHECK_BROWSER')))
        self.assertEqual(report.value['status'], 'fail')
        self.assertIn('Observed transform differs', report.value['checks'][0]['reason'])

    def test_real_browser_rejects_corrupted_receipts_and_reopen(self):
        original = runner.evaluate
        cases = [('receipt-id', 'Receipt identity mismatch'),
                 ('receipt-ok', 'Incomplete runtime receipt'),
                 ('reopen', 'Saved world differs after new-page reopen')]
        for corruption, reason in cases:
            with self.subTest(corruption=corruption):
                def evaluate(context, page, expression):
                    value = original(context, page, expression)
                    if expression == 'matrixCheck.exercise()':
                        if corruption == 'receipt-id':
                            value['receipts'][0]['requestId'] = 'wrong-request'
                        elif corruption == 'receipt-ok':
                            value['receipts'][0]['ok'] = False
                    elif expression == 'matrixCheck.reopen()' and corruption == 'reopen':
                        value['world']['game'] = {'corrupt': True}
                    return value
                report = runner.Report('negative-control')
                with patch.object(runner, 'evaluate', evaluate):
                    report.check('negative-control', lambda: runner.desktop(report, os.environ.get('MATRIX_CHECK_BROWSER')))
                self.assertEqual(report.value['status'], 'fail')
                self.assertIn(reason, report.value['checks'][0]['reason'])

    def test_optimized_interpreters_detect_browser_corruption(self):
        # Re-run negative controls in fresh optimized processes, never this test itself.
        script = """
import sys, unittest
if sys.flags.optimize < 1:
    raise RuntimeError('Regression must run under optimization')
suite = unittest.defaultTestLoader.loadTestsFromNames([
    'test_automated_checks.RunnerTests.test_deliberate_transform_corruption_fails',
    'test_automated_checks.RunnerTests.test_real_browser_detects_wrong_expected_transform',
    'test_automated_checks.RunnerTests.test_real_browser_rejects_corrupted_receipts_and_reopen',
])
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
"""
        for flags, optimize in ((['-O'], '0'), ([], '2')):
            with self.subTest(flags=flags, PYTHONOPTIMIZE=optimize):
                result = subprocess.run([sys.executable, *flags, '-c', script],
                    cwd=Path(__file__).parent, env={**os.environ, 'PYTHONOPTIMIZE': optimize},
                    capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_desktop_browser_fixture(self):
        # A missing dependency is an explicit test failure, never a silently skipped desktop pass.
        report = runner.Report('desktop')
        report.check('load-transform-save-reopen', lambda: runner.desktop(report, os.environ.get('MATRIX_CHECK_BROWSER')))
        self.assertEqual(report.value['status'], 'pass', report.value['checks'])
        self.assertEqual(report.value['runtime']['descriptor']['presentation'], 'desktop')
        self.assertTrue(report.value['build']['sha256'])
        self.assertIsNone(report.value['device'])
        self.assertTrue(report.value['checks'][0]['evidence']['actual']['savedWorldEqualsReopened'])


if __name__ == '__main__':
    unittest.main()
