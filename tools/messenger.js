#!/usr/bin/env node
'use strict';
// No dependencies; usable from PowerShell, bash, or a Codex exec tool.
const fs = require('node:fs');
async function main() {
  const [file, command, ...args] = process.argv.slice(2);
  if (!file || !['send', 'read', 'wait', 'status'].includes(command)) throw Error('Usage: node tools/messenger.js <agent-messenger.json> send <text> | read [cursor] | wait [cursor] [seconds<=55] | status. send - reads stdin.');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(c.url)) throw Error('Expected loopback URL');
  const after = Number(args[0] || 0);
  const wait = command === 'wait' ? Math.min(55, Math.max(0, Number(args[1] || 55))) * 1000 : 0;
  let text;
  if (command === 'send') text = args[0] === '-' ? fs.readFileSync(0, 'utf8') : args.join(' ');
  const route = command === 'send' ? '/send' : '/messages?after=' + (command === 'status' ? 0 : after) + '&wait=' + wait;
  const r = await fetch(c.url + route, { method: command === 'send' ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: command === 'send' ? JSON.stringify({ text }) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Request failed');
  if (command === 'status') delete data.messages;
  process.stdout.write(JSON.stringify(data) + '\n');
}
main().catch(e => { process.stderr.write(JSON.stringify({ error: e.message }) + '\n'); process.exitCode = 1; });
