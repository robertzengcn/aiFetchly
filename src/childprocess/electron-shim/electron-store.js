"use strict";

class ElectronStoreShim {
  constructor(options = {}) {
    this.path =
      options.cwd ?? process.env.ELECTRON_USER_DATA_PATH ?? process.cwd();
  }

  get() {
    return undefined;
  }

  set() {
    return undefined;
  }

  delete() {
    return undefined;
  }

  clear() {
    return undefined;
  }
}

export default ElectronStoreShim;
