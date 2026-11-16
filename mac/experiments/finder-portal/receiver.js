'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),{spawn}=require('node:child_process');
const https=require('node:https'),tls=require('node:tls');
const WebSocket=require('ws');const {parse,check,SHA,UUID,metadata,frame}=require('./wire');
function connect(config){
 const pair=JSON.parse(fs.readFileSync(config.pairingFile));const url=new URL(pair.url);
 check(SHA.test(config.sourceCommit),'Receiver commit required');
 check(url.pathname==='/portal'&&!url.username&&!url.password,'Invalid portal URL');
 check((url.protocol==='ws:'&&url.hostname==='127.0.0.1')||(url.protocol==='wss:'&&/^[a-f0-9]{64}$/i.test(pair.certificateSha256)),'LAN requires pinned TLS');
 check(typeof pair.token==='string'&&pair.token.length<=1024,'Missing pairing token');
 // Verify the exact paired DER pin before HTTP upgrade or hello/token.
 let agent,pinFailed=false;
 if(url.protocol==='wss:'){
  agent=new https.Agent({keepAlive:false});
  agent.createConnection=(options,callback)=>{
   let finished=false;
   const done=(error,socket)=>{if(finished)return;finished=true;callback(error,socket);};
   const socket=tls.connect({...options,rejectUnauthorized:false,minVersion:'TLSv1.2'});
   socket.once('error',()=>done(Error('TLS failed')));
   socket.once('secureConnect',()=>{
    const raw=socket.getPeerCertificate().raw;
    const actual=raw&&crypto.createHash('sha256').update(raw).digest('hex');
    if(!actual||actual!==pair.certificateSha256.toLowerCase()){
     pinFailed=true;done(Error('Certificate pin mismatch'));socket.destroy();return;
    }
    done(null,socket);
   });
  };
 }
 const ws=new WebSocket(pair.url,{agent,perMessageDeflate:false,maxPayload:12*1024*1024,handshakeTimeout:5000,followRedirects:false});
 let session=null,window=null,child=null,buffer='',last=Date.now(),lastFrame=0,pendingFrame=null,inputSeq=0,closed=false,heartbeat=null,nonce=0;
 const inputs=new Set();let frames=0,sourceCommit=null,lastDecodedPNG=null,evidenceError=null;const minimizeStates=[],localDrags=[],decodedHashes=new Set();
 if(config.evidenceDirectory)fs.mkdirSync(config.evidenceDirectory,{recursive:true,mode:0o700});
 const saveEvidence=name=>{if(config.evidenceDirectory&&lastDecodedPNG)try{fs.writeFileSync(path.join(config.evidenceDirectory,name),lastDecodedPNG,{mode:0o600});}catch{evidenceError='Could not save decoded frame artifact';}};
 const log=m=>{if(config.resultFile)fs.writeFileSync(config.resultFile,JSON.stringify(m,null,2));};
 const send=m=>{if(ws.readyState===1)ws.send(JSON.stringify({v:1,sessionId:session,...m}));};
 const close=reason=>{
  if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(handshake);
  if(session)send({type:'close',reason});ws.close();agent?.destroy();const timer=setTimeout(()=>ws.terminate(),1000);timer.unref();
  if(child){child.stdin.end();const timer=setTimeout(()=>child.kill(),2000);timer.unref();}
  saveEvidence('final.png');
  log({closed:true,reason,frames,sourceCommit,receiverCommit:config.sourceCommit,distinctDecodedFrames:decodedHashes.size,distinctFrameLimit:1024,evidenceError,appId:window?.appId||null,inputResults:inputSeq-inputs.size,minimizeStates,localDrags});
 };
 const handshake=setTimeout(()=>close('Handshake timeout'),5000);
 const native=m=>{check(child&&!child.killed,'Native receiver unavailable');check(child.stdin.writableLength<16*1024*1024,'Native decoder backpressure');child.stdin.write(JSON.stringify(m)+'\n');};
 const startNative=()=>{
  child=spawn(config.receiver||path.join(path.dirname(config.capture),'../../../Window Portal Receiver.app/Contents/MacOS/WindowPortalReceiver'),['--receiver'],{stdio:['pipe','pipe','inherit']});child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{try{buffer+=chunk;check(buffer.length<=65536,'Native response too large');for(let i;(i=buffer.indexOf('\n'))>=0;){const m=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);
   if(closed)continue;
   if(m.event==='error'||m.event==='close'){close('Native receiver closed');return;}
   if(m.event==='localDrag')localDrags.push({before:m.before,after:m.after});
   if(m.event==='minimized')minimizeStates.push(m.value);
   if(m.event==='frameAck'){
    check(pendingFrame&&m.seq===pendingFrame.seq&&m.width===window.pixelSize.width&&m.height===window.pixelSize.height,'Native decoded frame mismatch');
    if(decodedHashes.size<1024)decodedHashes.add(pendingFrame.hash);
    if(config.evidenceDirectory){lastDecodedPNG=pendingFrame.png;if(frames===0)saveEvidence('first.png');}
    send({type:'frameAck',windowId:window.windowId,seq:m.seq});pendingFrame=null;frames++;
    if(config.testMinimize&&frames===2)native({type:'minimize'});
    if(config.testMinimize&&frames===8)native({type:'restore'});
    if(config.maxFrames&&frames>=config.maxFrames)close('Bounded receiver test finished');
   }
   if(m.event==='input'){
    if(!window||!lastFrame||inputs.size>=16||!window.capabilities.includes(m.op))continue;
    check(Number.isSafeInteger(m.frameSeq)&&m.frameSeq>0&&m.frameSeq<=lastFrame,'Native input frame invalid');
    const seq=++inputSeq;inputs.add(seq);send({type:'input',windowId:window.windowId,geometryRevision:window.geometryRevision,seq,frameSeq:m.frameSeq,op:m.op,args:m.args});
   }
  }}catch{close('Native receiver protocol failure');}});
  child.on('exit',()=>close('Native receiver exited'));child.on('error',()=>close('Native receiver failed'));child.stdin.on('error',()=>close('Native input pipe failed'));
 };
 ws.on('open',()=>{
  try{
   if(url.protocol==='wss:'){
    const cert=ws._socket.getPeerCertificate();check(cert.raw,'Missing source certificate');
    const pin=crypto.createHash('sha256').update(cert.raw).digest('hex');
    check(pin===pair.certificateSha256.toLowerCase(),'Certificate pin mismatch');
   }
   ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:pair.token,sourceCommit:config.sourceCommit}));
  }catch{close('TLS certificate rejected');}
 });
 ws.on('message',(data,binary)=>{try{
  const m=parse(data,binary);
  if(!session){check(m.type==='welcome'&&UUID.test(m.sessionId)&&SHA.test(m.sourceCommit)&&m.heartbeatMs===2000&&m.disconnectMs===6000,'Invalid welcome');sourceCommit=m.sourceCommit;session=m.sessionId;clearTimeout(handshake);last=Date.now();heartbeat=setInterval(()=>{if(Date.now()-last>=6000||(pendingFrame&&Date.now()-pendingFrame.at>=6000)){close('Liveness timeout');return;}send({type:'ping',nonce:++nonce});},2000);return;}
  check(m.sessionId===session,'Wrong session');
  if(m.type==='window'){
   metadata(m);check(window?(m.windowId===window.windowId&&m.geometryRevision===window.geometryRevision+1&&!pendingFrame):m.geometryRevision===1,'Invalid metadata revision');
   window=m;if(!child)startNative();native(m);
  }else if(m.type==='frame'){
   check(window&&!pendingFrame&&m.seq>lastFrame,'Unexpected frame');frame(m,window);lastFrame=m.seq;const png=Buffer.from(m.png,'base64');pendingFrame={seq:m.seq,at:Date.now(),hash:crypto.createHash('sha256').update(png).digest('hex'),png:config.evidenceDirectory?png:null};native(m);
  }else if(m.type==='ping'||m.type==='pong'){
   check(Number.isSafeInteger(m.nonce)&&m.nonce>=0,'Invalid nonce');if(m.type==='ping')send({type:'pong',nonce:m.nonce});
  }else if(m.type==='inputResult'){
   check(window&&m.windowId===window.windowId&&inputs.has(m.seq)&&['dispatched','verified','unsupported','rejected','failed'].includes(m.status)&&typeof m.detail==='string'&&Buffer.byteLength(m.detail)<=1024,'Invalid input result');inputs.delete(m.seq);
  }else if(m.type==='close'){check(typeof m.reason==='string'&&Buffer.byteLength(m.reason)<=1024,'Invalid close');close('Source ended session');}
  else throw Error('Unexpected message');
  last=Date.now();
 }catch{close('Source protocol or frame failure');}});
 ws.on('close',()=>close('Transport closed'));ws.on('error',()=>close(pinFailed?'TLS certificate rejected':'Transport error'));
 return {close};
}
module.exports={connect};
if(require.main===module){try{const config=JSON.parse(fs.readFileSync(process.argv[2]));const receiver=connect(config);for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>receiver.close('Receiver stopped'));}catch(e){console.error('Receiver failed: '+e.message);process.exitCode=1;}}
