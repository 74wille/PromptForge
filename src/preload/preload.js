'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// Renderaren kor utan Node-atkomst. Allt den far gora gar genom den har ytan,
// vilket haller node-pty och filsystemet inlast i huvudprocessen.
contextBridge.exposeInMainWorld('forge', {
  describe: () => ipcRenderer.invoke('env:describe'),
  spawn: options => ipcRenderer.invoke('pty:spawn', options),
  write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: id => ipcRenderer.send('pty:kill', { id }),
  detachSession: payload => ipcRenderer.invoke('session:detach', payload),
  dockSession: payload => ipcRenderer.invoke('session:dock', payload),
  dragStart: payload => ipcRenderer.send('drag:start', payload),
  dragEnd: () => ipcRenderer.send('drag:end'),
  onDockTarget: callback => ipcRenderer.on('dock:target', (event, payload) => callback(payload)),
  pendingAdopt: () => ipcRenderer.invoke('session:pendingAdopt'),
  onAdopt: callback => ipcRenderer.on('session:adopt', (event, payload) => callback(payload)),
  notifySession: payload => ipcRenderer.send('notify:session', payload),
  reportUi: payload => ipcRenderer.send('ui:report', payload),
  onFocusSession: callback => ipcRenderer.on('session:focus', (event, payload) => callback(payload)),
  copy: text => ipcRenderer.send('clipboard:write', text),
  paste: () => ipcRenderer.invoke('clipboard:read'),
  openLink: url => ipcRenderer.send('link:open', url),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  pickExe: () => ipcRenderer.invoke('dialog:pickExe'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    confirmClose: () => ipcRenderer.send('window:closeConfirmed'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onStateChange: callback => ipcRenderer.on('window:state', (event, payload) => callback(payload)),
    onConfirmClose: callback => ipcRenderer.on('window:confirmClose', () => callback()),
  },
  onData: callback => ipcRenderer.on('pty:data', (event, payload) => callback(payload)),
  onExit: callback => ipcRenderer.on('pty:exit', (event, payload) => callback(payload)),
  onOpenFolder: callback => ipcRenderer.on('app:openFolder', (event, folder) => callback(folder)),
})
