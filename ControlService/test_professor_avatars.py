import copy
import json
import struct
import hashlib
import tempfile
from pathlib import Path
import unittest

from professor_avatars import validate_binding, public_catalog
from vrm_assets import REQUIRED_BONES
from web_assets import inspect_glb, WebAssetError
from test_web_assets import glb
from server import scene, APIError


def vrm_bytes(edit=None):
    original=glb();length=struct.unpack_from('<I',original,12)[0]
    document=json.loads(original[20:20+length]);binary=original[28+length:]
    document['nodes'] += [{} for _ in REQUIRED_BONES]
    document['extensions']={'VRMC_vrm':{'specVersion':'1.0','meta':{'name':'Fixture','licenseUrl':'https://example.test/license'},
        'humanoid':{'humanBones':{name:{'node':index+1} for index,name in enumerate(sorted(REQUIRED_BONES))}}}}
    if edit:edit(document)
    encoded=json.dumps(document).encode();encoded+=b' '*(-len(encoded)%4)
    return struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary


class ProfessorAvatarTests(unittest.TestCase):
    def test_curated_models_are_valid_small_humans_and_unknown_assets_stay_manual(self):
        root=Path(__file__).resolve().parents[1]/'WebRuntime'/'art'/'professors'
        entries=json.loads((root/'catalog.json').read_text())['avatars']
        assets=[]
        for entry in entries:
            path=root/entry['file']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),entry['sha256'])
            info=inspect_glb(path)
            self.assertIn('aa',info['vrm']['expressions'])
            self.assertIn('blink',info['vrm']['expressions'])
            self.assertLess(info['bytes'],600000)
            assets.append(dict(assetId=entry['id'],sha256=entry['sha256'],displayName=entry['displayName'],geometry=info))
        assets.append(dict(assetId='riko',sha256='a'*64,displayName='Riko',geometry=assets[0]['geometry']))
        catalog=public_catalog(assets)['avatars']
        self.assertEqual(sum(item['automaticSelection'] for item in catalog),7)
        self.assertFalse(catalog[-1]['automaticSelection'])
        self.assertIn('fantasy',catalog[-1]['visualTags'])

    def test_vrm_profile_requires_valid_humanoid_and_retains_license(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'avatar.vrm';path.write_bytes(vrm_bytes())
            info=inspect_glb(path)
            self.assertEqual(info['vrm']['specVersion'],'1.0')
            self.assertEqual(info['vrm']['license']['name'],'Fixture')
            path.write_bytes(vrm_bytes(lambda d:d['extensions']['VRMC_vrm']['humanoid']['humanBones'].pop('head')))
            with self.assertRaises(WebAssetError):inspect_glb(path)

    def test_external_resources_remain_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'avatar.vrm'
            path.write_bytes(vrm_bytes(lambda d:d.update(images=[{'uri':'https://outside.example/a.png'}])))
            with self.assertRaises(WebAssetError):inspect_glb(path)

    def test_public_catalog_omits_private_paths_and_binding_survives_server_normalization(self):
        value={'schemaVersion':1,'teacherId':'euclid','teacherName':'Euclid','schoolSessionId':'00000000-0000-4000-8000-000000000001',
            'catalogId':'generic-professor','assetSha256':'','representation':'generic'}
        self.assertEqual(validate_binding(value,'professor-placeholder'),value)
        result=scene({'schemaVersion':1,'roomId':'web-virtual-room-v1','objects':[{'objectId':'prof','assetId':'professor-placeholder',
            'anchorId':'web-floor','transform':{'position':dict(x=0,y=0,z=0),'rotation':dict(x=0,y=0,z=0),'scale':dict(x=1,y=1,z=1)},'professor':value}]})
        self.assertEqual(result['objects'][0]['professor'],value)
        self.assertNotIn('location',json.dumps(public_catalog([])))
        invalid=copy.deepcopy(result);invalid['objects'][0]['professor']['assetSha256']='bad'
        with self.assertRaises(APIError):scene(invalid)

    def test_unknown_and_extra_binding_fields_are_rejected(self):
        with self.assertRaises(ValueError):validate_binding({'schemaVersion':1,'source':'C:/secret'},'professor-placeholder')
