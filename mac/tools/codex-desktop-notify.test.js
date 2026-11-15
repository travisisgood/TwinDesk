'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { desktopNotify } = require('./codex-desktop-notify');

test('desktop transport probes without sending, routes to actual thread, and rejects errors', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twindesk-mcp-test-'));
  const fixture = path.join(dir, 'server.cjs');
  const previous = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  process.env.CODEX_APP_TOOLS_PIPE_PATH = 'test-only';
  await fs.writeFile(fixture, `
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const q = JSON.parse(line);
      if (!q.id) return;
      let result = {};
      if (q.method === 'tools/list') result = {tools:[{name:'send_message_to_thread'}]};
      if (q.method === 'tools/call') {
        if (q.params._meta['openai/threadId'] !== 'test-thread' || q.params.arguments.threadId !== 'test-thread') process.exit(2);
        result = {isError:q.params.arguments.prompt === 'reject', content:[{type:'text',text:q.params.arguments.prompt}]};
      }
      process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:q.id, result})+'\\n');
    });
  `);
  try {
    assert.equal(await desktopNotify(fixture, 'test-thread'), 'desktop messaging tool available');
    assert.equal((await desktopNotify(fixture, 'test-thread', 'hello')).content[0].text, 'hello');
    await assert.rejects(desktopNotify(fixture, 'test-thread', 'reject'), /rejected notification/);
    delete process.env.CODEX_APP_TOOLS_PIPE_PATH;
    await assert.rejects(desktopNotify(fixture, 'test-thread'), /not available/);
  } finally {
    if (previous === undefined) delete process.env.CODEX_APP_TOOLS_PIPE_PATH;
    else process.env.CODEX_APP_TOOLS_PIPE_PATH = previous;
    await fs.rm(dir, {recursive:true,force:true});
  }
});
