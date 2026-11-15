'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Messenger, start, TYPE } = require('../agent-messenger.js');
function pair() {
  const a = new EventEmitter(), b = new EventEmitter();
  a.current = b.current = {};
  a.send = m => b.emit(TYPE, m); b.send = m => a.emit(TYPE, m);
  return [a, b];
}
(async () => {
  const [a,b] = pair(); const mac = new Messenger(a, 'mac'), win = new Messenger(b, 'windows');
  a.emit('welcome');
  assert.equal(mac.ready, true); assert.equal(win.ready, true);
  const sent = mac.send('Finder → Windows\nmessage');
  assert.equal(sent.status, 'delivered'); assert.equal(win.snapshot().messages[0].text, sent.text);
  const cursor = win.cursor;
  b.emit(TYPE, { t: TYPE, version: 1, kind: 'text', id: sent.id, text: sent.text });
  assert.equal(win.cursor, cursor, 'duplicate text is not added');
  win.send('Explorer → Mac'); assert.equal(mac.messages[1].direction, 'in');
  b.emit(TYPE, { version: 1, kind: 'text', id: 'bad', text: 'ignored' });
  assert.equal(win.messages.length, 2);
  assert.throws(() => win.send('x'.repeat(16001)));
  b.emit('closed'); assert.throws(() => win.send('offline'));
  b.current = null; b.emit(TYPE, { version: 1, kind: 'hello' }); assert.equal(win.ready, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-messenger-'));
  const [c,d] = pair(); const remote = new Messenger(d, 'windows');
  const svc = await start({ link:c, dir, platform:'mac' }); c.emit('welcome');
  const headers = { Authorization:'Bearer '+svc.config.token, 'Content-Type':'application/json' };
  try {
    assert.equal((await fetch(svc.config.url+'/messages')).status, 403);
    assert.equal((await fetch(svc.config.url+'/messages', {headers:{...headers,Origin:'https://example.com'}})).status,403);
    let r = await fetch(svc.config.url+'/send',{method:'POST',headers,body:JSON.stringify({text:'hello 🌍'})});
    assert.equal(r.status,200); assert.equal((await r.json()).status,'delivered');
    assert.equal(remote.messages[0].text,'hello 🌍');
    const after=svc.messenger.cursor;
    const waiting=fetch(svc.config.url+'/messages?after='+after+'&wait=1000',{headers});
    setTimeout(()=>remote.send('bounded reply'),30);
    const result=await (await waiting).json(); assert.equal(result.messages[0].text,'bounded reply');
    const empty=await (await fetch(svc.config.url+'/messages?after='+result.cursor+'&wait=10',{headers})).json(); assert.deepEqual(empty.messages,[]);
    assert.equal((await fetch(svc.config.url+'/messages?after=-1',{headers})).status,400);
    const { execFile }=require('node:child_process');
    const cli = await new Promise((resolve,reject)=>execFile(process.execPath,[path.join(__dirname,'../../tools/messenger.js'),path.join(dir,'agent-messenger.json'),'send','CLI reply'],(e,out)=>e?reject(e):resolve(JSON.parse(out))));
    assert.equal(cli.text,'CLI reply');assert.equal(remote.messages.at(-1).text,'CLI reply');
    for(let i=0;i<205;i++)remote.send('bounded '+i);
    assert.equal(svc.messenger.messages.length,200);assert.equal(svc.messenger.snapshot(0).truncated,true);
  } finally { svc.close(); fs.rmSync(dir,{recursive:true,force:true}); }
  console.log('agent-messenger: passed handshake, bidirectional delivery/ACK, validation, disconnect, auth, bounded wait/history, CLI');
})().catch(e=>{console.error(e);process.exitCode=1;});
