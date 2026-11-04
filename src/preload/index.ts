import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeInfo, WorkspaceBridge } from '../shared/desktop.js';

const info = ipcRenderer.sendSync('app:bridge-info') as BridgeInfo;

const bridge: WorkspaceBridge = {
  ...info,
  chooseDirectory: () => ipcRenderer.invoke('dialog:choose-directory') as Promise<string | null>,
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path) as Promise<string>,
  showItemInFolder: (path: string) => ipcRenderer.invoke('shell:show-item', path) as Promise<void>,
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  hideWindow: () => ipcRenderer.invoke('app:hide') as Promise<void>,
};

contextBridge.exposeInMainWorld('workspace', bridge);
