const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('portal',{
  sources:()=>ipcRenderer.invoke('sources'),
  select:id=>ipcRenderer.invoke('select',id),
  native:(cmd,args)=>ipcRenderer.invoke('native',cmd,args),
  report:r=>ipcRenderer.invoke('report',r),
  mode:()=>ipcRenderer.invoke('mode'),
  snapshot:()=>ipcRenderer.invoke('snapshot'),
  explorerMutation:()=>ipcRenderer.invoke('explorer-mutation'),
  saveProof:(phase,image)=>ipcRenderer.invoke('save-proof',phase,image),
});
