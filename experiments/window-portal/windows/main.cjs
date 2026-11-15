const {app,BrowserWindow,desktopCapturer,ipcMain}=require('electron');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path'),fs=require('node:fs');
app.setPath('userData',path.join(__dirname,'profile'));
let helper,external,wgc,wgcStatus={},win,next=0,selected,fixture,fixturePoint,fixtureClicks=0;
const pending=new Map();
function native(cmd,args={}){return new Promise((resolve,reject)=>{
  const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Native request timed out'))},3000);
  pending.set(id,{resolve,reject,timer});helper.stdin.write(JSON.stringify({cmd,id,...args})+'\n');
})}
function printFrame(){return new Promise((resolve,reject)=>{
  if(!selected)return reject(Error('Select a source first'));
  const p=spawn(path.join(__dirname,'WindowPortal.Native.exe'),['print',String(selected.wid)],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let data='';const timer=setTimeout(()=>{p.kill();reject(Error('Source did not render within one second'))},1000);
  p.stdout.on('data',b=>{data+=b;if(data.length>16000000){p.kill();reject(Error('Frame exceeded limit'))}});
  p.once('error',e=>{clearTimeout(timer);reject(e)});
  p.once('exit',()=>{clearTimeout(timer);try{const frame=JSON.parse(data);frame.hash=require('node:crypto').createHash('sha256').update(frame.image).digest('hex');resolve(frame)}catch{reject(Error('Source does not support PrintWindow capture'))}});
})}
app.whenReady().then(async()=>{
  helper=spawn(path.join(__dirname,'WindowPortal.Native.exe'),['controller'],{windowsHide:false,stdio:['pipe','pipe','pipe']});
  helper.stderr.on('data',b=>fs.appendFileSync(path.join(__dirname,'native-error.log'),b));
  const ready=new Promise((resolve,reject)=>{
    helper.once('error',reject);
    readline.createInterface({input:helper.stdout}).on('line',line=>{
      let m;try{m=JSON.parse(line)}catch{return}
      if(m.eventName==='ready'){fixture=m.wid;fixturePoint={x:m.buttonX,y:m.buttonY};resolve();return}
      const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(Error(m.error))}
    });
  });
  helper.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Native helper exited'))}pending.clear();if(win&&!win.isDestroyed())win.webContents.send('helper-lost')});
  await ready;
  if(process.argv.includes('--self-test')||process.argv.includes('--demo')){
    external=spawn(path.join(__dirname,'WindowPortal.Native.exe'),[],{windowsHide:false,stdio:['pipe','pipe','ignore']});
    await new Promise((resolve,reject)=>{
      external.once('error',reject);
      readline.createInterface({input:external.stdout}).on('line',line=>{
        let m;try{m=JSON.parse(line)}catch{return}
        if(m.eventName==='ready'){fixture=m.wid;fixturePoint={x:m.buttonX,y:m.buttonY};resolve()}
        if(m.eventName==='clicked')fixtureClicks=m.clicks;
      });
    });
  }
  ipcMain.handle('sources',async()=> (await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:true})).filter(s=>!s.name.startsWith('WindowPortal —')).map(s=>({id:s.id,name:s.name,icon:s.appIcon?.toDataURL()})));
  ipcMain.handle('select',async(_e,id)=>{
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:true});
    const source=sources.find(s=>s.id===id);if(!source)throw Error('Source is no longer available');
    const wid=Number(/^window:(\d+):/.exec(id)?.[1]);if(!wid)throw Error('Invalid window source');
    await native('select',{wid});selected={id,wid};
    if(wgc)wgc.kill();wgcStatus={};
    wgc=spawn(path.join(__dirname,'WindowPortal.WgcProbe.exe'),[String(wid)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    readline.createInterface({input:wgc.stdout}).on('line',line=>{try{wgcStatus=JSON.parse(line)}catch{}});
    wgc.stderr.on('data',b=>{wgcStatus={error:b.toString().trim()}});
    win.setTitle('WindowPortal — '+source.name);if(source.appIcon&&!source.appIcon.isEmpty())win.setIcon(source.appIcon);
    return selected;
  });
  ipcMain.handle('native',async(_e,cmd,args)=>{if(!['status','cloak','park','restore','click','text'].includes(cmd))throw Error('Unsupported action');const result=await native(cmd,args);if(cmd==='status'){if(external)result.clicks=fixtureClicks;result.wgc=wgcStatus;}return result});
  ipcMain.handle('mode',()=>({selfTest:process.argv.includes('--self-test'),scarlettProbe:process.argv.includes('--scarlett-probe'),explorerProbe:process.argv.includes('--explorer-probe'),demo:process.argv.includes('--demo'),fixture,fixturePoint}));
  ipcMain.handle('snapshot',()=>printFrame());
  ipcMain.handle('explorer-mutation',()=>{
    if(!process.argv.includes('--explorer-probe'))throw Error('Not an Explorer test');
    const folder=path.resolve(__dirname,'../../work/WindowPortal Explorer Test');
    fs.writeFileSync(path.join(folder,'Live capture proof '+Date.now()+'.txt'),'Created by the standalone capture test while its Explorer window was offscreen.');
  });
  ipcMain.handle('save-proof',(_e,phase,image)=>{
    if(!process.argv.includes('--explorer-probe')||!['before','after'].includes(phase)||!image.startsWith('data:image/png;base64,'))throw Error('Invalid proof image');
    fs.writeFileSync(path.join(__dirname,'Explorer-'+phase+'.png'),Buffer.from(image.split(',')[1],'base64'));
  });
  ipcMain.handle('report',(_e,result)=>{
    fs.appendFileSync(path.join(__dirname,'results.jsonl'),JSON.stringify({at:new Date().toISOString(),...result})+'\n');
    if(result.finished&&(process.argv.includes('--self-test')||process.argv.includes('--scarlett-probe')||process.argv.includes('--explorer-probe')))setTimeout(()=>app.quit(),500);
  });
  win=new BrowserWindow({width:850,height:650,x:600,y:120,title:'WindowPortal — standalone experiment',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('render-process-gone',()=>native('restore').catch(()=>{}));
  win.on('closed',()=>app.quit());
  await win.loadFile('index.html');
});
app.on('before-quit',()=>{if(helper&&!helper.killed)helper.stdin.end();if(external&&!external.killed)external.stdin.end();if(wgc)wgc.kill()});
setTimeout(()=>{if(process.argv.includes('--self-test')||process.argv.includes('--scarlett-probe')||process.argv.includes('--explorer-probe'))app.quit()},45000).unref();
