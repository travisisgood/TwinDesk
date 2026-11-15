// TwinDesk — Copyright (C) 2026. GPL-3.0, see LICENSE.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { T } = require('../../shared/protocol');

const main = { id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 2, workArea: { x: 0, y: 25, width: 1920, height: 1055 } };
const second = { id: 2, size: { width: 1440, height: 2560 }, scaleFactor: 1, workArea: { x: -1440, y: 25, width: 1440, height: 2535 } };
const screen = new EventEmitter();
screen.getAllDisplays = () => [main, second];
screen.getPrimaryDisplay = () => main;
screen.getDisplayMatching = (rect) => rect.x < 0 ? second : main;
const ipcMain = new EventEmitter();

class Window extends EventEmitter {
  constructor(opts) {
    super();
    this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
    this.webContents = new EventEmitter();
    this.webContents.send = () => {};
  }

  isDestroyed() { return false; }
  isFocused() { return true; }
  isMinimized() { return false; }
  isFullScreen() { return !!this.fullScreen; }
  getBounds() { return this.bounds; }
  setBounds(bounds) { this.bounds = bounds; }
  setFullScreen(on) { this.fullScreen = on; }
  loadFile() {}
}

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { BrowserWindow: Window, screen, ipcMain, app: { getLocale: () => 'en' } };
  return originalLoad.apply(this, arguments);
};
const { Displays } = require('../displays');
const { PcView } = require('../pcview');
Module._load = originalLoad;

test('explicit Extend fails closed and a physical selection remains usable for Mirror', async () => {
  const calls = [];
  const helper = Object.assign(new EventEmitter(), {
    async request(command) {
      calls.push(command);
      if (command === 'createDisplay') throw new Error('virtual display unavailable');
    },
  });
  const settings = { sharing: { on: true, displayId: null }, virtual: { enabled: true } };
  const displays = new Displays(helper, () => settings);
  await displays.applyVirtual();
  assert.equal(displays.target(), null);
  assert.equal(displays.virtualError, 'virtual display unavailable');
  assert.deepEqual(calls, ['createDisplay', 'destroyDisplay']);

  settings.sharing.on = false;
  await displays.applyVirtual();
  assert.equal(displays.virtualError, 'virtual display unavailable');
  settings.virtual.enabled = false;
  settings.sharing.displayId = second.id;
  assert.equal(displays.target().id, second.id);
  clearTimeout(displays.changeTimer);
});

test('viewer sends selected monitor policy before explicit Extend and releases held input', () => {
  const sent = [];
  const server = Object.assign(new EventEmitter(), {
    current: { name: 'Windows PC' },
    sendToClient: (m) => sent.push(m),
  });
  const settings = { receive: { input: true, fullScreen: true, displayId: second.id }, sharing: {}, audio: {} };
  const view = new PcView({ server, getSettings: () => settings, saveSettings() {}, virtualDisplayId: () => null });
  view.control({ share: true, mode: 'extend' });
  assert.equal(view.win.isFullScreen(), true);
  assert.ok(view.win.getBounds().x < 0);
  assert.deepEqual(sent.splice(0), [
    { t: T.SCREEN_POLICY, accept: true, width: 1440, height: 2560 },
    { t: T.SCREEN_CTL, share: true, mode: 'extend' },
  ]);

  view.session = 7;
  view.status = 'live';
  const event = { sender: view.win.webContents };
  ipcMain.emit('pcview:out', event, { t: T.IN_DOWN, session: 6, b: 0, x: 0.2, y: 0.3 });
  ipcMain.emit('pcview:out', event, { t: T.IN_DOWN, session: 7, b: 0, x: 0.2, y: 0.3 });
  ipcMain.emit('pcview:out', event, { t: T.IN_MOVE, session: 7, x: 0.4, y: 0.5 });
  view.win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', code: 'KeyA' });
  settings.receive.input = false;
  view.applySettings();
  assert.deepEqual(sent, [
    { t: T.IN_DOWN, b: 0, x: 0.2, y: 0.3 },
    { t: T.IN_MOVE, x: 0.4, y: 0.5 },
    { t: T.IN_KEY_DOWN, code: 'KeyA' },
    { t: T.IN_KEY_UP, code: 'KeyA' },
    { t: T.IN_UP, b: 0, x: 0.4, y: 0.5 },
  ]);
});
