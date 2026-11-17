'use strict';
// Source-side bounded transaction. Transport and native work are injected so
// asynchronous capture startup cannot re-hide a window after cancellation.
const {randomUUID}=require('node:crypto');
const {UUID}=require('./wire');
const PREFIX='PORTAL_HANDOFF1 ',SESSION='PORTAL_SESSION1 ';
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function check(ok,why){if(!ok)throw Error(why);}
class SourceHandoff {
 constructor({send,start,context,layout,now=()=>performance.now(),onState=()=>{}}){Object.assign(this,{send,start,context,layout,now,onState});this.pending=null;this.sequence=0;this.epoch=0;}
 async begin(edge){
  check(!this.pending&&!this.recovering&&!this.starting,'A window already owns the source lease');
  check(edge.appId==='com.apple.finder'&&Number.isSafeInteger(edge.wid)&&edge.wid>0,'Invalid source window');
  check(['left','right','top','bottom'].includes(edge.side)&&[edge.offset,edge.anchor?.x,edge.anchor?.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1),'Invalid edge geometry');
  check(['mac','windows'].includes(edge.pointerOwner)&&integer(edge.sourceLayoutRevision),'Invalid source ownership');
  const p={edge,requestId:randomUUID(),sequence:++this.sequence,deadline:this.now()+5000,phase:'starting',service:null};this.pending=p;this.starting=true;this.onState(p.phase);
  try{
   const service=await this.start(edge);p.service=service;
   if(this.pending!==p){await service.stop();return;}
   this.valid(p);p.phase='opening';
   await this.send(SESSION+JSON.stringify({type:'open',requestId:p.requestId,sequence:p.sequence,ttlMs:Math.max(1,Math.floor(p.deadline-this.now())),...service.open,appId:'com.apple.finder',sourceLayoutRevision:edge.sourceLayoutRevision,pointerOwner:edge.pointerOwner}));
   if(this.pending===p)this.onState(p.phase);
  }catch(error){if(this.pending===p)await this.abort(error.message);}
  finally{this.starting=false;}
 }
 valid(p){check(this.pending===p&&this.now()<p.deadline,'Source handoff expired');check(this.layout()===p.edge.sourceLayoutRevision,'Physical layout changed');}
 async receive(text){
  const prefix=typeof text==='string'&&[PREFIX,SESSION].find(p=>text.startsWith(p));if(!prefix)return;
  check(text.length<=16000,'Oversized handoff');const m=JSON.parse(text.slice(prefix.length));const p=this.pending;if(!p)return;
  try{
   if(prefix===SESSION){
    if(m.requestId!==p.requestId)return;
    if(m.type==='failed'||m.type==='closed'){await this.abort('Receiver bootstrap ended');return;}
    check(m.type==='sessionReady'&&p.phase==='opening','Unexpected session response');this.valid(p);
    const c=this.context();
    check(c&&UUID.test(m.sessionId)&&m.sessionId===c.sessionId&&m.windowId===c.windowId&&m.geometryRevision===c.geometryRevision,'Receiver source identity differs');
    check(integer(m.frameSeq)&&m.frameSeq>0&&m.frameSeq<=c.acknowledgedFrameSeq,'Receiver has not acknowledged its frame');
    check(m.sourceLayoutRevision===p.edge.sourceLayoutRevision&&m.pointerOwner===p.edge.pointerOwner&&integer(m.destinationLayoutRevision)&&integer(m.ownershipEpoch),'Receiver ownership differs');
    check(typeof m.displayId==='string'||Number.isSafeInteger(m.displayId),'Invalid destination display');
    p.offer={type:'offer',id:randomUUID(),sessionId:m.sessionId,windowId:m.windowId,geometryRevision:m.geometryRevision,sequence:p.sequence,ttlMs:Math.max(1,Math.floor(p.deadline-this.now())),sourceLayoutRevision:p.edge.sourceLayoutRevision,destinationLayoutRevision:m.destinationLayoutRevision,displayId:m.displayId,entry:{edge:({left:'right',right:'left',top:'bottom',bottom:'top'})[p.edge.side],offset:p.edge.offset},anchor:p.edge.anchor,drag:{id:randomUUID(),button:0,held:true},pointerOwner:p.edge.pointerOwner,ownershipEpoch:m.ownershipEpoch};
    p.phase='offered';await this.send(PREFIX+JSON.stringify(p.offer));return;
   }
   const o=p.offer;if(!o||m.id!==o.id)return;
   if(m.type==='abort'){await this.abort('Receiver aborted handoff');return;}
   for(const key of ['sessionId','windowId','geometryRevision','sequence'])check(m[key]===o[key],'Mismatched handoff identity');
   check(m.dragId===o.drag.id,'Mismatched drag');
   if(m.type==='ready'){
    this.valid(p);check(p.phase==='offered'&&m.ownershipEpoch===o.ownershipEpoch,'Unexpected ready');
    const c=this.context();check(c&&c.geometryRevision===o.geometryRevision&&m.frameSeq>0&&m.frameSeq<=c.acknowledgedFrameSeq,'Stale ready frame');
    p.frameSeq=m.frameSeq;p.phase='committing';await this.send(PREFIX+JSON.stringify({...m,type:'commit'}));return;
   }
   if(m.type==='committed'){
    if(p.phase==='active')return;this.valid(p);
    check(p.phase==='committing'&&m.ownershipEpoch===o.ownershipEpoch+1&&m.frameSeq===p.frameSeq,'Commit acknowledgement differs');
    p.phase='active';this.epoch=m.ownershipEpoch;this.onState('active');return;
   }
   throw Error('Unexpected handoff response');
  }catch(error){await this.abort(error.message);}
 }
 async buttonUp(injected){
  const p=this.pending;if(!p||p.phase==='active')return;
  // KVM releases its injected Mac button when returning the real Windows mouse.
  // Windows must verify its actual held button before committing that ownership.
  if(p.edge.pointerOwner==='windows'&&injected)return;
  await this.abort('Source drag released before commit');
 }
 async tick(){const p=this.pending;if(!p)return;if(this.layout()!==p.edge.sourceLayoutRevision||(p.phase!=='active'&&this.now()>=p.deadline))await this.abort('Handoff deadline or topology changed');}
 async abort(reason){
  const p=this.pending;if(!p)return;this.pending=null;this.recovering=true;this.onState('recovering',reason);
  const recovery=p.service?.stop();
  Promise.resolve().then(()=>this.send(p.offer?PREFIX+JSON.stringify({...p.offer,type:'abort',reason}):SESSION+JSON.stringify({type:'cancel',requestId:p.requestId,sequence:p.sequence,reason}))).catch(()=>{});
  try{await recovery;}finally{this.recovering=false;}this.onState('idle',reason);
 }
}
module.exports={SourceHandoff,PREFIX,SESSION};
