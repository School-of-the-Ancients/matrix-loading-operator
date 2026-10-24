import copy
import unittest
import tempfile
import hashlib
from pathlib import Path
from web_assets import WebAssetCatalog, WebAssetError
from test_web_assets import glb
from asset_parts import checked_parts, inspect_parts, validate_targets, part_revision

class PartTests(unittest.TestCase):
    def setUp(self):
        self.document={'nodes':[{'name':'Rotor','mesh':0}], 'meshes':[{'primitives':[{}]}]}

    def test_named_meshes_are_automatic_targets_but_do_not_invent_a_function(self):
        parts=inspect_parts(self.document)
        self.assertEqual(parts[0]['label'],'Rotor')
        self.assertEqual(parts[0]['description'],'')
        self.assertEqual(parts[0]['provenance'],'node-name')

    def test_authored_parts_accept_only_bounded_data_and_real_submeshes(self):
        part={'partId':'canvas','label':'Canvas','nodeIndex':0,'primitiveIndex':0,'description':'Illustrative sail.'}
        self.assertEqual(validate_targets([part],self.document)[0]['partId'],'canvas')
        for change in ({'nodeIndex':2},{'nodeIndex':True},{'primitiveIndex':2},{'localPoint':{'x':float('nan'),'y':0,'z':0}},{'url':'http://example.org'},{'description':'x'*601}):
            with self.subTest(change=change),self.assertRaises(ValueError):validate_targets([{**part,**change}],self.document)
        with self.assertRaises(ValueError):checked_parts([part,part])

    def test_embedded_metadata_and_revision_are_stable_and_change_with_the_description(self):
        self.document['nodes'][0]['extras']={'matrixPart':{'partId':'rotor','label':'Rotor','description':'Turns the sail.'}}
        parts=inspect_parts(self.document)
        self.assertEqual(parts[0]['provenance'],'authored')
        self.assertEqual(part_revision(parts),part_revision(copy.deepcopy(parts)))
        changed=copy.deepcopy(parts);changed[0]['description']='Illustrates rotation, not lift.'
        self.assertNotEqual(part_revision(parts),part_revision(changed))
        anchor={'partId':'shaft','label':'Shaft','nodeIndex':0,'localPoint':{'x':-0.0,'y':1.0,'z':0}}
        browser={**anchor,'localPoint':{'x':0,'y':1,'z':0}}
        self.assertEqual(part_revision([anchor]),part_revision([browser]))

    def test_annotations_survive_reopen_and_reregistration_without_changing_model_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'model.glb';path.write_bytes(glb())
            catalog=WebAssetCatalog(Path(folder)/'catalog');asset=catalog.register(path,'Rotor')
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            changed=catalog.annotate_parts(asset['assetId'],digest,[{'partId':'sail','label':'Sail','nodeIndex':0,'description':'Illustrative part.'}])
            self.assertEqual(changed['parts'][0]['partId'],'sail')
            self.assertEqual(WebAssetCatalog(catalog.root).list()[0]['partsRevision'],changed['partsRevision'])
            self.assertEqual(catalog.register(path,'Rotor')['partsRevision'],changed['partsRevision'])
            self.assertEqual(hashlib.sha256(catalog.file(digest).read_bytes()).hexdigest(),digest)
            with self.assertRaises(WebAssetError):catalog.annotate_parts(asset['assetId'],'0'*64,[])
