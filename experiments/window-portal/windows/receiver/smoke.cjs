const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {fixture}=require('./fixture.cjs');
async function main(){
 const [electron,proofDir,sourceCommit]=process.argv.slice(2);
 if(!electron||!proofDir||!/^[a-f0-9]{40}$/i.test(sourceCommit||''))throw Error('Usage: node smoke.cjs <electron> <proof-directory> <commit>');
 fs.mkdirSync(proofDir,{recursive:true});
 const privateConfig=path.join(proofDir,'private-fixture.json'),eventsPath=path.join(__dirname,'receiver-events.jsonl');
 const offset=fs.existsSync(eventsPath)?fs.readFileSync(eventsPath,'utf8').length:0;
 const f=fixture();await once(f.wss,'listening');let child;
 try{
  fs.writeFileSync(privateConfig,JSON.stringify({url:'ws://127.0.0.1:'+f.wss.address().port+'/portal',token:f.token,loopbackTest:true,sourceCommit}),{mode:0o600});
  // Intentionally no inherited pipes: GUI process must survive without console.
  child=spawn(electron,[__dirname,'--config='+privateConfig,'--smoke-seconds=12','--proof-dir='+proofDir],{stdio:'ignore',windowsHide:false});
  await once(child,'exit',{signal:AbortSignal.timeout(25000)});
  const events=fs.readFileSync(eventsPath,'utf8').slice(offset).trim().split('\n').map(JSON.parse);
  const closed=events.find(e=>e.event==='closed'),restored=events.find(e=>e.event==='restored');
  const pass=child.exitCode===0&&closed?.frames>20&&restored?.wasMinimized===true&&f.stats.closed&&fs.existsSync(path.join(proofDir,'receiver.png'));
  const report={pass,exitCode:child.exitCode,sourceCommit,fixture:f.stats,events};
  fs.writeFileSync(path.join(proofDir,'smoke-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass,frames:closed?.frames,minimizeRestore:restored?.wasMinimized,fixtureClosed:f.stats.closed}));
  if(!pass)process.exitCode=1;
 }finally{child?.kill();f.close();fs.rmSync(privateConfig,{force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
