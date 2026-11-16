'use strict';
const WebSocket=require('ws'),https=require('node:https'),tls=require('node:tls'),crypto=require('node:crypto');
const {ReceiverProtocol,check}=require('./protocol.cjs');
function connect(config){
 const url=new URL(config.url);
 check(url.pathname==='/portal'&&!url.username&&!url.password&&!url.search&&!url.hash,'Invalid endpoint');
 check(/^[a-f0-9]{64}$/i.test(config.token||''),'Expected 256-bit hexadecimal pairing token');
 check(/^[a-f0-9]{40}$/i.test(config.sourceCommit||''),'Missing receiver source commit');
 const local=url.protocol==='ws:'&&url.hostname==='127.0.0.1'&&config.loopbackTest===true;
 check(local||url.protocol==='wss:','LAN requires pinned TLS');
 let agent;
 if(!local){
  check(/^[a-f0-9]{64}$/i.test(config.certSha256||''),'Missing certificate pin');
  agent=new https.Agent({keepAlive:false});
  // TLS is authenticated by the paired exact DER certificate pin before HTTP
  // or the pairing secret can be sent. No CA-bypass fallback is permitted.
  agent.createConnection=(options,callback)=>{
   let finished=false;const done=(err,socket)=>{if(finished)return;finished=true;callback(err,socket)};
   const socket=tls.connect({...options,rejectUnauthorized:false,minVersion:'TLSv1.2'});
   socket.once('error',()=>done(Error('TLS connection failed')));
   socket.once('secureConnect',()=>{
    const raw=socket.getPeerCertificate().raw;
    const hash=raw&&crypto.createHash('sha256').update(raw).digest('hex');
    if(!hash||!crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(config.certSha256,'hex'))){done(Error('Certificate pin mismatch'));socket.destroy();return;}
    done(null,socket);
   });
   // Returning no socket keeps HTTPS from sending before pin verification.
  };
 }
 const ws=new WebSocket(url,{agent,perMessageDeflate:false,maxPayload:12*1024*1024,handshakeTimeout:5000,followRedirects:false});
 const protocol=new ReceiverProtocol(m=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));});
 let last=Date.now(),started=Date.now(),pendingSince=0,ended=false;
 const end=reason=>{
  if(ended)return;ended=true;clearInterval(timer);protocol.closed=true;
  if(ws.readyState===WebSocket.OPEN&&protocol.session)ws.send(JSON.stringify(protocol.envelope('close',{reason})));
  ws.close();setTimeout(()=>ws.terminate(),250).unref();agent?.destroy();protocol.emit('ended',reason);
 };
 const timer=setInterval(()=>{
  if(!protocol.session){if(Date.now()-started>5000)end('Authentication deadline');return;}
  if(Date.now()-last>6000||(pendingSince&&Date.now()-pendingSince>6000)){end('Connection or frame acknowledgment timed out');return;}
  protocol.send(protocol.envelope('ping',{nonce:Date.now()}));
 },2000);timer.unref();
 protocol.on('frame',()=>pendingSince=Date.now());
 const ack=protocol.displayedFrame.bind(protocol);protocol.displayedFrame=seq=>{ack(seq);pendingSince=0;};
 protocol.on('closed',()=>end('Source returned the window'));
 ws.on('open',()=>ws.send(JSON.stringify({v:1,type:'hello',role:'receiver',token:config.token,sourceCommit:config.sourceCommit})));
 ws.on('message',(raw,binary)=>{try{check(!binary,'Binary frames unsupported');protocol.receive(new TextDecoder('utf-8',{fatal:true}).decode(raw));last=Date.now();}catch(e){end(e.message)}});
 ws.on('error',()=>end('Connection failed'));ws.on('close',()=>end('Disconnected'));
 protocol.end=end;return protocol;
}
module.exports={connect};
