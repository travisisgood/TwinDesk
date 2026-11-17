const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {decryptPairing,createLauncher}=require('./bootstrap-launcher.cjs');
test('encrypted pairing authenticates and cannot inject local launch options',()=>{
 const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('WindowPortal pairing v1'));
 const payload={url:'wss://192.0.2.1:49735/portal',token:'a'.repeat(64),certSha256:'b'.repeat(64),executable:'untrusted',bootstrap:{ttlMs:999999}};
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);
 const envelope={v:1,alg:'RSA-OAEP-256+A256GCM',key:crypto.publicEncrypt({key:publicKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
 const result=decryptPairing(envelope,privateKey);assert.deepEqual(Object.keys(result).sort(),['certSha256','token','url']);
 assert.throws(()=>decryptPairing({...envelope,tag:Buffer.alloc(16).toString('base64')},privateKey));
});
test('launcher requires operator configured absolute paths',()=>{assert.throws(()=>createLauncher({executable:'peer-command'}),/absolute/);});
