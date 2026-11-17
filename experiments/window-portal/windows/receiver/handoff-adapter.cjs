'use strict';
const {HandoffState}=require('./handoff-state.cjs');
const PREFIX='PORTAL_HANDOFF1 ';
// Registered, already authenticated portal sessions only. The transport must
// supply inbound peer messages, never outbound echoes or AI coordination text.
class HandoffAdapter {
 constructor({context,place,release,now}) {
  this.context=context;this.place=place;this.release=release;
  this.state=new HandoffState(now);this.ready=null;this.completed=null;
 }
 receive(text) {
  if(typeof text!=='string'||!text.startsWith(PREFIX))return null;
  if(text.length>8192)throw Error('Handoff too large');
  const m=JSON.parse(text.slice(PREFIX.length)),c=this.context();
  if(m.sessionId!==c.sessionId||m.windowId!==c.windowId)throw Error('Unregistered portal');
  if(m.type==='offer') {
   if(!m.drag||typeof m.drag.id!=='string'||!m.drag.id.length||m.drag.id.length>80||m.drag.button!==0||m.drag.held!==true)throw Error('Invalid drag');
   if(!Number.isSafeInteger(c.displayedFrameSeq)||c.displayedFrameSeq<=0)throw Error('No decoded frame');
   const result=this.state.prepare(m,c);
   this.ready={type:'ready',id:m.id,sessionId:m.sessionId,windowId:m.windowId,geometryRevision:m.geometryRevision,sequence:m.sequence,dragId:m.drag.id,ownershipEpoch:m.ownershipEpoch,frameSeq:c.displayedFrameSeq,bounds:result.bounds};
   return PREFIX+JSON.stringify(this.ready);
  }
  if(m.type==='commit') {
   // A retry may acknowledge the previous commit, but must never move a window
   // or synthesize another button down. A new ownership epoch invalidates it.
   const done=this.completed;
   if(done&&m.id===done.id&&m.sequence===done.sequence&&m.dragId===done.dragId&&m.geometryRevision===done.geometryRevision&&m.frameSeq===done.frameSeq&&c.geometryRevision===done.geometryRevision&&m.ownershipEpoch===done.ownershipEpoch-1&&c.ownershipEpoch===done.ownershipEpoch)
    return PREFIX+JSON.stringify(done);
   const r=this.ready;
   if(!r||m.id!==r.id||m.sequence!==r.sequence||m.dragId!==r.dragId||m.ownershipEpoch!==r.ownershipEpoch||m.frameSeq!==r.frameSeq)throw Error('Commit does not match ready');
   const previous=this.state.pending.before;
   let result;
   try {
    result=this.state.commit(m.id,{...c,firstFrameDisplayed:c.displayedFrameSeq>=r.frameSeq});
    this.ready=null;
    // place must synchronously accept ownership epoch + native drag together.
    // It must not manufacture a second button-down for a held KVM drag.
    this.place(result,{dragId:r.dragId,ownershipEpoch:r.ownershipEpoch+1});
   } catch(error) {this.state.abort(m.id);this.ready=null;this.release();this.place({bounds:previous},{rollback:true});throw error;}
   this.completed={...r,type:'committed',ownershipEpoch:r.ownershipEpoch+1};
   return PREFIX+JSON.stringify(this.completed);
  }
  if(m.type==='abort') {this.abort(m.id);return null;}
  throw Error('Unexpected handoff type');
 }
 abort(id) {const bounds=this.state.abort(id);if(bounds){this.ready=null;this.release();this.place({bounds},{rollback:true});}}
 tick() {if(this.state.pending&&this.state.now()>=this.state.pending.deadline)this.abort(this.state.pending.id);}
 disconnect() {if(this.state.pending)this.abort(this.state.pending.id);this.completed=null;this.release();}
}
module.exports={HandoffAdapter,PREFIX};
