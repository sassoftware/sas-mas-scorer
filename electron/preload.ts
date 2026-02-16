// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Electron preload script — exposes IPC bridge to renderer via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Connection management
  getAllConnections: () => ipcRenderer.invoke('conn:getAll'),
  getActiveConnection: () => ipcRenderer.invoke('conn:getActive'),
  addConnection: (conn: unknown) => ipcRenderer.invoke('conn:add', conn),
  updateConnection: (conn: unknown) => ipcRenderer.invoke('conn:update', conn),
  deleteConnection: (id: string) => ipcRenderer.invoke('conn:delete', id),
  setActiveConnection: (id: string) => ipcRenderer.invoke('conn:setActive', id),

  // Backward-compat alias (used by client.ts interceptor)
  getConnection: () => ipcRenderer.invoke('conn:getActive'),

  // Auth flow
  startLogin: () => ipcRenderer.invoke('auth:startLogin'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),
  getAccessToken: () => ipcRenderer.invoke('auth:getAccessToken'),

  // Server URL
  getViyaUrl: () => ipcRenderer.invoke('auth:getViyaUrl'),

  // Platform detection
  isElectron: true,
});
