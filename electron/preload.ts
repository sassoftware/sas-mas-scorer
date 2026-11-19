// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Electron preload script — exposes IPC bridge to renderer via contextBridge.
 *
 * The SAS Viya access token is deliberately not exposed: requests go through
 * httpRequest, and the main process adds the token (electron/httpBridge.ts).
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** Local containers: run SCR images with Podman or Docker (electron/containers). */
const containers = Object.freeze({
  status: () => ipcRenderer.invoke('containers:status'),
  setEngine: (choice: string) => ipcRenderer.invoke('containers:setEngine', { choice }),
  startMachine: () => ipcRenderer.invoke('containers:startMachine'),
  deploy: (req: unknown) => ipcRenderer.invoke('containers:deploy', req),
  cancel: (opId: string) => ipcRenderer.invoke('containers:cancel', { opId }),
  list: () => ipcRenderer.invoke('containers:list'),
  start: (managedId: string) => ipcRenderer.invoke('containers:start', { managedId }),
  stop: (managedId: string) => ipcRenderer.invoke('containers:stop', { managedId }),
  remove: (managedId: string) => ipcRenderer.invoke('containers:remove', { managedId }),
  logs: (managedId: string, lines: number) => ipcRenderer.invoke('containers:logs', { managedId, lines }),
  settings: (managedId: string) => ipcRenderer.invoke('containers:settings', { managedId }),
  update: (req: unknown) => ipcRenderer.invoke('containers:update', req),
  chooseFolder: () => ipcRenderer.invoke('containers:chooseFolder'),
  stats: () => ipcRenderer.invoke('containers:stats'),
  /** The page gets the event payload only, never the IPC event object. */
  onEvent: (callback: (payload: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('containers:event', listener);
    return () => {
      ipcRenderer.removeListener('containers:event', listener);
    };
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  // Connection management
  getAllConnections: () => ipcRenderer.invoke('conn:getAll'),
  getActiveConnection: () => ipcRenderer.invoke('conn:getActive'),
  addConnection: (conn: unknown) => ipcRenderer.invoke('conn:add', conn),
  updateConnection: (conn: unknown) => ipcRenderer.invoke('conn:update', conn),
  deleteConnection: (id: string) => ipcRenderer.invoke('conn:delete', id),
  setActiveConnection: (id: string) => ipcRenderer.invoke('conn:setActive', id),

  // Backward-compat alias
  getConnection: () => ipcRenderer.invoke('conn:getActive'),

  // Auth flow
  startLogin: () => ipcRenderer.invoke('auth:startLogin'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),

  // Server URL
  getViyaUrl: () => ipcRenderer.invoke('auth:getViyaUrl'),

  // HTTP bridge: SAS Viya (token added in main) and SCR endpoints
  httpRequest: (req: unknown) => ipcRenderer.invoke('http:request', req),
  httpAbort: (id: string) => ipcRenderer.invoke('http:abort', id),

  // Local containers
  containers,

  // Platform detection
  isElectron: true,
});
