// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * IPC for local containers.
 *
 * Every handler goes through the main window's trusted-sender check, input is
 * read against closed schemas, lifecycle calls take the app's own managed IDs
 * (never an engine ID from the page), and anything that pulls, runs, deletes
 * or starts a machine needs a native confirmation.
 */

import path from 'node:path';
import { app, dialog, session, type BrowserWindow, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron';
import { ContainerService, type ConfirmRequest } from './service';
import { ContainerStore } from './store';
import { checkHostFolder, hostFolderContext } from './mounts';
import type { AnonymousFetch } from './registry';
import { readEngineChoice, readManagedId, readOpId } from './validate';
import type { ContainersEvent, OpResult } from './types';

type HandleTrusted = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

export interface ContainerIpcDeps {
  handle: HandleTrusted;
  getWindow: () => BrowserWindow | null;
}

/** Wraps an operation so bad input comes back as a problem, not as an IPC exception. */
const safely = async <T extends OpResult<object>>(fn: () => Promise<T> | T): Promise<T | OpResult> => {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, problem: { code: 'invalid-input', title: err instanceof Error ? err.message : String(err) } };
  }
};

function readUpdateInput(value: unknown): { opId: string; managedId: string; options: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
  for (const key of Object.keys(value)) {
    if (key !== 'opId' && key !== 'managedId' && key !== 'options') throw new Error(`Unknown field "${key}".`);
  }
  return { opId: readOpId(value), managedId: readManagedId(value), options: (value as { options?: unknown }).options };
}

function readDeployInput(value: unknown): { opId: string; imageRef: unknown; options: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
  for (const key of Object.keys(value)) {
    if (key !== 'opId' && key !== 'imageRef' && key !== 'options') throw new Error(`Unknown field "${key}".`);
  }
  const v = value as { imageRef?: unknown; options?: unknown };
  return { opId: readOpId(value), imageRef: v.imageRef, options: v.options };
}

export function registerContainerIpc({ handle, getWindow }: ContainerIpcDeps): void {
  const store = new ContainerStore(path.join(app.getPath('userData'), 'containers.json'));

  const emit = (event: ContainersEvent) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('containers:event', event);
  };

  const confirm = async (request: ConfirmRequest): Promise<boolean> => {
    const options: MessageBoxOptions = {
      type: 'question',
      title: request.title,
      message: request.message,
      detail: request.detail,
      buttons: [request.confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const win = getWindow();
    const result = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return result.response === 0;
  };

  const folderContext = hostFolderContext(app.getPath('userData'));
  // Public image manifests, for download progress: an in-memory session of its own, so no cookies,
  // and normal certificate checks even when a Viya connection turned them off for the default session.
  const fetchAnonymous: AnonymousFetch = (url, init) =>
    session.fromPartition('mas-scorer-registry').fetch(url, {
      headers: init.headers,
      signal: init.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
    });
  const service = new ContainerService({
    store,
    emit,
    confirm,
    checkFolder: (folder) => checkHostFolder(folder, folderContext),
    fetchAnonymous,
  });

  handle('containers:status', () => service.status());
  handle('containers:setEngine', (_event, value) => {
    store.setEngineChoice(readEngineChoice(value));
    return service.status();
  });
  handle('containers:startMachine', () => service.startMachine());
  handle('containers:deploy', (_event, value) =>
    safely(() => {
      const input = readDeployInput(value);
      return service.deploy(input.opId, input.imageRef, input.options);
    })
  );
  handle('containers:cancel', (_event, value) => service.cancel(readOpId(value)));
  handle('containers:list', () => service.list());
  handle('containers:start', (_event, value) => safely(() => service.start(readManagedId(value))));
  handle('containers:stop', (_event, value) => safely(() => service.stop(readManagedId(value))));
  handle('containers:remove', (_event, value) => safely(() => service.remove(readManagedId(value))));
  handle('containers:settings', (_event, value) => safely(() => service.settings(readManagedId(value))));
  handle('containers:update', (_event, value) =>
    safely(() => {
      const input = readUpdateInput(value);
      return service.update(input.opId, input.managedId, input.options);
    })
  );
  // A native folder dialog; the chosen folder is checked before the page sees it.
  handle('containers:chooseFolder', () =>
    safely(async () => {
      const win = getWindow();
      const options = { title: 'Choose a folder to mount into the container', properties: ['openDirectory' as const] };
      const result = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return { ok: false as const, problem: { code: 'cancelled' as const, title: 'No folder chosen.' } };
      return { ok: true as const, path: service.checkFolderInput(result.filePaths[0]) };
    })
  );
  handle('containers:stats', () => service.stats());
  handle('containers:logs', (_event, value) =>
    safely(() => {
      const lines = (value as { lines?: unknown } | null)?.lines;
      return service.logs(readManagedId(value), typeof lines === 'number' ? lines : 300);
    })
  );
}
