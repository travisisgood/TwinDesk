const {test}=require('node:test'),assert=require('node:assert/strict');
const {HandoffAdapter,PREFIX}=require('./handoff-adapter.cjs');
function fixture(){
 let time=0;const calls=[];
 const c={sessionId:'s',windowId:'w',geometryRevision:1,pointerHeld:true,displayedFrameSeq:7,sourceLayoutRevision:1,destinationLayoutRevision:1,ownershipEpoch:0,pointerOwner:'mac',display:{id:'d',x:0,y:0,width:1920,height:1080},logicalSize:{width:800,height:550},bounds:{x:100,y:100,width:800,height:550}};
 const offer={type:'offer',id:'11111111-1111-4111-8111-111111111111',sessionId:'s',windowId:'w',geometryRevision:1,sequence:1,ttlMs:1000,sourceLayoutRevision:1,destinationLayoutRevision:1,ownershipEpoch:0,pointerOwner:'mac',displayId:'d',entry:{edge:'left',offset:.5},anchor:{x:.5,y:.05},drag:{id:'drag1',button:0,held:true}};
 const adapter=new HandoffAdapter({context:()=>c,now:()=>time,place:(p,opts)=>{calls.push({p,opts});if(!opts.rollback)c.ownershipEpoch=opts.ownershipEpoch;},release:()=>calls.push('release')});
 const send=m=>adapter.receive(PREFIX+JSON.stringify(m));
 const ready=()=>JSON.parse(send(offer).slice(PREFIX.length));
 return {c,offer,adapter,calls,send,ready,time:n=>time=n};
}
test('ready carries decoded proof; commit retry does not apply twice',()=>{const f=fixture(),r=f.ready();assert.equal(r.frameSeq,7);assert.equal(f.calls.length,0);const commit={...r,type:'commit'};const ack=f.send(commit);assert.equal(JSON.parse(ack.slice(PREFIX.length)).ownershipEpoch,1);assert.equal(f.send(commit),ack);assert.equal(f.calls.length,1);});
test('wrong session, no frame and wrong drag cannot acquire ownership',()=>{const f=fixture();assert.throws(()=>f.send({...f.offer,sessionId:'other'}),/Unregistered/);f.c.displayedFrameSeq=0;assert.throws(()=>f.ready(),/decoded/);f.c.displayedFrameSeq=7;const r=f.ready();assert.throws(()=>f.send({...r,type:'commit',dragId:'other'}),/match/);assert.equal(f.calls.length,0);});
test('local deadline releases pending drag and restores prior placement',()=>{const f=fixture();f.ready();f.time(1000);f.adapter.tick();assert.equal(f.calls[0],'release');assert.deepEqual(f.calls[1].p.bounds,f.c.bounds);assert.equal(f.adapter.state.pending,null);});
test('unrelated abort has no effect; disconnect always releases',()=>{const f=fixture();f.ready();f.send({...f.offer,type:'abort',id:'other'});assert.equal(f.calls.length,0);f.adapter.disconnect();assert.ok(f.calls.includes('release'));assert.equal(f.adapter.state.pending,null);});
test('AI coordination is ignored and changed ownership rejects commit',()=>{const f=fixture();assert.equal(f.adapter.receive('TDCOORD1 {}'),null);const r=f.ready();f.c.ownershipEpoch=2;assert.throws(()=>f.send({...r,type:'commit'}),/context changed/);assert.equal(f.calls[0],'release');assert.equal(f.calls[1].opts.rollback,true);});
