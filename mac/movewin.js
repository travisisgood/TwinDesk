// TwinDesk — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Transfers one source window through the existing per-window stream.
'use strict';

const { T } = require('../shared/protocol');
const MAX_POPUPS = 6;

async function moveOut(as, wid, pid) {
  const peer = as.server.current;
  if (!wid || !pid || !as.getSettings().apps.moveWindows || !as.accepts || !peer || peer.transport === 'ble') return false;
  if (as.moved.has(wid) || as._mine(wid)) return false;
  const pending = { pid, app: null };
  as.moved.set(wid, pending);
  try {
    const parked = await as.helper.request('appPark', { wid, pid });
    if (as.moved.get(wid) !== pending) return false;
    if (as.server.current !== peer || !as.accepts || !as.getSettings().apps.moveWindows || !parked.app?.id) {
      bringBack(as, wid);
      return false;
    }
    pending.app = parked.app;
    pending.displayId = parked.displayId;
    console.log(`[appsend] parked ${parked.app.id} window ${wid} on display ${parked.displayId}`);
    as.server.sendToClient({ t: T.APPS_RESULT, apps: as.movedCatalog() });
    as._poll();
    as.emit('change');
    return true;
  } catch (error) {
    if (as.moved.get(wid) === pending) bringBack(as, wid);
    console.log(`[appsend] transfer ${wid}: ${error.message}`);
    return false;
  }
}

function bringBack(as, wid, home = false) {
  let changed = false;
  for (const id of as.moved.keys()) {
    if (wid !== undefined && wid !== id) continue;
    as.moved.delete(id);
    as.helper.send('appUnpark', { wid: id, home });
    changed = true;
  }
  if (!changed) return;
  as.helper.send('releaseAll');
  // Stop accepting input and stop the proxy immediately. New polling may still describe other windows.
  const list = as.windows.filter((w) => w.moved ? as.moved.has(w.wid) : !w.popup || as.moved.has(w.owner) || !as.windows.some((owner) => owner.moved && owner.wid === w.owner));
  as._sync(list);
  as.emit('change');
}

function list(as, all, out, pops) {
  for (const [wid, m] of as.moved) {
    if (!m.app) continue; // only advertise after the helper verified placement
    const w = all.find((x) => x.wid === wid && !x.popup);
    const display = as.parkingDisplay(m.displayId);
    if (!w || !display || !inside(w, display.bounds)) {
      // AX can confirm the move before CGWindowList and Electron agree on the
      // new coordinates. Suppress capture until they agree; allow them to settle.
      m.missingSince ||= Date.now();
      if (Date.now() - m.missingSince > 1200) {
        const reason = !display ? 'backing display unavailable' : !w ? 'window unavailable'
          : 'window remained outside its backing display';
        console.log(`[appsend] returning window ${wid}: ${reason}`);
        as.bringBack(wid);
      }
      continue;
    }
    m.missingSince = 0;
    const entry = as._entry(w, m.app.id);
    out.push({
      ...entry, moved: true,
      maxW: Math.floor((display.bounds.x + display.bounds.width - w.x) * entry.scale),
      maxH: Math.floor((display.bounds.y + display.bounds.height - w.y) * entry.scale),
    });
    const popups = all.filter((p) => p.popup && p.pid === m.pid && inside(p, display.bounds)).slice(0, MAX_POPUPS);
    for (const p of popups) {
      const pe = as._entry(p, m.app.id);
      pops.push({ ...pe, popup: true, owner: wid, x: Math.round((p.x - w.x) * pe.scale), y: Math.round((p.y - w.y) * pe.scale) });
    }
  }
}

function inside(w, bounds) {
  return w.x >= bounds.x && w.y >= bounds.y && w.x + w.w <= bounds.x + bounds.width && w.y + w.h <= bounds.y + bounds.height;
}

module.exports = { moveOut, bringBack, list };
