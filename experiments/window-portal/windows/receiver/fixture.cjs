'use strict';
// Deterministic fake source for receiver tests. Never captures a desktop or app.
const {WebSocketServer}=require('ws'),crypto=require('node:crypto'),zlib=require('node:zlib'),fs=require('node:fs');
function crc32(b){let crc=0xffffffff;for(const v of b){crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function framePng(seq,width=640,height=400){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*3+1)+1+x*3;raw[i]=y<32?40:30;raw[i+1]=y<32?70:80;raw[i+2]=y<32?120:50;if(x>seq*13%width&&x<seq*13%width+80&&y>80&&y<180){raw[i]=240;raw[i+1]=180;raw[i+2]=40;}}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function fixture({server,port=0,token=crypto.randomBytes(32).toString('hex')}={}){
 const wss=new WebSocketServer(server?{server,path:'/portal',perMessageDeflate:false,maxPayload:16384}:{host:'127.0.0.1',port,path:'/portal',perMessageDeflate:false,maxPayload:16384});
 let consumed=false;const created=Date.now(),stats={hello:0,frames:0,inputs:0,closed:false};
 wss.on('connection',(ws,req)=>{
  if(!server&&!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){ws.close();return;}
  let authenticated=false,seq=0,outstanding=0,interval,frameTimer;
  const sessionId=crypto.randomUUID(),windowId=crypto.randomUUID();
  const send=(type,extra={})=>ws.readyState===1&&ws.send(JSON.stringify({v:1,type,sessionId,...extra}));
  const next=()=>{if(ws.readyState!==1||outstanding)return;outstanding=++seq;stats.frames++;send('frame',{windowId,geometryRevision:1,seq,pixelSize:{width:640,height:400},contentRect:{x:0,y:0,width:640,height:400},captureMode:'stream',png:framePng(seq).toString('base64')});};
  const deadline=setTimeout(()=>ws.close(),5000);
  ws.on('message',raw=>{
   try{
    const m=JSON.parse(raw.toString());
    if(!authenticated){
     stats.hello++;
     if(consumed||Date.now()-created>300000||m.type!=='hello'||m.v!==1||m.role!=='receiver'||m.token!==token){ws.close();return;}
     consumed=true;authenticated=true;clearTimeout(deadline);
     send('welcome',{sourceCommit:'f'.repeat(40),heartbeatMs:2000,disconnectMs:6000});
     send('window',{windowId,geometryRevision:1,appId:'test.fixture',title:'Window Portal — LOCAL TEST FIXTURE',logicalSize:{width:640,height:400},pixelSize:{width:640,height:400},iconPng:framePng(1,32,32).toString('base64'),capabilities:['pressAt']});
     next();interval=setInterval(()=>send('ping',{nonce:Date.now()}),2000);return;
    }
    if(m.sessionId!==sessionId){ws.close();return;}
    if(m.type==='ping')send('pong',{nonce:m.nonce});
    else if(m.type==='frameAck'){if(m.seq!==outstanding){ws.close();return;}outstanding=0;frameTimer=setTimeout(next,100);}
    else if(m.type==='input'){stats.inputs++;send('inputResult',{windowId,seq:m.seq,status:'dispatched',detail:'Local fixture only; no real application input'});}
    else if(m.type==='close')ws.close();
   }catch{ws.close();}
  });
  ws.on('close',()=>{stats.closed=true;clearTimeout(deadline);clearInterval(interval);clearTimeout(frameTimer);});
 });
 return {wss,token,stats,close:()=>{for(const ws of wss.clients)ws.terminate();wss.close();}};
}
module.exports={fixture,framePng};
if(require.main===module){
 const configPath=process.argv[2];if(!configPath)throw Error('Private config output path required');
 const f=fixture();f.wss.once('listening',()=>{fs.writeFileSync(configPath,JSON.stringify({url:'ws://127.0.0.1:'+f.wss.address().port+'/portal',token:f.token,loopbackTest:true,sourceCommit:process.argv[3]||'0'.repeat(40)}),{mode:0o600});console.log('Local receiver fixture ready; private configuration saved.');});
 setTimeout(()=>{f.close();console.log(JSON.stringify(f.stats));},120000);
}
