const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupApi', {
  getStatus: () => ipcRenderer.invoke('setup:status'),
  complete: (input) => ipcRenderer.invoke('setup:complete', input),
});
