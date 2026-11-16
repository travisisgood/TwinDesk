const {test}=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{fixture}=require('./fixture.cjs'),{connect}=require('./connection.cjs');
test('pinned TLS accepts exact certificate and rejects wrong pin before sending token',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-tls-'));
 const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
 try{
  execFileSync(process.env.PORTAL_OPENSSL||'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore',windowsHide:true});
  const raw=fs.readFileSync(cert),pin=crypto.createHash('sha256').update(new crypto.X509Certificate(raw).raw).digest('hex');
  for(const good of [true,false]){
   const server=https.createServer({key:fs.readFileSync(key),cert:raw,minVersion:'TLSv1.2'}),f=fixture({server});server.listen(0,'127.0.0.1');await once(server,'listening');
   const p=connect({url:'wss://127.0.0.1:'+server.address().port+'/portal',token:f.token,sourceCommit:'a'.repeat(40),certSha256:good?pin:'0'.repeat(64)});
   try{
    if(good){await once(p,'welcome',{signal:AbortSignal.timeout(5000)});assert.equal(f.stats.hello,1);}
    else {await once(p,'ended',{signal:AbortSignal.timeout(5000)});assert.equal(f.stats.hello,0,'pairing secret must never reach unpinned peer');}
   }finally{p.end('TLS test cleanup');f.close();await new Promise(r=>server.close(r));}
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
