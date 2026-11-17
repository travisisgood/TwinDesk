(function(root){
 'use strict';
 function layout(viewport,content){
  const scale=Math.min(viewport.width/content.width,viewport.height/content.height);
  return {scale,x:(viewport.width-content.width*scale)/2,y:(viewport.height-content.height*scale)/2,width:content.width*scale,height:content.height*scale};
 }
 function point(x,y,viewport,content){const b=layout(viewport,content),nx=(x-b.x)/b.width,ny=(y-b.y)/b.height;return nx>=0&&nx<=1&&ny>=0&&ny<=1?{x:nx,y:ny}:null;}
 function region(rect,logical,viewport,content){const b=layout(viewport,content);return {x:b.x+rect.x/logical.width*b.width,y:b.y+rect.y/logical.height*b.height,width:rect.width/logical.width*b.width,height:rect.height/logical.height*b.height};}
 const api={layout,point,region};if(typeof module==='object')module.exports=api;else root.PortalGeometry=api;
})(globalThis);
