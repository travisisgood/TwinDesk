'use strict';
const PREFIX='PORTAL_SESSION1 ';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const positive=n=>Number.isSafeInteger(n)&&n>0;
function check(ok,reason){if(!ok)throw Error(reason);}
// One instance per authenticated TwinDesk peer/connection. Caller supplies the
// locally opted-in launcher; peer text can never supply executable or argv.
class SessionBootstrap {
 constructor({launch,context,now=()=>performance.now()}){this.launch=launch;this.context=context;this.now=now;this.highestSequence=0;this.requests=new Set();this.pending=null;}
 async receive(row){
  if(row.direction!=='in'||typeof row.text!=='string'||!row.text.startsWith(PREFIX))return null;
  check(row.text.length<=16000,'Oversize bootstrap');
  const m=JSON.parse(row.text.slice(PREFIX.length)),before=this.context();
  check(before.peerReady===true&&before.optedIn===true,'Bootstrap not enabled for paired peer');
  check(m.type==='open'&&UUID.test(m.requestId||'')&&!this.requests.has(m.requestId),'Invalid or duplicate open');
  check(positive(m.sequence)&&m.sequence>this.highestSequence,'Replayed open');
  check(!this.pending,'Receiver bootstrap already pending');
  check(m.appId==='com.apple.finder'&&/^[a-f0-9]{40}$/.test(m.sourceCommit||''),'Unsupported source');
  check(positive(m.ttlMs)&&m.ttlMs<=5000&&positive(m.sourceLayoutRevision)&&m.pointerOwner==='mac','Invalid bootstrap ownership');
  check(m.encryptedPairing&&typeof m.encryptedPairing==='object'&&!Array.isArray(m.encryptedPairing),'Missing encrypted pairing');
  check(positive(before.destinationLayoutRevision)&&typeof before.displayId==='string'&&before.peerInstance,'Missing local layout');
  // Burn replay IDs before any side effect, even when authentication fails.
  this.highestSequence=m.sequence;this.requests.add(m.requestId);
  if(this.requests.size>256)this.requests.delete(this.requests.values().next().value);
  const abort=new AbortController(),p={requestId:m.requestId,deadline:this.now()+m.ttlMs,abort,before};this.pending=p;
  const timer=setTimeout(()=>abort.abort(),m.ttlMs);
  let receiver;
  try {
   const expired=new Promise((_,reject)=>{if(abort.signal.aborted)reject(Error('Bootstrap expired'));else abort.signal.addEventListener('abort',()=>reject(Error('Bootstrap expired')),{once:true});});
   const launching=Promise.resolve(this.launch({requestId:m.requestId,sourceCommit:m.sourceCommit,encryptedPairing:m.encryptedPairing,ttlMs:m.ttlMs,signal:abort.signal})).then(child=>{if(abort.signal.aborted){child?.close();throw Error('Bootstrap expired');}return child;});
   receiver=await Promise.race([launching,expired]);
   check(receiver&&typeof receiver.close==='function','Invalid local receiver');
   const proof=await Promise.race([receiver.ready,expired]);
   const after=this.context();
   check(!abort.signal.aborted&&this.now()<p.deadline&&this.pending===p,'Bootstrap expired');
   check(after.peerReady&&after.optedIn&&after.peerInstance===before.peerInstance&&after.destinationLayoutRevision===before.destinationLayoutRevision&&after.displayId===before.displayId,'Peer or destination changed');
   check(proof.sourceCommit===m.sourceCommit&&UUID.test(proof.sessionId||'')&&UUID.test(proof.windowId||'')&&positive(proof.geometryRevision)&&positive(proof.frameSeq)&&proof.hidden===true,'Missing authenticated hidden decoded-frame proof');
   p.receiver=receiver;
   return PREFIX+JSON.stringify({type:'sessionReady',requestId:m.requestId,sessionId:proof.sessionId,windowId:proof.windowId,geometryRevision:proof.geometryRevision,frameSeq:proof.frameSeq,displayId:before.displayId,destinationLayoutRevision:before.destinationLayoutRevision,ownershipEpoch:0,sourceLayoutRevision:m.sourceLayoutRevision,pointerOwner:m.pointerOwner});
  }catch(error){receiver?.close();if(this.pending===p)this.pending=null;throw error;}
  finally{clearTimeout(timer);}
 }
 // Remains hidden after sessionReady. Only an ownership-aware handoff adapter
 // may adopt it; expiry/transport loss closes it so the source recovers home.
 take(requestId){const p=this.pending;check(p?.requestId===requestId&&p.receiver&&this.now()<p.deadline,'Bootstrap not ready');this.pending=null;return p.receiver;}
 expire(){if(this.pending&&this.now()>=this.pending.deadline)this.disconnect();}
 disconnect(){const p=this.pending;this.pending=null;p?.abort.abort();p?.receiver?.close();}
}
module.exports={SessionBootstrap,PREFIX};
