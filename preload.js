const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => Promise.resolve(process.versions.electron)
});
