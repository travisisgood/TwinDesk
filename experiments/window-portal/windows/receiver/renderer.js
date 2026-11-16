const api=window.portal,img=document.getElementById('frame'),notice=document.getElementById('notice'),form=document.getElementById('search');
let current,capabilities=[],connected=true,loading=false;
api.on('metadata',m=>{capabilities=m.capabilities;current=null;});
api.on('frame',async m=>{
 if(loading){api.failed();return;}loading=true;
 try{const next=new Image();next.src=m.image;await next.decode();if(!connected)return;img.src=m.image;current=m;notice.hidden=true;api.displayed(m.seq)}catch{api.failed()}finally{loading=false}
});
api.on('notice',text=>{notice.textContent=text;notice.hidden=false;});
api.on('disconnected',text=>{connected=false;current=null;document.body.classList.add('disconnected');notice.textContent='Disconnected — '+text;notice.hidden=false;form.hidden=true;});
api.on('search',()=>{if(connected){form.hidden=false;document.getElementById('query').focus()}});
img.onclick=e=>{
 if(!connected||!current||!capabilities.includes('pressAt'))return;
 const b=img.getBoundingClientRect(),p=current.pixelSize,c=current.contentRect;
 const scale=Math.min(b.width/p.width,b.height/p.height),ox=b.left+(b.width-p.width*scale)/2,oy=b.top+(b.height-p.height*scale)/2;
 const x=((e.clientX-ox)/scale-c.x)/c.width,y=((e.clientY-oy)/scale-c.y)/c.height;
 if(x>=0&&x<=1&&y>=0&&y<=1)api.input('pressAt',{x,y});
};
form.onsubmit=e=>{e.preventDefault();if(!connected)return;api.input('setSearchText',{text:document.getElementById('query').value});if(capabilities.includes('confirmSearch'))api.input('confirmSearch',{});form.hidden=true;};
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='m'){e.preventDefault();api.local('minimize')}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='q'){e.preventDefault();api.local('close')}});
