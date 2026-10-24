"""Saved invention tasks must not consume a selected-concept image."""
import copy
import unittest
from server import APIError, agent_portal_turn, concept_build_request
import test_concept_handoff as handoff


class ProfessorTaskRoutingTests(unittest.TestCase):
    setUp = handoff.ConceptHandoffTests.setUp
    exchange = handoff.ConceptHandoffTests.exchange

    def request(self):
        return {'taskId':'00000000-0000-4000-8000-000000000001',
                'schoolSessionId':'00000000-0000-4000-8000-000000000002',
                'sessionId':self.session_id,'title':'Additional flight designs',
                'instruction':'Using Blender, create and load two educational interpretations: a flapping-wing flying-machine concept and a pyramidal parachute concept. Preserve existing exhibits.',
                'objectiveId':'compare-designs'}

    def submit_task(self):
        manager=self.state.professor_tasks
        manager._start=lambda:None
        value=self.request();manager.submit(value)
        task=manager.tasks[value['taskId']];manager._step(task)
        return task

    def test_new_invention_task_starts_without_a_selected_image(self):
        value=self.request();self.assertTrue(concept_build_request(value['instruction']))
        self.state.concepts._change(lambda doc:doc['sessions'][self.session_id].update(selectedConceptId=None))
        task=self.submit_task()
        self.assertEqual(task['status'],'running');self.assertTrue(task['turnId'])
        self.assertEqual(len(self.backend.sent),1);self.assertIsNone(self.backend.sent[0][2])
        self.assertIn(value['instruction'],self.backend.sent[0][1])

    def test_invention_task_does_not_consume_an_unrelated_selected_image(self):
        before=copy.deepcopy(self.state.concepts.data)
        task=self.submit_task();self.assertEqual(task['status'],'running')
        self.assertIsNone(self.backend.sent[0][2]);self.assertEqual(self.state.concepts.data,before)
        self.assertIsNone(self.state.concept_build_guard)

    def test_public_turn_cannot_opt_into_the_internal_task_route(self):
        with self.assertRaises(APIError):
            agent_portal_turn(self.state,{'sessionId':self.session_id,'text':'Build a design','delegated_task':True})
        with self.assertRaises(APIError):
            agent_portal_turn(self.state,{'sessionId':self.session_id,'text':'Build a design','creationMode':'blender'},delegated_task=True)
        self.assertFalse(self.backend.sent)


if __name__=='__main__':unittest.main()
