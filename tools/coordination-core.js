'use strict';
const PREFIX = 'TDCOORD1 ';
function decode(text) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX) || text.length > 16000) return null;
  let m; try { m = JSON.parse(text.slice(PREFIX.length)); } catch { return null; }
  if (!['request','status','ack','receipt'].includes(m.kind) || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.id || '')
      || !['windows','mac'].includes(m.from) || typeof m.body !== 'string' || m.body.length > 8000) return null;
  if (['ack','receipt'].includes(m.kind) && !/^[a-zA-Z0-9_-]{1,80}$/.test(m.ref || '')) return null;
  return m;
}
function encode(m) { const text = PREFIX + JSON.stringify(m); if (!decode(text)) throw Error('Invalid coordination message'); return text; }

async function receive(state, row, { save, notify, receipt }) {
  const m = decode(row.text); if (!m) return;
  const key = row.direction + ':' + m.from + ':' + m.id;
  let record = state.messages[key];
  if (record) { if (row.direction === 'out') record.transport = row.status; return; }
  if (Object.keys(state.messages).length >= 5000) throw Error('Coordination inbox full; archive it explicitly before continuing');
  record = state.messages[key] = { ...m, direction: row.direction, at: row.at, transport: row.status, notification: 'none' };
  if (row.direction !== 'in') return;
  if (m.kind === 'ack' || m.kind === 'receipt') {
    for (const r of Object.values(state.messages)) if (r.direction === 'out' && r.id === m.ref) {
      if (m.kind === 'ack') r.acknowledged = true;
      else r.chatQueued = true;
    }
    await save(); return;
  }
  if (m.kind !== 'request') { await save(); return; }
  // Persist before notification: a crash/ambiguous timeout must never cause a
  // duplicate model wake. Manual recovery may inspect an uncertain record.
  record.notification = 'attempting'; await save();
  try {
    await notify(m);
    record.notification = 'chat-queued'; await save();
  } catch (error) {
    record.notification = 'uncertain';
    record.error = String(error.message).slice(0,300); await save(); return;
  }
  try { await receipt(m.id); record.receiptSent = true; }
  catch { record.receiptSent = false; }
  await save();
}
module.exports = {decode,encode,receive};
