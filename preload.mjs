import { contextBridge, ipcRenderer, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    on: (...args) => ipcRenderer.on(...args),
    invoke: (...args) => ipcRenderer.invoke(...args),
    send: (...args) => ipcRenderer.send(...args),
    removeListener: (...args) => ipcRenderer.removeListener(...args),
    once: (...args) => ipcRenderer.once(...args),
  },
  shell
});

contextBridge.exposeInMainWorld('electronAPI', {
  //BrowserWindow methods
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  //WebContents methods
  toggleDevTools: () => ipcRenderer.send('window-toggle-devtools'),
  // FS methods
  existsSync: (filePath) => fs.existsSync(filePath),
  readFileSync: (filePath, encoding = 'utf8') => fs.readFileSync(filePath, encoding),
  writeFileSync: (filePath, data, encoding = 'utf8') => fs.writeFileSync(filePath, data, encoding),
  openSync: (filePath, flags) => fs.openSync(filePath, flags),
  readSync: (fd, buffer, offset, length, position) => fs.readSync(fd, buffer, offset, length, position),
  closeSync: (fd) => fs.closeSync(fd),
  unlink: (filePath, cb) => fs.unlink(filePath, cb),
  readdirSync: (dirPath) => fs.readdirSync(dirPath),
  //Path methods
  joinPath: (...args) => path.join(...args),
  // Add process spawning APIs
  spawnProcess: (command, args, options) => ipcRenderer.send('spawn-process', { command, args, options }),
  execProcess: (command, options) => ipcRenderer.send('exec-process', { command, options }),
  forkProcess: (modulePath, options) => ipcRenderer.send('fork-process', { modulePath, options }),
  sendToFork: (data) => ipcRenderer.send('send-to-fork', data),
  killFork: (forkId) => ipcRenderer.send('kill-fork', { forkId }),
  // OS methods
  osHomedir: () => os.homedir(),
  osPlatform: () => os.platform(),
});