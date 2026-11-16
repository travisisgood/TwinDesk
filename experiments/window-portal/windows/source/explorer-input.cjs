'use strict';
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
module.exports=class ExplorerInput {
 constructor(executable,wid,execute=run){this.executable=executable;this.wid=wid;this.execute=execute;}
 async call(op,args=[]){
  if(!this.executable)return {error:'Explorer input helper unavailable'};
  try{const result=await this.execute(this.executable,[op,String(this.wid),...args],{windowsHide:true,timeout:2000,maxBuffer:65536});return JSON.parse(result.stdout);}catch{return {error:'Explorer input helper failed or timed out'};}
 }
 inspect(){return this.call('inspect');}
 press({x,y}){if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return Promise.resolve({error:'Invalid normalized point'});return this.call('press',[String(x),String(y)]);}
};
