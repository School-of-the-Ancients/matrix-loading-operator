import json
from pathlib import Path
import tempfile
import unittest
from agent_portal import AgentPortal
from latency_trace import TraceRun, TraceStore, current_trace, span
from test_agent_portal import FakeBackend


class LatencyTraceTests(unittest.TestCase):
    def test_bounds_and_request_correlation_do_not_retain_content(self):
        store=TraceStore()
        self.assertIsNone(store.resolve('private prompt'))
        run=store.resolve('a'*32)
        run.record('command.queued',request_id='b'*32)
        self.assertIs(store.for_request('b'*32),run)
        for _ in range(300):run.record('receipt.received')
        self.assertEqual(len(run.snapshot()['records']),128)
        for i in range(20):store.resolve(f'{i:032x}')
        self.assertEqual(len(store.runs),16)
        self.assertNotIn('private',json.dumps(run.snapshot()))

    def test_spans_preserve_failure_and_use_one_service_clock(self):
        ticks=iter([1,2]);run=TraceRun('a'*32,now=lambda:next(ticks))
        token=current_trace.set(run)
        try:
            with self.assertRaisesRegex(ValueError,'private error'):
                with span('context.assemble'):raise ValueError('private error')
        finally:current_trace.reset(token)
        event=run.snapshot()['records'][0]
        self.assertEqual((event['durationMs'],event['outcome']),(1000,'failed'))
        self.assertNotIn('private error',json.dumps(event))

    def test_trace_is_opt_in_and_not_persisted_with_agent_transcript(self):
        with tempfile.TemporaryDirectory() as directory:
            portal=AgentPortal(directory,lambda:FakeBackend([True]),pc_input=lambda _: 'n')
            try:
                session=portal.open()['sessionId'];run=TraceRun('a'*32)
                token=current_trace.set(run)
                try:portal.send_text(session,'private user request')
                finally:current_trace.reset(token)
                status=portal.status(session)
                self.assertEqual(status['latencyTrace']['traceId'],'a'*32)
                self.assertNotIn('private user request',json.dumps(status['latencyTrace']))
                saved=json.loads(Path(directory,'agent_portal.json').read_text())
                self.assertNotIn('latencyTrace',saved)
            finally:portal.close()
