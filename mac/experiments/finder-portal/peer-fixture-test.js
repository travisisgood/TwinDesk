'use strict';
// Run reviewed Windows fixture code unchanged against the Mac native receiver.
// This is a cross-implementation LOCAL test, not a Windows capture claim.
const fs=require('node:fs'),path=require('node:path'),{once}=require('node:events');
const {connect}=require('./receiver');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const [fixturePath,capture,output,commit]=process.argv.slice(2);fs.mkdirSync(output,{recursive:true,mode:0o700});
 const {fixture}=require(path.resolve(fixturePath)),source=fixture();let receiver;
 try{
  if(!source.wss.address())await once(source.wss,'listening');
  const pairingFile=path.join(output,'pairing.json'),resultFile=path.join(output,'receiver-result.json');
  fs.rmSync(resultFile,{force:true});
  fs.writeFileSync(pairingFile,JSON.stringify({url:'ws://127.0.0.1:'+source.wss.address().port+'/portal',token:source.token}),{mode:0o600});
  receiver=connect({capture,pairingFile,sourceCommit:commit,resultFile,maxFrames:16,testMinimize:true});
  for(let i=0;i<150&&!fs.existsSync(resultFile);i++)await sleep(100);
  const r=JSON.parse(fs.readFileSync(resultFile));
  if(r.frames!==16||r.appId!=='test.fixture'||JSON.stringify(r.minimizeStates)!=='[true,false]')throw Error('Peer fixture receiver failed');
  if(source.stats.hello!==1||source.stats.frames!==16)throw Error('Peer fixture exchange failed');
  if(r.sourceCommit!=='f'.repeat(40)||r.receiverCommit!==commit||r.distinctDecodedFrames<2)throw Error('Decoded frame evidence failed');
  console.log(JSON.stringify({localFixtureOnly:true,receiver:r,source:{hellos:source.stats.hello,frames:source.stats.frames}}));
 }finally{receiver?.close('Fixture test finished');source.close();fs.rmSync(path.join(output,'pairing.json'),{force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
