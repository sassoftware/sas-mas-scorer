// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The only place the app starts a child process.
 *
 * The container engine CLI is run directly: an argument array, no shell, an
 * absolute binary path, and on Windows only a real .exe (a .cmd/.bat would go
 * through cmd.exe, CVE-2024-27980). Output is capped and the process is killed
 * on timeout or cancel.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ExecOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Per stream; the rest is dropped and `truncated` set. */
  maxBytes?: number;
  /** Called for each complete output line, in arrival order across both streams. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface ExecResult {
  /** Exit code; -1 when the process could not be started or was killed. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export function assertRunnable(binPath: string): void {
  if (!path.isAbsolute(binPath)) throw new Error('The container engine path must be absolute.');
  if (process.platform === 'win32' && path.extname(binPath).toLowerCase() !== '.exe') {
    throw new Error('On Windows only .exe files are run as the container engine.');
  }
}

let cachedEnv: NodeJS.ProcessEnv | undefined;

/**
 * The environment for engine CLIs: English, unlocalised messages (errors are
 * classified by their text). On Windows, Windows' own OpenSSH also goes first
 * on PATH: `podman machine ssh` runs `ssh` with its known-hosts file set to
 * NUL, and Git's ssh.exe (when Git's Unix tools are on PATH) writes that as a
 * file named NUL into the working folder, where Windows' OpenSSH reads it as
 * the null device.
 */
export function childEnv(): NodeJS.ProcessEnv {
  if (cachedEnv) return cachedEnv;
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };
  if (process.platform === 'win32') {
    const openSsh = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH');
    if (fs.existsSync(path.win32.join(openSsh, 'ssh.exe'))) {
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path';
      env[key] = env[key] ? `${openSsh};${env[key]}` : openSsh;
    }
  }
  cachedEnv = env;
  return env;
}

/** Engine commands still running, so that quitting the app can end them. */
const running = new Set<ChildProcess>();

/** Ends every engine command still running (on quit). Returns how many there were. */
export function stopAllCli(): number {
  const count = running.size;
  for (const child of running) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  running.clear();
  return count;
}

export function runCli(binPath: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  assertRunnable(binPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return new Promise((resolve) => {
    const result: ExecResult = { code: -1, stdout: '', stderr: '', timedOut: false, aborted: false, truncated: false };
    if (options.signal?.aborted) {
      result.aborted = true;
      resolve(result);
      return;
    }

    const child = spawn(binPath, args, {
      shell: false,
      windowsHide: true,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.add(child);

    const sizes = { stdout: 0, stderr: 0 };
    const partial = { stdout: '', stderr: '' };
    const collect = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (sizes[stream] < maxBytes) {
        const room = maxBytes - sizes[stream];
        const kept = text.length > room ? text.slice(0, room) : text;
        if (kept.length < text.length) result.truncated = true;
        result[stream] += kept;
        sizes[stream] += kept.length;
      } else {
        result.truncated = true;
      }
      if (options.onLine) {
        const lines = (partial[stream] + text).split(/\r?\n|\r/);
        partial[stream] = lines.pop() ?? '';
        for (const line of lines) if (line) options.onLine(line, stream);
      }
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      running.delete(child);
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.onLine) {
        for (const stream of ['stdout', 'stderr'] as const) {
          if (partial[stream]) options.onLine(partial[stream], stream);
        }
      }
      result.code = code;
      resolve(result);
    };

    const kill = () => {
      if (child.exitCode === null && !child.killed) child.kill();
    };
    const timer = setTimeout(() => {
      result.timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => {
      result.aborted = true;
      kill();
    };
    options.signal?.addEventListener('abort', onAbort);

    child.on('error', (err) => {
      result.stderr += (result.stderr ? '\n' : '') + err.message;
      finish(-1);
    });
    child.on('close', (code) => finish(result.timedOut || result.aborted ? -1 : code ?? -1));
  });
}
