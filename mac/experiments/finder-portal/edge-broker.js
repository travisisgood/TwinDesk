'use strict';
// Opt-in, finite local runtime. No model calls, commands from peers, or app build.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const {start,Pipe}=require('./source'),{encrypt}=require('./pairing-envelope'),{SourceHandoff}=require('./handoff-source');
async function run(config){
 if(!Number.isInteger(config.durationSeconds)||config.durationSeconds<30||config.durationSeconds>3540)throw Error('Finite broker duration30..3540 required');
 if(!['left','right','top','bottom'].includes(config.side))throw Error('Explicit configured physical crossing side required');
 const settings=JSON.parse(fs.readFileSync(config.settingsFile));
 if(settings.apps?.moveWindows!==false||settings.kvm?.pcSide!==config.side)throw Error('Disable legacy Move windows and match the existing physical KVM side before broker launch');
 fs.mkdirSync(config.output,{recursive:true,mode:0o700});
 const log=(event,fields={})=>fs.appendFileSync(path.join(config.output,'broker-events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...fields})+'\n',{mode:0o600});
 const c=JSON.parse(fs.readFileSync(config.connectionFile));if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(c.url)||c.platform!=='mac')throw Error('Expected local Mac messenger');
 const controller=new AbortController();let stopped=false,holder,observer,portal=null,timer,lifetime,revision=1,fingerprint=null;
 const api=async(route,text)=>{const r=await fetch(c.url+route,{method:text===undefined?'GET':'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:text===undefined?undefined:JSON.stringify({text}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});if(!r.ok)throw Error('Local messenger unavailable');return r.json();};
 const send=text=>api('/send',text);
 const statePath=path.join(config.output,'broker-state.json');
 const instance=crypto.createHash('sha256').update(c.url+'\0'+c.token).digest('hex');
 let saved={instance,sequence:0};if(fs.existsSync(statePath)){const prior=JSON.parse(fs.readFileSync(statePath));if(prior.instance===instance)saved=prior;}
 if(!Number.isSafeInteger(saved.sequence)||saved.sequence<0)throw Error('Invalid saved broker sequence');
 const persist=()=>{fs.writeFileSync(statePath,JSON.stringify({instance,sequence:h.sequence}),{mode:0o600});fs.chmodSync(statePath,0o600);};
 const end=async(reason)=>{if(stopped)return;stopped=true;clearInterval(timer);clearTimeout(lifetime);log('stopping',{reason});await h.abort(reason);controller.abort();observer?.kill('SIGTERM');holder?.child.stdin.end();};
 const h=new SourceHandoff({send,context:()=>portal?.context,layout:()=>revision,onState:(phase,reason)=>log('handoff',{phase,reason}),start:async edge=>{
  persist();const output=path.join(config.output,crypto.randomUUID());fs.mkdirSync(output,{mode:0o700});
  const cfg={...config.source,output,pairingFile:path.join(output,'pairing.json'),durationSeconds:Math.min(config.durationSeconds,1800),testDisplay:display,sourceWindow:{appId:'com.apple.finder',wid:edge.wid,recoveryBounds:edge.originalBounds,finishDrag:{pid:edge.pid,x:edge.anchor.x,y:edge.anchor.y}}};
  const service=await start(cfg);portal=service;
  const pairing=JSON.parse(fs.readFileSync(cfg.pairingFile));
  const open={sourceCommit:cfg.sourceCommit,encryptedPairing:encrypt(pairing,fs.readFileSync(config.peerPublicKey))};
  return {open,stop:async()=>{await service.stop();if(portal===service)portal=null;}};
 }});h.sequence=saved.sequence;
 let display;
 try{
  const initial=await api('/messages?after=0&wait=0');if(!initial.ready)throw Error('Paired messenger is not ready');let cursor=initial.cursor;
  const child=spawn(path.join(path.dirname(config.source.capture),'FinderPortalBacking'),[String(config.durationSeconds+30)],{stdio:['pipe','pipe','inherit']});holder=new Pipe(child);const backing=await holder.read();if(!backing.ready)throw Error('Backing display creation failed');display=backing.topology.find(d=>d.id===backing.displayID);if(!display)throw Error('Missing backing display');
  child.once('exit',()=>end('Backing display exited'));
  observer=spawn(config.source.capture,['--observe-edge',config.side,String(config.durationSeconds)],{stdio:['ignore','pipe','inherit']});observer.once('exit',()=>end('Edge observer exited'));
  readline.createInterface({input:observer.stdout}).on('line',line=>{
   try{const e=JSON.parse(line);if(e.error)throw Error(e.error);
    if(e.ready||e.event==='layoutChanged'){if(fingerprint&&fingerprint!==e.layoutRevision)revision++;fingerprint=e.layoutRevision;log('observer',{ready:!!e.ready,revision});return;}
    if(e.event==='edgeOffer'){
     if(!fingerprint||e.layoutRevision!==fingerprint||h.pending)return;
     h.begin({...e,sourceLayoutRevision:revision}).catch(error=>end(error.message));
    }else if(e.event==='sourceButtonUp')h.buttonUp(e.injected).catch(error=>end(error.message));
   }catch(error){end(error.message);}
  });
  timer=setInterval(()=>{h.tick().catch(error=>end(error.message));if(h.pending?.phase==='active'&&portal?.used&&!portal.context)h.abort('Portal disconnected').catch(error=>end(error.message));},50);
  lifetime=setTimeout(()=>end('Broker lifetime ended'),config.durationSeconds*1000);
  process.once('SIGTERM',()=>end('Broker stopped'));process.once('SIGINT',()=>end('Broker stopped'));
  log('ready',{side:config.side,expiresAt:new Date(Date.now()+config.durationSeconds*1000).toISOString()});
  const seen=new Set();
  while(!stopped){
   const inbox=await api('/messages?after='+cursor+'&wait=55000');
   if(inbox.truncated||!inbox.ready||inbox.cursor<cursor)throw Error('Peer disconnect or messenger history gap');
   for(const row of inbox.messages){if(row.direction!=='in'||seen.has(row.id))continue;seen.add(row.id);if(seen.size>256)seen.delete(seen.values().next().value);await h.receive(row.text);}
   cursor=inbox.cursor;
  }
 }catch(error){if(!stopped)log('error',{reason:error.message});}
 finally{await end('Broker finished');}
}
module.exports={run};
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2]))).catch(e=>{console.error(e.message);process.exitCode=1;});
