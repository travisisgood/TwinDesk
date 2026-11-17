'use strict';
// Keep at most one acknowledged-in-flight move and one newest pending point.
// Button boundaries discard pending hover; clicks never wait for that backlog.
class MotionGate {
 constructor(send){this.send=send;this.inflight=null;this.pending=null;}
 input(op,args){
  if(op==='pointer'&&args.phase==='move'){
   if(this.inflight!==null){this.pending=args;return;}
   this.inflight=this.send(op,args);return this.inflight;
  }
  this.pending=null;return this.send(op,args);
 }
 acknowledged(seq){if(seq!==this.inflight)return;this.inflight=null;const next=this.pending;this.pending=null;if(next)this.input('pointer',next);}
 clear(){this.pending=null;}
}
module.exports={MotionGate};
