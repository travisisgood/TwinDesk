// Temporary TwinDesk peer messenger. Text is data: never execute received messages.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const TYPE = 'twindesk.messenger.v1';
const MAX_TEXT = 16000;
class Messenger extends EventEmitter {
  constructor(link, platform) {
    super();
    this.link = link;
    this.platform = platform;
    this.ready = false;
    this.cursor = 0;
    this.messages = [];
    link.on('welcome', () => { this.ready = false; link.send({ t: TYPE, kind: 'hello', version: 1 }); });
    link.on('closed', () => { this.ready = false; this.changed(); });
    link.on(TYPE, m => this.receive(m));
  }
  changed() { this.cursor++; this.emit('change'); }
  snapshot(after = 0) {
    return { version: 1, platform: this.platform, ready: this.ready && !!this.link.current,
      cursor: this.cursor, truncated: this.messages.length === 200 && after < this.messages[0].seq,
      messages: this.messages.filter(m => m.seq > after) };
  }
  receive(m) {
    if (!this.link.current || !m || m.version !== 1) return;
    if (m.kind === 'hello') {
      this.ready = true;
      if (!m.reply) this.link.send({ t: TYPE, version: 1, kind: 'hello', reply: true });
      this.changed();
    } else if (m.kind === 'text' && typeof m.id === 'string' && /^[a-f0-9-]{36}$/.test(m.id)
      && typeof m.text === 'string' && m.text.trim() && m.text.length <= MAX_TEXT) {
      if (!this.messages.some(x => x.id === m.id)) {
        this.messages.push({ id: m.id, text: m.text, direction: 'in', at: Date.now(), status: 'received', seq: this.cursor + 1 });
        this.messages = this.messages.slice(-200);
        this.changed();
      }
      this.link.send({ t: TYPE, version: 1, kind: 'ack', id: m.id });
    } else if (m.kind === 'ack') {
      const row = this.messages.find(x => x.id === m.id && x.direction === 'out');
      if (row && row.status !== 'delivered') { row.status = 'delivered'; row.seq = this.cursor + 1; this.changed(); }
    }
  }
  send(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Text must contain 1–16000 characters');
    if (!this.ready || !this.link.current) throw new Error('Peer messenger is not connected/enabled');
    const row = { id: randomUUID(), text, direction: 'out', at: Date.now(), status: 'sent', seq: this.cursor + 1 };
    this.messages.push(row); this.messages = this.messages.slice(-200); this.changed();
    this.link.send({ t: TYPE, version: 1, kind: 'text', id: row.id, text });
    return row;
  }
}
async function start({ link, dir, platform, port = 0 }) {
  const messenger = new Messenger(link, platform);
  const token = randomBytes(32).toString('hex');
  const file = path.join(dir, 'agent-messenger.json');
  const reply = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'agent-messenger.html')));
    }
    if (req.headers.authorization !== 'Bearer ' + token || (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`)) return reply(res, 403, { error: 'Unauthorized' });
    if (req.method === 'GET' && url.pathname === '/messages') {
      const after = Number(url.searchParams.get('after') || 0);
      const wait = Math.min(55000, Math.max(0, Number(url.searchParams.get('wait') || 0)));
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isFinite(wait)) return reply(res, 400, { error: 'Invalid cursor/wait' });
      if (messenger.cursor <= after && wait) {
        const done = () => { clearTimeout(timer); messenger.off('change', done); res.off('close', done); if (!res.destroyed) reply(res, 200, messenger.snapshot(after)); };
        const timer = setTimeout(done, wait);
        messenger.once('change', done); res.once('close', done);
      } else reply(res, 200, messenger.snapshot(after));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/send') {
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 100000) { reply(res, 413, { error: 'Body too large' }); req.destroy(); return; } chunks.push(chunk); }
        const row = messenger.send(JSON.parse(Buffer.concat(chunks).toString('utf8')).text);
        return reply(res, 200, row);
      } catch (e) { return reply(res, 400, { error: e.message }); }
    }
    reply(res, 404, { error: 'Not found' });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  server.on('error', e => console.warn('[messenger]', e.message));
  const config = { version: 1, url: `http://127.0.0.1:${server.address().port}`, token, platform, pid: process.pid };
  try { fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 }); fs.chmodSync(file, 0o600); }
  catch (e) { server.close(); throw e; }
  console.log('[messenger] local connection file: ' + file);
  return { messenger, config, close() { server.closeAllConnections(); server.close(); try { if (JSON.parse(fs.readFileSync(file)).token === token) fs.unlinkSync(file); } catch {} } };
}
function install({ app, ...options }) {
  if (process.env.TWINDESK_MESSENGER !== '1') return;
  start({ ...options, dir: app.getPath('userData') }).then(service => app.once('before-quit', () => service.close())).catch(e => console.warn('[messenger] could not start:', e.message));
}
module.exports = { Messenger, start, install, TYPE };
