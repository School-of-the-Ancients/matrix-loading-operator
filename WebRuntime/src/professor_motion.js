import * as THREE from 'three';

const BONES=['spine','chest','upperChest','neck','head','leftShoulder','rightShoulder',
  'leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'];
const SIDES=[['left',-1,0],['right',1,2.1]];
for(const [side] of SIDES)for(const finger of ['Index','Middle','Ring','Little'])
  for(const joint of ['Proximal','Intermediate','Distal'])BONES.push(side+finger+joint);
const damp=(value,target,rate,dt)=>value+(target-value)*(1-Math.exp(-rate*dt));

// Presentation-only motion on normalized bones. Never changes the entity/root transform.
export class ProfessorMotion {
  constructor(vrm,{reducedMotion=false}={}) {
    this.vrm=vrm;this.reducedMotion=reducedMotion;this.time=0;this.talking=0;this.listening=0;this.energy=0;
    this.euler=new THREE.Euler();this.rotation=new THREE.Quaternion();this.target=new THREE.Quaternion();
    this.bones=new Map();
    this.gazeTarget=new THREE.Object3D();this.attention=0;this.pointing=0;this.pointSide=null;
    this.aimPosition=new THREE.Vector3();this.direction=new THREE.Vector3();this.localTarget=new THREE.Vector3();
    this.parentRotation=new THREE.Quaternion();this.baseRotation=new THREE.Quaternion();this.swing=new THREE.Quaternion();
    this.axis=new THREE.Vector3();this.attentionTarget=null;
    for(const name of BONES){
      const node=vrm.humanoid.getNormalizedBoneNode(name);
      if(node)this.bones.set(name,{node,rest:node.quaternion.clone()});
    }
    vrm.humanoid.autoUpdateHumanBones=true;
    this.apply(1); // Show the relaxed pose on the first rendered frame, not a T-pose.
  }
  rotate(name,x,y,z,blend){
    const bone=this.bones.get(name);if(!bone)return;
    this.rotation.setFromEuler(this.euler.set(x,y,z,'XYZ'));
    this.target.copy(bone.rest).multiply(this.rotation);
    bone.node.quaternion.slerp(this.target,blend);
  }
  aimArm(side,blend){
    const bone=this.bones.get(side+'UpperArm');if(!bone?.node.parent)return;
    bone.node.updateWorldMatrix(true,false);
    bone.node.getWorldPosition(this.aimPosition);
    this.direction.copy(this.gazeTarget.position).sub(this.aimPosition);
    if(this.direction.lengthSq()<.01)return;
    this.direction.normalize();
    bone.node.parent.getWorldQuaternion(this.parentRotation);
    this.baseRotation.copy(this.parentRotation).multiply(bone.rest);
    this.axis.set(side==='left'?1:-1,0,0).applyQuaternion(this.baseRotation);
    this.swing.setFromUnitVectors(this.axis,this.direction);
    this.target.copy(this.swing).multiply(this.baseRotation);
    this.target.premultiply(this.parentRotation.invert());
    bone.node.quaternion.slerp(this.target,blend);
    // Extend the index finger; loosely curl the other fingers into a pointing hand.
    const sign=side==='left'?-1:1;
    for(const finger of ['Index','Middle','Ring','Little'])for(const joint of ['Proximal','Intermediate','Distal'])
      this.rotate(side+finger+joint,0,0,finger==='Index'?0:sign*.85,blend);
    this.rotate(side+'LowerArm',0,0,0,blend);
    this.rotate(side+'Hand',0,0,0,blend);
  }
  apply(blend){
    const t=this.time,motion=this.reducedMotion ? .2 : 1;
    const breath=Math.sin(t*1.55),sway=Math.sin(t*.62),talk=this.talking*motion;
    const listen=this.listening*motion,energy=.55+.45*this.energy;
    this.rotate('spine',.008*breath*motion,.012*sway*motion,.009*Math.sin(t*.48)*motion,blend);
    this.rotate('chest',.012*breath*motion,.015*talk*Math.sin(t*1.15),0,blend);
    this.rotate('upperChest',.005*breath*motion,0,0,blend);
    this.rotate('neck',.006*Math.sin(t*.8)*motion,0,0,blend);
    this.rotate('head',(.009*Math.sin(t*.9)+.028*listen*Math.sin(t*1.9)+.017*talk*Math.sin(t*2.8))*motion,
      .015*Math.sin(t*.43)*motion,.008*Math.sin(t*.71)*motion,blend);
    for(const [side] of SIDES)for(const finger of ['Index','Middle','Ring','Little'])
      for(const joint of ['Proximal','Intermediate','Distal'])this.rotate(side+finger+joint,0,0,0,blend);
    for(const [side,sign,phase] of SIDES){
      const gesture=(.5+.5*Math.sin(t*1.45+phase))*talk*energy;
      this.rotate(side+'Shoulder',0,0,-sign*.012*breath*motion,blend);
      this.rotate(side+'UpperArm',-.04-.15*gesture,0,sign*(1.43-.28*gesture),blend);
      this.rotate(side+'LowerArm',0,sign*(.2+.65*gesture),sign*.025,blend);
      this.rotate(side+'Hand',.035*Math.sin(t*1.2+phase)*talk,sign*.04,sign*(.035+.04*gesture),blend);
    }
    if(this.attentionTarget&&this.attention>.001){
      const chest=this.bones.get('chest')||this.bones.get('spine');
      if(chest?.node.parent){
        chest.node.parent.updateWorldMatrix(true,false);
        this.localTarget.copy(this.gazeTarget.position);chest.node.parent.worldToLocal(this.localTarget);
        this.localTarget.sub(chest.node.position);
        const yaw=Math.atan2(this.localTarget.x,this.localTarget.z);
        this.rotate('chest',.012*breath*motion,THREE.MathUtils.clamp(yaw,-.6,.6)*this.attention,0,blend);
      }
      if(this.pointSide&&this.pointing>.001)this.aimArm(this.pointSide,this.pointing);
    }
    const blink=Math.max(0,1-Math.abs((t%4.6)-4.35)/.085);
    this.vrm.expressionManager?.setValue('blink',blink);
  }
  update(delta,{speaking=false,listening=false,level=0,attentionTarget=null,point=false}={}){
    const dt=Number.isFinite(delta)?Math.max(0,Math.min(.1,delta)):0;
    this.time+=dt;
    this.talking=damp(this.talking,speaking?1:0,speaking?5:3.5,dt);
    this.listening=damp(this.listening,listening?1:0,4,dt);
    this.energy=damp(this.energy,Number.isFinite(level)?Math.max(0,Math.min(1,level)):0,7,dt);
    const valid=attentionTarget?.isVector3&&attentionTarget.toArray().every(Number.isFinite);
    if(valid){
      this.gazeTarget.position.copy(attentionTarget);
      const torso=this.bones.get('chest')||this.bones.get('spine');
      if(torso?.node.parent){
        torso.node.parent.updateWorldMatrix(true,false);
        this.localTarget.copy(attentionTarget);torso.node.parent.worldToLocal(this.localTarget);
        // Do not reach backwards. Hysteresis prevents hand swapping near the centre line.
        point=point&&this.localTarget.z>-.1;
        const side=this.localTarget.x>=0?'left':'right';
        if(!this.pointSide||this.pointing<.02)this.pointSide=side;
        else if(side!==this.pointSide&&Math.abs(this.localTarget.x)>.2){this.pointing=0;this.pointSide=side;}
      }else point=false;
      this.attentionTarget=true;
    }
    this.attention=damp(this.attention,valid?1:0,5,dt);
    this.pointing=damp(this.pointing,valid&&point?1:0,4,dt);
    if(!valid&&this.attention<.001){this.attentionTarget=null;this.pointSide=null;}
    this.apply(1-Math.exp(-12*dt));
  }
}
