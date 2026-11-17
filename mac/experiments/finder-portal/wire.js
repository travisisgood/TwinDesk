'use strict';
// Standalone v1 validation/state; never imports TwinDesk protocol code.
const { randomUUID } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const LIMIT = { control: 16384, metadata: 786432, frame: 12582912, png: 8388608, icon: 524288 };
function check(ok, why) { if (!ok) throw new Error(why); }
function object(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
function integer(n) { return Number.isSafeInteger(n) && n > 0; }
function string(s, limit) { return typeof s === 'string' && Buffer.byteLength(s) <= limit; }
function size(s) { return object(s) && integer(s.width) && integer(s.height) && s.width <= 4096 && s.height <= 4096 && s.width*s.height <= 8000000; }
function parse(data, binary = false) {
  check(!binary && Buffer.byteLength(data) <= LIMIT.frame, 'Invalid message size/type');
  const m = JSON.parse(data.toString());
  check(object(m) && m.v === 1 && typeof m.type === 'string', 'Invalid envelope');
  check(Buffer.byteLength(data) <= (m.type === 'frame' ? LIMIT.frame : m.type === 'window' ? LIMIT.metadata : LIMIT.control), 'Envelope too large');
  return m;
}
function png(encoded, icon = false) {
  check(typeof encoded === 'string' && encoded.length <= Math.ceil((icon ? LIMIT.icon : LIMIT.png)/3)*4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), 'Invalid PNG encoding');
  const data = Buffer.from(encoded, 'base64');
  check(data.length >= 33 && data.length <= (icon ? LIMIT.icon : LIMIT.png) && data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && data.readUInt32BE(8) === 13 && data.toString('ascii',12,16) === 'IHDR', 'Invalid PNG header');
  const dimensions = {width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
  check(size(dimensions) && (!icon || (dimensions.width <= 512 && dimensions.height <= 512)), 'Invalid PNG dimensions');
  return {data, ...dimensions}; // Native receiver must additionally validate decoder output.
}
function metadata(m) {
  check(UUID.test(m.windowId) && integer(m.geometryRevision) && string(m.appId,512) && m.appId.length > 0 && string(m.title,4096), 'Invalid window identity');
  check(size(m.logicalSize) && size(m.pixelSize) && Array.isArray(m.capabilities) && m.capabilities.length <= 16 && m.capabilities.every(c=>string(c,64)), 'Invalid window geometry/capabilities');
  if (m.iconPng !== null) png(m.iconPng,true);
}
function frame(m, window) {
  check(m.windowId === window.windowId && m.geometryRevision === window.geometryRevision && integer(m.seq), 'Invalid frame identity');
  check(size(m.pixelSize) && m.pixelSize.width === window.pixelSize.width && m.pixelSize.height === window.pixelSize.height, 'Frame geometry differs from metadata');
  const r = m.contentRect;
  check(object(r) && [r.x,r.y,r.width,r.height].every(Number.isFinite) && r.x>=0 && r.y>=0 && r.width>0 && r.height>0 && r.x+r.width<=m.pixelSize.width && r.y+r.height<=m.pixelSize.height, 'Invalid content rectangle');
  check(['stream','snapshot'].includes(m.captureMode), 'Invalid capture mode');
  const p = png(m.png);
  check(p.width === m.pixelSize.width && p.height === m.pixelSize.height, 'PNG size differs from frame');
  return p;
}
class SourceState {
  constructor(commit, window) {
    check(SHA.test(commit),'Invalid build commit'); metadata(window);
    this.id = randomUUID(); this.window = window; this.commit = commit;
    this.frameSeq=0; this.inputSeq=0; this.outstanding=null; this.revisionFirstFrame=1;
  }
  updateGeometry(meta) {
    check(!this.outstanding,'Geometry change requires frame ACK');
    const next={...meta,windowId:this.window.windowId,geometryRevision:this.window.geometryRevision+1};
    metadata(next);this.window=next;this.revisionFirstFrame=this.frameSeq+1;
    return this.envelope('window',next);
  }
  envelope(type, fields={}) { return {v:1,type,sessionId:this.id,...fields}; }
  welcome() { return this.envelope('welcome',{sourceCommit:this.commit,heartbeatMs:2000,disconnectMs:6000}); }
  nextFrame(payload, now=Date.now()) {
    if (this.outstanding) return null;
    const m=this.envelope('frame',{...payload,windowId:this.window.windowId,geometryRevision:this.window.geometryRevision,seq:this.frameSeq+1});
    frame(m,this.window); check(Buffer.byteLength(JSON.stringify(m))<=LIMIT.frame,'Encoded frame too large');
    this.frameSeq=m.seq; this.outstanding={seq:m.seq,at:now}; return m;
  }
  accept(m) {
    check(m.v===1 && m.sessionId===this.id,'Wrong session');
    if (m.type==='ping'||m.type==='pong') { check(Number.isSafeInteger(m.nonce)&&m.nonce>=0,'Invalid nonce'); return {kind:m.type}; }
    if (m.type==='close') { check(string(m.reason,1024),'Invalid reason'); return {kind:'close'}; }
    check(m.windowId===this.window.windowId,'Wrong window');
    if (m.type==='frameAck') {
      check(this.outstanding && m.seq===this.outstanding.seq,'Unexpected frame ACK'); this.outstanding=null; return {kind:'ack'};
    }
    check(m.type==='input'&&integer(m.seq)&&m.seq>this.inputSeq,'Invalid input sequence/type');
    check(integer(m.frameSeq)&&m.frameSeq<=this.frameSeq,'Unknown frame');
    check(integer(m.geometryRevision)&&typeof m.op==='string'&&object(m.args),'Malformed input');
    if(m.op==='pressAt') check([m.args.x,m.args.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1),'Invalid click');
    if(m.op==='setSearchText') check(string(m.args.text,4096),'Invalid search text');
    if(m.op==='confirmSearch') check(Object.keys(m.args).length===0,'Invalid confirmation');
    if(m.op==='resize') check(size(m.args.logicalSize)&&Number.isFinite(m.args.pixelScale)&&m.args.pixelScale>=1&&m.args.pixelScale<=3,'Invalid resize');
    this.inputSeq=m.seq;
    if(m.geometryRevision!==this.window.geometryRevision) return {kind:'result',status:'rejected',detail:'Stale geometry'};
    if(m.frameSeq<this.revisionFirstFrame) return {kind:'result',status:'rejected',detail:'Frame belongs to previous geometry'};
    if(!this.window.capabilities.includes(m.op)) return {kind:'result',status:'unsupported',detail:'Capability not advertised'};
    if(m.op==='resize'&&!size({width:Math.ceil(m.args.logicalSize.width*m.args.pixelScale),height:Math.ceil(m.args.logicalSize.height*m.args.pixelScale)}))return {kind:'result',status:'rejected',detail:'Requested capture exceeds bounds'};
    return {kind:'input'};
  }
}
module.exports={UUID,SHA,LIMIT,check,parse,png,metadata,frame,SourceState};
