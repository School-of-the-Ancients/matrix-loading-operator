import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverAgentTextDraft} from '../src/agent_text_delivery.js';

test('an acknowledged steer preserves a newer draft typed while delivery is pending',async()=>{
  const input={value:'Add lighting'};
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const delivery=deliverAgentTextDraft(input,'Add lighting',async text=>{
    assert.equal(text,'Add lighting');
    await pending;
  });
  input.value='Move the chair next';
  finish();
  await delivery;
  assert.equal(input.value,'Move the chair next');
});

test('a new turn preserves a newer draft through concept lookup and network delivery',async()=>{
  const input={value:'Build a bridge'};
  let finishLookup;
  const lookup=new Promise(resolve=>{finishLookup=resolve;});
  const sent=[];
  const delivery=deliverAgentTextDraft(input,'Build a bridge',async text=>{
    await lookup;
    sent.push(text);
    return true;
  });
  input.value='Add lanterns after the bridge';
  finishLookup();
  assert.equal(await delivery,true);
  assert.deepEqual(sent,['Build a bridge']);
  assert.equal(input.value,'Add lanterns after the bridge');
});

test('an acknowledged steer clears only its own unchanged draft',async()=>{
  const input={value:'Add lighting'};
  await deliverAgentTextDraft(input,'Add lighting',async()=>{});
  assert.equal(input.value,'');
});

test('an unconfirmed steer retains the submitted draft',async()=>{
  const input={value:'Add lighting'};
  await assert.rejects(deliverAgentTextDraft(input,'Add lighting',async()=>{
    throw Error('Delivery uncertain');
  }),/Delivery uncertain/);
  assert.equal(input.value,'Add lighting');
});
