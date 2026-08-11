'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// Notisrutan behöver bara två saker: öppna sessionen den gäller, eller
// försvinna. Därför en egen, minimal brygga i stället för programmets stora.
contextBridge.exposeInMainWorld('toast', {
  open: () => ipcRenderer.send('toast:open'),
  dismiss: () => ipcRenderer.send('toast:dismiss'),
  // Fönstret är större än kortet för att skuggan ska få plats. Ytan runtom
  // släpper igenom klick tills pekaren är över själva kortet.
  setInteractive: active => ipcRenderer.send('toast:interactive', active),
})
