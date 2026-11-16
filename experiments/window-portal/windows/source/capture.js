(async()=>{
 const info=await window.capture.source(),video=document.getElementById('source');
 const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:info.sourceId,maxWidth:1920,maxHeight:1200,maxFrameRate:15}}});
 video.srcObject=stream;await video.play();
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
 const scale=Math.min(1,1920/video.videoWidth,1200/video.videoHeight);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
 async function frame(){
  if(stream.getVideoTracks()[0].readyState!=='live'){window.capture.failure('Capture ended');return;}
  context.drawImage(video,0,0,canvas.width,canvas.height);
  window.capture.frame({pixelSize:{width:canvas.width,height:canvas.height},contentRect:{x:0,y:0,width:canvas.width,height:canvas.height},captureMode:'stream',png:canvas.toDataURL('image/png').split(',')[1]});
  setTimeout(frame,150);
 }frame();
})().catch(e=>window.capture.failure(e.message));
