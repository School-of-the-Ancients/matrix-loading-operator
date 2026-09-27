import test from 'node:test';
import assert from 'node:assert/strict';
import {CREATION_MODE_KEY,loadCreationMode,saveCreationMode,
  creationModeFromPanelAction} from '../src/creation_mode.js';

function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
}

test('creation mode defaults to Auto and stays in this tab',()=>{
  const first=storage(),otherTab=storage();
  assert.equal(loadCreationMode(first),'auto');
  saveCreationMode(first,'procedural');
  assert.equal(first.getItem(CREATION_MODE_KEY),'procedural');
  assert.equal(loadCreationMode(first),'procedural');
  assert.equal(loadCreationMode(otherTab),'auto');
  saveCreationMode(first,'blender');
  assert.equal(loadCreationMode(first),'blender');
  assert.throws(()=>saveCreationMode(first,'network'),/Unknown concept creation mode/);
});

test('XR creation-mode actions map to the same desktop values',()=>{
  for(const mode of ['auto','procedural','blender'])
    assert.equal(creationModeFromPanelAction(`creation-mode-${mode}`),mode);
  assert.equal(creationModeFromPanelAction('creation-mode-other'),null);
  assert.equal(creationModeFromPanelAction('agent-connect'),null);
});
