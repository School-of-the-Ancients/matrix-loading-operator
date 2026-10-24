import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfessorAppearanceClient} from '../src/professor_appearance.js';

test('applies only a registered avatar, after speech stops, and preserves session context',async()=>{
  let busy=true,applied=0;
  let session={id:'lesson',revision:1,appearance:{catalogId:'avatar'}};
  const client=new ProfessorAppearanceClient({current:()=>session,isBusy:()=>busy,
    request:async path=>path.includes('/sessions/')?session:{avatars:[{catalogId:'avatar',availability:'ready'}]},
    onSession:value=>{session=value;},apply:async(avatar,s)=>{assert.equal(s.id,'lesson');applied++;}});
  await client.sync();assert.equal(applied,0);busy=false;await client.sync();assert.equal(applied,1);
});

test('does not attach a delayed avatar to a different world or selected lesson',async()=>{
  let world={},session={id:'one',revision:1},applied=0;
  const client=new ProfessorAppearanceClient({current:()=>session,isBusy:()=>false,worldIdentity:()=>world,
    request:async()=>{world={};return session;},apply:async()=>applied++});
  await client.sync();assert.equal(applied,0);await client.sync();assert.equal(applied,0);
});

test('does not replace current manual choice with an older appearance revision',async()=>{
  const current={id:'one',revision:2,appearanceRevision:3,appearance:{mode:'manual',catalogId:'mine'}};
  let applied=0;
  const client=new ProfessorAppearanceClient({current:()=>current,isBusy:()=>false,
    request:async()=>({...current,appearanceRevision:2}),apply:async()=>applied++});
  await client.sync();assert.equal(applied,0);
});
