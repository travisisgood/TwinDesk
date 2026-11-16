const {test}=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const {fixture}=require('./fixture.cjs'),{connect}=require('./connection.cjs');
test('loopback real WebSocket handshake, frames, scoped input and close',async()=>{
 const f=fixture();await once(f.wss,'listening');
 const p=connect({url:'ws://127.0.0.1:'+f.wss.address().port+'/portal',token:f.token,loopbackTest:true,sourceCommit:'a'.repeat(40)});
 try{
  const got=once(p,'inputResult',{signal:AbortSignal.timeout(5000)});
  p.on('frame',m=>{p.displayedFrame(m.seq);if(m.seq===1)p.input('pressAt',{x:.5,y:.5})});
  const [result]=await got;assert.equal(result.status,'dispatched');assert.equal(f.stats.inputs,1);
  p.end('Test complete');await new Promise(r=>setTimeout(r,80));assert.equal(f.stats.closed,true);
 }finally{p.end('Cleanup');f.close();}
});
test('reject insecure LAN and missing explicit loopback mode before socket creation',()=>{
 for(const url of ['ws://192.0.2.1:49731/portal','ws://127.0.0.1:49731/portal'])assert.throws(()=>connect({url,token:'a'.repeat(64),sourceCommit:'a'.repeat(40)}),/TLS/);
});
test('single-use authentication prevents second receiver from seeing metadata',async()=>{
 const f=fixture();await once(f.wss,'listening');const cfg={url:'ws://127.0.0.1:'+f.wss.address().port+'/portal',token:f.token,loopbackTest:true,sourceCommit:'a'.repeat(40)};
 const first=connect(cfg);first.on('frame',m=>first.displayedFrame(m.seq));
 try{await once(first,'welcome',{signal:AbortSignal.timeout(5000)});first.end('First done');const second=connect(cfg);let metadata=false;second.on('window',()=>metadata=true);await once(second,'ended',{signal:AbortSignal.timeout(5000)});assert.equal(metadata,false);}finally{first.end('Cleanup');f.close();}
});
test('malformed UTF8 ends session and stops accepting input',async()=>{
 const f=fixture();await once(f.wss,'listening');
 const p=connect({url:'ws://127.0.0.1:'+f.wss.address().port+'/portal',token:f.token,loopbackTest:true,sourceCommit:'a'.repeat(40)});
 p.on('frame',m=>p.displayedFrame(m.seq));
 try{
  await once(p,'welcome',{signal:AbortSignal.timeout(5000)});
  const ended=once(p,'ended',{signal:AbortSignal.timeout(5000)});
  for(const ws of f.wss.clients)ws.send(Buffer.from([0xc0,0xaf]),{binary:false});
  await ended;assert.equal(p.closed,true);assert.throws(()=>p.input('pressAt',{x:.5,y:.5}));
 }finally{p.end('Cleanup');f.close();}
});
