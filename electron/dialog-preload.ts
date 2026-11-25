import { contextBridge, ipcRenderer } from 'electron';
import type { SystemDialogApi } from '../shared/types';

contextBridge.exposeInMainWorld('kjmclDialog', {
  read: () => ipcRenderer.invoke('kjmcl-dialog:read'),
  ready: (height) => ipcRenderer.send('kjmcl-dialog:ready', height),
  choose: (index) => ipcRenderer.send('kjmcl-dialog:choose', index),
} satisfies SystemDialogApi);
