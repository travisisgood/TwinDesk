// TwinDesk — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// This Mac's apps on another Mac, way (port of windows/pcapps.js +
// sender.js). The other Mac's viewer (its pcapps.js) asks for the list (`papps.list`), opens an app
// (`papp.launch` → `open -b` through the helper), and gets `papp.windows` for the apps it opened:
// their windows and their menus / pop-ups (`popup`, `owner`, offset). Every window is its own `rtc2`
// session (kind 'window', `win: 'send'`) from a hidden capture window, only while the viewer's
// `papp.policy` accepts and "apps.offer" is on. Its input (`in.*` + `wid`) is injected at that
// window. Nothing is captured before the viewer opened an app, or ReZume sent one that is open here
// (adopt): independent of "apps.offer", and closing its copy there stops only that copy.
// Crossed windows use dedicated backing displays owned by the native helper.
//
// Events: 'change'.
'use strict';

const path = require('path');
const { BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const { EventEmitter } = require('events');
const P = require('../shared/protocol.js');
const ScreenCodec = require('../shared/screencodec.js');

const T = P.T;
const POLL_MS = 250;
const MAX_W = 3840, MAX_H = 2160;
const MAX_POPUPS = 6;
const IN_TYPES = [T.IN_MOVE, T.IN_DOWN, T.IN_UP, T.IN_WHEEL, T.IN_KEY_DOWN, T.IN_KEY_UP];

class AppSend extends EventEmitter {
  constructor({ server, helper, getSettings, extending = () => false }) {
    super();
    Object.assign(this, { server, helper, getSettings, extending });
    this.accepts = false; // the viewer's papp.policy
    this.launched = new Map(); // app id -> {id, pids: Set, since, had, lastSeen}
    this.moved = new Map(); // wid -> {pid, x, y, w, h}: windows moved to the other computer (movewin.js), and where they were (points)
    this.windows = []; // the list last sent
    this.bounds = new Map(); // wid -> {x, y, width, height} points
    this.streams = new Map(); // wid -> session
    this.failed = new Set();
    this.live = new Set();
    this.transferTimers = new Map();
    this.counter = 0;
    this.sentKey = '';
    this.win = null;
    this.ready = false;
    this.queue = [];
    this.timer = null;

    server.on('client', () => {
      this.accepts = false;
      this.bringBack();
      this.sentKey = '';
      this._moveKey();
    });
    server.on('closed', () => {
      if (server.current) return;
      this.accepts = false;
      this._moveKey();
      for (const id of [...this.launched.keys()]) this._forget(id);
      this.bringBack();
      this._sync([]);
      this._idle();
    });
    helper.on('exit', () => this.bringBack());
    helper.on('event', (name, ev) => {
      if (name !== 'parkingDisplayTerminated') return;
      for (const [wid, entry] of this.moved) if (entry.displayId === ev.displayId) this.bringBack(wid);
    });
    helper.on('ready', () => this._moveKey()); // a restarted helper is told the move key again
    const on = (t, fn) => server.on(`t:${t}`, fn);
    on(T.PAPP_POLICY, (m) => {
      const accept = m.accept === true;
      if (accept !== this.accepts) console.log(`[appsend] peer ${accept ? 'accepts' : 'declines'} app windows`);
      this.accepts = accept;
      this._moveKey();
      if (!this.accepts) this.bringBack();
      this._sync(this.windows);
    });
    on(T.PAPPS_LIST, () => this._list());
    on(T.PAPP_LAUNCH, (m) => typeof m.id === 'string' && this._launch(m.id));
    on(T.PAPP_FOCUS, (m) => this._mine(m.wid) && !this._popup(m.wid) && this.helper.request('appFocus', { wid: m.wid }).catch(() => {}));
    // Closing a moved window's copy there brings it back here (it isn't closed); one ReZume sent stays open here.
    on(T.PAPP_CLOSE, (m) => this._mine(m.wid) && (this.moved.has(m.wid) ? this.bringBack(m.wid) : !this._unfollow(m.wid) && this.helper.request('appClose', { wid: m.wid }).catch(() => {})));
    on(T.PAPP_RETURN, (m) => this.moved.has(m.wid) && this.bringBack(m.wid, true));
    on(T.PAPP_SIZE, (m) => {
      const ok = (v) => Number.isInteger(v) && v >= 50 && v <= 16384;
      const w = this.windows.find((x) => x.wid === m.wid);
      if (w && !w.popup && ok(m.w) && ok(m.h)) {
        const width = w.moved ? Math.min(m.w, w.maxW) : m.w;
        const height = w.moved ? Math.min(m.h, w.maxH) : m.h;
        this.helper.request('appResize', { wid: m.wid, w: width / w.scale, h: height / w.scale }).catch(() => {});
      }
    });
    for (const t of IN_TYPES) on(t, (m) => this._input(m));
    // Answers and candidates from the other Mac's viewer for our sessions (`win: 'view'`).
    const ours = (m) => this.live.has(m.session) && m.win === 'view';
    on(T.RTC2_ANSWER, (m) => ours(m) && typeof m.sdp === 'string' && this._toWin(m));
    on(T.RTC2_ICE, (m) => ours(m) && this._toWin(m));

    ipcMain.on('appsend-out', (e, m) => {
      if (!this._fromWin(e) || !m || !this.live.has(m.session)) return;
      if (m.t === T.RTC2_OFFER || m.t === T.RTC2_ICE) this.server.sendToClient({ ...m, win: 'send' });
    });
    ipcMain.on('appsend-state', (e, s) => {
      if (!this._fromWin(e) || !s || !this.live.has(s.session)) return;
      if (s.status === 'live') this._clearTransferTimer(s.session);
      if (s.status === 'disconnected' && this._movedOwner(s.session)) this._watchTransfer(s.session);
      if (s.status !== 'ended' && s.status !== 'failed') return;
      for (const [wid, ses] of this.streams) {
        if (ses !== s.session) continue;
        this.streams.delete(wid);
        this.failed.add(wid);
        this._stop(ses);
        if (this.moved.has(wid)) this.bringBack(wid);
      }
    });
    ipcMain.on('appsend-ready', (e) => {
      if (!this._fromWin(e)) return;
      this.ready = true;
      for (const m of this.queue.splice(0)) this.win.webContents.send('appsend', m);
    });
  }

  get allowed() {
    return this.getSettings().apps.offer !== false;
  }

  // An app followed for ReZume (adopt), which the Apps switch doesn't stop.
  get rezumes() {
    for (const a of this.launched.values()) if (a.rz) return true;
    return false;
  }

  applySettings() {
    const mv = !!this.getSettings().apps.moveWindows;
    if (!mv || this.extending()) this.bringBack(); // Move windows off: every moved window back here
    this._moveKey();
    if (!this.allowed) {
      for (const [id, a] of this.launched) if (!a.rz) this._forget(id);
      if (this.launched.size) this._poll();
      else this._sync([]);
    }
  }

  // The helper grabs a window with the move key and a click (Grab.swift); "" = off.
  _moveKey() {
    const a = this.getSettings().apps;
    this.helper.send('moveWin', { key: a.moveWindows && this.accepts && !this.extending() ? a.moveKey || 'auto' : '' });
  }

  // Move windows (movewin.js, loaded only when used): a grabbed window crossed with the pointer
  // goes over there; bringBack returns one or all of them.
  moveOut(wid, pid) {
    if (!this.getSettings().apps.moveWindows || this.extending()) return Promise.resolve(false);
    return require('./movewin.js').moveOut(this, Number(wid), Number(pid));
  }

  bringBack(wid, home = false) {
    if (this.moved.size) require('./movewin.js').bringBack(this, wid, home);
  }

  // ReZume: the windows of an app that is open here (its bundle id), streamed to the other Mac.
  async adopt(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9.-]{1,200}$/.test(id) || !this.server.current) return false;
    const had = this.launched.get(id);
    if (had) {
      if (had.skip) had.skip.clear();
      this._poll();
      return true;
    }
    const r = await this.helper.request('appLaunch', { appId: id }).catch(() => null); // it's running: its pid
    if (!r || !r.pid) return false;
    this.launched.set(id, { id, rz: true, skip: new Set(), pids: new Set([r.pid]), since: Date.now(), had: false, lastSeen: 0 });
    this._poll();
    return true;
  }

  // ReZume's window sharing turned off (app: only that app's windows).
  unadopt(app) {
    let any = false;
    for (const [id, a] of this.launched) if (a.rz && (!app || a.id === app)) { this._forget(id); any = true; }
    if (any && !this.launched.size) this._sync([]);
  }

  // A window ReZume sent, closed there: only its copy goes (the window stays open here).
  _unfollow(wid) {
    const w = this.windows.find((x) => x.wid === wid);
    const a = w && this.launched.get(w.id);
    if (!a || !a.rz) return false;
    a.skip.add(wid);
    this.helper.request('appFocus', { wid }).catch(() => {}); // back to the front here (it never left this screen)
    return true;
  }

  _mine(wid) {
    return typeof wid === 'number' && this.windows.some((w) => w.wid === wid);
  }

  _popup(wid) {
    return this.windows.some((w) => w.wid === wid && w.popup);
  }

  async _list() {
    if (!this.allowed) return this.server.sendToClient({ t: T.PAPPS_RESULT, apps: [] });
    const r = await this.helper.request('appsList').catch(() => ({ apps: [] }));
    this.server.sendToClient({ t: T.PAPPS_RESULT, apps: (r.apps || []).map((a) => ({ id: a.id, name: a.name, icon: a.icon || '' })) });
  }

  async _launch(id) {
    const reply = (ok, why) => this.server.sendToClient(why ? { t: T.PAPP_LAUNCHED, id, ok, why } : { t: T.PAPP_LAUNCHED, id, ok });
    if (!this.allowed) return reply(false, 'This Mac doesn’t let you open its apps (its Apps tab)');
    const open = this.windows.find((w) => w.id === id && !w.popup);
    if (open) {
      this.helper.request('appFocus', { wid: open.wid }).catch(() => {});
      return reply(true);
    }
    try {
      const r = await this.helper.request('appLaunch', { appId: id });
      const a = this.launched.get(id) || { id, pids: new Set(), since: Date.now(), had: false, lastSeen: 0 };
      if (r && r.pid) a.pids.add(r.pid);
      this.launched.set(id, a);
      reply(true);
      this._poll();
    } catch (e) {
      reply(false, e.message);
    }
  }

  _poll() {
    if (this.timer) return;
    const tick = async () => {
      if ((!this.launched.size && !this.moved.size) || !this.server.current) { this.timer = null; return this._sync([]); }
      const peer = this.server.current;
      const pids = [...this.launched.values()].flatMap((a) => [...a.pids]).concat([...this.moved.values()].map((m) => m.pid));
      const r = await this.helper.request('appWindows', { pids, popups: true }).catch(() => null);
      if (peer === this.server.current && r && Array.isArray(r.windows)) this._match(r.windows);
      this.timer = this.launched.size || this.moved.size ? setTimeout(tick, POLL_MS) : null;
    };
    this.timer = setTimeout(tick, 0);
  }

  // The windows of the apps the viewer opened, then their pop-ups over the front one.
  _match(all) {
    const now = Date.now();
    const out = [];
    const pops = [];
    this.bounds.clear();
    if (this.moved.size) require('./movewin.js').list(this, all, out, pops); // moved windows (Move windows)
    for (const a of this.launched.values()) {
      const mine = all.filter((w) => a.pids.has(w.pid) && !this.moved.has(w.wid) && !pops.some((p) => p.wid === w.wid) && !(a.skip && a.skip.has(w.wid)));
      const main = mine.filter((w) => !w.popup);
      for (const w of main) out.push(this._entry(w, a.id));
      const popups = mine.filter((w) => w.popup).sort((x, y) => y.w * y.h - x.w * x.h).slice(0, MAX_POPUPS);
      for (const w of popups) {
        const owner = main.find((m) => w.x >= m.x && w.y >= m.y && w.x < m.x + m.w && w.y < m.y + m.h) || main[0];
        if (!owner) continue;
        const e = this._entry(w, a.id);
        pops.push({ ...e, popup: true, owner: owner.wid, x: Math.round((w.x - owner.x) * e.scale), y: Math.round((w.y - owner.y) * e.scale) });
      }
      if (main.length) {
        a.had = true;
        a.lastSeen = now;
      }
      if ((a.had && now - a.lastSeen > 3000) || (!a.had && now - a.since > 30000)) this._forget(a.id);
    }
    this._sync(out.concat(pops).filter((w, i, list) => list.findIndex((entry) => entry.wid === w.wid) === i)); // owners before their pop-ups
  }

  movedCatalog() {
    return [...new Map([...this.moved.values()].filter((m) => m.app).map((m) => [m.app.id, m.app])).values()];
  }

  parkingDisplay(id) {
    return screen.getAllDisplays().find((d) => d.id === id);
  }

  _forget(id) {
    const a = this.launched.get(id);
    if (!a) return;
    this.launched.delete(id);
  }

  // One entry of papp.windows: sizes in physical px, `scale` = the display's backing scale.
  _entry(w, id) {
    const b = { x: w.x, y: w.y, width: w.w, height: w.h };
    this.bounds.set(w.wid, b);
    const d = screen.getDisplayMatching({ x: Math.round(w.x), y: Math.round(w.y), width: Math.max(1, Math.round(w.w)), height: Math.max(1, Math.round(w.h)) });
    const k = d.scaleFactor || 1;
    return {
      wid: w.wid, id, title: w.title || '', w: Math.round(w.w * k), h: Math.round(w.h * k), scale: k,
      maxW: Math.round(d.workArea.width * k), maxH: Math.round(d.workArea.height * k),
    };
  }

  async _sync(list) {
    const key = JSON.stringify(list);
    const changed = key !== this.sentKey;
    if (changed && this.server.current) this.server.sendToClient({ t: T.PAPP_WINDOWS, windows: list });
    this.sentKey = key;
    this.windows = list;
    for (const wid of this.failed) if (!list.some((w) => w.wid === wid)) this.failed.delete(wid);
    const want = this.accepts && (this.allowed || this.rezumes || this.moved.size > 0) ? new Set(list.map((w) => w.wid)) : new Set();
    for (const [wid, session] of this.streams) {
      if (want.has(wid)) continue;
      this.streams.delete(wid);
      this._stop(session);
    }
    const start = [...want].filter((wid) => !this.streams.has(wid) && !this.failed.has(wid));
    if (start.length) {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
      for (const wid of start) {
        if (!this.accepts || this.streams.has(wid) || !this.windows.some((w) => w.wid === wid)) continue;
        const src = sources.find((s) => s.id.startsWith(`window:${wid}:`));
        const fps = Math.min(120, Math.max(30, Math.round(screen.getPrimaryDisplay().displayFrequency || 60)));
        const session = ++this.counter;
        this.live.add(session);
        this.streams.set(wid, session);
        if (this._movedOwner(session)) this._watchTransfer(session);
        this._toWin({
          t: 'start', session, sourceId: src ? src.id : `window:${wid}:0`, width: MAX_W, height: MAX_H, follow: true,
          mbps: this.getSettings().bitrateMbps, fps, offer: { kind: 'window', wid },
          codec: ScreenCodec.mode((this.getSettings().sharing || {}).codec), // Share screen › Encoder
        });
      }
    }
    if (changed) this.emit('change');
  }

  _movedOwner(session) {
    const entry = this.windows.find((w) => this.streams.get(w.wid) === session);
    return this.moved.has(entry?.wid) ? entry.wid : null;
  }

  _clearTransferTimer(session) {
    clearTimeout(this.transferTimers.get(session));
    this.transferTimers.delete(session);
  }

  _watchTransfer(session) {
    if (this.transferTimers.has(session)) return;
    const timer = setTimeout(() => {
      this.transferTimers.delete(session);
      const owner = this._movedOwner(session);
      if (owner) this.bringBack(owner);
    }, 12000);
    timer.unref();
    this.transferTimers.set(session, timer);
  }

  _stop(session) {
    this._clearTransferTimer(session);
    if (!this.live.delete(session)) return;
    this._toWin({ t: 'stop', session });
    if (this.server.current) this.server.sendToClient({ t: T.RTC2_STOP, session, win: 'send' });
    this._idle();
  }

  // No window streamed and no session: the hidden capture window goes after 30 s (made again for the next).
  _idle() {
    clearTimeout(this.dropTimer);
    if (!this.win) return;
    this.dropTimer = setTimeout(() => {
      if (this.live.size || this.server.current || !this.win) return;
      const w = this.win;
      this.win = null;
      this.ready = false;
      if (!w.isDestroyed()) w.destroy();
    }, 30000);
    if (this.dropTimer.unref) this.dropTimer.unref();
  }

  // The viewer's input in one of our windows: at that window (normalized 0–1 over its frame).
  // Clicks and keys bring it to the front first; a pop-up is never raised (that closes a menu).
  _input(m) {
    if (m.wid == null || !this.streams.has(m.wid)) return;
    const bounds = this.bounds.get(m.wid);
    if (!bounds) return;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    let ev;
    switch (m.t) {
      case T.IN_MOVE: ev = { t: m.t, x: num(m.x), y: num(m.y) }; break;
      case T.IN_DOWN: case T.IN_UP: ev = { t: m.t, x: num(m.x), y: num(m.y), b: Math.max(0, Math.min(4, num(m.b) | 0)) }; break;
      case T.IN_WHEEL: ev = { t: m.t, dx: num(m.dx), dy: num(m.dy) }; break;
      default:
        if (typeof m.code !== 'string' || m.code.length > 32) return;
        ev = { t: m.t, code: this.server.keySwap(this.getSettings()) ? P.mapKeyFromOtherPlatform(m.code) : m.code };
    }
    if ((m.t === T.IN_DOWN || m.t === T.IN_KEY_DOWN) && !this._popup(m.wid) && this.front !== m.wid) {
      this.front = m.wid;
      this.helper.request('appFocus', { wid: m.wid }).catch(() => {});
    }
    this.helper.send('input', { ev, bounds });
  }

  _fromWin(e) {
    return this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
  }

  _toWin(m) {
    if (!this.win || this.win.isDestroyed()) {
      if (m.t !== 'start') return;
      this._create();
    }
    if (this.ready) this.win.webContents.send('appsend', m);
    else this.queue.push(m);
  }

  _create() {
    clearTimeout(this.dropTimer);
    this.ready = false;
    this.queue = [];
    this.win = new BrowserWindow({
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload-appsend.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    this.win.webContents.on('render-process-gone', () => {
      this.bringBack();
      for (const session of this.streams.values()) this._stop(session);
      this.streams.clear();
      if (this.win && !this.win.isDestroyed()) this.win.destroy();
    });
    this.win.webContents.on('console-message', (e) => e.level === 'error' && console.log(`[appsend] ${e.message}`));
    this.win.loadFile(path.join(__dirname, 'appsend.html'));
    this.win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
  }

  shutdown() {
    for (const id of [...this.launched.keys()]) this._forget(id);
    this.bringBack(); // quitting: every moved window back here
    for (const session of this.streams.values()) this._stop(session);
    this.streams.clear();
  }

  get view() {
    return { accepts: this.accepts, open: this.windows.filter((w) => !w.popup).length, streaming: this.streams.size, moved: this.moved.size };
  }
}

module.exports = { AppSend };
