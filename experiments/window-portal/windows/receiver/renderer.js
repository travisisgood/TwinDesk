const api=window.portal,img=document.getElementById('frame'),notice=document.getElementById('notice'),form=document.getElementById('search'),viewport=document.getElementById('viewport'),drag=document.getElementById('drag');
let current,metadata,capabilities=[],connected=true,loading=false,blocked=false,dragLayoutKey=null;
function redraw(){
 if(!current||!metadata)return;
 const v={width:viewport.clientWidth,height:viewport.clientHeight},c=current.contentRect,b=PortalGeometry.layout(v,c);
 Object.assign(img.style,{width:current.pixelSize.width*b.scale+'px',height:current.pixelSize.height*b.scale+'px',left:b.x-c.x*b.scale+'px',top:b.y-c.y*b.scale+'px'});
 img.style.clipPath=`inset(${100*c.y/current.pixelSize.height}% ${100*(current.pixelSize.width-c.x-c.width)/current.pixelSize.width}% ${100*(current.pixelSize.height-c.y-c.height)/current.pixelSize.height}% ${100*c.x/current.pixelSize.width}%)`;
 const layoutKey=JSON.stringify({v,c,logical:metadata.logicalSize,regions:metadata.dragRegions,controls:metadata.windowControls,blocked,revision:metadata.geometryRevision});
 if(layoutKey===dragLayoutKey)return;dragLayoutKey=layoutKey;drag.replaceChildren();
 if(blocked)return;
 const regions=capabilities.includes('sourceDragRegions')?(metadata.dragRegions||[]):[{x:metadata.logicalSize.width*.35,y:0,width:metadata.logicalSize.width*.3,height:8}];
 for(const r of regions){const b=PortalGeometry.region(r,metadata.logicalSize,v,c),el=document.createElement('div');el.className='drag-region';Object.assign(el.style,{left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px'});drag.append(el);}
 if(capabilities.includes('receiverWindowControls'))for(const r of metadata.windowControls||[]){
  const b=PortalGeometry.region(r,metadata.logicalSize,v,c),el=document.createElement('button');el.className='window-control';el.title={close:'Return to Mac',minimize:'Minimize to taskbar',zoom:'Maximize or restore'}[r.action];
  Object.assign(el.style,{position:'absolute',left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px',padding:'0',border:'1px solid #0003',borderRadius:'50%',background:{close:'#ff5f57',minimize:'#febc2e',zoom:'#28c840'}[r.action],pointerEvents:'auto',webkitAppRegion:'no-drag'});
  el.disabled=r.action==='zoom'&&!capabilities.includes('resize');el.onclick=e=>{e.stopPropagation();api.local(r.action);};drag.append(el);
 }
}
api.on('metadata',m=>{metadata=m;capabilities=m.capabilities;current=null;pendingMove=null;heldKeys.clear();dragLayoutKey=null;drag.replaceChildren();});
api.on('interaction-state',m=>{blocked=m.blocked;if(blocked)pendingMove=null;redraw();});
api.on('frame',async m=>{
 if(loading){api.failed();return;}loading=true;
 try{const next=new Image();next.src=m.image;await next.decode();if(!connected)return;img.src=m.image;current=m;notice.hidden=true;redraw();api.displayed(m.seq)}catch{api.failed()}finally{loading=false}
});
new ResizeObserver(redraw).observe(viewport);
api.on('notice',text=>{notice.textContent=text;notice.hidden=false;});
api.on('disconnected',text=>{connected=false;current=null;drag.replaceChildren();document.body.classList.add('disconnected');notice.textContent='Disconnected — '+text;notice.hidden=false;form.hidden=true;});
api.on('search',()=>{if(connected&&!blocked){form.hidden=false;document.getElementById('query').focus()}});
viewport.onclick=e=>{
 if(!connected||!current||blocked)return;
 if(capabilities.includes('pointer'))return;
 if(!capabilities.includes('pressAt')){notice.textContent='This source does not yet support clicks';notice.hidden=false;return;}
 const b=viewport.getBoundingClientRect(),p=PortalGeometry.point(e.clientX-b.left,e.clientY-b.top,b,current.contentRect);
 if(p)api.input('pressAt',p);
};
form.onsubmit=e=>{e.preventDefault();if(!connected||blocked)return;api.input('setSearchText',{text:document.getElementById('query').value});if(capabilities.includes('confirmSearch'))api.input('confirmSearch',{});form.hidden=true;};
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='m'){e.preventDefault();api.local('minimize')}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='q'){e.preventDefault();api.local('close')}});

function remotePoint(e){if(!connected||!current||blocked||e.target?.closest('.window-control'))return null;const b=viewport.getBoundingClientRect();return PortalGeometry.point(e.clientX-b.left,e.clientY-b.top,b,current.contentRect);}
let pendingMove,moveScheduled=false;const heldKeys=new Set();
viewport.tabIndex=0;
viewport.addEventListener('pointerdown',e=>{if(!capabilities.includes('pointer')||e.target.closest('.drag-region'))return;const p=remotePoint(e);if(!p||e.button>2)return;pendingMove=null;e.preventDefault();viewport.focus();viewport.setPointerCapture(e.pointerId);api.input('pointer',{phase:'down',button:e.button,...p});});
viewport.addEventListener('pointermove',e=>{if(!capabilities.includes('pointer'))return;const p=remotePoint(e);if(!p)return;pendingMove=p;if(moveScheduled)return;moveScheduled=true;requestAnimationFrame(()=>{moveScheduled=false;if(pendingMove&&!blocked&&connected)api.input('pointer',{phase:'move',button:0,...pendingMove});pendingMove=null;});});
viewport.addEventListener('pointerup',e=>{if(!capabilities.includes('pointer'))return;pendingMove=null;const p=remotePoint(e);if(p&&e.button<=2)api.input('pointer',{phase:'up',button:e.button,...p});else if(capabilities.includes('releaseAll'))api.input('releaseAll',{});if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);});
viewport.addEventListener('pointercancel',()=>{pendingMove=null;if(capabilities.includes('releaseAll'))api.input('releaseAll',{});});
viewport.addEventListener('wheel',e=>{if(!capabilities.includes('wheel'))return;const p=remotePoint(e);if(!p)return;e.preventDefault();const unit=e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1;api.input('wheel',{...p,deltaX:Math.max(-4096,Math.min(4096,e.deltaX*unit)),deltaY:Math.max(-4096,Math.min(4096,e.deltaY*unit))});},{passive:false});
const hid={Enter:40,Escape:41,Backspace:42,Tab:43,Space:44,Minus:45,Equal:46,BracketLeft:47,BracketRight:48,Backslash:49,Semicolon:51,Quote:52,Backquote:53,Comma:54,Period:55,Slash:56,CapsLock:57,Insert:73,Home:74,PageUp:75,Delete:76,End:77,PageDown:78,ArrowRight:79,ArrowLeft:80,ArrowDown:81,ArrowUp:82,ControlLeft:224,ShiftLeft:225,AltLeft:226,MetaLeft:227,ControlRight:228,ShiftRight:229,AltRight:230,MetaRight:231};
for(let i=0;i<26;i++)hid['Key'+String.fromCharCode(65+i)]=4+i;
for(let i=1;i<=9;i++)hid['Digit'+i]=29+i;hid.Digit0=39;
for(let i=1;i<=12;i++)hid['F'+i]=57+i;
viewport.addEventListener('keydown',e=>{
 if(!connected||blocked||e.isComposing)return;
 if(e.ctrlKey&&e.shiftKey&&['m','q'].includes(e.key.toLowerCase()))return;
 if(capabilities.includes('text')&&e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault();api.input('text',{text:e.key});return;}
 const usage=hid[e.code];if(capabilities.includes('key')&&usage){e.preventDefault();heldKeys.add(usage);api.input('key',{phase:'down',usage});}
});
viewport.addEventListener('keyup',e=>{const usage=hid[e.code];if(heldKeys.delete(usage)&&connected){e.preventDefault();if(!blocked)api.input('key',{phase:'up',usage});else if(capabilities.includes('releaseAll'))api.input('releaseAll',{});}});
viewport.addEventListener('compositionend',e=>{if(connected&&!blocked&&capabilities.includes('text')&&e.data)api.input('text',{text:e.data});});
window.addEventListener('blur',()=>{heldKeys.clear();pendingMove=null;});
