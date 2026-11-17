const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('native title drag elements survive frame refresh and change only with layout',async()=>{
 const handlers={},elements={},local=[];
 function element(){return {style:{},children:[],clientWidth:800,clientHeight:550,addEventListener(){},replaceChildren(){this.children=[];},append(e){this.children.push(e);},getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}};}
 for(const id of ['frame','notice','search','viewport','drag'])elements[id]=element();
 const context={window:{portal:{on:(n,f)=>handlers[n]=f,displayed(){},failed(){throw Error('decode failed')},input(){throw Error('Local control reached source')},local:a=>local.push(a)},addEventListener(){}},document:{getElementById:id=>elements[id],createElement:()=>element(),addEventListener(){}},PortalGeometry:require('./geometry.js'),Image:class{async decode(){}},ResizeObserver:class{observe(){}},requestAnimationFrame(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'renderer.js'),'utf8'),context);
 handlers.metadata({logicalSize:{width:800,height:550},capabilities:['sourceDragRegions','receiverWindowControls'],dragRegions:[{x:243,y:13,width:282,height:26}],windowControls:[{action:'minimize',x:20,y:12,width:12,height:12}]});
 const frame={seq:1,image:'test',pixelSize:{width:1600,height:1100},contentRect:{x:0,y:0,width:1600,height:1100}};
 await handlers.frame(frame);const original=elements.drag.children[0];assert.ok(original);assert.ok(Math.abs(parseFloat(original.style.left)-243)<1e-6);
 await handlers.frame({...frame,seq:2});handlers['interaction-state']({blocked:false});assert.equal(elements.drag.children[0],original);
 handlers['interaction-state']({blocked:true});assert.equal(elements.drag.children.length,0);
 handlers['interaction-state']({blocked:false});assert.notEqual(elements.drag.children[0],original);
 elements.drag.children[1].onclick({stopPropagation(){}});assert.deepEqual(local,['minimize']);
});


test('ordinary pointer pairs do not duplicate semantic clicks or replay queued movement',async()=>{
 const handlers={},elements={},sent=[],raf=[];
 function element(){return {style:{},children:[],listeners:{},clientWidth:800,clientHeight:550,addEventListener(n,f){this.listeners[n]=f;},replaceChildren(){this.children=[];},append(e){this.children.push(e);},getBoundingClientRect(){return {left:0,top:0,width:800,height:550};},focus(){},setPointerCapture(){},hasPointerCapture(){return false;}};}
 for(const id of ['frame','notice','search','viewport','drag'])elements[id]=element();
 const context={window:{portal:{on:(n,f)=>handlers[n]=f,displayed(){},failed(){throw Error('decode failed')},input:(op,args)=>sent.push({op,args}),local(){}},addEventListener(){}},document:{getElementById:id=>elements[id],createElement:()=>element(),addEventListener(){}},PortalGeometry:require('./geometry.js'),Image:class{async decode(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:f=>raf.push(f)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'renderer.js'),'utf8'),context);
 handlers.metadata({logicalSize:{width:800,height:550},capabilities:['pointer','pressAt','releaseAll']});
 await handlers.frame({seq:1,image:'test',pixelSize:{width:1600,height:1100},contentRect:{x:0,y:0,width:1600,height:1100}});
 const v=elements.viewport,e={clientX:400,clientY:275,button:0,pointerId:1,target:{closest:()=>null},preventDefault(){}};
 v.listeners.pointermove({...e,clientX:100});v.listeners.pointerdown(e);v.listeners.pointerup(e);for(const f of raf)f();v.onclick(e);
 assert.equal(sent.length,2);assert.equal(sent[0].op,'pointer');assert.equal(sent[0].args.phase,'down');assert.equal(sent[0].args.x,.5);assert.equal(sent[0].args.button,0);assert.equal(sent[1].args.phase,'up');assert.equal('modifiers' in sent[0].args,false);
 v.listeners.pointerup({...e,clientX:-1});assert.equal(sent.at(-1).op,'releaseAll');
 v.listeners.pointercancel();assert.equal(sent.at(-1).op,'releaseAll');
});

test('document-focused keyboard routes text once and pairs navigation keys',async()=>{
 const handlers={},events={},elements={},sent=[];
 function element(){return {hidden:true,style:{},children:[],clientWidth:800,clientHeight:550,addEventListener(){},replaceChildren(){this.children=[]},append(e){this.children.push(e)},getBoundingClientRect(){return {left:0,top:0,width:800,height:550}}};}
 for(const id of ['frame','notice','search','viewport','drag'])elements[id]=element();
 const ctx={window:{portal:{on:(n,f)=>handlers[n]=f,input:(op,args)=>sent.push({op,args}),local(){},displayed(){},failed(){}},addEventListener(){}},document:{getElementById:id=>elements[id],createElement:element,addEventListener:(n,f)=>(events[n]??=[]).push(f)},PortalGeometry:require('./geometry.js'),Image:class{async decode(){}},ResizeObserver:class{observe(){}},requestAnimationFrame(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'renderer.js'),'utf8'),ctx);
 handlers.metadata({logicalSize:{width:800,height:550},capabilities:['key','text','releaseAll']});
 const fire=(type,patch)=>{const e={key:'a',code:'KeyA',target:{closest:()=>null},preventDefault(){},...patch};for(const fn of events[type]||[])fn(e);};
 fire('keydown',{});fire('keyup',{});fire('keydown',{key:'ArrowDown',code:'ArrowDown'});fire('keyup',{key:'ArrowDown',code:'ArrowDown'});
 assert.deepEqual(sent.map(s=>s.op),['text','key','key']);assert.equal(sent[1].args.usage,81);assert.equal(sent[2].args.phase,'up');
 elements.search.hidden=false;fire('keydown',{});assert.equal(sent.length,3);
});
