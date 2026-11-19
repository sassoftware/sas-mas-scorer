// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Finds the docker/podman CLI and checks the engine behind it.
 *
 * Binaries come from known install locations first, then PATH (a desktop
 * launch on macOS has no shell PATH, and no login shell is started to get
 * one). On Windows only .exe files are considered.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runCli } from './exec';
import {
  dockerContextArgs,
  podmanConnectionsArgs,
  podmanMachineListArgs,
  versionArgs,
} from './argv';
import {
  isDockerDesktop,
  isLocalEngineUri,
  majorVersion,
  parseDockerContextHost,
  parseMachineList,
  parsePodmanDefaultConnection,
  parseVersion,
} from './parse';
import { tail } from './classify';
import type { EngineCandidate, EngineChoice, EngineInfo, EngineKind } from './types';

const KINDS: EngineKind[] = ['podman', 'docker'];

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function knownPaths(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): EngineCandidate[] {
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const list: EngineCandidate[] = [
      { kind: 'podman', binPath: path.win32.join(programFiles, 'RedHat', 'Podman', 'podman.exe') },
    ];
    if (env.LOCALAPPDATA) {
      list.push({ kind: 'podman', binPath: path.win32.join(env.LOCALAPPDATA, 'Programs', 'Podman', 'podman.exe') });
    }
    list.push({ kind: 'docker', binPath: path.win32.join(programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe') });
    return list;
  }
  if (platform === 'darwin') {
    return [
      { kind: 'podman', binPath: '/opt/podman/bin/podman' },
      { kind: 'podman', binPath: '/opt/homebrew/bin/podman' },
      { kind: 'podman', binPath: '/usr/local/bin/podman' },
      { kind: 'docker', binPath: '/Applications/Docker.app/Contents/Resources/bin/docker' },
      { kind: 'docker', binPath: '/opt/homebrew/bin/docker' },
      { kind: 'docker', binPath: '/usr/local/bin/docker' },
    ];
  }
  return [
    { kind: 'podman', binPath: '/usr/bin/podman' },
    { kind: 'podman', binPath: '/usr/local/bin/podman' },
    { kind: 'docker', binPath: '/usr/bin/docker' },
    { kind: 'docker', binPath: '/usr/local/bin/docker' },
  ];
}

function pathCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): EngineCandidate[] {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => d && path.isAbsolute(d));
  const list: EngineCandidate[] = [];
  for (const dir of dirs) {
    for (const kind of KINDS) {
      list.push({ kind, binPath: path.join(dir, platform === 'win32' ? `${kind}.exe` : kind) });
    }
  }
  return list;
}

/** Engine CLIs present on this computer, known locations first, without duplicates. */
export function findCandidates(): EngineCandidate[] {
  const seen = new Set<string>();
  const found: EngineCandidate[] = [];
  for (const candidate of [...knownPaths(), ...pathCandidates(process.platform, process.env)]) {
    if (!isFile(candidate.binPath)) continue;
    let key: string;
    try {
      key = fs.realpathSync(candidate.binPath);
    } catch {
      key = candidate.binPath;
    }
    if (process.platform === 'win32') key = key.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(candidate);
  }
  return found;
}

/** Auto prefers Podman (no licence question, rootless on Linux), then Docker. */
export function pickCandidate(candidates: EngineCandidate[], choice: EngineChoice): EngineCandidate | null {
  if (choice === 'auto') {
    return candidates.find((c) => c.kind === 'podman') ?? candidates.find((c) => c.kind === 'docker') ?? null;
  }
  return candidates.find((c) => c.kind === choice) ?? null;
}

const usesMachine = (kind: EngineKind): boolean => kind === 'podman' && (process.platform === 'win32' || process.platform === 'darwin');

/** Checks that the engine can be used: running, on this computer, new enough. */
export async function probeEngine(candidate: EngineCandidate): Promise<EngineInfo> {
  const { kind, binPath } = candidate;
  const info: EngineInfo = { kind, binPath, state: 'error', warnings: [] };
  const refuse = (message: string): EngineInfo => ({ ...info, state: 'refused', message });

  try {
    if (kind === 'docker') {
      if (process.env.DOCKER_HOST && !isLocalEngineUri(process.env.DOCKER_HOST)) {
        return refuse(`DOCKER_HOST points at an engine on another computer (${process.env.DOCKER_HOST}). Only an engine on this computer is used.`);
      }
      const ctx = await runCli(binPath, dockerContextArgs(), { timeoutMs: 15_000 });
      const host = ctx.code === 0 ? parseDockerContextHost(ctx.stdout) : null;
      if (host && !isLocalEngineUri(host)) {
        return refuse(`The current Docker context uses an engine that is not on this computer (${host}). Only an engine on this computer is used.`);
      }
    } else {
      if (process.env.CONTAINER_HOST && !isLocalEngineUri(process.env.CONTAINER_HOST)) {
        return refuse(`CONTAINER_HOST points at an engine on another computer (${process.env.CONTAINER_HOST}). Only an engine on this computer is used.`);
      }
      if (usesMachine(kind)) {
        const ml = await runCli(binPath, podmanMachineListArgs(), { timeoutMs: 20_000 });
        const machines = ml.code === 0 ? parseMachineList(ml.stdout) : [];
        const machine = machines.find((m) => m.isDefault) ?? machines[0];
        if (!machine) {
          return {
            ...info,
            state: 'not-running',
            message: 'Podman has no machine yet. Create one in a terminal with: podman machine init',
          };
        }
        info.machine = { name: machine.name, running: machine.running };
        if (!machine.running) {
          return { ...info, state: 'machine-stopped', message: `The Podman machine "${machine.name}" is not running.` };
        }
      }
      const conn = await runCli(binPath, podmanConnectionsArgs(), { timeoutMs: 15_000 });
      const uri = conn.code === 0 ? parsePodmanDefaultConnection(conn.stdout) : null;
      if (uri && !isLocalEngineUri(uri)) {
        return refuse(`Podman's default connection is to another computer (${uri}). Only an engine on this computer is used.`);
      }
    }

    const ver = await runCli(binPath, versionArgs(), { timeoutMs: 30_000 });
    const facts = parseVersion(ver.stdout);
    info.clientVersion = facts.clientVersion;
    info.serverVersion = facts.serverVersion;
    info.arch = facts.arch;
    if (!facts.serverReachable) {
      const why = tail(ver.stderr, 2);
      const message =
        kind === 'docker' && process.platform !== 'linux'
          ? 'The Docker engine is not running. Start Docker Desktop, or whatever runs your engine (for example Colima), then check again.'
          : `The ${kind} engine did not answer.${why ? ` ${why}` : ''}`;
      return { ...info, state: 'not-running', message };
    }
    if (facts.os && facts.os !== 'linux') {
      return refuse(`The engine runs ${facts.os} containers. SCR images need Linux containers.`);
    }
    if (kind === 'docker' && process.platform === 'linux') {
      const major = majorVersion(facts.serverVersion);
      if (major !== null && major < 28) {
        return refuse(
          `Docker Engine ${facts.serverVersion} is older than 28.0. Before 28.0, other computers on the local network could reach ports published on 127.0.0.1. Update Docker Engine.`
        );
      }
    }
    if (kind === 'docker' && isDockerDesktop(facts.platformName)) {
      info.warnings.push('Docker Desktop needs a paid subscription for larger organisations. Check your licence.');
    }
    if (!facts.arch) info.warnings.push('The engine did not report its CPU architecture, so emulation cannot be detected.');
    return { ...info, state: 'ready' };
  } catch (err) {
    return { ...info, state: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
