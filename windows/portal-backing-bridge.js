'use strict';
// Optional local standalone-source integration. No network or window transfer.
// The existing KVM and native helper already support excluding one app display.
const fs=require('node:fs'),path=require('node:path');
function choose(request,displays){
 if(!request||request.v!==1||typeof request.name!=='string'||!/^\\\\\.\\DISPLAY\d+$/.test(request.name))throw Error('Invalid backing display request');
 const mon=displays.find(d=>d.name===request.name);
 if(!mon)return null;
 if(!/virtual display driver/i.test(mon.adapter||''))throw Error('Refusing to exclude a physical display');
 return mon;
}
class PortalBackingBridge {
 constructor({directory,helper,kvm,busy=()=>false}){Object.assign(this,{directory,helper,kvm,busy});this.requestPath=path.join(directory,'portal-backing-lease.json');this.ackPath=path.join(directory,'portal-backing-ack.json');this.mon=null;this.active=false;this.pending=null;}
 start(){
  this.watch=()=>this.refresh().catch(()=>{});
  fs.watchFile(this.requestPath,{interval:500,persistent:false},this.watch);
  this.ready=()=>{this.mon=null;this.watch()};this.helper.on('ready',this.ready);
  this.timer=setInterval(this.watch,2000);this.timer.unref();this.watch();return this;
 }
 async refresh(){if(this.pending)return this.pending;this.pending=this.update().finally(()=>this.pending=null);return this.pending;}
 async update(){
  let request;
  try{request=JSON.parse(await fs.promises.readFile(this.requestPath,'utf8'));}
  catch(e){if(e.code==='ENOENT'&&!this.active)return;if(e.code!=='ENOENT'){await this.ack({ok:false,error:'Invalid local lease'});return;}}
  try{
   // No driver calls here. Leaving a source window never changes topology.
   const displays=(await this.helper.request('displays')).displays||[];
   let mon=request?choose(request,displays):null;
   // Removing the request alone must not reintroduce a still-live hidden display.
   if(!request&&this.mon)mon=displays.find(d=>d.name===this.mon.name&&/virtual display driver/i.test(d.adapter||''))||null;
   if(mon&&this.busy())throw Error('Existing TwinDesk display session is active');
   if(JSON.stringify(mon)!==JSON.stringify(this.mon)){
    await this.helper.request('appDisplay',{name:mon?.name||''});
    this.kvm.setAppDisplay(mon);this.mon=mon;
   }
   this.active=!!mon;
   await this.ack({ok:!!mon,requestId:request?.id||null,monitor:mon,physicalMap:this.kvm.map.mine,error:mon?null:'Backing display not present'});
  }catch(e){await this.ack({ok:false,error:e.message});}
 }
 async ack(value){const text=JSON.stringify(value);if(text===this.lastAck)return;this.lastAck=text;const temp=this.ackPath+'.tmp';await fs.promises.writeFile(temp,text);await fs.promises.rename(temp,this.ackPath);}
 stop(){fs.unwatchFile(this.requestPath,this.watch);clearInterval(this.timer);this.helper.removeListener('ready',this.ready);}
}
module.exports={PortalBackingBridge,choose};
