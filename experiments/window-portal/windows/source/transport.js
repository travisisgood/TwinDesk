'use strict';
// Isolated endpoint. No TwinDesk session, protocol, settings, or credentials imported.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),https=require('node:https'),{spawn}=require('node:child_process');
const {WebSocketServer}=require('ws');
const {parse,check,SHA,metadata,SourceState}=require('./wire');
class Pipe {
  constructor(child) {
    this.child=child;this.buffer='';this.rows=[];this.waiters=[];this.tail=Promise.resolve();this.error=null;
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      this.buffer+=chunk;
      if(Buffer.byteLength(this.buffer)>16*1024*1024){this.fail(new Error('Native response too large'));child.kill();return;}
      for(let i;(i=this.buffer.indexOf('\n'))>=0;){const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);try{const row=JSON.parse(line);const waiter=this.waiters.shift();if(waiter)waiter.resolve(row);else if(this.rows.length<2)this.rows.push(row);else throw Error('Unexpected native output');}catch(e){this.fail(e);}}
    });
    child.on('error',e=>this.fail(e));child.on('exit',()=>this.fail(Error('Native process exited')));
    child.stdin.on('error',e=>this.fail(e));
  }
  fail(e){this.error=e;for(const w of this.waiters.splice(0))w.reject(e);}
  read(){if(this.rows.length)return Promise.resolve(this.rows.shift());if(this.error)return Promise.reject(this.error);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.fail(Error('Native response timed out'));},15000);this.waiters.push({resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});});}
  call(m){const work=this.tail.then(()=>{if(this.error)throw this.error;this.child.stdin.write(JSON.stringify(m)+'\n');return this.read();});this.tail=work.catch(()=>{});return work;}
}
function startWorker(config,display){
 const x=display.x+40,y=display.y+60;
 const child=spawn('/usr/bin/python3',[path.join(__dirname,'source_worker.py'),config.capture,config.output,String(display.id),String(x),String(y)],{stdio:['pipe','pipe','inherit']});
 return new Pipe(child);
}
async function stopChild(child){
 if(!child||child.exitCode!==null||child.signalCode)return;
 child.stdin.end();
 await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGTERM');resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
}
async function start(config,{workerFactory=startWorker}={}){
 check(SHA.test(config.sourceCommit),'Exact source commit required');
 const host=config.host||'127.0.0.1',port=config.port??49731;
 check(Number.isInteger(port)&&port>=0&&port<=65535,'Invalid port');
 const tls=!!config.certFile;
 check(host==='127.0.0.1'||(tls&&config.keyFile),'LAN requires explicit TLS certificate/key');
 const duration=config.durationSeconds??120;
 check(Number.isInteger(duration)&&duration>=15&&duration<=900,'Session lifetime must be 15..900 seconds');
 fs.mkdirSync(config.output,{recursive:true,mode:0o700});
 const log=(event,fields={})=>fs.appendFileSync(path.join(config.output,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...fields})+'\n',{mode:0o600});
 let server,pin=null;
 if(tls){const cert=fs.readFileSync(config.certFile);pin=crypto.createHash('sha256').update(new crypto.X509Certificate(cert).raw).digest('hex');server=https.createServer({cert,key:fs.readFileSync(config.keyFile),minVersion:'TLSv1.2'},(_,res)=>{res.writeHead(404);res.end();});}
 else server=http.createServer((_,res)=>{res.writeHead(404);res.end();});
 const token=crypto.randomBytes(32).toString('hex'),expires=Date.now()+300000;
 let used=false,active=null,closing=false,holder=null;
 let display=config.testDisplay,physicalMap=null;
 if(!display){
  const holderArgs=[String(duration+30)];
  if(config.backingOrigin){check(Number.isInteger(config.backingOrigin.x)&&Number.isInteger(config.backingOrigin.y),'Invalid explicit backing origin');holderArgs.push(String(config.backingOrigin.x),String(config.backingOrigin.y));}
  const child=spawn(path.join(path.dirname(config.capture),'FinderPortalBacking'),holderArgs,{stdio:['pipe','pipe','inherit']});
  holder=new Pipe(child);
  try { const ready=await holder.read();check(ready.ready,'Backing display unavailable');
   display=ready.topology.find(d=>d.id===ready.displayID);physicalMap=ready.physicalMap??null;check(display,'Missing backing geometry');
  } catch(e) { await stopChild(child);throw e; }
  child.once('exit',()=>{if(active)active.end('Backing display lost');});
 }
 const wss=new WebSocketServer({server,path:'/portal',maxPayload:16384,perMessageDeflate:false});
 wss.on('connection',(ws,req)=>{
  if(closing||(!tls&&req.socket.remoteAddress!=='127.0.0.1')){ws.close(1008);return;}
  let state=null,worker=null,ended=false,ready=false,last=Date.now(),timer=null,frameBusy=false,inputs=0,nonce=0;
  let cleanupPromise=null;
  const send=m=>{if(ws.readyState===1)ws.send(JSON.stringify(m));};
  const end=reason=>{
   if(cleanupPromise)return cleanupPromise;log('sessionEnded',{reason,authenticated:!!state});ended=true;clearInterval(timer);clearTimeout(helloTimer);
   if(state)send(state.envelope('close',{reason}));ws.close(1000);
   const terminate=setTimeout(()=>ws.terminate(),1000);terminate.unref();
   cleanupPromise=(async()=>{await stopChild(worker?.child);if(active?.ws===ws)active=null;})();return cleanupPromise;
  };
  const helloTimer=setTimeout(()=>end('Hello timeout'),5000);
  ws.on('error',()=>end('Transport failure'));ws.on('close',()=>end('Receiver disconnected'));
  ws.on('message',async(data,binary)=>{
   try{
    const m=parse(data,binary);
    if(!state){
     check(!ended&&m.type==='hello'&&m.role==='receiver'&&SHA.test(m.sourceCommit)&&typeof m.token==='string','Invalid hello');
     const received=Buffer.from(m.token),expected=Buffer.from(token);
     check(!used&&!active&&Date.now()<expires&&received.length===expected.length&&crypto.timingSafeEqual(received,expected),'Authentication rejected');
     used=true;clearTimeout(helloTimer);log('authenticated',{receiverCommit:m.sourceCommit});
     const initial={windowId:crypto.randomUUID(),geometryRevision:1,appId:'com.apple.finder',title:'Finder',logicalSize:{width:800,height:550},pixelSize:{width:1600,height:1100},iconPng:null,capabilities:['pressAt','setSearchText','confirmSearch']};
     state=new SourceState(config.sourceCommit,initial);active={ws,end};send(state.welcome());last=Date.now();
     timer=setInterval(()=>{
      if(ended)return;
      if(Date.now()-last>=6000||(state.outstanding&&Date.now()-state.outstanding.at>=6000)){end('Liveness timeout');return;}
      send(state.envelope('ping',{nonce:++nonce}));
     },2000);
     worker=workerFactory(config,display);
     const meta=await worker.read();
     if(ended){await stopChild(worker.child);return;}
     state.window={...meta,windowId:initial.windowId,geometryRevision:1};metadata(state.window);
     send(state.envelope('window',state.window));ready=true;log('metadataReady',{appId:state.window.appId});
     const pump=async()=>{
      if(ended)return;
      if(!state.outstanding&&!frameBusy){
       frameBusy=true;
       try{const result=await worker.call({op:'frame'});if(ended)return;check(!result.error,'Native capture failure');
        if(!result.pending){const {nativeFrames,...payload}=result;send(state.nextFrame(payload));}
       }catch{end('Capture failure');}finally{frameBusy=false;}
      }
      if(!ended)setTimeout(pump,100);
     };pump();return;
    }
    check(!ended,'Session closed');const action=state.accept(m);last=Date.now();
    if(action.kind==='ack'&&(m.seq===1||m.seq%100===0))log('frameAcknowledged',{seq:m.seq});
    if(action.kind==='ping'){send(state.envelope('pong',{nonce:m.nonce}));return;}
    if(action.kind==='close'){end('Receiver closed');return;}
    if(action.kind==='input'||action.kind==='result'){
     const answer=(status,detail)=>{log('inputResult',{seq:m.seq,op:m.op,status});send(state.envelope('inputResult',{windowId:state.window.windowId,seq:m.seq,status,detail}));};
     if(action.kind==='result'){answer(action.status,action.detail);return;}
     if(!ready||inputs>=16){answer('rejected','Input queue unavailable');return;}
     inputs++;
     try{const result=await worker.call({op:m.op,args:m.args});if(!ended)answer(result.error?'unsupported':result.AXError===0?'dispatched':'failed',result.error?'Source control unsupported':result.AXError===0?'Accessibility action dispatched':'Source action failed');}
     finally{inputs--;}
    }
   }catch{end('Protocol or source failure');}
  });
 });
 try { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);}); }
 catch(e){wss.close();await stopChild(holder?.child);throw e;}
 const address=server.address();
 const pairing={url:`${tls?'wss':'ws'}://${host}:${address.port}/portal`,token,certificateSha256:pin,expiresAt:new Date(expires).toISOString(),sourceCommit:config.sourceCommit};
 fs.writeFileSync(config.pairingFile,JSON.stringify(pairing),{mode:0o600});fs.chmodSync(config.pairingFile,0o600);
 fs.writeFileSync(path.join(config.output,'session.json'),JSON.stringify({port:address.port,host,tls,pin,display,physicalMap,sourceCommit:config.sourceCommit,expiresAt:new Date(Date.now()+duration*1000).toISOString()}));
 let stopping=null;
 const stop=()=>{
  if(stopping)return stopping;closing=true;
  stopping=(async()=>{clearTimeout(lifetime);if(active)await active.end('Backing session ended');for(const client of wss.clients)client.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));await stopChild(holder?.child);fs.rmSync(config.pairingFile,{force:true});})();return stopping;
 };
 const lifetime=setTimeout(stop,duration*1000);
 return {stop,port:address.port,get used(){return used;}};
}
module.exports={start,Pipe};
if(require.main===module){
 const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 start(config).then(service=>{console.log(JSON.stringify({listening:true,port:service.port,pairingFile:config.pairingFile}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>service.stop().then(()=>process.exit(0)));}).catch(e=>{console.error('Source failed: '+e.message);process.exitCode=1;});
}
