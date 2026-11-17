'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {SourceState,parse,png,frame,metadata}=require('./wire');
const meta={windowId:'11111111-1111-4111-8111-111111111111',geometryRevision:1,appId:'com.apple.finder',title:'Fixture',logicalSize:{width:1,height:1},pixelSize:{width:1,height:1},iconPng:null,capabilities:['pressAt']};
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
const payload={pixelSize:{width:1,height:1},contentRect:{x:0,y:0,width:1,height:1},captureMode:'stream',png:image};
const state=()=>new SourceState('a'.repeat(40),meta);
test('source drag regions require capability and bounded nonoverlapping geometry',()=>{
 const m={...meta,logicalSize:{width:800,height:550},capabilities:['sourceDragRegions'],dragRegions:[{x:200,y:0,width:200,height:52}]};metadata(m);
 assert.throws(()=>metadata({...m,capabilities:[]}));
 assert.throws(()=>metadata({...m,dragRegions:[...m.dragRegions,{x:250,y:1,width:10,height:10}]}));
 assert.throws(()=>metadata({...m,dragRegions:[{x:799,y:0,width:2,height:52}]}));
 assert.throws(()=>metadata({...m,dragRegions:Array(33).fill({x:0,y:0,width:1,height:1})}));
});
test('geometry revisions require ACK and bind input to frames of that revision',()=>{
 const s=state();s.nextFrame(payload);assert.throws(()=>s.updateGeometry(meta));
 s.accept(s.envelope('frameAck',{windowId:meta.windowId,seq:1}));
 assert.equal(s.updateGeometry(meta).geometryRevision,2);
 const input=s.envelope('input',{windowId:meta.windowId,seq:1,frameSeq:1,geometryRevision:2,op:'pressAt',args:{x:.5,y:.5}});
 assert.equal(s.accept(input).status,'rejected');
 assert.equal(s.nextFrame(payload).seq,2);
 assert.equal(s.accept({...input,seq:2,frameSeq:2}).kind,'input');
});
test('resize is capability gated and validates capture limits before dispatch',()=>{
 const s=new SourceState('a'.repeat(40),{...meta,capabilities:['resize']});s.nextFrame(payload);
 const input=s.envelope('input',{windowId:meta.windowId,seq:1,frameSeq:1,geometryRevision:1,op:'resize',args:{logicalSize:{width:900,height:600},pixelScale:2}});
 assert.equal(s.accept(input).kind,'input');
 assert.equal(s.accept({...input,seq:2,args:{logicalSize:{width:2000,height:2000},pixelScale:3}}).status,'rejected');
 assert.throws(()=>s.accept({...input,seq:3,args:{logicalSize:{width:900,height:600},pixelScale:NaN}}));
});
test('one outstanding frame; no old/future ACK; monotonic frame sequence',()=>{let s=state();assert.equal(s.nextFrame(payload).seq,1);assert.equal(s.nextFrame(payload),null);assert.throws(()=>s.accept(s.envelope('frameAck',{windowId:meta.windowId,seq:2})));s.accept(s.envelope('frameAck',{windowId:meta.windowId,seq:1}));assert.equal(s.nextFrame(payload).seq,2)});
test('input rejects replay, wrong session and unsent frame',()=>{let s=state();s.nextFrame(payload);const m=s.envelope('input',{windowId:meta.windowId,seq:1,frameSeq:1,geometryRevision:1,op:'pressAt',args:{x:.5,y:.5}});assert.equal(s.accept(m).kind,'input');assert.throws(()=>s.accept(m));assert.throws(()=>s.accept({...m,seq:2,sessionId:'wrong'}));assert.throws(()=>s.accept({...m,seq:2,frameSeq:9}));});
test('stale geometry and unsupported capabilities do not dispatch',()=>{let s=state();s.nextFrame(payload);const m=s.envelope('input',{windowId:meta.windowId,seq:1,frameSeq:1,geometryRevision:2,op:'pressAt',args:{x:0,y:1}});assert.equal(s.accept(m).status,'rejected');assert.equal(s.accept({...m,seq:2,geometryRevision:1,op:'drag'}).status,'unsupported');});
test('oversized/binary/control/nonfinite coordinates fail closed',()=>{assert.throws(()=>parse('{}',true));assert.throws(()=>parse(JSON.stringify({v:1,type:'ping',padding:'x'.repeat(16384)})));let s=state();s.nextFrame(payload);assert.throws(()=>s.accept(s.envelope('input',{windowId:meta.windowId,seq:1,frameSeq:1,geometryRevision:1,op:'pressAt',args:{x:NaN,y:0}})));});
test('PNG bounds and content rect validated before decode',()=>{assert.equal(png(image).width,1);assert.throws(()=>png(image+'!'));let altered=Buffer.from(image,'base64');altered.writeUInt32BE(9000,16);assert.throws(()=>png(altered.toString('base64')));assert.throws(()=>frame({...payload,windowId:meta.windowId,geometryRevision:1,seq:1,contentRect:{x:1,y:0,width:1,height:1}},meta));});
test('releaseAll bypasses frame and revision gates but preserves identity and replay checks',()=>{
 const s=new SourceState('a'.repeat(40),{...meta,capabilities:['pointer','releaseAll']});
 const release=s.envelope('input',{windowId:meta.windowId,seq:1,frameSeq:0,geometryRevision:999,op:'releaseAll',args:{}});
 assert.equal(s.accept(release).kind,'input');assert.throws(()=>s.accept(release));
 assert.throws(()=>s.accept({...release,seq:2,windowId:'wrong'}));
 assert.throws(()=>s.accept({...release,seq:2,args:{button:0}}));
 s.nextFrame(payload);
 assert.throws(()=>s.accept({...release,seq:2,op:'pointer',frameSeq:1,geometryRevision:1,args:{phase:'move',button:2,x:0,y:0}}));
 assert.equal(s.accept({...release,seq:2,op:'pointer',frameSeq:1,geometryRevision:1,args:{phase:'down',button:0,x:0,y:0}}).kind,'input');
});
