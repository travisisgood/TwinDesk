'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../../shared/protocol');
let profile;
const ipcMain = new EventEmitter();
class BrowserWindow extends EventEmitter {
  constructor(options) { super(); this.options = options; this.webContents = Object.assign(new EventEmitter(), { send() {} }); }
  setMenu() {} setMaximumSize() {} loadFile() {} setTitle() {}
  getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; }
  getSize() { return [800, 600]; } getContentSize() { return [800, 600]; }
  isDestroyed() { return false; }
  setIcon(icon) { this.icon = icon; }
  setAppDetails(details) { this.details = details; }
  minimize() { this.minimized = true; this.emit('minimize'); this.emit('blur'); }
  restore() { this.minimized = false; this.emit('restore'); this.emit('focus'); }
}
const icon = { isEmpty: () => false, resize() { return this; }, toPNG: () => Buffer.from('test-png') };
const load = Module._load;
Module._load = function(id, ...args) {
  if (id === 'electron') return { app: { getPath: () => profile, getLocale: () => 'en' }, ipcMain, BrowserWindow,
    nativeImage: { createFromDataURL: () => icon }, screen: {
      getCursorScreenPoint: () => ({ x: 400, y: 100 }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayMatching: () => ({ workArea: { width: 1920, height: 1080 } }),
    } };
  return load.call(this, id, ...args);
};
const PeerApps = require('../peerapps');
Module._load = load;
function fixture(t) {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'twindesk-taskbar-test-'));
  const dir = profile;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  ipcMain.removeAllListeners();
  const sent = [];
  const link = Object.assign(new EventEmitter(), { status: { state: 'connected' }, peerOs: P.OS.MAC, send: m => sent.push(m) });
  const apps = new PeerApps({ link, settings: { pcApps: { moveWindows: true }, macApps: {}, ui: {}, monitor: {} },
    peerName: () => 'Mac', onChange() {} });
  const window = (wid, id) => ({ wid, id, title: 'Documents', w: 800, h: 600, scale: 1, moved: true });
  return { apps, link, sent, window };
}
test('crossed Finder gets its icon even when the app list arrives after the window', t => {
  const f = fixture(t);
  f.link.emit(P.T.PAPP_WINDOWS, { windows: [f.window(10, 'com.apple.finder')] });
  const win = f.apps.wins.get(10).win;
  assert.equal(win.options.minimizable, true);
  assert.equal(win.options.skipTaskbar, false);
  f.link.emit(P.T.APPS_RESULT, { apps: [{ id: 'com.apple.finder', name: 'Finder', icon: 'data:image/png;base64,dGVzdA==' }] });
  assert.equal(win.icon, icon);
  assert.ok(fs.existsSync(win.details.appIconPath));
  assert.equal(win.details.appIconIndex, 0);
});
test('minimize stays local and restore focuses the original remote window', t => {
  const f = fixture(t);
  f.link.emit(P.T.PAPP_WINDOWS, { windows: [f.window(10, 'com.apple.finder')] });
  const win = f.apps.wins.get(10).win;
  win.minimize();
  assert.equal(win.minimized, true);
  assert.equal(f.sent.some(m => [P.T.PAPP_CLOSE, P.T.PAPP_RETURN].includes(m.t)), false);
  win.restore();
  assert.ok(f.sent.some(m => m.t === P.T.PAPP_FOCUS && m.wid === 10));
});
test('legacy generic moved windows do not share an incorrect app identity', t => {
  const f = fixture(t);
  f.link.emit(P.T.PAPP_WINDOWS, { windows: [f.window(10, 'moved'), f.window(11, 'moved')] });
  assert.notEqual(f.apps.wins.get(10).win.details.appId, f.apps.wins.get(11).win.details.appId);
});
