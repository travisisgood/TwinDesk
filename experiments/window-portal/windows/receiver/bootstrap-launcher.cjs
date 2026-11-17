'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
function decryptPairing(envelope,privateKey){
 if(!envelope||envelope.v!==1||envelope.alg!=='RSA-OAEP-256+A256GCM'||typeof envelope.ciphertext!=='string'||envelope.ciphertext.length>8192)throw Error('Invalid encrypted pairing');
 const key=crypto.privateDecrypt({key:privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));
 try{
  const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');
  if(key.length!==32||iv.length!==12||tag.length!==16)throw Error('Invalid pairing cipher');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from('WindowPortal pairing v1'));decipher.setAuthTag(tag);
  const p=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8')),url=new URL(p.url);
  if(url.protocol!=='wss:'||url.pathname!=='/portal'||url.username||url.password||url.search||url.hash||!/^[a-f0-9]{64}$/i.test(p.token||'')||!/^[a-f0-9]{64}$/i.test(p.certSha256||''))throw Error('Invalid pinned portal');
  // Copy only connection fields; peer cannot smuggle local receiver options.
  return {url:url.href,token:p.token,certSha256:p.certSha256};
 }finally{key.fill(0);}
}
function createLauncher({executable,receiverDirectory,privateDirectory,privateKeyFile,receiverCommit}){
 for(const p of [executable,receiverDirectory,privateDirectory,privateKeyFile])if(!path.isAbsolute(p))throw Error('Launcher paths must be locally configured absolute paths');
 if(!/^[a-f0-9]{40}$/.test(receiverCommit))throw Error('Receiver commit required');
 return async ({requestId,sourceCommit,encryptedPairing,ttlMs,signal})=>{
  if(signal.aborted)throw Error('Bootstrap expired');
  const pairing=decryptPairing(encryptedPairing,fs.readFileSync(privateKeyFile));
  fs.mkdirSync(privateDirectory,{recursive:true,mode:0o700});
  const configPath=path.join(privateDirectory,crypto.randomUUID()+'.json');
  fs.writeFileSync(configPath,JSON.stringify({...pairing,sourceCommit:receiverCommit,bootstrap:{requestId,expectedSourceCommit:sourceCommit,ttlMs}}),{flag:'wx',mode:0o600});
  let child,timer,closed=false;
  const cleanup=()=>{try{fs.unlinkSync(configPath);}catch(e){if(e.code!=='ENOENT')throw e;}};
  const close=()=>{if(closed)return;closed=true;clearTimeout(timer);if(child?.connected)child.send({type:'portal-abort',requestId},()=>{});const kill=setTimeout(()=>child?.kill(),250);kill.unref();cleanup();};
  try{child=spawn(executable,[receiverDirectory,'--config='+configPath],{cwd:receiverDirectory,shell:false,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});}
  catch(error){cleanup();throw error;}
  const ready=new Promise((resolve,reject)=>{
   child.once('error',()=>{close();reject(Error('Receiver launch failed'));});
   child.once('exit',()=>{close();reject(Error('Receiver exited before handoff'));});
   child.on('message',m=>{if(m?.type==='portal-decoded'&&m.requestId===requestId){cleanup();resolve(m);}});
   signal.addEventListener('abort',()=>{close();reject(Error('Bootstrap expired'));},{once:true});
  });
  timer=setTimeout(close,ttlMs);timer.unref();
  return {ready,close};
 };
}
module.exports={decryptPairing,createLauncher};
