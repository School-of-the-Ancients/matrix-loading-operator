// Original stylized teaching avatars, using only geometry authored here (MIT).
// Run with Node after installing the existing WebRuntime dependencies.
import * as THREE from '../WebRuntime/node_modules/three/build/three.module.js';
import {GLTFExporter} from '../WebRuntime/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result=`data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;this.onloadend?.();});}
};
const destination=resolve(process.argv[2]||fileURLToPath(new URL('../WebRuntime/art/professors/',import.meta.url)));
mkdirSync(destination,{recursive:true});
const profiles=[
  {id:'renaissance-scholar',name:'Renaissance scholar',skin:'#cda47d',hair:'#d3cbc0',cloth:'#71352f',trim:'#c39c57',beard:'long',cap:true,
    tags:['human','masculine','older-adult','long-gray-beard','renaissance','robe','cap'],matches:['leonardo-da-vinci','galileo-galilei']},
  {id:'classical-philosopher',name:'Classical philosopher',skin:'#b98560',hair:'#ded7c7',cloth:'#e8dfc6',trim:'#ad883a',beard:'short',bald:true,
    tags:['human','masculine','older-adult','beard','classical','greek','robe'],matches:['socrates','plato','aristotle','euclid','archimedes']},
  {id:'classical-scholar',name:'Classical woman scholar',skin:'#ad7857',hair:'#382820',cloth:'#416b75',trim:'#d3b777',bun:true,
    tags:['human','feminine','adult','dark-hair','classical','greek','robe'],matches:['hypatia']},
  {id:'victorian-scholar',name:'Victorian woman scholar',skin:'#d6ac91',hair:'#3f2925',cloth:'#345449',trim:'#eadfc5',bun:true,victorian:true,
    tags:['human','feminine','adult','dark-hair','victorian','nineteenth-century','gown'],matches:['ada-lovelace','mary-somerville','florence-nightingale']},
  {id:'natural-philosopher',name:'Natural philosopher',skin:'#ca9f7d',hair:'#e0d5bf',cloth:'#343a59',trim:'#d9cbb1',longHair:true,coat:true,
    tags:['human','masculine','adult','long-hair','european','seventeenth-century','eighteenth-century','coat'],matches:['isaac-newton','gottfried-leibniz','rene-descartes']},
  {id:'modern-scientist',name:'Modern scientist',skin:'#c19a80',hair:'#e4e1d5',cloth:'#696451',trim:'#e6ddc9',wildHair:true,moustache:true,coat:true,
    tags:['human','masculine','older-adult','white-hair','moustache','twentieth-century','suit'],matches:['albert-einstein','max-planck']}
];

function build(profile){
  const scene=new THREE.Scene(),rig=new THREE.Group();rig.name='Professor';scene.add(rig);
  const bones={},expressions={};
  function bone(name,parent,position){const node=new THREE.Bone();node.name=name;node.position.set(...position);(parent?bones[parent]:rig).add(node);bones[name]=node;return node;}
  bone('hips',null,[0,.95,0]);bone('spine','hips',[0,.16,0]);bone('chest','spine',[0,.17,0]);
  bone('neck','chest',[0,.19,0]);bone('head','neck',[0,.13,0]);
  const material=color=>new THREE.MeshStandardMaterial({color,roughness:.9,metalness:0});
  const mats={skin:material(profile.skin),hair:material(profile.hair),cloth:material(profile.cloth),trim:material(profile.trim),
    eye:material('#f1ede2'),iris:material('#333d37'),mouth:material('#643b37'),shoe:material('#3a302b')};
  let serial=0;
  function mesh(parent,geometry,mat,position=[0,0,0],scale=[1,1,1]){
    const part=new THREE.Mesh(geometry,mats[mat]);part.name=`part-${++serial}`;
    part.position.set(...position);part.scale.set(...scale);bones[parent].add(part);return part;
  }
  const sphere=(parent,mat,pos,size)=>mesh(parent,new THREE.SphereGeometry(1,12,8),mat,pos,size);
  function cylinder(parent,mat,pos,top,bottom,height,axis='y'){
    const part=mesh(parent,new THREE.CylinderGeometry(top,bottom,height,12),mat,pos);
    if(axis==='x')part.rotation.z=Math.PI/2;return part;
  }
  function morph(part,name,axis,factor){
    const positions=part.geometry.attributes.position.clone();
    for(let i=0;i<positions.count;i++)positions.setComponent(i,axis,positions.getComponent(i,axis)*factor);
    part.geometry.morphAttributes.position=[positions];part.updateMorphTargets();
    (expressions[name]??=[]).push(part.name);
  }
  // Continuous, modest clothing silhouette; joints are tucked under round sleeve cuffs.
  sphere('hips','cloth',[0,.02,0],[.205,.22,.135]);
  sphere('chest','cloth',[0,-.07,0],[.215,.245,.145]);
  if(!profile.coat)cylinder('hips','cloth',[0,-.32,0],.19,.31,.64);
  else {cylinder('hips','cloth',[0,-.15,0],.21,.24,.30);sphere('chest','trim',[0,.025,.132],[.085,.135,.02]);}
  cylinder('neck','skin',[0,0,0],.065,.075,.16);
  cylinder('neck','trim',[0,-.085,0],.095,.12,.06);
  for(const side of ['left','right']){
    const sign=side==='left'?1:-1;
    bone(side+'Shoulder','chest',[sign*.15,.11,0]);bone(side+'UpperArm',side+'Shoulder',[sign*.1,0,0]);
    bone(side+'LowerArm',side+'UpperArm',[sign*.27,0,0]);bone(side+'Hand',side+'LowerArm',[sign*.25,0,0]);
    sphere(side+'UpperArm','cloth',[0,0,0],[.105,.09,.09]);
    cylinder(side+'UpperArm','cloth',[sign*.125,0,0],.08,.09,.26,'x');
    sphere(side+'LowerArm','cloth',[0,0,0],[.076,.076,.076]);
    cylinder(side+'LowerArm','cloth',[sign*.105,0,0],.06,.075,.22,'x');
    cylinder(side+'LowerArm','trim',[sign*.225,0,0],.063,.063,.035,'x');
    sphere(side+'Hand','skin',[sign*.035,0,0],[.067,.043,.038]);
    for(const [index,finger] of ['Index','Middle','Ring','Little'].entries()){
      const z=(index-1.5)*.018;
      bone(side+finger+'Proximal',side+'Hand',[sign*.075,0,z]);
      bone(side+finger+'Intermediate',side+finger+'Proximal',[sign*.028,0,0]);
      bone(side+finger+'Distal',side+finger+'Intermediate',[sign*.022,0,0]);
      for(const [joint,length] of [['Proximal',.028],['Intermediate',.022],['Distal',.02]])
        sphere(side+finger+joint,'skin',[sign*length/2,0,0],[length*.68,.009,.008]);
    }
    sphere(side+'Hand','skin',[sign*.035,-.04,.015],[.025,.04,.017]);
    bone(side+'UpperLeg','hips',[sign*.11,-.10,0]);bone(side+'LowerLeg',side+'UpperLeg',[0,-.39,0]);bone(side+'Foot',side+'LowerLeg',[0,-.38,.025]);
    cylinder(side+'UpperLeg','cloth',[0,-.18,0],.085,.07,.37);cylinder(side+'LowerLeg','cloth',[0,-.16,0],.069,.054,.34);
    sphere(side+'Foot','shoe',[0,-.018,.075],[.077,.065,.15]);
  }
  sphere('head','skin',[0,0,0],[.158,.205,.148]);
  sphere('head','skin',[0,-.14,.045],[.105,.085,.102]);
  sphere('head','skin',[0,-.012,.148],[.038,.055,.044]);
  for(const x of [-1,1]){
    sphere('head','skin',[x*.153,0,0],[.027,.052,.028]);
    const eye=x>0?'leftEye':'rightEye';bone(eye,'head',[x*.063,.035,.132]);
    const white=sphere(eye,'eye',[0,0,0],[.04,.022,.018]);morph(white,'blink',1,.05);
    const iris=sphere(eye,'iris',[0,0,.017],[.014,.018,.006]);morph(iris,'blink',1,.05);
    sphere('head','hair',[x*.062,.08,.132],[.047,.012,.014]);
  }
  const mouth=sphere('head','mouth',[0,-.085,.14],[.041,.009,.009]);morph(mouth,'aa',1,4.5);
  // Hair is sculpted geometry, not an external texture or character scan.
  if(!profile.bald){
    mesh('head',new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI*.51),'hair',[0,.015,-.005],[.166,.203,.157]);
    for(const x of [-1,1])sphere('head','hair',[x*.128,-.015,-.035],[.041,.13,.115]);
  }else for(const x of [-1,1])sphere('head','hair',[x*.138,.015,-.03],[.033,.12,.105]);
  if(profile.longHair)for(const x of [-1,1])sphere('head','hair',[x*.13,-.17,-.07],[.062,.16,.09]);
  if(profile.bun)sphere('head','hair',[0,.11,-.15],[.09,.085,.083]);
  if(profile.wildHair)for(let i=0;i<10;i++){
    const a=i*Math.PI*2/10;sphere('head','hair',[Math.sin(a)*.135,.10+Math.abs(Math.cos(a))*.06,Math.cos(a)*.105],[.06,.065,.052]);
  }
  if(profile.beard){
    for(const x of [-1,1])sphere('head','hair',[x*.068,-.10,.104],[.075,.082,.041]);
    const long=profile.beard==='long';
    const beard=mesh('head',new THREE.ConeGeometry(long?.115:.10,long?.31:.14,12),'hair',[0,long?-.235:-.16,.15]);beard.rotation.z=Math.PI;
    for(const x of [-1,1])sphere('head','hair',[x*.037,-.064,.15],[.045,.016,.012]);
  }
  if(profile.moustache)for(const x of [-1,1])sphere('head','hair',[x*.038,-.058,.151],[.05,.023,.012]);
  if(profile.cap){cylinder('head','cloth',[0,.186,0],.17,.18,.045);sphere('head','cloth',[0,.215,-.018],[.163,.068,.146]);}
  if(profile.victorian){sphere('chest','trim',[0,.115,.116],[.17,.032,.057]);sphere('chest','trim',[0,.023,.149],[.014,.018,.012]);}
  return {scene,bones,expressions};
}
function withVrm(binary,profile,expressions){
  const bytes=Buffer.from(binary),jsonLength=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
  const nodeByName=new Map(doc.nodes.map((node,index)=>[node.name,index]));
  const humanBones=Object.fromEntries(doc.nodes.flatMap((node,index)=>node.name&&!node.name.startsWith('part-')&&node.name!=='Professor'&&node.name!=='AuxScene'?[ [node.name,{node:index}] ]:[]));
  const presets=Object.fromEntries(Object.entries(expressions).map(([name,parts])=>[name,{morphTargetBinds:parts.map(part=>({node:nodeByName.get(part),index:0,weight:1})),isBinary:false}]));
  doc.extensions??={};doc.extensions.VRMC_vrm={specVersion:'1.0',meta:{name:profile.name,version:'1',authors:['Matrix project'],
    copyrightInformation:'Copyright (c) 2026 thetopham. Original procedural geometry; MIT license.',licenseUrl:'https://vrm.dev/licenses/1.0/',otherLicenseUrl:'https://github.com/School-of-the-Ancients/matrix-loading-operator/blob/main/LICENSE',
    avatarPermission:'everyone',commercialUsage:'corporation',allowRedistribution:true,modification:'allowModificationRedistribution'},
    humanoid:{humanBones},lookAt:{type:'bone',offsetFromHeadBone:[0,.04,.04],rangeMapHorizontalInner:{inputMaxValue:90,outputScale:10},rangeMapHorizontalOuter:{inputMaxValue:90,outputScale:10},rangeMapVerticalDown:{inputMaxValue:90,outputScale:10},rangeMapVerticalUp:{inputMaxValue:90,outputScale:10}},expressions:{preset:presets}};
  doc.extensionsUsed=[...new Set([...(doc.extensionsUsed||[]),'VRMC_vrm'])];
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const bin=bytes.subarray(20+jsonLength),out=Buffer.alloc(20+json.length+bin.length);
  out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.write('JSON',16);json.copy(out,20);bin.copy(out,20+json.length);return out;
}
const manifest=[];
for(const profile of profiles){
  const {scene,expressions}=build(profile);
  const binary=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true});
  const bytes=withVrm(binary,profile,expressions),file=`${profile.id}.vrm`;
  writeFileSync(join(destination,file),bytes);
  manifest.push({id:profile.id,file,displayName:profile.name,sha256:createHash('sha256').update(bytes).digest('hex'),
    visualTags:profile.tags,teacherMatches:profile.matches,automaticSelection:true,representation:'approximate',source:'Original procedural geometry; MIT project license.'});
}
writeFileSync(join(destination,'catalog.json'),JSON.stringify({schemaVersion:1,avatars:manifest},null,2)+'\n');
console.log(JSON.stringify(manifest.map(({id,file,sha256})=>({id,file,sha256}))));
