const {app,BrowserWindow,ipcMain,nativeImage,Menu,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {connect}=require('./connection.cjs');
app.setPath('userData',path.join(__dirname,'profile'));
app.setAppUserModelId('WindowPortal.StandaloneReceiver');
let win,session,ending=false,frames=0,presented=false;
let desiredResize,resizeTimer,resizeDeadline,appliedSize,resizeReadyAt=0,lastResizeSeq,releasedForResize;
function interactionState(){win?.webContents.send('interaction-state',{blocked:!!session?.resizePending});}
function releaseRemoteInput(){
 if(session&&!session.closed&&session.window?.capabilities.includes('releaseAll')&&!session.releaseSeq){try{session.input('releaseAll',{});}catch{}}
}
function applySourceSize(size){
 appliedSize=[Math.round(size.width),Math.round(size.height)];
 win.setContentSize(...appliedSize);
}
function flushResize(){
 if(Date.now()<resizeReadyAt||!desiredResize||!session?.displayed||session.resizePending||session.inputs.size||session.pending||!session.window.capabilities.includes('resize'))return;
 if(session.window.capabilities.includes('releaseAll')&&releasedForResize!==desiredResize){releasedForResize=desiredResize;releaseRemoteInput();return;}
 const args=desiredResize;desiredResize=null;
 try{lastResizeSeq=session.input('resize',args);interactionState();clearTimeout(resizeDeadline);resizeDeadline=setTimeout(()=>{if(session.resizePending)end('Source resize did not complete');},10000);}
 catch(error){win.webContents.send('notice',error.message);applySourceSize(session.window.logicalSize);}
}
const configPath=process.argv.find(a=>a.startsWith('--config='))?.slice(9);
const proofDir=process.argv.find(a=>a.startsWith('--proof-dir='))?.slice(12);
// A GUI process can outlive the launching shell's stdout/stderr pipes. Logging
// must never throw EPIPE or bring down an otherwise healthy remote window.
function log(event,extra={}){try{fs.appendFileSync(path.join(__dirname,'receiver-events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...extra})+'\n');}catch{}}
process.stdout.on('error',e=>{if(e.code!=='EPIPE')log('stdout-error',{code:e.code})});
process.stderr.on('error',e=>{if(e.code!=='EPIPE')log('stderr-error',{code:e.code})});
function end(reason){if(ending)return;ending=true;clearTimeout(resizeTimer);clearTimeout(resizeDeadline);releaseRemoteInput();session?.end(reason);log('closed',{reason,frames});app.quit();}
app.whenReady().then(async()=>{
 if(!configPath)throw Error('Pass --config=<private pairing JSON path>');
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 win=new BrowserWindow({width:800,height:550,frame:false,show:false,resizable:true,minimizable:true,skipTaskbar:false,title:'Window Portal — connecting',webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.setMenu(null);
 win.on('blur',releaseRemoteInput);
 win.on('resize',()=>{
  if(!session?.window)return;
  const [width,height]=win.getContentSize();
  if(appliedSize&&width===appliedSize[0]&&height===appliedSize[1])return;
  if(!session.window.capabilities.includes('resize'))return;
  desiredResize={logicalSize:{width,height},pixelScale:Math.max(1,Math.min(3,screen.getDisplayMatching(win.getBounds()).scaleFactor))};
  resizeReadyAt=Date.now()+180;clearTimeout(resizeTimer);resizeTimer=setTimeout(flushResize,180);
 });
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 win.on('closed',()=>end('Receiver closed; return source'));
 win.webContents.on('render-process-gone',()=>end('Receiver renderer lost'));
 win.webContents.on('context-menu',()=>Menu.buildFromTemplate([
  {label:'Minimize',click:()=>win.minimize()},
  {label:'Search in source',enabled:!!session?.window?.capabilities.includes('setSearchText'),click:()=>win.webContents.send('search')},
  {label:'Return window to source',click:()=>end('Receiver closed; return source')}
 ]).popup({window:win}));
 ipcMain.on('frame-displayed',(e,seq)=>{if(e.sender!==win.webContents)return;try{session.displayedFrame(seq);interactionState();if(!session.resizePending)clearTimeout(resizeDeadline);flushResize();frames++;if(frames===1||frames%30===0)log('frame-displayed',{seq,frames});}catch{end('Invalid renderer acknowledgment')}});
 ipcMain.on('decode-failed',()=>end('Receiver could not decode frame'));
 ipcMain.on('input',(e,op,args)=>{if(e.sender!==win.webContents)return;try{session.input(op,args)}catch(error){if(op==='pointer'||op==='key')releaseRemoteInput();win.webContents.send('notice',error.message)}});
 ipcMain.on('local',(e,action)=>{if(e.sender!==win.webContents)return;if(action==='minimize')win.minimize();else if(action==='close')end('Receiver closed; return source')});
 await win.loadFile('index.html');win.show();
 session=connect(config);
 session.on('welcome',m=>log('authenticated',{sourceCommit:m.sourceCommit,receiverCommit:config.sourceCommit}));
 session.on('window',m=>{
  win.setTitle(m.title+' — Window Portal');
  if(m.iconPng){const icon=nativeImage.createFromBuffer(Buffer.from(m.iconPng,'base64'));if(icon.isEmpty())return end('Invalid icon');win.setIcon(icon);}
  applySourceSize(m.logicalSize);
  if(!presented){presented=true;win.show();win.focus();}
  win.webContents.send('metadata',{capabilities:m.capabilities,logicalSize:m.logicalSize,dragRegions:m.dragRegions});
  log('window',{windowId:m.windowId,geometryRevision:m.geometryRevision,logicalSize:m.logicalSize,pixelSize:m.pixelSize,receiverScale:screen.getDisplayMatching(win.getBounds()).scaleFactor,capabilities:m.capabilities});
 });
 session.on('frame',(m,bytes)=>{
  const decoded=nativeImage.createFromBuffer(bytes),s=decoded.getSize();
  if(decoded.isEmpty()||s.width!==m.pixelSize.width||s.height!==m.pixelSize.height)return end('PNG decoder dimensions mismatch');
  if(proofDir&&[1,60,180].includes(m.seq)){fs.mkdirSync(proofDir,{recursive:true});fs.writeFileSync(path.join(proofDir,'source-frame-'+m.seq+'.png'),bytes);}
  win.webContents.send('frame',{seq:m.seq,image:'data:image/png;base64,'+m.png,pixelSize:m.pixelSize,contentRect:m.contentRect});
 });
 session.on('inputResult',m=>{
  interactionState();if(!session.resizePending){clearTimeout(resizeDeadline);if(m.seq===lastResizeSeq&&['rejected','unsupported','failed'].includes(m.status))applySourceSize(session.window.logicalSize);flushResize();}
  win.webContents.send('notice',m.status+': '+m.detail);log('input-result',{seq:m.seq,status:m.status});
  if(proofDir)setTimeout(async()=>{if(!win.isDestroyed()){const image=await win.webContents.capturePage();fs.writeFileSync(path.join(proofDir,'after-input-'+m.seq+'.png'),image.toPNG());}},700);
 });
 session.on('ended',reason=>{if(!ending){win.webContents.send('disconnected',reason);log('disconnected',{reason,frames});}});
 // Explicit bounded smoke mode only; ordinary receiver lifetime is user-owned.
 const smoke=Number(process.argv.find(a=>a.startsWith('--smoke-seconds='))?.split('=')[1]);
 if(smoke>0&&smoke<=600){
  const proof=proofDir;
  if(proof){
   fs.mkdirSync(proof,{recursive:true});
   setTimeout(async()=>{if(!win.isDestroyed()){const image=await win.webContents.capturePage();fs.writeFileSync(path.join(proof,'receiver.png'),image.toPNG());log('proof',{frames});}},4000);
   setTimeout(()=>{if(!win.isDestroyed()){win.minimize();log('minimized',{frames});}},5000);
   setTimeout(()=>{if(!win.isDestroyed()){const minimized=win.isMinimized();win.restore();log('restored',{wasMinimized:minimized,frames});}},7000);
  }
  setTimeout(()=>end('Bounded receiver test complete'),smoke*1000);
 }
}).catch(e=>{log('startup-error',{reason:e.message});app.exit(1)});
app.on('before-quit',()=>session?.end('Receiver exiting; return source'));
