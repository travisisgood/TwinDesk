'use strict';
// Local receiver handoff primitive. Not a wire extension or a KVM hook.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const finite=n=>Number.isFinite(n),unit=n=>finite(n)&&n>=0&&n<=1;
function check(ok,message){if(!ok)throw Error(message);}
function placement(display,size,entry,anchor){
 check(display&&[display.x,display.y,display.width,display.height].every(finite)&&display.width>2&&display.height>2,'Invalid destination display');
 check(size&&[size.width,size.height].every(n=>finite(n)&&n>0&&n<=4096),'Invalid source size');
 check(entry&&['left','right','top','bottom'].includes(entry.edge)&&unit(entry.offset)&&anchor&&unit(anchor.x)&&unit(anchor.y),'Invalid entry or grab anchor');
 const vertical=['left','right'].includes(entry.edge);
 const pointer={x:vertical?display.x+(entry.edge==='left'?1:display.width-1):display.x+entry.offset*(display.width-2)+1,y:vertical?display.y+entry.offset*(display.height-2)+1:display.y+(entry.edge==='top'?1:display.height-1)};
 // Partial off-screen placement at a shared edge is intentional: preserve the
 // user's original grab point rather than jump the entire window into view.
 return {pointer,bounds:{x:Math.round(pointer.x-anchor.x*size.width),y:Math.round(pointer.y-anchor.y*size.height),width:Math.round(size.width),height:Math.round(size.height)}};
}
class HandoffState {
 constructor(now=()=>performance.now()){this.now=now;this.pending=null;this.finished=new Set();this.sessionId=null;this.highestSequence=0;}
 prepare(offer,context){
  check(!this.pending,'Handoff already pending');
  check(offer&&UUID.test(offer.id||'')&&!this.finished.has(offer.id),'Invalid or repeated handoff');
  check(Number.isSafeInteger(offer.sequence)&&offer.sequence>this.highestSequence,'Replayed handoff sequence');
  check(!this.sessionId||this.sessionId===context.sessionId,'Wrong authenticated session');
  check(offer.sessionId===context.sessionId&&offer.windowId===context.windowId&&offer.geometryRevision===context.geometryRevision,'Stale or wrong source geometry');
  check(context.pointerHeld===true,'Drag button no longer held');
  check(Number.isInteger(offer.ttlMs)&&offer.ttlMs>0&&offer.ttlMs<=5000,'Invalid handoff TTL');
  for(const key of ['sourceLayoutRevision','destinationLayoutRevision','ownershipEpoch'])check(Number.isSafeInteger(offer[key])&&offer[key]>=0&&offer[key]===context[key],'Stale layout or ownership');
  check(typeof offer.pointerOwner==='string'&&offer.pointerOwner===context.pointerOwner,'Wrong pointer owner');
  check(offer.displayId===context.display.id,'Destination display not authorized');
  const result=placement(context.display,context.logicalSize,offer.entry,offer.anchor);
  this.sessionId=context.sessionId;this.highestSequence=offer.sequence;
  this.pending={id:offer.id,offer:JSON.parse(JSON.stringify(offer)),deadline:this.now()+offer.ttlMs,layout:JSON.stringify(context.display),before:{...context.bounds},result};
  return result;
 }
 commit(id,context){
  const p=this.pending;check(p&&p.id===id,'Unknown handoff');
  if(context.sessionId!==p.offer.sessionId||context.windowId!==p.offer.windowId||this.now()>=p.deadline||!context.pointerHeld||JSON.stringify(context.display)!==p.layout||context.geometryRevision!==p.offer.geometryRevision||['sourceLayoutRevision','destinationLayoutRevision','ownershipEpoch','pointerOwner'].some(k=>context[k]!==p.offer[k])){this.abort(id);throw Error('Handoff expired or context changed');}
  check(context.firstFrameDisplayed===true,'Destination frame not displayed');
  this.finish(id);return p.result;
 }
 abort(id){const p=this.pending;if(!p||p.id!==id)return null;this.finish(id);return p.before;}
 expire(){return this.pending&&this.now()>=this.pending.deadline?this.abort(this.pending.id):null;}
 finish(id){this.pending=null;this.finished.add(id);if(this.finished.size>128)this.finished.delete(this.finished.values().next().value);}
}
module.exports={placement,HandoffState};
