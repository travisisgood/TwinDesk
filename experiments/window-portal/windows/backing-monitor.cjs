'use strict';
// The display lifetime is independent of every window and receiver connection.
// This experiment adopts the current layout; it never guesses the Mac's location.
class BackingMonitor {
  constructor({list,enable,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
    Object.assign(this,{list,enable,wait});this.pending=null;this.monitor=null;
  }
  acquire() {
    if(this.pending)return this.pending;
    this.pending=this.prepare().catch(e=>{this.pending=null;throw e});
    return this.pending;
  }
  async prepare() {
    const find=ds=>ds.find(d=>/virtual display driver/i.test(d.adapter||''));
    let mon=find(await this.list());
    if(!mon){
      await this.enable(); // one setup operation; never called from a window drag
      for(let i=0;i<40&&!mon;i++){await this.wait(500);mon=find(await this.list());}
    }
    if(!mon)throw Error('Backing display unavailable; leave windows at home. No automatic disable/re-enable.');
    this.monitor=mon;return mon;
  }
  async verify() {
    const now=(await this.list()).find(d=>d.name===this.monitor?.name);
    if(!now||['x','y','width','height'].some(k=>now[k]!==this.monitor[k]))throw Error('Backing display changed; restore source without changing display topology.');
    return now;
  }
  releaseWindow() {} // Returning a window must NEVER remove its backing display.
}
module.exports=BackingMonitor;
