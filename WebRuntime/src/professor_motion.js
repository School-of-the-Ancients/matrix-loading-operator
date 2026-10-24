import * as THREE from 'three';

const BONES=['spine','chest','upperChest','neck','head','leftShoulder','rightShoulder',
  'leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'];
const SIDES=[['left',-1,0],['right',1,2.1]];
const damp=(value,target,rate,dt)=>value+(target-value)*(1-Math.exp(-rate*dt));

// Presentation-only motion on normalized bones. Never changes the entity/root transform.
export class ProfessorMotion {
  constructor(vrm,{reducedMotion=false}={}) {
    this.vrm=vrm;this.reducedMotion=reducedMotion;this.time=0;this.talking=0;this.listening=0;this.energy=0;
    this.euler=new THREE.Euler();this.rotation=new THREE.Quaternion();this.target=new THREE.Quaternion();
    this.bones=new Map();
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
    for(const [side,sign,phase] of SIDES){
      const gesture=(.5+.5*Math.sin(t*1.45+phase))*talk*energy;
      this.rotate(side+'Shoulder',0,0,-sign*.012*breath*motion,blend);
      this.rotate(side+'UpperArm',-.04-.15*gesture,0,sign*(1.43-.28*gesture),blend);
      this.rotate(side+'LowerArm',0,sign*(.2+.65*gesture),sign*.025,blend);
      this.rotate(side+'Hand',.035*Math.sin(t*1.2+phase)*talk,sign*.04,sign*(.035+.04*gesture),blend);
    }
    const blink=Math.max(0,1-Math.abs((t%4.6)-4.35)/.085);
    this.vrm.expressionManager?.setValue('blink',blink);
  }
  update(delta,{speaking=false,listening=false,level=0}={}){
    const dt=Number.isFinite(delta)?Math.max(0,Math.min(.1,delta)):0;
    this.time+=dt;
    this.talking=damp(this.talking,speaking?1:0,speaking?5:3.5,dt);
    this.listening=damp(this.listening,listening?1:0,4,dt);
    this.energy=damp(this.energy,Number.isFinite(level)?Math.max(0,Math.min(1,level)):0,7,dt);
    this.apply(1-Math.exp(-12*dt));
  }
}
