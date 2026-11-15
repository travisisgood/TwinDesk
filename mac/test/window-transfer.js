// TwinDesk — Copyright (C) 2026. GPL-3.0, see LICENSE.
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { T } = require('../../shared/protocol');
const transfer = require('../movewin');

const finder = { id: 'com.apple.finder', name: 'Finder', icon: 'data:image/png;base64,AAAA' };

function setup() {
  const requests = [], messages = [];
  const appSend = {
    moved: new Map(), windows: [], accepts: true,
    server: { current: { transport: 'ip' }, sendToClient: (msg) => messages.push(msg) },
    helper: {
      request: async (command, payload) => {
        requests.push([command, payload]);
        return { app: finder, displayId: 8 };
      },
      send: (command, payload) => requests.push([command, payload]),
    },
    getSettings: () => ({ apps: { moveWindows: true } }),
    movedCatalog: () => [finder],
    _mine: () => false,
    _poll() {},
    _sync(list) { this.windows = list; },
    _entry: (window, id) => ({ wid: window.wid, id, scale: 1 }),
    parkingDisplay: () => ({ bounds: { x: -1280, y: 0, width: 1280, height: 900 } }),
    emit() {},
  };
  appSend.bringBack = (wid) => transfer.bringBack(appSend, wid);
  return { appSend, requests, messages };
}

test('Finder and its owned popup carry the real bundle identity on the per-window path', async () => {
  const { appSend, requests, messages } = setup();
  assert.equal(await transfer.moveOut(appSend, 10, 42), true);
  assert.deepEqual(requests, [['appPark', { wid: 10, pid: 42 }]]);
  assert.deepEqual(messages, [{ t: T.APPS_RESULT, apps: [finder] }]);
  const owners = [], popups = [];
  transfer.list(appSend, [
    { wid: 10, pid: 42, x: -1200, y: 60, w: 400, h: 400 },
    { wid: 11, pid: 42, x: -805, y: 100, w: 200, h: 200, popup: true },
    { wid: 12, pid: 42, x: 20, y: 100, w: 200, h: 200, popup: true },
  ], owners, popups);
  assert.equal(owners[0].id, finder.id);
  assert.equal(owners[0].moved, true);
  assert.deepEqual(popups, [{ wid: 11, id: finder.id, scale: 1, popup: true, owner: 10, x: 395, y: 40 }]);

  appSend.windows = [...owners, ...popups];
  transfer.bringBack(appSend, 10, true);
  assert.deepEqual(appSend.windows, []);
  assert.deepEqual(requests.slice(1), [['appUnpark', { wid: 10, home: true }], ['releaseAll', undefined]]);
});

test('disconnection during display creation cancels parking and ignores a late reply', async () => {
  const { appSend, requests, messages } = setup();
  let finish;
  appSend.helper.request = () => new Promise((resolve) => { finish = resolve; });
  const transferInProgress = transfer.moveOut(appSend, 10, 42);
  appSend.server.current = null;
  transfer.bringBack(appSend);
  finish({ app: finder, displayId: 8 });

  assert.equal(await transferInProgress, false);
  assert.deepEqual(requests, [['appUnpark', { wid: 10, home: false }], ['releaseAll', undefined]]);
  assert.deepEqual(messages, []);
  assert.equal(appSend.moved.size, 0);
});

test('stale geometry defers capture and a persistent mismatch returns the window', async () => {
  const { appSend, requests } = setup();
  await transfer.moveOut(appSend, 10, 42);
  const physical = { wid: 10, pid: 42, x: 20, y: 60, w: 400, h: 400 };
  const owners = [];
  transfer.list(appSend, [physical], owners, []);
  assert.deepEqual(owners, []);
  assert.equal(requests.length, 1);

  const parked = { ...physical, x: -1200 };
  transfer.list(appSend, [parked], owners, []);
  assert.equal(owners[0].wid, 10);
  assert.equal(appSend.moved.get(10).missingSince, 0);

  appSend.moved.get(10).missingSince = Date.now() - 1300;
  transfer.list(appSend, [physical], [], []);
  assert.equal(requests[1][0], 'appUnpark');
});
