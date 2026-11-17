'use strict';
const {EventEmitter}=require('node:events');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const own=(v)=>v&&typeof v==='object'&&!Array.isArray(v);
function check(ok,message){if(!ok)throw Error(message)}
function integer(n,min=1,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(n)&&n>=min&&n<=max}
function str(s,max){return typeof s==='string'&&Buffer.byteLength(s,'utf8')<=max}
function size(s){check(own(s)&&integer(s.width,1,4096)&&integer(s.height,1,4096)&&s.width*s.height<=8000000,'Invalid image size')}
function png(encoded,icon=false){
 check(typeof encoded==='string'&&encoded.length<=(icon?512*1024:8*1024*1024)*4/3+4&&encoded.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'Invalid PNG encoding');
 const bytes=Buffer.from(encoded,'base64');
 check(bytes.length<=(icon?512*1024:8*1024*1024)&&bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR','Invalid PNG header');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);size({width,height});
 if(icon)check(width<=512&&height<=512,'Icon too large');
 return {bytes,width,height};
}
class ReceiverProtocol extends EventEmitter {
 constructor(send){super();this.send=send;this.session=null;this.window=null;this.lastFrame=0;this.displayed=0;this.inputSeq=0;this.pending=null;this.inputs=new Set();this.closed=false;}
 envelope(type,fields={}){return {v:1,type,sessionId:this.session,...fields}}
 receive(raw){
  check(!this.closed,'Session closed');check(Buffer.byteLength(raw)<=12*1024*1024,'Message too large');
  const m=JSON.parse(raw);check(own(m)&&m.v===1&&typeof m.type==='string','Invalid envelope');
  const limit=m.type==='frame'?12*1024*1024:m.type==='window'?768*1024:16*1024;
  check(Buffer.byteLength(raw)<=limit,'Envelope exceeds limit');
  if(!this.session){
   check(m.type==='welcome'&&UUID.test(m.sessionId||'')&&/^[a-f0-9]{40}$/i.test(m.sourceCommit||'')&&m.heartbeatMs===2000&&m.disconnectMs===6000,'Invalid welcome');
   this.session=m.sessionId;this.emit('welcome',m);return;
  }
  check(m.sessionId===this.session,'Wrong session');
  if(m.type==='ping'){check(integer(m.nonce,0),'Invalid ping');this.send(this.envelope('pong',{nonce:m.nonce}));return;}
  if(m.type==='pong'){check(integer(m.nonce,0),'Invalid pong');return;}
  if(m.type==='close'){check(str(m.reason,1024),'Invalid close');this.closed=true;this.emit('closed',m.reason);return;}
  if(m.type==='window'){
   check(UUID.test(m.windowId||'')&&integer(m.geometryRevision)&&str(m.title,4096)&&str(m.appId,512),'Invalid window');
   check(own(m.logicalSize)&&Number.isFinite(m.logicalSize.width)&&Number.isFinite(m.logicalSize.height)&&m.logicalSize.width>0&&m.logicalSize.height>0&&m.logicalSize.width<=100000&&m.logicalSize.height<=100000,'Invalid logical size');size(m.pixelSize);
   check(Array.isArray(m.capabilities)&&m.capabilities.length<=32&&m.capabilities.every(c=>str(c,128)),'Invalid capabilities');
   check(!m.capabilities.some(c=>['pointer','key'].includes(c))||m.capabilities.includes('releaseAll'),'Stateful input requires releaseAll');
   if(m.dragRegions!==undefined){
    check(m.capabilities.includes('sourceDragRegions')&&Array.isArray(m.dragRegions)&&m.dragRegions.length<=32,'Invalid drag regions');
    for(const [i,r] of m.dragRegions.entries()){
     check(own(r)&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=m.logicalSize.width&&r.y+r.height<=m.logicalSize.height,'Invalid drag region bounds');
     check(!m.dragRegions.slice(0,i).some(a=>r.x<a.x+a.width&&r.x+r.width>a.x&&r.y<a.y+a.height&&r.y+r.height>a.y),'Overlapping drag regions');
    }
   }
   if(m.iconPng!==null)png(m.iconPng,true);
   if(this.window)check(m.windowId===this.window.windowId&&m.geometryRevision===this.window.geometryRevision+1&&!this.pending,'Invalid geometry transition');
   else check(m.geometryRevision===1,'Initial geometry must be revision 1');
   this.window=m;this.displayed=0;this.emit('window',m);return;
  }
  check(this.window&&m.windowId===this.window.windowId,'Unknown window');
  if(m.type==='frame'){
   check(!this.pending&&integer(m.seq)&&m.seq>this.lastFrame,'Replayed or overlapping frame');
   check(m.geometryRevision===this.window.geometryRevision,'Frame geometry mismatch');size(m.pixelSize);
   check(m.pixelSize.width===this.window.pixelSize.width&&m.pixelSize.height===this.window.pixelSize.height,'Frame metadata mismatch');
   check(['stream','snapshot'].includes(m.captureMode),'Invalid capture mode');
   const r=m.contentRect;check(own(r)&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=m.pixelSize.width&&r.y+r.height<=m.pixelSize.height,'Invalid content rectangle');
   const decoded=png(m.png);check(decoded.width===m.pixelSize.width&&decoded.height===m.pixelSize.height,'PNG dimensions mismatch');
   this.pending=m;this.lastFrame=m.seq;this.emit('frame',m,decoded.bytes);return;
  }
  if(m.type==='inputResult'){
   check(this.inputs.has(m.seq)&&['dispatched','verified','unsupported','rejected','failed'].includes(m.status)&&str(m.detail,1024),'Unexpected input result');
   this.inputs.delete(m.seq);
   if(this.releaseSeq===m.seq)this.releaseSeq=null;
   if(this.resizePending?.seq===m.seq){
    if(['unsupported','rejected','failed'].includes(m.status))this.resizePending=null;
    else {this.resizePending.result=true;if(this.resizePending.displayed)this.resizePending=null;}
   }
   this.emit('inputResult',m);return;
  }
  throw Error('Unknown message type');
 }
 displayedFrame(seq){
  check(this.pending&&this.pending.seq===seq,'Unexpected display acknowledgment');
  this.displayed=seq;this.contentRect=this.pending.contentRect;this.pending=null;
  this.send(this.envelope('frameAck',{windowId:this.window.windowId,seq}));
  if(this.resizePending&&this.window.geometryRevision>this.resizePending.revision){this.resizePending.displayed=true;if(this.resizePending.result)this.resizePending=null;}
 }
 input(op,args){
  const release=op==='releaseAll';
  check(!this.closed&&this.window&&(release||this.displayed)&&this.window.capabilities.includes(op),'Input unavailable');
  check(release||!this.resizePending,'Resize transition in progress');
  check(release?!this.releaseSeq:this.inputs.size<16,'Input queue full');
  if(op==='pressAt')check(own(args)&&[args.x,args.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1),'Invalid coordinates');
  else if(op==='pointer')check(own(args)&&['move','down','up'].includes(args.phase)&&integer(args.button,0,2)&&[args.x,args.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1),'Invalid pointer');
  else if(op==='wheel')check(own(args)&&[args.x,args.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&[args.deltaX,args.deltaY].every(n=>Number.isFinite(n)&&Math.abs(n)<=4096),'Invalid wheel');
  else if(op==='key')check(own(args)&&['down','up'].includes(args.phase)&&integer(args.usage,4,231),'Invalid key');
  else if(op==='text')check(own(args)&&str(args.text,4096),'Invalid committed text');
  else if(release)check(own(args)&&Object.keys(args).length===0,'Invalid releaseAll');
  else if(op==='resize')check(own(args)&&own(args.logicalSize)&&integer(args.logicalSize.width,1,4096)&&integer(args.logicalSize.height,1,4096)&&Number.isFinite(args.pixelScale)&&args.pixelScale>=1&&args.pixelScale<=3&&Math.ceil(args.logicalSize.width*args.pixelScale)<=4096&&Math.ceil(args.logicalSize.height*args.pixelScale)<=4096&&Math.ceil(args.logicalSize.width*args.pixelScale)*Math.ceil(args.logicalSize.height*args.pixelScale)<=8000000,'Invalid resize');
  else if(op==='setSearchText')check(own(args)&&str(args.text,4096),'Invalid search text');
  else check(op==='confirmSearch'&&own(args)&&Object.keys(args).length===0,'Unsupported operation');
  const seq=++this.inputSeq;this.inputs.add(seq);
  if(release)this.releaseSeq=seq;
  if(op==='resize')this.resizePending={seq,revision:this.window.geometryRevision,result:false,displayed:false};
  this.send(this.envelope('input',{windowId:this.window.windowId,geometryRevision:this.window.geometryRevision,seq,frameSeq:this.displayed,op,args}));return seq;
 }
}
module.exports={ReceiverProtocol,png,check};
