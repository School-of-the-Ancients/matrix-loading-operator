import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MatrixView} from '../src/view.js';

test('the Operator panel blocks a pointing hit on the world behind it',()=>{
  const view=Object.create(MatrixView.prototype);
  view.renderer={xr:{isPresenting:false}};
  view.pointerKnown=true;
  view.pointer=new THREE.Vector2(0,0);
  view.camera=new THREE.PerspectiveCamera(65,1,.01,100);
  view.camera.position.set(0,1,0);
  view.camera.lookAt(0,0,-3);
  view.camera.updateMatrixWorld(true);
  view.raycaster=new THREE.Raycaster();
  view.operatorPanel={group:{visible:true},mesh:new THREE.Mesh(new THREE.PlaneGeometry(2,2))};
  view.operatorPanel.mesh.position.set(0,.66,-1);
  view.operatorPanel.mesh.updateMatrixWorld(true);
  view.objectRoots=new Map();
  view.isAR=false;
  view.virtualFloorRoot=new THREE.Group();
  view.floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20));
  view.floor.rotation.x=-Math.PI/2;
  view.virtualFloorRoot.add(view.floor);
  view.virtualFloorRoot.updateMatrixWorld(true);
  assert.equal(view.pointingTarget(),null);
  view.operatorPanel.group.visible=false;
  assert.equal(view.pointingTarget().anchorId,'web-floor');
});

test('controller speech on the Operator does not report an object behind it',()=>{
  const view=Object.create(MatrixView.prototype);
  view.renderer={xr:{isPresenting:true}};
  const controller=new THREE.Group();controller.position.set(0,1,0);controller.updateMatrixWorld(true);
  view.lastPointingController=controller;
  view.raycaster=new THREE.Raycaster();
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(2,2));
  panel.position.set(0,1,-1);panel.updateMatrixWorld(true);
  view.operatorPanel={group:{visible:true},mesh:panel};
  const object=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5));
  object.position.set(0,1,-2);object.userData.objectId='chair-1';object.updateMatrixWorld(true);
  view.objectRoots=new Map([['chair-1',object]]);
  view.world={scene:{objects:[{objectId:'chair-1',anchorId:'web-floor'}]}};
  view.virtualFloorRoot=new THREE.Group();view.virtualFloorRoot.updateMatrixWorld(true);
  assert.equal(view.pointingTarget(),null);
  view.operatorPanel.group.visible=false;
  assert.equal(view.pointingTarget().objectId,'chair-1');
});
