const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('portal',{
 on:(name,fn)=>{if(['frame','metadata','notice','disconnected','search','interaction-state'].includes(name))ipcRenderer.on(name,(_e,data)=>fn(data));},
 displayed:seq=>ipcRenderer.send('frame-displayed',seq),failed:()=>ipcRenderer.send('decode-failed'),
 input:(op,args)=>ipcRenderer.send('input',op,args),local:action=>ipcRenderer.send('local',action)
});
