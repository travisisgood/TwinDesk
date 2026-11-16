'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {encrypt}=require('./pairing-envelope');
test('pairing envelope decrypts only with peer key and authenticated context',()=>{
 const keys=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
 const pair={url:'wss://127.0.0.1:49731/portal',token:crypto.randomBytes(32).toString('hex'),certificateSha256:'a'.repeat(64)};
 const e=encrypt(pair,keys.publicKey);
 assert.equal(JSON.stringify(e).includes(pair.token),false);
 const key=crypto.privateDecrypt({key:keys.privateKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(e.key,'base64'));
 const decode=aad=>{const cipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(e.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(e.ciphertext,'base64')),cipher.final()]);};
 assert.deepEqual(JSON.parse(decode('WindowPortal pairing v1')), {url:pair.url,token:pair.token,certSha256:pair.certificateSha256});
 assert.throws(()=>decode('wrong context'));
});
