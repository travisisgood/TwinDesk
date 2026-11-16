'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),WebSocket=require('ws');
const {start,Pipe}=require('./source');
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
const meta={appId:'com.apple.finder',title:'Fixture',logicalSize:{width:1,height:1},pixelSize:{width:1,height:1},iconPng:null,capabilities:['pressAt']};
function client(url){const ws=new WebSocket(url);const rows=[],waiters=[];ws.on('message',d=>{const m=JSON.parse(d);if(m.type==='ping'){ws.send(JSON.stringify({v:1,type:'pong',sessionId:m.sessionId,nonce:m.nonce}));return;}const r=waiters.shift();if(r)r(m);else rows.push(m);});return {ws,read:()=>rows.length?Promise.resolve(rows.shift()):new Promise(r=>waiters.push(r))};}
test('real loopback socket authenticates before worker, enforces ACK and stops worker on disconnect',{timeout:12000},async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'portal-wire-'));let launches=0,child;
 const factory=()=>{launches++;child=spawn(process.execPath,['-e',`console.log(JSON.stringify(${JSON.stringify(meta)}));require('readline').createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);console.log(JSON.stringify(m.op==='frame'?{pixelSize:{width:1,height:1},contentRect:{x:0,y:0,width:1,height:1},png:'${image}',captureMode:'stream'}:{AXError:0}));});`],{stdio:['pipe','pipe','inherit']});return new Pipe(child);};
 const config={sourceCommit:'a'.repeat(40),port:0,output,pairingFile:path.join(output,'pair.json'),testDisplay:{id:1,x:0,y:0},durationSeconds:15};
 const service=await start(config,{workerFactory:factory});
 try{
  const pair=JSON.parse(fs.readFileSync(config.pairingFile));
  const bad=client(pair.url);await once(bad.ws,'open');bad.ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:'wrong',sourceCommit:'b'.repeat(40)}));await once(bad.ws,'close');assert.equal(launches,0);
  const c=client(pair.url);await once(c.ws,'open');c.ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:pair.token,sourceCommit:'b'.repeat(40)}));
  assert.equal((await c.read()).type,'welcome');const w=await c.read(),f=await c.read();assert.equal(w.type,'window');assert.equal(f.type,'frame');assert.equal(launches,1);
  c.ws.send(JSON.stringify({v:1,type:'input',sessionId:f.sessionId,windowId:f.windowId,geometryRevision:1,seq:1,frameSeq:f.seq,op:'pressAt',args:{x:.5,y:.5}}));assert.equal((await c.read()).status,'dispatched');
  const exited=once(child,'exit');c.ws.close();await once(c.ws,'close');await exited;
  const reused=client(pair.url);await once(reused.ws,'open');reused.ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:pair.token,sourceCommit:'b'.repeat(40)}));await once(reused.ws,'close');assert.equal(launches,1);
 }finally{await service.stop();fs.rmSync(output,{recursive:true,force:true});}
});

test('source input queue rejects overflow without replay or teardown',{timeout:12000},async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'portal-queue-'));
 const factory=()=>new Pipe(spawn(process.execPath,['-e',`console.log(JSON.stringify(${JSON.stringify(meta)}));require('readline').createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);const row=m.op==='frame'?{pixelSize:{width:1,height:1},contentRect:{x:0,y:0,width:1,height:1},png:'${image}',captureMode:'stream'}:{AXError:0};setTimeout(()=>console.log(JSON.stringify(row)),m.op==='frame'?0:40);});`],{stdio:['pipe','pipe','inherit']}));
 const config={sourceCommit:'a'.repeat(40),port:0,output,pairingFile:path.join(output,'pair.json'),testDisplay:{id:1,x:0,y:0},durationSeconds:15};
 const service=await start(config,{workerFactory:factory});let c;
 try{
  const pair=JSON.parse(fs.readFileSync(config.pairingFile));c=client(pair.url);await once(c.ws,'open');c.ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:pair.token,sourceCommit:'b'.repeat(40)}));
  await c.read();await c.read();const f=await c.read();
  for(let seq=1;seq<=17;seq++)c.ws.send(JSON.stringify({v:1,type:'input',sessionId:f.sessionId,windowId:f.windowId,geometryRevision:1,seq,frameSeq:f.seq,op:'pressAt',args:{x:.5,y:.5}}));
  const replies=[];for(let i=0;i<17;i++)replies.push(await c.read());
  assert.equal(replies.find(m=>m.seq===17).status,'rejected');
  assert.equal(replies.filter(m=>m.status==='dispatched').length,16);
  assert.equal(c.ws.readyState,WebSocket.OPEN);
 }finally{c?.ws.terminate();await service.stop();fs.rmSync(output,{recursive:true,force:true});}
});

test('missing frame ACK tears down even while valid heartbeats continue',{timeout:12000},async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'portal-ack-'));let child;
 const factory=()=>{child=spawn(process.execPath,['-e',`console.log(JSON.stringify(${JSON.stringify(meta)}));require('readline').createInterface({input:process.stdin}).on('line',()=>console.log(JSON.stringify({pixelSize:{width:1,height:1},contentRect:{x:0,y:0,width:1,height:1},png:'${image}',captureMode:'stream'})));`],{stdio:['pipe','pipe','inherit']});return new Pipe(child);};
 const config={sourceCommit:'a'.repeat(40),port:0,output,pairingFile:path.join(output,'pair.json'),testDisplay:{id:1,x:0,y:0},durationSeconds:15};
 const service=await start(config,{workerFactory:factory});let c;
 try{
  const pair=JSON.parse(fs.readFileSync(config.pairingFile));c=client(pair.url);await once(c.ws,'open');c.ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:pair.token,sourceCommit:'b'.repeat(40)}));
  await c.read();await c.read();assert.equal((await c.read()).type,'frame');
  const exited=once(child,'exit');await once(c.ws,'close');await exited;
  assert.match(fs.readFileSync(path.join(output,'events.jsonl'),'utf8'),/Liveness timeout/);
 }finally{c?.ws.terminate();await service.stop();fs.rmSync(output,{recursive:true,force:true});}
});
