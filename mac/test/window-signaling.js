// TwinDesk — Copyright (C) 2026. GPL-3.0, see LICENSE.
'use strict';

const { strict: assert } = require('assert');
const { EventEmitter } = require('events');
const { readFileSync } = require('fs');
const Module = require('module');
const path = require('path');
const { test } = require('node:test');
const vm = require('vm');
const { T } = require('../../shared/protocol');

test('Mac window sender publishes its offer before early local ICE', async () => {
  const sent = [];
  let receive;
  const candidate = { toJSON: () => ({ candidate: 'early' }) };
  const track = { stop() {} };
  const sender = {
    getParameters: () => ({ encodings: [{}] }),
    setParameters: async () => {},
  };
  class PeerConnection {
    addTransceiver() { return { sender, setCodecPreferences() {} }; }
    async createOffer() { return { sdp: '' }; }
    async setLocalDescription(description) {
      this.localDescription = description;
      this.onicecandidate({ candidate });
    }
  }
  vm.runInNewContext(readFileSync(path.join(__dirname, '../appsend-renderer.js'), 'utf8'), {
    window: {
      MacShareProtocol: { T },
      appsend: { on: (fn) => { receive = fn; }, ready() {}, state() {}, send: (m) => sent.push(m) },
      TwinDeskScreenCodec: { order: () => [] },
    },
    navigator: { mediaDevices: { getUserMedia: async () => ({
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
    }) } },
    RTCPeerConnection: PeerConnection,
    RTCRtpSender: { getCapabilities: () => ({ codecs: [] }) },
    setInterval() {},
  });
  receive({ t: 'start', session: 7, offer: { kind: 'window', wid: 18 }, mbps: 4 });
  await new Promise(setImmediate);
  assert.deepEqual(sent.map((m) => m.t), [T.RTC2_OFFER, T.RTC2_ICE]);
  assert.ok(sent.every((m) => m.session === 7));
});

test('Mac window viewer queues only window ICE, then delivers it after the matching offer', () => {
  const ipcMain = new EventEmitter();
  const originalLoad = Module._load;
  let PcApps;
  try {
    Module._load = function (name) {
      if (name === 'electron') return { ipcMain };
      if (name === './dockstub') return {};
      return originalLoad.apply(this, arguments);
    };
    ({ PcApps } = require('../pcapps'));
  } finally {
    Module._load = originalLoad;
  }
  const server = new EventEmitter();
  server.sendToClient = () => {};
  const viewer = new PcApps({ server, getSettings: () => ({ papps: { on: true } }) });
  const w = { info: { wid: 18 }, win: { isDestroyed: () => false }, session: null, queue: [] };
  viewer.wins.set(18, w);
  const ice = (win, session) => ({ t: T.RTC2_ICE, win, session, candidate: { candidate: 'early' } });
  server.emit(`t:${T.RTC2_ICE}`, ice('view', 7));
  server.emit(`t:${T.RTC2_ICE}`, ice(undefined, 7));
  server.emit(`t:${T.RTC2_ICE}`, ice('send', 7));
  server.emit(`t:${T.RTC2_ICE}`, ice('send', 8));
  server.emit(`t:${T.RTC2_STOP}`, { win: 'send', session: 8 });
  server.emit(`t:${T.RTC2_OFFER}`, { kind: 'window', win: 'send', wid: 18, session: 7, sdp: 'offer' });
  assert.deepEqual(w.queue.map((m) => m.t), ['offer', T.RTC2_ICE]);
  assert.equal(viewer.earlyIce.size, 0);
});
