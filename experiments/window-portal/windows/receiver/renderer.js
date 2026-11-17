const api=window.portal,img=document.getElementById('frame'),notice=document.getElementById('notice'),form=document.getElementById('search'),viewport=document.getElementById('viewport'),drag=document.getElementById('drag');
let current,metadata,capabilities=[],connected=true,loading=false,blocked=false;
function redraw(){
 if(!current||!metadata)return;
 const v={width:viewport.clientWidth,height:viewport.clientHeight},c=current.contentRect,b=PortalGeometry.layout(v,c);
 Object.assign(img.style,{width:current.pixelSize.width*b.scale+'px',height:current.pixelSize.height*b.scale+'px',left:b.x-c.x*b.scale+'px',top:b.y-c.y*b.scale+'px'});
 img.style.clipPath=`inset(${100*c.y/current.pixelSize.height}% ${100*(current.pixelSize.width-c.x-c.width)/current.pixelSize.width}% ${100*(current.pixelSize.height-c.y-c.height)/current.pixelSize.height}% ${100*c.x/current.pixelSize.width}%)`;
 drag.replaceChildren();
 if(blocked)return;
 const regions=capabilities.includes('sourceDragRegions')?(metadata.dragRegions||[]):[{x:metadata.logicalSize.width*.35,y:0,width:metadata.logicalSize.width*.3,height:8}];
 for(const r of regions){const b=PortalGeometry.region(r,metadata.logicalSize,v,c),el=document.createElement('div');el.className='drag-region';Object.assign(el.style,{left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px'});drag.append(el);}
}
api.on('metadata',m=>{metadata=m;capabilities=m.capabilities;current=null;drag.replaceChildren();});
api.on('interaction-state',m=>{blocked=m.blocked;redraw();});
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
 if(!capabilities.includes('pressAt')){notice.textContent='This source does not yet support clicks';notice.hidden=false;return;}
 const b=viewport.getBoundingClientRect(),p=PortalGeometry.point(e.clientX-b.left,e.clientY-b.top,b,current.contentRect);
 if(p)api.input('pressAt',p);
};
form.onsubmit=e=>{e.preventDefault();if(!connected||blocked)return;api.input('setSearchText',{text:document.getElementById('query').value});if(capabilities.includes('confirmSearch'))api.input('confirmSearch',{});form.hidden=true;};
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='m'){e.preventDefault();api.local('minimize')}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='q'){e.preventDefault();api.local('close')}});
