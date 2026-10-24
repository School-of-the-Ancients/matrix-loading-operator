import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ProfessorMotion} from '../src/professor_motion.js';

function rig(){
  const scene=new THREE.Group();scene.position.set(2,0,-3);scene.rotation.y=.4;scene.scale.setScalar(1.2);
  const nodes={};const expressions=new Map([['aa',.6]]);
  for(const [side,sign] of [['left',1],['right',-1]]){
    const upper=new THREE.Object3D(),lower=new THREE.Object3D(),hand=new THREE.Object3D();
    upper.position.set(sign*.1,1.2,0);lower.position.x=sign*.25;hand.position.x=sign*.22;
    scene.add(upper);upper.add(lower);lower.add(hand);
    nodes[side+'UpperArm']=upper;nodes[side+'LowerArm']=lower;nodes[side+'Hand']=hand;
  }
  for(const name of ['spine','chest','neck','head']){nodes[name]=new THREE.Object3D();scene.add(nodes[name]);}
  const vrm={scene,humanoid:{getNormalizedBoneNode:name=>nodes[name]},expressionManager:{setValue:(key,value)=>expressions.set(key,value)}};
  return {vrm,nodes,expressions};
}
const localPosition=(node,root)=>root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));

test('first frame lowers both hands beside the body with softly bent elbows',()=>{
  const {vrm,nodes}=rig();new ProfessorMotion(vrm);
  for(const side of ['left','right']){
    vrm.scene.updateMatrixWorld(true);
    const upper=localPosition(nodes[side+'UpperArm'],vrm.scene),hand=localPosition(nodes[side+'Hand'],vrm.scene);
    assert(hand.y<upper.y-.4);
    assert(Math.abs(hand.x-upper.x)<.1);
    assert(Math.abs(nodes[side+'LowerArm'].quaternion.y)>.05);
  }
});

test('idle and speech move the skeleton, preserve root placement and lip-sync, then blend to rest',()=>{
  const {vrm,nodes,expressions}=rig(),motion=new ProfessorMotion(vrm);
  const root=vrm.scene.matrix.clone(),position=vrm.scene.position.clone(),rotation=vrm.scene.quaternion.clone(),scale=vrm.scene.scale.clone();
  const initial=nodes.leftUpperArm.quaternion.clone();
  for(let i=0;i<120;i++)motion.update(1/60);
  assert(nodes.chest.quaternion.angleTo(new THREE.Quaternion())>0);
  for(let i=0;i<180;i++)motion.update(1/60,{speaking:true,level:.7});
  assert(nodes.leftUpperArm.quaternion.angleTo(initial)>.015);
  for(let i=0;i<180;i++)motion.update(1/60);
  assert(nodes.leftUpperArm.quaternion.angleTo(initial)<.002);
  assert(vrm.scene.position.equals(position));assert(vrm.scene.quaternion.equals(rotation));assert(vrm.scene.scale.equals(scale));
  assert(vrm.scene.matrix.equals(root));assert.equal(expressions.get('aa'),.6);
  assert(expressions.get('blink')>=0&&expressions.get('blink')<=1);
});

test('optional missing bones, frame gaps and reduced motion remain finite and bounded',()=>{
  const {vrm,nodes}=rig(),motion=new ProfessorMotion(vrm,{reducedMotion:true});
  for(const dt of [0,NaN,-1,50,1/60])motion.update(dt,{speaking:true,listening:true,level:Infinity});
  for(const node of Object.values(nodes))assert(node.quaternion.toArray().every(Number.isFinite));
  assert.doesNotThrow(()=>new ProfessorMotion({humanoid:{getNormalizedBoneNode:()=>null}}).update(1/60));
});

test('pointing aims at a real world target across rotation/scale, then releases without root drift',()=>{
  for(const x of [-2,2]){
    const {vrm,nodes,expressions}=rig(),motion=new ProfessorMotion(vrm);
    const position=vrm.scene.position.clone(),rotation=vrm.scene.quaternion.clone(),scale=vrm.scene.scale.clone();
    vrm.scene.updateMatrixWorld(true);
    const target=vrm.scene.localToWorld(new THREE.Vector3(x,1.25,2));
    for(let i=0;i<240;i++)motion.update(1/60,{speaking:true,attentionTarget:target,point:true});
    vrm.scene.updateMatrixWorld(true);
    const side=x>0?'left':'right';
    const shoulder=nodes[side+'UpperArm'].getWorldPosition(new THREE.Vector3());
    const hand=nodes[side+'Hand'].getWorldPosition(new THREE.Vector3());
    assert(hand.sub(shoulder).normalize().dot(target.clone().sub(shoulder).normalize())>.98);
    for(let i=0;i<240;i++)motion.update(1/60);
    assert(motion.pointing<.001);assert.equal(motion.attentionTarget,null);
    assert(vrm.scene.position.equals(position));assert(vrm.scene.quaternion.equals(rotation));assert(vrm.scene.scale.equals(scale));
    assert.equal(expressions.get('aa'),.6);
  }
});

test('targets behind the torso receive no backwards pointing gesture',()=>{
  const {vrm}=rig(),motion=new ProfessorMotion(vrm);vrm.scene.updateMatrixWorld(true);
  const target=vrm.scene.localToWorld(new THREE.Vector3(0,1,-2));
  for(let i=0;i<120;i++)motion.update(1/60,{attentionTarget:target,point:true});
  assert.equal(motion.pointing,0);
});

test('moving an exhibit across the torso changes the pointing hand without moving the avatar',()=>{
  const {vrm}=rig(),motion=new ProfessorMotion(vrm);vrm.scene.updateMatrixWorld(true);
  for(const x of [-2,2]){
    const target=vrm.scene.localToWorld(new THREE.Vector3(x,1,2));
    for(let i=0;i<120;i++)motion.update(1/60,{attentionTarget:target,point:true});
    assert.equal(motion.pointSide,x>0?'left':'right');
  }
});
