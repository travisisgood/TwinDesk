'use strict';

// Use the installed desktop messaging plugin over its standard MCP transport.
// Never launch/resume a second app-server for a desktop-owned thread.
const { spawn } = require('node:child_process');
const readline = require('node:readline');

async function desktopNotify(serverPath, threadId, prompt) {
  if (!process.env.CODEX_APP_TOOLS_PIPE_PATH) throw new Error('Desktop plugin connection is not available in this environment');
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let serial = 0;
  const fail = error => { for (const p of pending.values()) p.reject(error); pending.clear(); };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Desktop MCP transport exited')));
  child.stdin.on('error', fail);
  const timer = setTimeout(() => fail(new Error('Desktop notification timed out; do not retry automatically')), 30000);
  function write(message) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }
  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      write({ id, method, params });
    });
  }
  lines.on('line', line => {
    let row;
    try { row = JSON.parse(line); } catch { return; }
    const p = pending.get(row.id);
    if (!p) return;
    pending.delete(row.id);
    if (row.error) p.reject(new Error(row.error.message || 'Desktop MCP error'));
    else p.resolve(row.result);
  });
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'twindesk-desktop-notifier', version: '0.1.0' } });
    write({ method: 'notifications/initialized' });
    const catalog = await call('tools/list', {});
    if (!catalog.tools?.some(t => t.name === 'send_message_to_thread')) throw new Error('Desktop messaging tool is unavailable');
    if (prompt === undefined) return 'desktop messaging tool available';
    const result = await call('tools/call', { name: 'send_message_to_thread', _meta: { 'openai/threadId': threadId }, arguments: { hostId: 'local', threadId, prompt } });
    if (result.isError) throw new Error('Desktop rejected notification; check app permissions and thread availability');
    return result;
  } finally {
    clearTimeout(timer);
    lines.close();
    child.kill();
  }
}

module.exports = { desktopNotify };
