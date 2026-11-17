const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('native title drag elements survive frame refresh and change only with layout',async()=>{
 const handlers={},elements={};
 function element(){return {style:{},children:[],clientWidth:800,clientHeight:550,addEventListener(){},replaceChildren(){this.children=[];},append(e){this.children.push(e);},getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}};}
 for(const id of ['frame','notice','search','viewport','drag'])elements[id]=element();
 const context={window:{portal:{on:(n,f)=>handlers[n]=f,displayed(){},failed(){throw Error('decode failed')},input(){},local(){}},addEventListener(){}},document:{getElementById:id=>elements[id],createElement:()=>element(),addEventListener(){}},PortalGeometry:require('./geometry.js'),Image:class{async decode(){}},ResizeObserver:class{observe(){}},requestAnimationFrame(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'renderer.js'),'utf8'),context);
 handlers.metadata({logicalSize:{width:800,height:550},capabilities:['sourceDragRegions'],dragRegions:[{x:243,y:13,width:282,height:26}]});
 const frame={seq:1,image:'test',pixelSize:{width:1600,height:1100},contentRect:{x:0,y:0,width:1600,height:1100}};
 await handlers.frame(frame);const original=elements.drag.children[0];assert.ok(original);assert.ok(Math.abs(parseFloat(original.style.left)-243)<1e-6);
 await handlers.frame({...frame,seq:2});handlers['interaction-state']({blocked:false});assert.equal(elements.drag.children[0],original);
 handlers['interaction-state']({blocked:true});assert.equal(elements.drag.children.length,0);
 handlers['interaction-state']({blocked:false});assert.notEqual(elements.drag.children[0],original);
});

