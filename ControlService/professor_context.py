"""Bounded, advisory lesson context for the existing Matrix Operator."""
import copy
import re

def checked_lesson_context(value):
    if not isinstance(value, dict) or set(value) != {'sessionId','teacherName','goal','events'}:
        raise ValueError('Invalid lesson context')
    if not isinstance(value['sessionId'], str) or not re.fullmatch(r'[a-f0-9-]{36}',value['sessionId']):
        raise ValueError('Invalid lesson identity')
    for key,limit in (('teacherName',100),('goal',500)):
        if not isinstance(value[key],str) or len(value[key])>limit:raise ValueError('Invalid lesson description')
    if not isinstance(value['events'],list) or len(value['events'])>10:raise ValueError('Too many lesson events')
    for event in value['events']:
        if not isinstance(event,dict) or set(event)!={'speaker','recipient','text'} or event['speaker'] not in ('learner','professor','operator') or event['recipient'] not in ('learner','professor','operator') or not isinstance(event['text'],str) or len(event['text'])>600:
            raise ValueError('Invalid lesson event')
    return copy.deepcopy(value)
