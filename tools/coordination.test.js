'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {decode,encode,receive}=require('./coordination-core');
function row(kind='request',id='one',extra={}){return {direction:'in',status:'received',text:encode({kind,id,from:'mac',body:'test',...extra})};}
test('ordinary chatter and malformed envelopes do not trigger notifications',()=>{assert.equal(decode('hello'),null);assert.equal(decode('TDCOORD1 {}'),null);});
test('requests notify once across duplicate delivery and persisted restart',async()=>{
  let state={messages:{}},notifications=0,receipts=0,saved;
  const hooks={save:async()=>{saved=JSON.stringify(state)},notify:async()=>{assert.equal(JSON.parse(saved).messages['in:mac:one'].notification,'attempting');notifications++},receipt:async()=>{receipts++}};
  await receive(state,row(),hooks);state=JSON.parse(saved);await receive(state,row(),hooks);
  assert.equal(notifications,1);assert.equal(receipts,1);assert.equal(state.messages['in:mac:one'].notification,'chat-queued');
});
test('status, receipt and agent acknowledgment never wake a model',async()=>{
  const state={messages:{out:{direction:'out',id:'request-id'}}};let notifications=0;
  const hooks={save:async()=>{},notify:async()=>notifications++,receipt:async()=>{throw Error('must not reply')}};
  await receive(state,row('status'),hooks);
  await receive(state,row('receipt','two',{ref:'request-id'}),hooks);
  await receive(state,row('ack','three',{ref:'request-id'}),hooks);
  assert.equal(notifications,0);assert.equal(state.messages.out.chatQueued,true);assert.equal(state.messages.out.acknowledged,true);
});
test('ambiguous notification failure is retained and never automatically retried',async()=>{
  const state={messages:{}};let attempts=0;
  const hooks={save:async()=>{},notify:async()=>{attempts++;throw Error('timeout')},receipt:async()=>{throw Error('must not acknowledge')}};
  await receive(state,row(),hooks);await receive(state,row(),hooks);
  assert.equal(attempts,1);assert.equal(state.messages['in:mac:one'].notification,'uncertain');
});
