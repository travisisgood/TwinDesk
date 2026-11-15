'use strict';

// A display for source windows, never a whole-desktop video session.
class AppDesktop {
  constructor({ vdd, helper, canStart, changed = () => {} }) {
    Object.assign(this, { vdd, helper, canStart, changed });
    this.revision = 0;
    this.queue = Promise.resolve();
    this.mon = null;
  }
  ensure() {
    const revision = this.revision;
    const run = async () => {
      if (revision !== this.revision) throw new Error('Window transfer cancelled');
      if (this.mon) return this.mon;
      if (!this.canStart()) throw new Error('Turn off Share screen Extend before moving individual windows');
      if (!this.vdd.state.installed) throw new Error('Moving windows needs the installed virtual display driver');
      this.vdd.appDisplay = true;
      try {
        let mon = await this.vdd.setOn(true);
        if (!mon || !mon.name) throw new Error('The app virtual display did not appear');
        if (revision !== this.revision) throw new Error('Window transfer cancelled');
        this.mon = mon;
        await this.helper.request('appDisplay', { name: mon.name });
        this.changed(mon);
        return mon;
      } catch (e) {
        await this.vdd.setOn(false).catch(() => {});
        this.vdd.appDisplay = false;
        this.mon = null;
        this.changed(null);
        throw e;
      }
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
  release() {
    ++this.revision;
    const run = async () => {
      if (!this.vdd.appDisplay) return;
      // Restore windows before removing their desktop; helper EOF also restores.
      await this.helper.request('appDisplay', { name: '' }).catch(() => {});
      await this.vdd.setOn(false).catch(() => {});
      this.mon = null;
      this.vdd.appDisplay = false;
      this.changed(null);
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
}
module.exports = AppDesktop;
