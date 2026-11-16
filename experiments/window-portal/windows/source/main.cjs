'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const {start,Pipe}=require('./transport'),Backing=require('../backing-monitor.cjs');
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 if(!config.kvmProfile||!config.nativeHelper||!config.electron||!config.displayProbe)throw Error('Explicit local helper/runtime/KVM profile paths required');
 if(config.fixture||!Number.isSafeInteger(config.sourceWid))throw Error('Explorer-only testing requires an exact locally selected Explorer window handle');
 const backing=new Backing({list:async()=>JSON.parse((await run(config.displayProbe,[],{windowsHide:true,timeout:5000})).stdout),enable:()=>run('schtasks.exe',['/run','/tn','\\MacShare\\Extend on'],{windowsHide:true,timeout:15000})});
 const display=await backing.acquire(),requestId=crypto.randomUUID();
 const lease=path.join(config.kvmProfile,'portal-backing-lease.json'),ack=path.join(config.kvmProfile,'portal-backing-ack.json');
 fs.writeFileSync(lease,JSON.stringify({v:1,id:requestId,name:display.name}));
 let registered=false;
 for(let i=0;i<40;i++){try{const a=JSON.parse(fs.readFileSync(ack,'utf8'));if(a.ok&&a.requestId===requestId&&a.monitor?.name===display.name){registered=true;break;}}catch{}await sleep(250);}
 if(!registered)throw Error('KVM has not acknowledged backing-display exclusion; source not moved');
 fs.mkdirSync(config.output,{recursive:true});
 fs.writeFileSync(path.join(config.output,'backing.json'),JSON.stringify(display));
 let worker;
 const workerFactory=()=>{
  const workerConfig=path.join(config.output,'worker-local.json');
  const pipe='\\\\.\\pipe\\WindowPortal-'+crypto.randomUUID(),server=require('node:net').createServer();
  fs.writeFileSync(workerConfig,JSON.stringify({pipe,nativeHelper:config.nativeHelper,explorerInput:config.explorerInput,fixture:false,sourceWid:config.sourceWid,sourceTitle:config.sourceTitle,backing:display,output:config.output}));
  let child;
  const ready=new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>{server.close();reject(Error('Capture IPC deadline'));},10000);
   server.once('error',e=>{clearTimeout(deadline);reject(e)});
   server.once('connection',socket=>{clearTimeout(deadline);server.close();child.stdin=socket;child.stdout=socket;resolve(new Pipe(child));});
  });
  server.listen(pipe);
  const errLog=fs.openSync(path.join(config.output,'worker-stderr.log'),'a');
  child=spawn(config.electron,[__dirname,'--worker-config='+workerConfig],{stdio:['pipe','ignore',errLog],windowsHide:true});fs.closeSync(errLog);
  child.once('exit',()=>server.close());
  worker={child,read:()=>ready.then(p=>p.read()),call:m=>ready.then(p=>p.call(m))};return worker;
 };
 // Mac transport's injected display/worker hooks keep its wire behavior identical;
 // Windows owns display setup and recovery, so no Mac holder is constructed.
 const service=await start({...config,testDisplay:{...display,id:display.name}},{workerFactory});
 const monitor=setInterval(()=>backing.verify().catch(()=>service.stop()),2000);monitor.unref();
 const stop=async()=>{clearInterval(monitor);await service.stop();};
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop().then(()=>process.exit(0)));
 console.log(JSON.stringify({listening:true,port:service.port,display:display.name,sourceCommit:config.sourceCommit}));
}
main().catch(e=>{console.error('Windows source failed: '+e.message);process.exitCode=1;});

