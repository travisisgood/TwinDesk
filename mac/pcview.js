// TwinDesk — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Display › PC → Mac: the PC's screen in a window on this Mac.
// We tell the PC with `screen.policy {accept, width, height}` and answer every `rtc2.offer`
// (recvonly) in a visible viewer window, tuned for the lowest latency (jitter buffer 0, input sent
// the moment it arrives). Keys are taken in main (before-input-event) so Cmd+Q/W/… reach the PC;
// mouse input comes from the viewer page. Closing the window turns the switch off.
// The window is the switch. It opens only when the person opens it (Receive tab, menu
// bar, never because the other side started sharing); while it is open and not minimized we accept
// (`screen.policy`), which is what makes the other computer send; opening it also starts the other
// side's sharing when that's allowed, and closing it stops what we started.
// Minimizing pauses the picture (accept false: the PC stops capturing); the PC's
// `screen.state` lets us start its sharing and switch Extend/Mirror from here (`screen.ctl`), from
// the Receive tab or the window's toolbar; opening the window starts it when the PC allows that.
//
// Events: 'change' — this.view changed.
'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { EventEmitter } = require('events');
const P = require('../shared/protocol.js');
const I18n = require('../shared/i18n.js');
const { attachKeys } = require('./viewer-keys');

const T = P.T;
const POINTER = new Set([T.IN_MOVE, T.IN_DOWN, T.IN_UP, T.IN_WHEEL]);

class PcView extends EventEmitter {
  constructor({ server, getSettings, saveSettings, virtualDisplayId }) {
    super();
    Object.assign(this, { server, getSettings, saveSettings, virtualDisplayId });
    this.win = null;
    this.ready = false;
    this.queue = [];
    this.session = null; // the PC's rtc2 session we answer
    this.kind = '';
    this.status = 'off';
    this.stats = null; // {width, height, fps, mbps, decoder, codec, delayMs}
    this.keys = null;
    this.buttons = new Map();
    this.sized = false;
    this.remote = null; // the peer's screen.state {on, mode, remote, modes}
    this.startedByUs = false; // we switched the PC's sharing on (switch it off again when we close)

    server.on('client', () => {
      this._end('', undefined, undefined, false);
      this.remote = null;
      this._toWin({ t: 'remote', modes: [] });
      this.startedByUs = false;
      this.policyKey = '';
      this._policy();
    });
    server.on(`t:${T.SCREEN_STATE}`, (m) => {
      const was = this.remote;
      this.remote = { on: !!m.on, mode: String(m.mode || ''), remote: m.remote !== false, modes: Array.isArray(m.modes) ? m.modes.slice(0, 4).map(String) : [] };
      if (!this.remote.on) this.startedByUs = false;
      this._toWin({ t: 'remote', ...this.remote });
      if (this.wantStart && this.remote.remote && !this.remote.on) this.control({ share: true });
      this.wantStart = false;
      // The other computer just started sharing (its menu, its window): watch it here. Not on
      // connecting to one that already shares (was: null), which would pop the window every time.
      if (this.remote.on && was && !was.on && !this.isOpen) return void this.show();
      this.emit('change');
    });
    server.on('closed', () => {
      if (server.current) return;
      this.remote = null;
      this.startedByUs = false;
      this._toWin({ t: 'remote', modes: [] });
      this._end('');
    });
    server.on(`t:${T.RTC2_OFFER}`, (m) => this._onOffer(m));
    // App-window sessions carry `win` (pcapps.js / appsend.js): never the screen's.
    server.on(`t:${T.RTC2_ICE}`, (m) => !m.win && m.session === this.session && this._toWin({ ...m }));
    server.on(`t:${T.RTC2_STOP}`, (m) => !m.win && (m.session === undefined || m.session === this.session) && this._end(`${this.server.current ? this.server.current.name : 'It'} stopped sharing`, this.server.current ? '{name} stopped sharing' : 'The other computer stopped sharing', this.server.current ? { name: this.server.current.name } : undefined));
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => {
      this._placeFullScreen();
      this._policy();
      this.emit('change');
    });

    ipcMain.on('pcview:out', (e, m) => {
      if (!this._fromWin(e) || !m || !this.server.current) return;
      if ((m.t === T.RTC2_ANSWER || m.t === T.RTC2_ICE) && m.session === this.session) this.server.sendToClient(m);
      else if (POINTER.has(m.t) && this.session !== null && m.session === this.session && this.cfg.input && this.status === 'live') {
        if (m.t === T.IN_UP ? !this.buttons.has(m.b) : !this.win.isFocused()) return;
        const { session, ...input } = m;
        if (m.t === T.IN_DOWN) this.buttons.set(m.b, { ...input });
        if (m.t === T.IN_UP) this.buttons.delete(m.b);
        if (m.t === T.IN_MOVE) {
          for (const down of this.buttons.values()) Object.assign(down, { x: m.x, y: m.y });
        }
        this.server.sendToClient(input);
      }
    });
    ipcMain.on('pcview:state', (e, s) => {
      if (!this._fromWin(e) || !s || s.session !== this.session) return;
      if (s.status) this.status = String(s.status);
      if (s.stats) this.stats = s.stats;
      if (s.size) this._fit(s.size.width, s.size.height);
      this.emit('change');
    });
    ipcMain.on('pcview:ctl', (e, m) => {
      if (!this._fromWin(e) || !m) return;
      if (this.session !== null && m.disconnected === this.session) this._releaseInput();
      if (m.framegen !== undefined) {
        this.cfg.framegen = !!m.framegen;
        this.saveSettings();
        this._toWin({ t: 'pacing', pacing: this.getSettings().sharing.pace || 'fast', framegen: !!this.cfg.framegen });
        this.emit('change');
      }
      if (m.fullScreen) this._toggleFullScreen();
      // Keep on top (the bar's button): this window over other apps' windows, for this time.
      if (m.pin && this.win && !this.win.isDestroyed()) {
        const on = !this.win.isAlwaysOnTop();
        this.win.setAlwaysOnTop(on, 'floating');
        this._toWin({ t: 'pinned', on });
      }
      if (m.share !== undefined || m.mode) this.control({ share: m.share, mode: m.mode });
      if (m.share === false) this.close(); // Stop on the bar: nothing left to watch
    });
    ipcMain.on('pcview:ready', (e) => {
      if (!this._fromWin(e)) return;
      this.ready = true;
      for (const m of this.queue.splice(0)) this.win.webContents.send('pcview', m);
    });
  }

  get cfg() {
    return this.getSettings().receive;
  }

  get monitors() {
    return screen.getAllDisplays().filter((d) => d.id !== this.virtualDisplayId() && !d.label?.startsWith('TwinDesk Window '));
  }

  _display() {
    const monitors = this.monitors;
    return monitors.find((d) => d.id === this.cfg.displayId)
      || monitors.find((d) => d.id === screen.getPrimaryDisplay().id)
      || monitors[0] || screen.getPrimaryDisplay();
  }

  // Keep the existing policy in logical points. Video is fit to the fullscreen viewport.
  _policy() {
    const watching = this.isOpen && !this.win.isMinimized();
    const actual = watching && screen.getDisplayMatching(this.win.getBounds());
    const d = (actual && !this.cfg.fullScreen && this.monitors.find((m) => m.id === actual.id)) || this._display();
    const even = (v) => Math.round(v / 2) * 2;
    const m = { t: T.SCREEN_POLICY, accept: watching, width: even(d.size.width), height: even(d.size.height) };
    const key = JSON.stringify(m);
    if (this.server.current && key !== this.policyKey) {
      this.server.sendToClient(m);
      this.policyKey = key;
    }
  }

  _toggleFullScreen() {
    this.cfg.fullScreen = !this.cfg.fullScreen;
    this.saveSettings();
    this.applySettings();
    this.emit('change');
  }

  _placeFullScreen() {
    if (!this.isOpen || this.fullScreenTransition) return;
    const win = this.win;
    const display = this._display();
    if (win.isFullScreen()) {
      if (this.cfg.fullScreen && screen.getDisplayMatching(win.getBounds()).id === display.id) return;
      this.fullScreenTransition = true;
      win.setFullScreen(false);
    } else if (this.cfg.fullScreen) {
      const wa = display.workArea;
      const bounds = win.getBounds();
      if (screen.getDisplayMatching(bounds).id !== display.id) {
        const width = Math.min(bounds.width, wa.width);
        const height = Math.min(bounds.height, wa.height);
        win.setBounds({ width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2) });
      }
      this.fullScreenTransition = true;
      win.setFullScreen(true);
    }
  }

  // Start/stop the PC's sharing or switch its mode (it obeys when its "remote" setting allows).
  control({ share, mode }) {
    if (!this.server.current) return;
    const m = { t: T.SCREEN_CTL };
    if (typeof share === 'boolean') m.share = share;
    if (mode === 'extend' || mode === 'mirror') m.mode = mode;
    if (m.share === undefined && !m.mode) return;
    if (m.share === true && !(this.remote && this.remote.on)) this.startedByUs = true;
    if (m.share === true && !this.isOpen) {
      this._open();
      this._policy(); // send the selected monitor's size before Windows creates its display
    }
    if (m.share === true && m.mode === 'extend' && this.session === null) {
      this._toWin({ t: 'stop', why: 'Waiting for Extend. Check Share screen on the sending computer if no picture appears.' });
      if (this.remote) this._toWin({ t: 'remote', ...this.remote });
    }
    this.server.sendToClient(m);
    this.emit('change');
  }

  _onOffer(m) {
    // Only into an open window (an older app may offer before anyone opened it: ignored).
    if (!this.isOpen || this.win.isMinimized() || typeof m.sdp !== 'string' || !/^screen/.test(String(m.kind))) return;
    this._releaseInput();
    this.session = m.session;
    this.kind = m.kind;
    this.status = 'connecting';
    this.stats = null;
    this.sized = false;
    clearTimeout(this.closeTimer);
    this._toWin({ t: 'offer', session: m.session, sdp: m.sdp, audio: m.kind === 'screen+audio', volume: this.getSettings().audio.volume, input: !!this.cfg.input,
      pacing: this.getSettings().sharing.pace || 'fast', framegen: !!this.cfg.framegen });
    if (this.remote) this._toWin({ t: 'remote', ...this.remote });
    this.emit('change');
  }

  // Session over (the other side stopped or went away): the window stays (only the person closes
  // it) and says so; it fills in again when a new offer comes.
  _end(why, whyKey, whyVars, sendReleases = true) {
    if (sendReleases) this._releaseInput();
    else {
      this.keys?.release(false);
      this.buttons.clear();
    }
    this.session = null;
    this.status = why ? 'stopped' : 'off';
    this.stats = null;
    this._toWin({ t: 'stop', why: why || 'Waiting for the other computer…', whyKey: whyKey || (!why ? 'Waiting for the other computer…' : undefined), whyVars });
    this.emit('change');
  }

  get isOpen() {
    return !!(this.win && !this.win.isDestroyed());
  }

  // Close the window (Receive tab switch, menu bar): the same as the person closing it.
  close() {
    if (this.isOpen) this.win.close();
  }

  _i18n() {
    const settings = this.getSettings();
    return I18n.create(I18n.resolveLanguage(settings.ui && settings.ui.language, app.getLocale()));
  }

  _open() {
    if (this.isOpen) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      return;
    }
    const name = this.server.current && this.server.current.name;
    const pcName = name || this._i18n().t('PC');
    const wa = this._display().workArea;
    this.ready = false;
    this.queue = [];
    this.sized = false;
    this.closingByUs = false;
    const w = Math.round(wa.width * 0.8), h = Math.min(Math.round((w * 9) / 16), wa.height);
    this.win = new BrowserWindow({
      title: pcName,
      width: w,
      height: h,
      x: wa.x + Math.round((wa.width - w) / 2),
      y: wa.y + Math.round((wa.height - h) / 2),
      backgroundColor: '#000000',
      useContentSize: true,
      fullscreenable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload-pcview.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const win = this.win;
    win.webContents.on('console-message', (e) => e.level === 'error' && console.log(`[pcview] ${e.message}`));
    this.keys = attachKeys(win, {
      send: (m) => this.server.current && this.server.sendToClient(m),
      enabled: () => !!(this.cfg.input && this.session !== null && this.server.current && this.status === 'live'),
      // Ctrl-⌘-F: full screen here.
      local: (input) => {
        if (!(input.code === 'KeyF' && input.meta && input.control)) return false;
        if (input.type === 'keyDown' && !input.isAutoRepeat) this._toggleFullScreen();
        return true;
      },
    });
    this.fullScreenTransition = false;
    const fullScreenChanged = () => {
      if (!this.fullScreenTransition) {
        this.cfg.fullScreen = win.isFullScreen();
        if (this.cfg.fullScreen) this.cfg.displayId = screen.getDisplayMatching(win.getBounds()).id;
        this.saveSettings();
        this.emit('change');
      }
      this.fullScreenTransition = false;
      this._placeFullScreen();
      this._policy();
    };
    win.on('enter-full-screen', fullScreenChanged);
    win.on('leave-full-screen', fullScreenChanged);
    win.on('moved', () => this._policy());
    win.on('minimize', () => {
      this._releaseInput();
      this._policy();
    }); // paused: the PC stops capturing
    win.on('restore', () => this._policy());
    win.on('blur', () => {
      this._releaseInput();
      this._toWin({ t: 'blur' });
    });
    win.on('close', () => this._releaseInput());
    win.webContents.on('render-process-gone', () => {
      this._releaseInput();
      if (this.win === win && !win.isDestroyed()) win.close();
    });
    win.on('closed', () => {
      this.wantStart = false;
      if (this.win === win) this.win = null;
      this.ready = false;
      if (!this.closingByUs) {
        // Closed: stop watching, and stop the other side's sharing if we started it.
        this._policy();
        if (this.startedByUs) this.control({ share: false }); // we started it, so we stop it
        this.startedByUs = false;
        this.session = null;
        this.status = 'off';
        this.emit('change');
      }
    });
    this._placeFullScreen();
    win.loadFile(path.join(__dirname, 'pcview.html'), { query: { language: this._i18n().locale, title: pcName, titleKey: name ? '' : 'PC' } });
  }

  // First picture (or a new size): fit the window to the PC's aspect ratio, ≤ 80 % of the screen.
  _fit(vw, vh) {
    if (!this.win || this.win.isDestroyed() || !vw || !vh) return;
    this.win.setAspectRatio(vw / vh);
    if (this.sized || this.win.isFullScreen()) return;
    this.sized = true;
    const wa = screen.getDisplayMatching(this.win.getBounds()).workArea;
    const scale = Math.min((wa.width * 0.9) / vw, (wa.height * 0.9) / vh, 1);
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    this.win.setContentSize(w, h);
    this.win.setPosition(wa.x + Math.round((wa.width - w) / 2), wa.y + Math.round((wa.height - h) / 2));
  }

  _releaseInput() {
    if (this.keys) this.keys.release();
    if (this.server.current) {
      for (const down of this.buttons.values()) this.server.sendToClient({ ...down, t: T.IN_UP });
    }
    this.buttons.clear();
  }

  _fromWin(e) {
    return this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
  }

  _toWin(m) {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.ready) this.win.webContents.send('pcview', m);
    else this.queue.push(m);
  }

  // Is the PC window focused? (kvm.js doesn't cross the edge while it is.)
  get focused() {
    return !!(this.win && !this.win.isDestroyed() && this.win.isFocused());
  }

  // After the PC → Mac tab changed.
  applySettings() {
    this._placeFullScreen();
    this._policy();
    if (!this.cfg.input) this._releaseInput();
    this._toWin({ t: 'input', on: !!this.cfg.input });
    this._toWin({ t: 'volume', volume: this.getSettings().audio.volume });
    this._toWin({ t: 'pacing', pacing: this.getSettings().sharing.pace || 'fast', framegen: !!this.cfg.framegen });
  }

  // "Open the PC's screen" (PC → Mac tab): turn receiving on and open the window, also before the
  // PC shares — it then shows what to do on the PC and fills in when the offer comes.
  show() {
    const fresh = !this.isOpen;
    this._open();
    this._policy(); // watching: the other side may send now
    // Nothing shared yet: start it from here (no need to touch the PC) when it allows that.
    const r = this.remote;
    if (r && !r.on && r.remote) this.control({ share: true });
    else if (!r) this.wantStart = true; // an older PC app or state not here yet
    if (fresh && !this.session) {
      const pc = this.server.current ? this.server.current.name : 'the other computer';
      const why = !this.server.current ? 'Waiting for the other computer…'
        : r && !r.on && r.remote ? `Starting ${pc}’s screen…` : `Choose what to share in TwinDesk on ${pc}`;
      this._toWin({ t: 'stop', why });
      if (this.remote) this._toWin({ t: 'remote', ...this.remote });
    }
    this.win.focus();
    this.emit('change');
  }

  shutdown() {
    this._releaseInput();
    this.closingByUs = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }

  get view() {
    return { session: this.session, kind: this.kind, status: this.status, stats: this.stats, open: this.isOpen, remote: this.remote, monitors: this.monitors.map((d) => ({ id: d.id, label: d.label, primary: d.id === screen.getPrimaryDisplay().id })) };
  }
}

module.exports = { PcView };
