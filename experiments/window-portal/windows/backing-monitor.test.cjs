const {test}=require('node:test'),assert=require('node:assert/strict');
const Backing=require('./backing-monitor.cjs');
const mon={name:'virtual',adapter:'Virtual Display Driver',x:100,y:0,width:1440,height:900};
test('existing display is adopted; concurrent windows and returns never toggle it',async()=>{
 let enables=0;const b=new Backing({list:async()=>[mon],enable:async()=>enables++});
 await Promise.all([b.acquire(),b.acquire()]);b.releaseWindow();await b.acquire();assert.equal(enables,0);
});
test('setup enables exactly once and waits for enumeration',async()=>{
 let enables=0,calls=0;const b=new Backing({list:async()=>++calls>2?[mon]:[],enable:async()=>enables++,wait:async()=>{}});
 await Promise.all([b.acquire(),b.acquire()]);assert.equal(enables,1);
});
test('topology loss fails without cycling monitor',async()=>{
 let ds=[mon];const b=new Backing({list:async()=>ds,enable:async()=>assert.fail('unexpected enable')});
 await b.acquire();ds=[];await assert.rejects(b.verify(),/changed/);
});
