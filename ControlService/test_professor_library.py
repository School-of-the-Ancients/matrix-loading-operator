import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from content_catalog import ContentError
from professor_library import ProfessorLibrary
from professor_avatars import public_catalog
from professor_avatar_jobs import ProfessorAvatarJobs
from web_assets import WebAssetCatalog


class LibraryTests(unittest.TestCase):
    def test_registered_avatar_is_reusable_after_restart_without_private_paths(self):
        source = Path(__file__).resolve().parents[1] / 'BundledAssets/professors/socrates.vrm'
        with tempfile.TemporaryDirectory() as directory:
            assets = WebAssetCatalog(Path(directory)/'assets')
            library = ProfessorLibrary(directory, assets)
            request = dict(source_path=str(source), expected_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                name='Leonardo custom', description='Renaissance teaching avatar', kind='avatar', teacher_ids=['davinci'],
                tags=['robe','beard'], job_id='')
            registered = library.register(request)
            self.assertEqual(library.register(request), registered)
            restored = ProfessorLibrary(directory, assets)
            matches = restored.list('beard','avatar')['assets']
            self.assertEqual(len(matches),1)
            self.assertEqual(matches[0]['teacherMatches'],['davinci'])
            self.assertNotIn('source_path',str(matches))
            avatar=public_catalog(assets.list(),restored.avatar_metadata())['avatars'][0]
            self.assertTrue(avatar['libraryOwned'])
            self.assertTrue(avatar['automaticSelection'])

    def test_bad_hash_kind_and_metadata_do_not_register_assets(self):
        source = Path(__file__).resolve().parents[1] / 'WebRuntime/art/professors/renaissance-scholar.vrm'
        with tempfile.TemporaryDirectory() as directory:
            assets=WebAssetCatalog(directory);library=ProfessorLibrary(directory,assets)
            request=dict(source_path=str(source),expected_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                name='Test',description='',kind='avatar',teacher_ids=[],tags=[],job_id='')
            for change in ({'expected_sha256':'0'*64},{'kind':'exhibit'},{'teacher_ids':['../bad']}):
                with self.assertRaises(ContentError):library.register({**request,**change})
                self.assertEqual(assets.list(),[])

    def test_avatar_jobs_deduplicate_and_require_registered_result(self):
        class Tasks:
            def __init__(self):self.calls=[]
            def submit(self,value,**flags):self.calls.append((value,flags));return value
            def get(self,*args):return {'status':'completed','message':'claimed done'}
        with tempfile.TemporaryDirectory() as directory:
            tasks=Tasks();assets=WebAssetCatalog(Path(directory)/'assets')
            state=SimpleNamespace(web_assets=assets,professor_library=ProfessorLibrary(directory,assets),
                professor_tasks=tasks,agent_portal=SimpleNamespace(open=lambda:{'sessionId':'a'*32}))
            jobs=ProfessorAvatarJobs(Path(directory)/'jobs',state)
            jobs.root.mkdir(parents=True)
            (jobs.root/'authoring-seeds.json').write_text('{"schemaVersion":1,"seeds":[]}',encoding='utf-8')
            value={'schoolSessionId':'00000000-0000-4000-8000-000000000001',
                'teacher':{'id':'davinci','name':'Leonardo','era':'Renaissance'},'description':'A human scholar'}
            first=jobs.ensure(value);second=jobs.ensure({**value,'description':'A similar scholar'})
            self.assertEqual(first['id'],second['id']);self.assertEqual(len(tasks.calls),1)
            self.assertTrue(tasks.calls[0][1]['asset_only'])
            instruction=tasks.calls[0][0]['instruction']
            self.assertIn(str(Path(__file__).resolve().parents[1]/'Docs'/'Professor-Avatar-Authoring.md'),instruction)
            import json
            brief=json.loads(instruction.split('Brief: ',1)[1])
            self.assertEqual(brief['seedCatalog'],str(jobs.root/'authoring-seeds.json'))
            self.assertEqual(Path(brief['sourceProject']).parent,Path(brief['nativeVrmFile']).parent)
            self.assertEqual(Path(brief['recipeFile']).parent,Path(brief['vrmFile']).parent)
            self.assertEqual(first['status'],'failed')
            self.assertNotIn('catalogId',first)
            self.assertNotIn('seedCatalog',first)

    def test_avatar_job_without_local_seeds_still_has_authoring_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            calls=[]
            state=SimpleNamespace(web_assets=SimpleNamespace(list=lambda:[]),
                professor_tasks=SimpleNamespace(submit=lambda value,**flags:(calls.append(value) or value),
                    get=lambda *args:{'status':'running'}),
                agent_portal=SimpleNamespace(open=lambda:{'sessionId':'a'*32}))
            jobs=ProfessorAvatarJobs(Path(directory)/'jobs',state)
            jobs.ensure({'schoolSessionId':'00000000-0000-4000-8000-000000000001',
                'teacher':{'id':'custom','name':'Custom teacher','era':'Modern'},'description':'A teacher'})
            import json
            brief=json.loads(calls[0]['instruction'].split('Brief: ',1)[1])
            self.assertNotIn('seedCatalog',brief)
            self.assertTrue(brief['accessoryProject'].endswith('avatar.blend'))
            self.assertTrue(brief['validationFile'].endswith('validation.json'))


if __name__=='__main__':unittest.main()
