'use strict';
const api=window.portal,video=document.getElementById('video'),status=document.getElementById('status'),select=document.getElementById('sources');
let stream,printGeneration=0,testMode=false;
const printImage=document.getElementById('printImage');
async function showPrint(){
  const generation=++printGeneration;
  const enabled=document.getElementById('print').checked&&!testMode;
  video.style.display=enabled?'none':'block';printImage.style.display=enabled?'block':'none';
  if(!enabled)return;
  while(generation===printGeneration){
    try{const frame=await api.snapshot();if(generation!==printGeneration)return;printImage.src=frame.image}
    catch(e){status.textContent=e.message;return}
    await sleep(250);
  }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function refresh(){const rows=await api.sources();select.replaceChildren(...rows.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o}));return rows}
async function open(id){
  if(stream)stream.getTracks().forEach(t=>t.stop());
  await api.select(id);
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:id,minWidth:2,minHeight:2,maxWidth:3840,maxHeight:2160,maxFrameRate:30}}});
  video.srcObject=stream;await video.play();status.textContent='Live copy opened. Source remains unchanged until Hide original is pressed.';
  if(!testMode)showPrint();
}
async function action(fn){try{await fn()}catch(e){status.textContent=e.message;await api.report({error:e.message})}}
document.getElementById('refresh').onclick=()=>action(refresh);
document.getElementById('open').onclick=()=>action(()=>open(select.value));
document.getElementById('hide').onclick=()=>action(async()=>{await api.native('cloak',{on:true});status.textContent='Original cloaked. Check whether the copy still updates; a visible image may be stale.'});
document.getElementById('restore').onclick=()=>action(async()=>{await api.native('restore');status.textContent='Original restored.'});
document.getElementById('park').onclick=()=>action(async()=>{await api.native('park');status.textContent='Original moved outside the desktop; no monitor was added.'});
document.getElementById('print').onchange=()=>action(showPrint);
for(const preview of [video,printImage])preview.onclick=e=>{preview.focus();if(!document.getElementById('input').checked)return;const r=preview.getBoundingClientRect();action(()=>api.native('click',{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}))};
window.addEventListener('keydown',e=>{if(document.getElementById('input').checked&&e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&[document.body,video,printImage].includes(e.target)){e.preventDefault();action(()=>api.native('text',{text:e.key}))}});
async function sample(phase){
  const canvas=document.createElement('canvas');canvas.width=80;canvas.height=50;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const hashes=[],nativeHashes=[],printHashes=[];let mean=0,printError='';
  for(let i=0;i<8;i++){await sleep(300);ctx.drawImage(video,0,0,80,50);const data=ctx.getImageData(0,0,80,50).data;let hash=2166136261,total=0;for(let j=0;j<data.length;j+=4){hash=Math.imul(hash^data[j],16777619);hash=Math.imul(hash^data[j+1],16777619);total+=data[j]+data[j+1]+data[j+2]}hashes.push(hash>>>0);mean=total/(80*50*3);const n=await api.native('status');if(n.wgc?.frames)nativeHashes.push(n.wgc.hash)}
  for(let i=0;i<4;i++){try{const frame=await api.snapshot();printHashes.push(frame.hash)}catch(e){printError=e.message;break}await sleep(300)}
  const r={phase,uniqueFrames:new Set(hashes).size,nativeWgcUniqueFrames:new Set(nativeHashes).size,printUniqueFrames:new Set(printHashes).size,printError,meanBrightness:Math.round(mean),width:video.videoWidth,height:video.videoHeight,native:await api.native('status')};await api.report(r);return r;
}
(async()=>{
  const mode=await api.mode();let rows=await refresh();
  testMode=mode.selfTest||mode.scarlettProbe||mode.explorerProbe;
  if(!testMode&&!mode.demo)return;
  let source;
  for(let attempt=0;attempt<12;attempt++){
    source=(mode.selfTest||mode.demo)?rows.find(s=>s.id.startsWith('window:'+mode.fixture+':')):mode.explorerProbe?rows.find(s=>s.name.includes('WindowPortal Explorer Test')):rows.find(s=>/Scarlett.*Device Settings/i.test(s.name));
    if(source)break;
    await sleep(500);rows=await refresh();
  }
  await api.report({enumeration:{fixture:mode.fixture,count:rows.length,testSourceIds:rows.filter(s=>/WindowPortal Test Source/.test(s.name)).map(s=>s.id),explorerCandidates:mode.explorerProbe?rows.filter(s=>/Explorer|WindowPortal/.test(s.name)).map(s=>s.name):[]}});
  if(!source)throw Error('Requested test source was not found');
  if(mode.demo){select.value=source.id;await open(source.id);return;}
  const results={source:source.name};
  try{
    await open(source.id);await sleep(800);results.visible=await sample('visible');
    try{await api.native('cloak',{on:true});await sleep(800);results.cloaked=await sample('cloaked');await api.native('restore');}
    catch(e){results.cloakError=e.message;await api.report({phase:'cloak-rejected',error:e.message})}
    await api.native('park');await sleep(800);results.offscreen=await sample('offscreen');
    if(mode.explorerProbe){
      const before=await api.snapshot();await api.saveProof('before',before.image);
      await api.explorerMutation();await sleep(1500);
      const after=await api.snapshot();await api.saveProof('after',after.image);
      results.explorerContentChangedOffscreen=before.hash!==after.hash;
    }
    if(mode.selfTest){
      // Known disposable form only: center of button in captured frame.
      const before=await api.native('status');
      const route=await api.native('click',mode.fixturePoint);await sleep(400);
      const after=await api.native('status');results.input={route:route.route,clickBefore:before.clicks,clickAfter:after.clicks,accepted:after.clicks>before.clicks};
    }
  }finally{await api.native('restore');}
  await sleep(600);results.restored=await sample('restored');
  await api.report({finished:true,...results});
})().catch(async e=>{status.textContent=e.message;try{await api.native('restore')}catch{}await api.report({finished:true,error:e.message})});
