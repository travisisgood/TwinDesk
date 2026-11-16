'use strict';
// Bounded real Finder + actual loopback WebSocket acceptance test, no synthetic worker.
const fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),{execFileSync}=require('node:child_process');
const WebSocket=require('ws');const {start}=require('./source');const {parse,frame,metadata}=require('./wire');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const [capture,output,commit,mode='normal']=process.argv.slice(2);
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 const config={capture,output,sourceCommit:commit,port:0,pairingFile:path.join(output,'pairing.json'),durationSeconds:60};
 const service=await start(config);let socket;
 const result={mode,frames:0,input:null,restored:false};
 try{
  const pair=JSON.parse(fs.readFileSync(config.pairingFile));socket=new WebSocket(pair.url);let window,session,mutated=false,lastSeq=0;
  const completed=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Live test timeout')),25000);
   socket.on('error',reject);
   socket.on('close',()=>{clearTimeout(timeout);resolve();});
   socket.on('message',data=>{
    try{const m=parse(data);
     if(m.type==='welcome'){session=m.sessionId;return;}
     if(m.type==='ping'){socket.send(JSON.stringify({v:1,type:'pong',sessionId:session,nonce:m.nonce}));return;}
     if(m.type==='window'){metadata(m);window=m;result.appId=m.appId;result.iconPresent=!!m.iconPng;return;}
     if(m.type==='frame'){
      const decoded=frame(m,window);result.frames++;lastSeq=m.seq;
      if(result.frames===1){fs.writeFileSync(path.join(output,'before.png'),decoded.data);const fixture=JSON.parse(fs.readFileSync(path.join(output,'fixture.json')));fs.writeFileSync(path.join(fixture.folder,'NETWORKLIVEPROOF.txt'),'Created after first authenticated network frame.\n');mutated=true;}
      if(result.frames===12&&mutated){
       fs.writeFileSync(path.join(output,'after.png'),decoded.data);
       const fixture=JSON.parse(fs.readFileSync(path.join(output,'fixture.json')));
       if(mode==='kill-worker'){process.kill(fixture.workerPID,'SIGKILL');result.killedWorker=true;}
       else socket.send(JSON.stringify({v:1,type:'input',sessionId:session,windowId:window.windowId,geometryRevision:1,seq:1,frameSeq:lastSeq,op:'pressAt',args:{x:.35,y:.12}}));
      }
      socket.send(JSON.stringify({v:1,type:'frameAck',sessionId:session,windowId:window.windowId,seq:m.seq}));return;
     }
     if(m.type==='inputResult'){
      result.input=m.status;
      const fixture=JSON.parse(fs.readFileSync(path.join(output,'fixture.json')));
      if(!/^\d+$/.test(fixture.finderWindowID))throw Error('Invalid fixture ID');
      result.sourceAfterInput=execFileSync('/usr/bin/osascript',['-e','tell application "Finder" to get {bounds, collapsed} of Finder window id '+fixture.finderWindowID],{encoding:'utf8'}).trim();
      socket.send(JSON.stringify({v:1,type:'close',sessionId:session,reason:'Live test finished'}));
     }
    }catch(e){clearTimeout(timeout);reject(e);}
   });
  });
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:pair.token,sourceCommit:commit}));
  await completed;
  const fixture=JSON.parse(fs.readFileSync(path.join(output,'fixture.json')));
  for(let i=0;i<30;i++){
   result.finalState=execFileSync('/usr/bin/osascript',['-e','tell application "Finder" to get {bounds, collapsed} of Finder window id '+fixture.finderWindowID],{encoding:'utf8'}).trim();
   if(result.finalState==='100, 100, 900, 650, false'){result.restored=true;break;}await sleep(200);
  }
  if(!result.restored)throw Error('Actual source did not restore');
  if(result.frames<12)throw Error('Freshness samples incomplete');
 }finally{socket?.terminate();await service.stop();fs.writeFileSync(path.join(output,'live-result.json'),JSON.stringify(result,null,2));}
 console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
