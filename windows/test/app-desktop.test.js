'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const AppDesktop = require('../app-desktop');
const moved = require('../moved-windows');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const calls = [], mon = { name: 'virtual', x: 3000, y: 0, width: 1920, height: 1080 };
  const vdd = { state: { installed: true }, setOn: async on => { calls.push(['display', on]); return on ? mon : true; } };
  let position = { x: 50, y: 60 };
  const helper = { request: async (cmd, args) => { calls.push([cmd, args]); if (cmd === 'winVirtualPlace') position = {x: args.x, y: args.y}; return { windows: [{ wid: 7, ...position, w: 350, h: 320, pid: 123 }] }; }, send: (cmd, args) => calls.push([cmd, args]) };
  const desktop = new AppDesktop({ vdd, helper, canStart: () => true, changed: mon => calls.push(['changed', mon]) });
  const pc = { helper, desktop, moved: new Map(), generation: 1, macAccepts: true, settings: { pcApps: { moveWindows: true } },
    link: { status: { state: 'connected' }, current: { transport: 'ip' } }, _mine: () => false, _current: n => n === pc.generation,
    _poll() {}, onChange() {}, _cursorPx: () => ({ x: -600, y: -300 }) };
  return { calls, mon, vdd, helper, desktop, pc };
}
test('transfer uses a virtual desktop without legacy park/unpark commands', async () => {
  const f = fixture();
  assert.equal(await moved.moveOut(f.pc, 7, { x: 50, y: 60 }), true);
  assert.equal(f.pc.moved.size, 1);
  assert.deepEqual(f.calls.find(c => c[0] === 'winVirtualPlace')[1], { wid: 7, x: 3024, y: 24, homeX: 50, homeY: 60 });
  assert.equal(f.calls.some(c => c[0] === 'winPark'), false);
  moved.bringBack(f.pc);
  assert.equal(f.pc.moved.size, 0);
  assert.deepEqual(f.calls.at(-1), ['winVirtualReturn', { wid: 7, x: 50, y: 60 }]);
});
test('concurrent display acquisition starts one monitor', async () => {
  const f = fixture();
  await Promise.all([f.desktop.ensure(), f.desktop.ensure()]);
  assert.equal(f.calls.filter(c => c[0] === 'display' && c[1]).length, 1);
  await f.desktop.release();
  const clear = f.calls.findIndex(c => c[0] === 'appDisplay' && c[1].name === '');
  const off = f.calls.findIndex(c => c[0] === 'display' && c[1] === false);
  assert.ok(clear < off);
  assert.equal(f.vdd.appDisplay, false);
});

test('pending native relocation does not advertise and disconnect cancels before publication', async () => {
  const f = fixture(), wait = deferred(), request = f.helper.request;
  let relocating = false;
  f.helper.request = async (cmd, args) => {
    if (cmd === 'winVirtualPlace') { relocating = true; return {}; }
    if (cmd === 'windows' && relocating) return wait.promise;
    return request(cmd, args);
  };
  const transfer = moved.moveOut(f.pc, 7);
  await new Promise(r => setImmediate(r));
  assert.equal(f.pc.moved.size, 0);
  f.pc.generation++;
  wait.resolve({windows: [{wid: 7, x: 3024, y: 24, w: 350, h: 320}]});
  assert.equal(await transfer, false);
  assert.equal(f.pc.moved.size, 0);
  assert.ok(f.calls.some(c => c[0] === 'winVirtualReturn'));
  await f.desktop.release();
});
test('disconnect during display creation never relocates the window', async () => {
  const f = fixture(), wait = deferred();
  f.vdd.setOn = async on => on ? wait.promise : true;
  const transfer = moved.moveOut(f.pc, 7);
  await new Promise(r => setImmediate(r));
  f.pc.generation++;
  const release = f.desktop.release();
  wait.resolve(f.mon);
  assert.equal(await transfer, false);
  await release;
  assert.equal(f.calls.some(c => c[0] === 'winVirtualPlace'), false);
  assert.equal(f.pc.moved.size, 0);
});
test('whole-screen Extend and absent driver fail without transferring', async () => {
  for (const reason of ['busy', 'missing']) {
    const f = fixture();
    if (reason === 'busy') f.desktop.canStart = () => false;
    else f.vdd.state.installed = false;
    assert.equal(await moved.moveOut(f.pc, 7), false);
    assert.match(f.pc.message, /Moving window:/);
    assert.equal(f.calls.some(c => c[0] === 'winVirtualPlace'), false);
  }
});

test('rejected native placement returns input and retains acquired display without advertising', async () => {
  const f = fixture(), request = f.helper.request;
  let failures = 0;
  f.pc.onTransferFailure = () => failures++;
  f.helper.request = async (cmd, args) => {
    if (cmd === 'winVirtualPlace') throw new Error('Window refused placement');
    return request(cmd, args);
  };
  assert.equal(await moved.moveOut(f.pc, 7), false);
  assert.equal(f.pc.moved.size, 0);
  await f.desktop.queue;
  assert.equal(f.vdd.appDisplay, true);
  assert.equal(failures, 1);
  assert.ok(f.calls.some(c => c[0] === 'winVirtualReturn'));
});

test('returning the last window retains display until sharing is disabled', async () => {
  const f = fixture();
  await moved.moveOut(f.pc, 7);
  f.pc.moved.set(8, { x: 60, y: 70 });
  moved.bringBack(f.pc, 7);
  await f.desktop.queue;
  assert.equal(f.vdd.appDisplay, true);
  moved.bringBack(f.pc, 8);
  await f.desktop.queue;
  assert.equal(f.vdd.appDisplay, true);
  await moved.moveOut(f.pc, 7);
  assert.equal(f.calls.filter(c => c[0] === 'display' && c[1]).length, 1);
  f.pc.settings.pcApps.moveWindows = false;
  moved.bringBack(f.pc);
  await f.desktop.queue;
  assert.equal(f.vdd.appDisplay, false);
});

test('source escaping backing bounds is returned before publishing', async () => {
  const f = fixture();
  await moved.moveOut(f.pc, 7);
  const out = [], pops = [];
  moved.list(f.pc, [{ wid: 7, x: 20, y: 20, w: 350, h: 320 }], new Set(), out, pops);
  assert.equal(out.length, 0);
  assert.equal(f.pc.moved.size, 0);
  await f.desktop.queue;
});
