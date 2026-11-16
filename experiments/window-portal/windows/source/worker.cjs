'use strict';
const {app,BrowserWindow,desktopCapturer,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),readline=require('node:readline');
const config=JSON.parse(fs.readFileSync(process.argv.find(a=>a.startsWith('--worker-config=')).slice(16),'utf8'));
app.setPath('userData',path.join(config.output,'worker-profile'));
let helper,fixture,win,selected,latest,sourceInfo,originalBounds,next=0,closed=false,clicks=0;const pending=new Map();
const transport=require('node:net').createConnection(config.pipe);
transport.on('error',()=>cleanup());transport.on('close',()=>cleanup());
function emit(m){if(m.error)fs.appendFileSync(path.join(config.output,'worker-errors.jsonl'),JSON.stringify({error:m.error})+'\n');try{transport.write(JSON.stringify(m)+'\n');}catch{cleanup()}}
function native(cmd,args={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Native helper deadline'));},3000);pending.set(id,{resolve,reject,timer});helper.stdin.write(JSON.stringify({id,cmd,...args})+'\n');})}
function stage(name){fs.appendFileSync(path.join(config.output,'worker-stages.jsonl'),JSON.stringify({at:new Date().toISOString(),stage:name})+'\n');}
function startNative(args){
 const child=spawn(config.nativeHelper,args,{stdio:['pipe','pipe','ignore'],windowsHide:args.includes('controller')});
 child.stdin.on('error',()=>cleanup());
 const ready=new Promise((resolve,reject)=>{
  child.once('error',reject);
  readline.createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.eventName==='ready')resolve(m);if(m.eventName==='clicked')clicks=m.clicks;const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(Error(m.error));}});
 });return {child,ready};
}
async function cleanup(){if(closed)return;closed=true;try{if(selected){await native('restore');await new Promise(r=>setTimeout(r,100));const after=(await native('status')).bounds;fs.writeFileSync(path.join(config.output,'source-return.json'),JSON.stringify({before:originalBounds,after,returned:Math.abs(after.x-originalBounds.x)<=2&&Math.abs(after.y-originalBounds.y)<=2}));}}catch{}helper?.stdin.end();fixture?.stdin.end();app.quit();}
app.whenReady().then(async()=>{
 const control=startNative(['controller']);helper=control.child;stage('native-start');await control.ready;stage('native-ready');
 let fixtureId;
 if(config.fixture){const f=startNative([]);fixture=f.child;const ready=await f.ready;fixtureId=ready.wid;fs.writeFileSync(path.join(config.output,'fixture-input.json'),JSON.stringify({x:ready.buttonX,y:ready.buttonY}));}
 let source;
 for(let i=0;i<1&&!source;i++){
  stage('enumerate-windows');const list=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:true});
  const matches=list.filter(s=>(fixtureId||config.sourceWid)?s.id.startsWith('window:'+(fixtureId||config.sourceWid)+':'):s.name===config.sourceTitle);
  if(matches.length>1)throw Error('Source window title is ambiguous');source=matches[0];if(!source)await new Promise(r=>setTimeout(r,300));
 }
 stage('enumeration-complete');if(!source)throw Error('Selected Explorer window is unavailable for capture; restore it if minimized');
 const wid=Number(/^window:(\d+):/.exec(source.id)[1]);stage('select');const identity=await native('select',{wid});selected=wid;
 if(!config.fixture&&identity.processName!=='explorer')throw Error('Refusing non-Explorer source');
 stage('status');originalBounds=(await native('status')).bounds;
 const mon=config.backing;await native('park',{x:mon.x+24,y:mon.y+24});
 let status;
 for(let i=0;i<12;i++){status=await native('status');const b=status.bounds;if(b.x>=mon.x&&b.y>=mon.y&&b.x+b.width<=mon.x+mon.width&&b.y+b.height<=mon.y+mon.height)break;await new Promise(r=>setTimeout(r,100));}
 const b=status.bounds;
 if(!(b.x>=mon.x&&b.y>=mon.y&&b.x+b.width<=mon.x+mon.width&&b.y+b.height<=mon.y+mon.height))throw Error('Whole source window does not fit backing monitor; refusing partial placement');
 fs.writeFileSync(path.join(config.output,'source-placement.json'),JSON.stringify({bounds:b,monitor:mon}));
 sourceInfo={sourceId:source.id,title:source.name,iconPng:source.appIcon&&!source.appIcon.isEmpty()?source.appIcon.resize({width:128,height:128}).toPNG().toString('base64'):null,logicalSize:{width:b.width,height:b.height}};
 stage('placement-complete');let first=true;
 ipcMain.handle('source',()=>sourceInfo);
 ipcMain.on('frame',(_e,frame)=>{
  latest=frame;if(first)stage('first-frame');
  if(first){first=false;emit({windowId:require('node:crypto').randomUUID(),geometryRevision:1,appId:config.fixture?'win32.WindowPortalFixture':'win32.explorer',title:sourceInfo.title,logicalSize:sourceInfo.logicalSize,pixelSize:frame.pixelSize,iconPng:sourceInfo.iconPng,capabilities:config.fixture?['pressAt']:[]});}
 });
 ipcMain.on('failure',(_e,message)=>{emit({error:String(message).slice(0,300)});cleanup()});
 let queue=Promise.resolve();
 readline.createInterface({input:transport}).on('line',line=>{queue=queue.then(async()=>{
  const m=JSON.parse(line);
  if(m.op==='frame'){if(!latest){emit({pending:true});return;}emit(latest);return;}
  if(m.op==='pressAt'&&config.fixture){const before=clicks;const r=await native('click',m.args);await new Promise(r=>setTimeout(r,200));fs.appendFileSync(path.join(config.output,'input-evidence.jsonl'),JSON.stringify({before,after:clicks,route:r.route})+'\n');emit({AXError:0});return;}
  emit({error:'Unsupported Windows source operation'});
 }).catch(e=>{emit({error:e.message});cleanup()});}).on('close',cleanup);
 win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('render-process-gone',(_e,d)=>{emit({error:'Capture renderer exited: '+d.reason});cleanup()});stage('renderer-load');await win.loadURL(require('node:url').pathToFileURL(path.join(__dirname,'index.html')).href);
}).catch(e=>{emit({error:e.message});cleanup()});
app.on('before-quit',()=>{helper?.stdin.end();fixture?.stdin.end();});






