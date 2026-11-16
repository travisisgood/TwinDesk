'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {start}=require('./source'),{connect}=require('./receiver');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const [capture,output,commit,mode='plain']=process.argv.slice(2);fs.mkdirSync(output,{recursive:true,mode:0o700});
 const config={capture,output,sourceCommit:commit,port:0,pairingFile:path.join(output,'pairing.json'),durationSeconds:60};
 if(mode!=='plain'){
  config.certFile=path.join(output,'cert.pem');config.keyFile=path.join(output,'key.pem');
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',config.keyFile,'-out',config.certFile,'-days','1','-subj','/CN=TwinDesk Standalone Probe'],{stdio:'ignore'});fs.chmodSync(config.keyFile,0o600);
 }
 const service=await start(config);let receiver;
 try{
  if(mode==='wrong-pin'){const pair=JSON.parse(fs.readFileSync(config.pairingFile));pair.certificateSha256='0'.repeat(64);fs.writeFileSync(config.pairingFile,JSON.stringify(pair),{mode:0o600});}
  const resultFile=path.join(output,'receiver-result.json');
  receiver=connect({...config,resultFile,maxFrames:16,testMinimize:true});
  for(let i=0;i<250&&!fs.existsSync(resultFile);i++)await sleep(100);
  if(!fs.existsSync(resultFile))throw Error('Native receiver did not complete');
  const result=JSON.parse(fs.readFileSync(resultFile));
  if(mode==='wrong-pin'){
   if(service.used||fs.existsSync(path.join(output,'fixture.json')))throw Error('Pin failure exposed source');
   if(result.reason!=='TLS certificate rejected')throw Error('Wrong rejection: '+result.reason);
  }else{
   if(result.frames!==16||result.appId!=='com.apple.finder'||JSON.stringify(result.minimizeStates)!=='[true,false]')throw Error('Native receiver acceptance failed: '+JSON.stringify(result));
   for(let i=0;i<70&&!fs.existsSync(path.join(output,'recovery.json'));i++)await sleep(100);
   if(!JSON.parse(fs.readFileSync(path.join(output,'recovery.json'))).restored)throw Error('Source did not restore');
  }
  console.log(JSON.stringify({mode,...result}));
 }finally{receiver?.close('Test cleanup');await service.stop();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
