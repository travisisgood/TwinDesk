const {test}=require('node:test'),assert=require('node:assert/strict');
const {ReceiverProtocol,png}=require('./protocol.cjs'),{framePng}=require('./fixture.cjs');
const sessionId='11111111-1111-1111-1111-111111111111',windowId='22222222-2222-2222-2222-222222222222';
const meta={v:1,type:'window',sessionId,windowId,geometryRevision:1,title:'Fixture',appId:'fixture',logicalSize:{width:640,height:400},pixelSize:{width:640,height:400},iconPng:null,capabilities:['pressAt']};
function setup(){const sent=[],p=new ReceiverProtocol(m=>sent.push(m));p.receive(JSON.stringify({v:1,type:'welcome',sessionId,sourceCommit:'a'.repeat(40),heartbeatMs:2000,disconnectMs:6000}));p.receive(JSON.stringify(meta));return {p,sent};}
const frame=()=>({v:1,type:'frame',sessionId,windowId,geometryRevision:1,seq:1,pixelSize:{width:640,height:400},contentRect:{x:0,y:0,width:640,height:400},captureMode:'stream',png:framePng(1).toString('base64')});
test('frame ACK waits for decoder/display completion; input uses displayed sequence',()=>{const {p,sent}=setup();p.receive(JSON.stringify(frame()));assert.equal(sent.length,0);assert.throws(()=>p.input('pressAt',{x:.5,y:.5}));p.displayedFrame(1);p.input('pressAt',{x:.5,y:.5});assert.equal(sent[0].type,'frameAck');assert.equal(sent[1].frameSeq,1);});
test('overlapping and replayed frames fail',()=>{const {p}=setup();p.receive(JSON.stringify(frame()));assert.throws(()=>p.receive(JSON.stringify({...frame(),seq:2})),/overlapping/);p.displayedFrame(1);assert.throws(()=>p.receive(JSON.stringify(frame())),/Replayed/);});
test('geometry mismatches, padding outside frame, wrong session fail',()=>{for(const patch of [{geometryRevision:2},{pixelSize:{width:100,height:100}},{contentRect:{x:600,y:0,width:640,height:400}},{sessionId:windowId}]){const {p}=setup();assert.throws(()=>p.receive(JSON.stringify({...frame(),...patch})));}});
test('PNG header resource bounds are checked before decoding',()=>{const b=framePng(1);b.writeUInt32BE(9000,16);assert.throws(()=>png(b.toString('base64')),/size/);assert.throws(()=>png('not png'));});
test('metadata revision invalidates input until new frame is displayed',()=>{const {p}=setup();p.receive(JSON.stringify(frame()));p.displayedFrame(1);p.receive(JSON.stringify({...meta,geometryRevision:2}));assert.throws(()=>p.input('pressAt',{x:.1,y:.2}));});
test('capability and local input bounds prevent injection',()=>{const {p}=setup();p.receive(JSON.stringify(frame()));p.displayedFrame(1);assert.throws(()=>p.input('rawKey',{}));assert.throws(()=>p.input('pressAt',{x:NaN,y:0}));assert.throws(()=>p.input('pressAt',{x:2,y:0}));});
test('unknown input result fails instead of matching another action',()=>{const {p}=setup();assert.throws(()=>p.receive(JSON.stringify({v:1,type:'inputResult',sessionId,windowId,seq:1,status:'verified',detail:''})));});

test('resize blocks old-frame input until result and new revision display',()=>{
 const {p}=setup();p.window.capabilities.push('resize');p.receive(JSON.stringify(frame()));p.displayedFrame(1);
 const seq=p.input('resize',{logicalSize:{width:700,height:450},pixelScale:1.5});
 assert.throws(()=>p.input('pressAt',{x:.5,y:.5}),/transition/);
 p.receive(JSON.stringify({...meta,geometryRevision:2,capabilities:['pressAt','resize']}));
 p.receive(JSON.stringify({v:1,type:'inputResult',sessionId,windowId,seq,status:'dispatched',detail:'Applied'}));
 assert.throws(()=>p.input('pressAt',{x:.5,y:.5}));
 p.receive(JSON.stringify({...frame(),seq:2,geometryRevision:2}));p.displayedFrame(2);
 assert.doesNotThrow(()=>p.input('pressAt',{x:.5,y:.5}));
});
test('rejected resize leaves existing geometry interactive',()=>{
 const {p}=setup();p.window.capabilities.push('resize');p.receive(JSON.stringify(frame()));p.displayedFrame(1);
 const seq=p.input('resize',{logicalSize:{width:700,height:450},pixelScale:1});
 p.receive(JSON.stringify({v:1,type:'inputResult',sessionId,windowId,seq,status:'rejected',detail:'Fixed size'}));assert.doesNotThrow(()=>p.input('pressAt',{x:.1,y:.2}));
});
test('resize density and resource limits are enforced',()=>{const {p}=setup();p.window.capabilities.push('resize');p.receive(JSON.stringify(frame()));p.displayedFrame(1);for(const args of [{logicalSize:{width:700,height:450},pixelScale:0},{logicalSize:{width:4096,height:4096},pixelScale:2},{logicalSize:{width:NaN,height:450},pixelScale:1}])assert.throws(()=>p.input('resize',args),/Invalid resize/);});
test('drag regions require capability, bounds and no overlap',()=>{for(const patch of [{dragRegions:[{x:0,y:0,width:100,height:30}]},{capabilities:['sourceDragRegions'],dragRegions:[{x:600,y:0,width:100,height:30}]},{capabilities:['sourceDragRegions'],dragRegions:[{x:0,y:0,width:100,height:30},{x:50,y:0,width:100,height:30}]}]){const {p}=setup();assert.throws(()=>p.receive(JSON.stringify({...meta,geometryRevision:2,...patch})),/drag region/);}});
