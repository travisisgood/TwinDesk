'use strict';
// Encrypt local pairing material for one peer public key. Never prints plaintext.
const fs=require('node:fs'),crypto=require('node:crypto');
function encrypt(pair,publicKey){
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('WindowPortal pairing v1'));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify({url:pair.url,token:pair.token,certSha256:pair.certificateSha256})),cipher.final()]);
 const wrapped=crypto.publicEncrypt({key:publicKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
 return {v:1,alg:'RSA-OAEP-256+A256GCM',key:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
module.exports={encrypt};
if(require.main===module){const [pairFile,keyFile,out]=process.argv.slice(2);fs.writeFileSync(out,JSON.stringify(encrypt(JSON.parse(fs.readFileSync(pairFile)),fs.readFileSync(keyFile))),{mode:0o600});console.log('Encrypted pairing envelope saved');}
