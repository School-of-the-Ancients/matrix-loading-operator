"""Opt-in monotonic diagnostics, independent of world state and persistence."""
from collections import OrderedDict
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import re
import threading
import time

current_trace = ContextVar('matrix_latency_trace', default=None)
STAGES = {'server.request', 'context.assemble', 'prompt.build', 'agent.start',
          'agent.first_tool', 'agent.completed', 'approval.wait', 'speech.transcribe',
          'command.queued', 'receipt.received'}


class TraceRun:
    def __init__(self, trace_id, now=time.perf_counter):
        self.trace_id, self.now = trace_id, now
        self.lock = threading.Lock()
        self.events, self.sequence, self.requests = [], 0, set()
        self.first_tool = False
        self.approval_started = None

    def record(self, stage, start=None, *, outcome='ok', request_id=None, size=None):
        if stage not in STAGES:
            raise ValueError('Unknown trace stage')
        end = self.now()
        with self.lock:
            self.sequence += 1
            event = {'id': self.sequence, 'traceId': self.trace_id, 'stage': stage,
                     'startedMs': (end if start is None else start)*1000,
                     'durationMs': max(0, end-start)*1000 if start is not None else 0,
                     'outcome': 'ok' if outcome == 'ok' else 'failed'}
            if request_id is not None and re.fullmatch(r'[0-9a-f]{32}', request_id):
                event['requestId'] = request_id
                if len(self.requests) < 256:
                    self.requests.add(request_id)
            if size is not None:
                event['bytes'] = max(0, min(int(size), 1048576))
            self.events.append(event)
            self.events = self.events[-128:]

    def snapshot(self):
        with self.lock:
            return {'schemaVersion': 1, 'clock': 'service-monotonic',
                    'traceId': self.trace_id, 'records': [dict(e) for e in self.events]}


class TraceStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.runs = OrderedDict()

    def resolve(self, trace_id):
        if not isinstance(trace_id, str) or not re.fullmatch(r'[0-9a-f]{32}', trace_id):
            return None
        with self.lock:
            if trace_id not in self.runs:
                self.runs[trace_id] = TraceRun(trace_id)
            self.runs.move_to_end(trace_id)
            while len(self.runs) > 16:
                self.runs.popitem(last=False)
            return self.runs[trace_id]

    def for_request(self, request_id):
        with self.lock:
            return next((run for run in reversed(self.runs.values())
                         if request_id in run.requests), None)


@contextmanager
def span(stage):
    run = current_trace.get()
    start = run.now() if run else None
    outcome = 'failed'
    try:
        yield run
        outcome = 'ok'
    finally:
        if run:
            run.record(stage, start, outcome=outcome)


def traced_stage(stage):
    def decorate(operation):
        @wraps(operation)
        def wrapped(*args, **kwargs):
            with span(stage):
                return operation(*args, **kwargs)
        return wrapped
    return decorate


def traced_request(operation):
    @wraps(operation)
    def wrapped(handler):
        run = handler.server.state.latency_traces.resolve(
            handler.headers.get('X-Matrix-Trace'))
        token = current_trace.set(run)
        try:
            with span('server.request'):
                return operation(handler)
        finally:
            current_trace.reset(token)
    return wrapped
