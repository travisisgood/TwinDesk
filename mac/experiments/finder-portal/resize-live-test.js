'use strict';
// Real dedicated Finder source, no receiver UI and no TwinDesk build.
const fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),{execFileSync}=require('node:child_process');
const assert=require('node:assert/strict'),WebSocket=require('ws'),{start}=require('./source');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const [capture,output,commit]=process.argv.slice(2);fs.mkdirSync(output,{recursive:true,mode:0o700});
 assert(!fs.existsSync(path.join(output,'fixture.json'))&&!fs.existsSync(path.join(output,'recovery.json')),'Use a fresh test output directory; stale recovery is not evidence');
 const cfg={capture,output,sourceCommit:commit,port:0,pairingFile:path.join(output,'pairing.json'),durationSeconds:90,backingOrigin:{x:-1280,y:0}};
 const service=await start(cfg);let ws,fixture;const evidence=[];
 try{
  const topology=JSON.parse(fs.readFileSync(path.join(output,'session.json')));
  assert.equal(topology.display.width,1280);assert.equal(topology.display.height,900);
  assert.deepEqual(topology.backingPixels,{width:2560,height:1800});
  assert(!topology.physicalMap.some(r=>r.includes('-1280')));
  const pair=JSON.parse(fs.readFileSync(cfg.pairingFile));ws=new WebSocket(pair.url);
  const rows=[],waiters=[];let session;
  const send=m=>ws.send(JSON.stringify({v:1,sessionId:session,...m}));
  ws.on('message',d=>{const m=JSON.parse(d);if(m.type==='ping'){send({type:'pong',nonce:m.nonce});return;}const w=waiters.shift();if(w)w(m);else rows.push(m);});
  const read=()=>rows.length?Promise.resolve(rows.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test message timeout')),12000);waiters.push(m=>{clearTimeout(timer);resolve(m)});});
  await once(ws,'open');ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:pair.token,sourceCommit:commit}));
  const welcome=await read();session=welcome.sessionId;let meta=await read(),frame=await read(),seq=0;
  assert.equal(meta.appId,'com.apple.finder');assert(meta.capabilities.includes('resize'));
  fixture=JSON.parse(fs.readFileSync(path.join(output,'fixture.json')));
  const initialFrame=frame.seq;
  for(const [width,height,pixelScale] of [[900,600,2],[640,480,1],[800,550,3],[800,550,1.5]]){
   send({type:'input',windowId:meta.windowId,geometryRevision:meta.geometryRevision,seq:++seq,frameSeq:frame.seq,op:'resize',args:{logicalSize:{width,height},pixelScale}});
   send({type:'frameAck',windowId:meta.windowId,seq:frame.seq}); // resize must drain this ACK
   const next=await read();assert.equal(next.type,'window');assert.equal(next.geometryRevision,meta.geometryRevision+1);meta=next;
   const result=await read();assert.equal(result.type,'inputResult');assert.equal(result.status,'dispatched');
   frame=await read();assert.equal(frame.geometryRevision,meta.geometryRevision);assert.deepEqual(frame.pixelSize,{width:meta.logicalSize.width*pixelScale,height:meta.logicalSize.height*pixelScale});
   fs.writeFileSync(path.join(output,'revision-'+meta.geometryRevision+'.png'),Buffer.from(frame.png,'base64'),{mode:0o600});
   const bounds=execFileSync('/usr/bin/osascript',['-e',`tell application "Finder" to get bounds of Finder window id ${fixture.finderWindowID}`],{encoding:'utf8'}).trim();
   assert.equal(bounds,`-1240, 60, ${-1240+meta.logicalSize.width}, ${60+meta.logicalSize.height}`);
   evidence.push({revision:meta.geometryRevision,logicalSize:meta.logicalSize,pixelSize:frame.pixelSize,bounds});
   send({type:'input',windowId:meta.windowId,geometryRevision:meta.geometryRevision,seq:++seq,frameSeq:initialFrame,op:'pressAt',args:{x:.5,y:.5}});
   assert.equal((await read()).status,'rejected');
  }
  send({type:'input',windowId:meta.windowId,geometryRevision:meta.geometryRevision,seq:++seq,frameSeq:frame.seq,op:'resize',args:{logicalSize:{width:1400,height:700},pixelScale:1}});
  send({type:'frameAck',windowId:meta.windowId,seq:frame.seq});
  assert.equal((await read()).status,'unsupported');
  frame=await read();assert.equal(frame.geometryRevision,meta.geometryRevision);
  ws.close();await once(ws,'close');
  for(let i=0;i<100&&!fs.existsSync(path.join(output,'recovery.json'));i++)await sleep(100);
  const recovery=JSON.parse(fs.readFileSync(path.join(output,'recovery.json')));assert.equal(recovery.restored,true);
  fs.writeFileSync(path.join(output,'resize-results.json'),JSON.stringify({realFinder:true,evidence,staleFrameRejected:true,oversizedBackingRefused:true,recovery},null,2));
  console.log(JSON.stringify({realFinder:true,evidence,recovery}));
 }finally{
  ws?.terminate();await service.stop();
  if(fixture&&/^\d+$/.test(fixture.finderWindowID)&&fs.existsSync(path.join(output,'recovery.json'))){
   const r=JSON.parse(fs.readFileSync(path.join(output,'recovery.json')));
   if(r.restored)execFileSync('/usr/bin/osascript',['-e',`tell application "Finder" to close Finder window id ${fixture.finderWindowID}`]);
  }
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
