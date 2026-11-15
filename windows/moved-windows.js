'use strict';
const legacy = require('../shared/movewin');

async function moveOut(pc, wid, from) {
  if (!Number.isFinite(wid) || !wid || !pc.settings.pcApps.moveWindows || !pc.macAccepts
      || pc.moved.has(wid) || pc._mine(wid) || pc.link.current?.transport === 'ble') return false;
  const generation = pc.generation;
  const current = () => !pc.stopped && pc.generation === generation && pc.link.status.state === 'connected';
  let original;
  try {
    const r = await pc.helper.request('windows');
    original = r.windows?.find(w => w.wid === wid && !w.popup);
    if (!original) return false;
    const at = from && Number.isFinite(from.x) && Number.isFinite(from.y) ? from : original;
    const mon = await pc.desktop.ensure();
    if (!current() || !pc.macAccepts || !pc.settings.pcApps.moveWindows) return false;
    const m = { x: Math.round(at.x), y: Math.round(at.y), w: original.w, h: original.h, pid: original.pid,
      virtualX: mon.x + 24, virtualY: mon.y + 24 };
    // Register the return position in the helper before moving. No idle unpark timer.
    await pc.helper.request('winVirtualPlace', { wid, x: m.virtualX, y: m.virtualY, homeX: m.x, homeY: m.y });
    if (!current() || !pc.macAccepts || !pc.settings.pcApps.moveWindows) {
      pc.helper.send('winVirtualReturn', { wid, x: m.x, y: m.y });
      return false;
    }
    pc.moved.set(wid, m);
    pc.message = '';
    pc._poll(true);
    pc.onChange();
    return true;
  } catch (e) {
    pc.message = 'Moving window: ' + e.message;
    if (original) pc.helper.send('winVirtualReturn', { wid, x: from?.x ?? original.x, y: from?.y ?? original.y });
    pc.onChange();
    return false;
  }
}

function bringBack(pc, wid, home = false) {
  let changed = false;
  for (const [id, m] of [...pc.moved]) {
    if (wid !== undefined && id !== wid) continue;
    pc.moved.delete(id);
    let at = m;
    if (home) { const p = pc._cursorPx(); at = { x: Math.round(p.x - m.w / 2), y: Math.round(p.y - 12) }; }
    pc.helper.send('winVirtualReturn', { wid: id, x: at.x, y: at.y });
    changed = true;
  }
  if (changed) { if (!pc.stopped) pc._poll(true); pc.onChange(); }
}

function list(pc, all, taken, out, pops) {
  legacy.list(pc, all, taken, out, pops);
  // Applications may reposition themselves. Keep them on their dedicated desktop.
  const mon = pc.desktop?.mon;
  if (!mon) return;
  for (const [wid, m] of pc.moved) {
    const w = all.find(w => w.wid === wid);
    if (w && (w.x < mon.x || w.y < mon.y || w.x >= mon.x + mon.width || w.y >= mon.y + mon.height))
      pc.helper.send('winPlace', { wid, x: m.virtualX, y: m.virtualY });
  }
}
module.exports = { moveOut, bringBack, list };
