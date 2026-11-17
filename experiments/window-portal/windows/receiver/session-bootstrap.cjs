'use strict';
const PREFIX='PORTAL_SESSION1 ';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const positive=n=>Number.isSafeInteger(n)&&n>0;
function check(ok,reason){if(!ok)throw Error(reason);}
function stop(p){if(!p)return;p.abort.abort();if(p.receiver&&!p.closed){p.closed=true;p.receiver.close();}}
function ownership(m,c){return ['mac','windows'].includes(m.pointerOwner)&&c.pointerOwner===m.pointerOwner&&c.pointerHeld===true&&c.pointerVerified===true&&Number.isSafeInteger(c.ownershipEpoch)&&c.ownershipEpoch>=0;}
function unchanged(p,c){return c.peerReady&&c.optedIn&&c.peerInstance===p.before.peerInstance&&c.destinationLayoutRevision===p.before.destinationLayoutRevision&&c.displayId===p.before.displayId&&ownership(p.offer,c)&&c.ownershipEpoch===p.before.ownershipEpoch;}
// One instance per authenticated TwinDesk peer/connection. Caller supplies the
// locally opted-in launcher; peer text can never supply executable or argv.
class SessionBootstrap {
 constructor({launch,context,now=()=>performance.now()}){this.launch=launch;this.context=context;this.now=now;this.highestSequence=0;this.requests=new Set();this.pending=null;}
 async receive(row){
  if(row.direction!=='in'||typeof row.text!=='string'||!row.text.startsWith(PREFIX))return null;
  check(row.text.length<=16000,'Oversize bootstrap');
  const m=JSON.parse(row.text.slice(PREFIX.length)),before=this.context();
  check(before.peerReady===true&&before.optedIn===true,'Bootstrap not enabled for paired peer');
  if(m.type==='cancel'){
   check(UUID.test(m.requestId||'')&&positive(m.sequence)&&typeof m.reason==='string'&&m.reason.length<=256,'Invalid cancellation');
   const p=this.pending;
   // sequence refers to the original open, not an unrelated later message.
   if(p&&p.requestId===m.requestId&&p.offer.sequence===m.sequence&&p.before.peerInstance===before.peerInstance){this.pending=null;stop(p);}
   return null;
  }
  check(m.type==='open'&&UUID.test(m.requestId||'')&&!this.requests.has(m.requestId),'Invalid or duplicate open');
  check(positive(m.sequence)&&m.sequence>this.highestSequence,'Replayed open');
  check(!this.pending,'Receiver bootstrap already pending');
  check(m.appId==='com.apple.finder'&&/^[a-f0-9]{40}$/.test(m.sourceCommit||''),'Unsupported source');
  check(positive(m.ttlMs)&&m.ttlMs<=5000&&positive(m.sourceLayoutRevision)&&ownership(m,before),'Invalid or unverified bootstrap ownership');
  check(m.encryptedPairing&&typeof m.encryptedPairing==='object'&&!Array.isArray(m.encryptedPairing),'Missing encrypted pairing');
  check(positive(before.destinationLayoutRevision)&&typeof before.displayId==='string'&&before.peerInstance,'Missing local layout');
  // Burn replay IDs before any side effect, even when authentication fails.
  this.highestSequence=m.sequence;this.requests.add(m.requestId);
  if(this.requests.size>256)this.requests.delete(this.requests.values().next().value);
  const abort=new AbortController(),p={requestId:m.requestId,offer:{...m},deadline:this.now()+m.ttlMs,abort,before:{...before}};this.pending=p;
  const timer=setTimeout(()=>abort.abort(),m.ttlMs);
  let receiver;
  try {
   const expired=new Promise((_,reject)=>{if(abort.signal.aborted)reject(Error('Bootstrap expired'));else abort.signal.addEventListener('abort',()=>reject(Error('Bootstrap expired')),{once:true});});
   const launching=Promise.resolve(this.launch({requestId:m.requestId,sourceCommit:m.sourceCommit,encryptedPairing:m.encryptedPairing,ttlMs:m.ttlMs,signal:abort.signal})).then(child=>{p.receiver=child;if(abort.signal.aborted){stop(p);throw Error('Bootstrap expired');}return child;});
   receiver=await Promise.race([launching,expired]);
   check(receiver&&typeof receiver.close==='function','Invalid local receiver');
   const proof=await Promise.race([receiver.ready,expired]);
   const after=this.context();
   check(!abort.signal.aborted&&this.now()<p.deadline&&this.pending===p,'Bootstrap expired');
   check(unchanged(p,after),'Peer, destination or pointer ownership changed');
   check(proof.sourceCommit===m.sourceCommit&&UUID.test(proof.sessionId||'')&&UUID.test(proof.windowId||'')&&positive(proof.geometryRevision)&&positive(proof.frameSeq)&&proof.hidden===true,'Missing authenticated hidden decoded-frame proof');
   p.receiver=receiver;p.ready=true;
   return PREFIX+JSON.stringify({type:'sessionReady',requestId:m.requestId,sessionId:proof.sessionId,windowId:proof.windowId,geometryRevision:proof.geometryRevision,frameSeq:proof.frameSeq,displayId:p.before.displayId,destinationLayoutRevision:p.before.destinationLayoutRevision,ownershipEpoch:p.before.ownershipEpoch,sourceLayoutRevision:m.sourceLayoutRevision,pointerOwner:m.pointerOwner});
  }catch(error){stop(p);if(this.pending===p)this.pending=null;throw error;}
  finally{clearTimeout(timer);}
 }
 // Remains hidden after sessionReady. Only an ownership-aware handoff adapter
 // may adopt it; expiry/transport loss closes it so the source recovers home.
 take(requestId){const p=this.pending;check(p?.requestId===requestId&&p.ready===true&&p.receiver&&this.now()<p.deadline,'Bootstrap not ready');if(!unchanged(p,this.context())){this.disconnect();throw Error('Pointer or destination changed before handoff');}this.pending=null;return p.receiver;}
 expire(){if(this.pending&&this.now()>=this.pending.deadline)this.disconnect();}
 disconnect(){const p=this.pending;this.pending=null;stop(p);}
}
module.exports={SessionBootstrap,PREFIX};
