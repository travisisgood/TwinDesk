'use strict';
const {EventEmitter}=require('node:events'),{spawn}=require('node:child_process'),readline=require('node:readline'),path=require('node:path');
// Ownership callback MUST come from the local authenticated KVM route, never
// from the peer's pointerOwner field. This implementation covers Windows-owned
// physical drags only; Mac-owned continuation needs its driven-input adapter.
class NativeDrag extends EventEmitter {
 constructor(child,ownershipValid,now=()=>performance.now()){
  super();this.child=child;this.ownershipValid=ownershipValid;this.now=now;this.sample=null;this.sampleAt=-Infinity;this.pending=null;this.closed=false;this.committed=false;
  this.lease=setInterval(()=>{if(!ownershipValid())this.cancel('ownership-lost');else if(!this.closed)this.command('lease');},250);this.lease.unref();
  child.once('error',()=>this.finish('native-helper-error'));child.once('exit',()=>this.finish('native-helper-exit'));
 }
 command(text){if(!this.closed&&this.child.stdin.writable)this.child.stdin.write(text+'\n');}
 receive(m){
  if(this.closed)return;
  if(m.type==='sample'&&typeof m.held==='boolean'&&Number.isFinite(m.x)&&Number.isFinite(m.y)){this.sample=m;this.sampleAt=this.now();this.emit('sample',this.snapshot());}
  else if(m.type==='committed'){
   if(!this.pending||m.held!==true||!Number.isFinite(m.x)||!Number.isFinite(m.y)||!this.ownershipValid()){this.cancel('unexpected-native-commit');return;}
   clearTimeout(this.pending.timer);this.committed=true;this.pending.resolve(m);this.pending=null;
  }else if(m.type==='ended'||m.type==='error')this.finish(m.reason||'native-helper-ended');
 }
 snapshot(){return {pointerOwner:'windows',pointerHeld:this.sample?.held===true,pointerVerified:!this.closed&&this.now()-this.sampleAt<=150&&this.ownershipValid()};}
 commit(){
  const s=this.snapshot();if(!s.pointerVerified||!s.pointerHeld||this.pending||this.committed)return Promise.reject(Error('No fresh held Windows drag'));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.cancel('native-commit-timeout'),1000);this.pending={resolve,reject,timer};this.command('commit');});
 }
 cancel(reason='cancelled'){if(this.closed)return;this.command('cancel');this.finish(reason);const timer=setTimeout(()=>this.child.kill(),300);timer.unref();}
 finish(reason){if(this.closed)return;this.closed=true;clearInterval(this.lease);if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error(reason));this.pending=null;}this.emit('ended',{reason,committed:this.committed});}
}
function arm({executable,hwnd,pid,anchor,durationMs=30000,ownershipValid}){
 if(!path.isAbsolute(executable)||!/^\d+$/.test(String(hwnd))||!Number.isSafeInteger(pid)||pid<=0||!anchor||![anchor.x,anchor.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||!Number.isInteger(durationMs)||durationMs<1||durationMs>60000||typeof ownershipValid!=='function'||!ownershipValid())throw Error('Invalid local native-drag binding');
 const child=spawn(executable,['--follow',String(hwnd),String(pid),String(anchor.x),String(anchor.y),String(durationMs)],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']});
 const drag=new NativeDrag(child,ownershipValid);
 const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{try{if(line.length>2048)throw Error();drag.receive(JSON.parse(line));}catch{drag.cancel('invalid-native-output');}});
 child.stdin.on('error',()=>drag.cancel('native-pipe-lost'));
 return drag;
}
module.exports={NativeDrag,arm};
