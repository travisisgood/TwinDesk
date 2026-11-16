'use strict';
// Open only the agreed authenticated envelope into a private local receiver file.
const fs=require('node:fs'),crypto=require('node:crypto');
function decrypt(e,privateKey){
 if(e?.v!==1||e.alg!=='RSA-OAEP-256+A256GCM')throw Error('Unsupported envelope');
 const bytes=(s,max)=>{if(typeof s!=='string'||s.length>max*2||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Malformed envelope');const b=Buffer.from(s,'base64');if(b.length>max)throw Error('Oversized envelope');return b;};
 const key=crypto.privateDecrypt({key:privateKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},bytes(e.key,1024));
 const iv=bytes(e.iv,12),tag=bytes(e.tag,16);if(key.length!==32||iv.length!==12||tag.length!==16)throw Error('Invalid envelope parameters');
 const d=crypto.createDecipheriv('aes-256-gcm',key,iv);d.setAAD(Buffer.from('WindowPortal pairing v1'));d.setAuthTag(tag);
 const plain=Buffer.concat([d.update(bytes(e.ciphertext,16384)),d.final()]);
 const p=JSON.parse(plain.toString('utf8')),url=new URL(p.url);
 if(url.protocol!=='wss:'||url.pathname!=='/portal'||url.username||url.password||url.search||url.hash||!/^[a-f0-9]{64}$/i.test(p.token)||!/^[a-f0-9]{64}$/i.test(p.certSha256))throw Error('Invalid pairing fields');
 return {url:p.url,token:p.token,certificateSha256:p.certSha256};
}
module.exports={decrypt};
if(require.main===module){try{const [envelope,key,out]=process.argv.slice(2);fs.writeFileSync(out,JSON.stringify(decrypt(JSON.parse(fs.readFileSync(envelope)),fs.readFileSync(key))),{mode:0o600});fs.chmodSync(out,0o600);console.log('Private pairing file saved');}catch{console.error('Pairing envelope rejected');process.exitCode=1;}}
