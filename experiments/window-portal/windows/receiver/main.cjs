const {app,BrowserWindow,ipcMain,nativeImage,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {connect}=require('./connection.cjs');
app.setPath('userData',path.join(__dirname,'profile'));
app.setAppUserModelId('WindowPortal.StandaloneReceiver');
let win,session,ending=false,frames=0;
const configPath=process.argv.find(a=>a.startsWith('--config='))?.slice(9);
// A GUI process can outlive the launching shell's stdout/stderr pipes. Logging
// must never throw EPIPE or bring down an otherwise healthy remote window.
function log(event,extra={}){try{fs.appendFileSync(path.join(__dirname,'receiver-events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...extra})+'\n');}catch{}}
process.stdout.on('error',e=>{if(e.code!=='EPIPE')log('stdout-error',{code:e.code})});
process.stderr.on('error',e=>{if(e.code!=='EPIPE')log('stderr-error',{code:e.code})});
function end(reason){if(ending)return;ending=true;session?.end(reason);log('closed',{reason,frames});app.quit();}
app.whenReady().then(async()=>{
 if(!configPath)throw Error('Pass --config=<private pairing JSON path>');
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 win=new BrowserWindow({width:800,height:550,frame:false,show:false,resizable:true,minimizable:true,skipTaskbar:false,title:'Window Portal — connecting',webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.setMenu(null);
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 win.on('closed',()=>end('Receiver closed; return source'));
 win.webContents.on('render-process-gone',()=>end('Receiver renderer lost'));
 win.webContents.on('context-menu',()=>Menu.buildFromTemplate([
  {label:'Minimize',click:()=>win.minimize()},
  {label:'Search in source',enabled:!!session?.window?.capabilities.includes('setSearchText'),click:()=>win.webContents.send('search')},
  {label:'Return window to source',click:()=>end('Receiver closed; return source')}
 ]).popup({window:win}));
 ipcMain.on('frame-displayed',(e,seq)=>{if(e.sender!==win.webContents)return;try{session.displayedFrame(seq);frames++;if(frames===1||frames%30===0)log('frame-displayed',{seq,frames});}catch{end('Invalid renderer acknowledgment')}});
 ipcMain.on('decode-failed',()=>end('Receiver could not decode frame'));
 ipcMain.on('input',(e,op,args)=>{if(e.sender!==win.webContents)return;try{session.input(op,args)}catch(error){win.webContents.send('notice',error.message)}});
 ipcMain.on('local',(e,action)=>{if(e.sender!==win.webContents)return;if(action==='minimize')win.minimize();else if(action==='close')end('Receiver closed; return source')});
 await win.loadFile('index.html');win.show();
 session=connect(config);
 session.on('welcome',m=>log('authenticated',{sourceCommit:m.sourceCommit,receiverCommit:config.sourceCommit}));
 session.on('window',m=>{
  win.setTitle(m.title+' — Window Portal');
  if(m.iconPng){const icon=nativeImage.createFromBuffer(Buffer.from(m.iconPng,'base64'));if(icon.isEmpty())return end('Invalid icon');win.setIcon(icon);}
  win.setSize(Math.min(1600,Math.max(240,Math.round(m.logicalSize.width))),Math.min(1000,Math.max(160,Math.round(m.logicalSize.height))));
  win.webContents.send('metadata',{capabilities:m.capabilities});log('window',{windowId:m.windowId,geometryRevision:m.geometryRevision});
 });
 session.on('frame',(m,bytes)=>{
  const decoded=nativeImage.createFromBuffer(bytes),s=decoded.getSize();
  if(decoded.isEmpty()||s.width!==m.pixelSize.width||s.height!==m.pixelSize.height)return end('PNG decoder dimensions mismatch');
  win.webContents.send('frame',{seq:m.seq,image:'data:image/png;base64,'+m.png,pixelSize:m.pixelSize,contentRect:m.contentRect});
 });
 session.on('inputResult',m=>win.webContents.send('notice',m.status+': '+m.detail));
 session.on('ended',reason=>{if(!ending){win.webContents.send('disconnected',reason);log('disconnected',{reason,frames});}});
 // Explicit bounded smoke mode only; ordinary receiver lifetime is user-owned.
 const smoke=Number(process.argv.find(a=>a.startsWith('--smoke-seconds='))?.split('=')[1]);
 if(smoke>0&&smoke<=120){
  const proof=process.argv.find(a=>a.startsWith('--proof-dir='))?.slice(12);
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
