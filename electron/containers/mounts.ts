// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Which folders of this computer may be bound into a container.
 *
 * The folder must exist, and it is checked by its real path (links and
 * junctions resolved). It may not be a whole drive, and it may not be, hold or
 * sit inside a protected folder: the system folders, this app's own data
 * (sign-in tokens), and the folders that hold keys or control a container
 * engine (.ssh, .docker, Podman's machine keys and sockets). A container that
 * can read those, or write to them, can reach beyond itself.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathsOverlap } from './validate';

export interface HostFolderContext {
  platform: NodeJS.Platform;
  homeDir: string;
  /** The app's user-data folder (sign-in tokens, containers.json). */
  userDataDir: string;
  tmpDir: string;
  env: Record<string, string | undefined>;
}

export interface FolderFs {
  /** Real path, links resolved; throws when the path does not exist. */
  realpath: (p: string) => string;
  isDirectory: (p: string) => boolean;
}

const realFs: FolderFs = {
  realpath: (p) => fs.realpathSync.native(p),
  isDirectory: (p) => fs.statSync(p).isDirectory(),
};

export function hostFolderContext(userDataDir: string): HostFolderContext {
  return { platform: process.platform, homeDir: os.homedir(), userDataDir, tmpDir: os.tmpdir(), env: process.env };
}

/** Folders that may not be mounted, nor any folder that holds them or lies inside them. */
export function protectedFolders(ctx: HostFolderContext): string[] {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const home = (...parts: string[]) => p.join(ctx.homeDir, ...parts);
  const list = [
    ctx.userDataDir,
    home('.ssh'),
    home('.gnupg'),
    home('.docker'),
    home('.kube'),
    home('.config', 'containers'),
    home('.local', 'share', 'containers'),
    // Podman on macOS keeps its machine's API socket here.
    p.join(ctx.tmpDir, 'podman'),
  ];
  if (ctx.platform === 'win32') {
    const e = ctx.env;
    list.push(
      e.SystemRoot || e.windir || 'C:\\Windows',
      e.ProgramFiles || 'C:\\Program Files',
      e['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      e.ProgramData || 'C:\\ProgramData'
    );
  } else {
    list.push(
      '/etc', '/proc', '/sys', '/dev', '/boot', '/run', '/var/run', '/var/lib', '/usr', '/bin', '/sbin', '/lib', '/lib64',
      '/System', '/Library', '/private/etc', '/private/var/run', '/private/var/db'
    );
    if (ctx.env.XDG_RUNTIME_DIR) list.push(ctx.env.XDG_RUNTIME_DIR);
  }
  return list.filter(Boolean);
}

export type HostFolderCheck = { ok: true; path: string } | { ok: false; reason: string };

/** Checks a folder (syntax already checked by readHostPath) and returns its real path. */
export function checkHostFolder(folder: string, ctx: HostFolderContext, fsImpl: FolderFs = realFs): HostFolderCheck {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const foldCase = ctx.platform === 'win32' || ctx.platform === 'darwin';
  let real: string;
  try {
    real = fsImpl.realpath(folder);
  } catch {
    return { ok: false, reason: `${folder} does not exist.` };
  }
  try {
    if (!fsImpl.isDirectory(real)) return { ok: false, reason: `${folder} is a file, not a folder.` };
  } catch {
    return { ok: false, reason: `${folder} cannot be read.` };
  }
  if (ctx.platform === 'win32' && real.startsWith('\\\\')) {
    return { ok: false, reason: `${folder} is on a network share. Choose a folder on a local drive.` };
  }
  if (p.parse(real).root.toLowerCase() === real.toLowerCase()) {
    return { ok: false, reason: `${real} is a whole drive. Choose a folder that holds only the data the container needs.` };
  }
  const cmp = (s: string) => (foldCase ? s.toLowerCase() : s);
  for (const guarded of protectedFolders(ctx)) {
    if (!pathsOverlap(real, guarded, p, foldCase)) continue;
    const rel = p.relative(cmp(real), cmp(guarded));
    const why = rel === '' ? 'is a protected folder' : rel.split(p.sep)[0] !== '..' ? `holds ${guarded}` : `is inside ${guarded}`;
    return {
      ok: false,
      reason:
        `${real} can't be mounted: it ${why}. System folders, keys, container-engine settings and this app's ` +
        'sign-in data stay out of containers. Choose a folder that holds only the data the container needs.',
    };
  }
  return { ok: true, path: real };
}
