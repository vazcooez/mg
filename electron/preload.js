'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  vault: {
    get: () => ipcRenderer.invoke('vault:get'),
    list: () => ipcRenderer.invoke('vault:list'),
    choose: () => ipcRenderer.invoke('vault:choose'),
    reveal: () => ipcRenderer.invoke('vault:reveal'),
  },
  file: {
    read: (rel) => ipcRenderer.invoke('file:read', rel),
    write: (rel, content) => ipcRenderer.invoke('file:write', rel, content),
    stat: (rel) => ipcRenderer.invoke('file:stat', rel),
    rename: (from, to) => ipcRenderer.invoke('file:rename', from, to),
    trash: (rel) => ipcRenderer.invoke('file:trash', rel),
    reveal: (rel) => ipcRenderer.invoke('file:reveal', rel),
    unique: (rel) => ipcRenderer.invoke('file:unique', rel),
    writeBinary: (rel, bytes) => ipcRenderer.invoke('file:write-binary', rel, bytes),
    mkdir: (rel) => ipcRenderer.invoke('dir:create', rel),
  },
  session: {
    read: () => ipcRenderer.invoke('session:read'),
    write: (data) => ipcRenderer.invoke('session:write', data),
  },
  app: {
    closeAction: () => ipcRenderer.invoke('app:close-action'),
    setCloseAction: (action) => ipcRenderer.invoke('app:set-close-action', action),
  },
  dialog: {
    savePath: (name, type) => ipcRenderer.invoke('dialog:save-path', name, type),
    confirmClose: (title, neverSaved) =>
      ipcRenderer.invoke('dialog:confirm-close', title, neverSaved),
    message: (message, detail) => ipcRenderer.invoke('dialog:message', message, detail),
  },
  setUiScale: (factor) => ipcRenderer.invoke('ui:scale', factor),
  exportFile: (defaultName, content) => ipcRenderer.invoke('export:file', defaultName, content),
  onMenu: (handler) => {
    const listener = (_e, action) => handler(action);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
  onVaultChanged: (handler) => {
    const listener = (_e, name) => handler(name);
    ipcRenderer.on('vault-changed', listener);
    return () => ipcRenderer.removeListener('vault-changed', listener);
  },
  // The tray menu can change the close behaviour too, so Settings follows it.
  onCloseAction: (handler) => {
    const listener = (_e, action) => handler(action);
    ipcRenderer.on('close-action', listener);
    return () => ipcRenderer.removeListener('close-action', listener);
  },
});
