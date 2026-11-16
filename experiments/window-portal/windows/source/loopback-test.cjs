const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{connect}=require('../receiver/connection.cjs');
async function main(){
 const [pairingFile,output,commit]=process.argv.slice(2),pair=JSON.parse(fs.readFileSync(pairingFile,'utf8'));
 const receiver=connect({url:pair.url,token:pair.token,loopbackTest:true,sourceCommit:commit});
 const hashes=new Set();let frames=0,inputResult;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{receiver.end('Test deadline');reject(Error('No complete source test within30seconds'));},30000);
  receiver.on('ended',reason=>{clearTimeout(timer);if(frames<10)reject(Error(reason));});
  receiver.on('inputResult',m=>inputResult=m.status);
  receiver.on('frame',(m,bytes)=>{
   try{
    hashes.add(crypto.createHash('sha256').update(bytes).digest('hex'));frames++;
    if(frames===1||frames===10)fs.writeFileSync(path.join(output,'received-'+frames+'.png'),bytes);
    receiver.displayedFrame(m.seq);
    if(frames===3&&receiver.window.capabilities.includes('pressAt'))receiver.input('pressAt',JSON.parse(fs.readFileSync(path.join(output,'fixture-input.json'),'utf8')));
    if(frames>=10){clearTimeout(timer);receiver.end('Local Windows source acceptance complete');resolve();}
   }catch(e){clearTimeout(timer);receiver.end('Test failed');reject(e);}
  });
 });
 const result={frames,uniqueFrames:hashes.size,inputResult,sourceCommit:pair.sourceCommit,receiverCommit:commit};
 fs.writeFileSync(path.join(output,'local-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(hashes.size<2)throw Error('Source did not update');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
