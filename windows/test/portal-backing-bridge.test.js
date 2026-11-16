const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PortalBackingBridge,choose}=require('../portal-backing-bridge');
const mon={name:'\\\\.\\DISPLAY34',adapter:'Virtual Display Driver',x:3840,y:0,width:1440,height:900};
test('reject physical monitor and malformed lease',()=>{assert.throws(()=>choose({v:1,name:mon.name},[{...mon,adapter:'NVIDIA'}]),/physical/);assert.throws(()=>choose({v:1,name:'oops'},[]));});
test('exclusion persists across source return; monitor removal clears it without driver toggle',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'portal-bridge-')),calls=[];let displays=[mon];
 const helper={request:async(cmd,args)=>{calls.push([cmd,args]);return cmd==='displays'?{displays}:{};}};
 const kvm={map:{mine:[]},setAppDisplay:m=>calls.push(['map',m])};const bridge=new PortalBackingBridge({directory,helper,kvm});
 try{
  await bridge.refresh();assert.equal(calls.length,0);
  fs.writeFileSync(bridge.requestPath,JSON.stringify({v:1,name:mon.name}));await bridge.refresh();
  assert.equal(calls.filter(c=>c[0]==='appDisplay').length,1);
  fs.unlinkSync(bridge.requestPath);await bridge.refresh();assert.equal(calls.filter(c=>c[0]==='appDisplay').length,1);
  displays=[];await bridge.refresh();assert.deepEqual(calls.filter(c=>c[0]==='appDisplay').at(-1)[1],{name:''});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('existing app display session cannot be taken over',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'portal-bridge-'));
 const bridge=new PortalBackingBridge({directory,busy:()=>true,helper:{request:async cmd=>{assert.equal(cmd,'displays');return {displays:[mon]}}},kvm:{map:{mine:[]},setAppDisplay:()=>assert.fail('Must not alter active KVM')}});
 try{fs.writeFileSync(bridge.requestPath,JSON.stringify({v:1,name:mon.name}));await bridge.refresh();assert.equal(JSON.parse(fs.readFileSync(bridge.ackPath)).ok,false);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
