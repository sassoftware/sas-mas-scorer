// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Input checks for the container IPC. Pure functions, no I/O.
 *
 * Image references follow a strict subset of the distribution grammar: the
 * registry host is always explicit (no implicit Docker Hub), nothing may start
 * with '-', and no whitespace, control or bidi characters get through to argv
 * or to a native dialog.
 */

import path from 'node:path';
import type { EngineChoice, EnvVar, FolderMount, RunOptions } from './types';

export interface ImageRef {
  host: string;
  /** Repository path below the host, e.g. library/gb_test_risk. */
  repo: string;
  tag: string | null;
  digest: string | null;
  /** host/repo[:tag][@digest], with ':latest' added when neither was given. */
  normalized: string;
}

/** C0/C1 controls and the Unicode bidi overrides/isolates and marks. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
// A dotted name, localhost or a bracketed IPv6 address, each with an optional
// port; or a single-label name with a port (registry:5000), as Docker reads it.
const HOST_RE = new RegExp(
  `^(?:(?:localhost|${HOST_LABEL}(?:\\.${HOST_LABEL})+|\\[[0-9a-f:]+\\])(?::(\\d{1,5}))?|${HOST_LABEL}:(\\d{1,5}))$`,
  'i'
);
const PATH_COMPONENT_RE = /^[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

export function hasUnsafeChars(value: string): boolean {
  return UNSAFE_CHARS.test(value);
}

export function parseImageRef(input: unknown): ImageRef {
  if (typeof input !== 'string') throw new Error('The image reference must be text.');
  const ref = input.trim();
  if (!ref) throw new Error('Enter an image reference.');
  if (ref.length > 512) throw new Error('The image reference is too long.');
  if (/\s/.test(ref) || hasUnsafeChars(ref)) throw new Error('The image reference may not contain spaces or control characters.');
  if (ref.startsWith('-')) throw new Error('The image reference may not start with "-".');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) throw new Error('Leave out the scheme: use host/repository:tag, not a URL.');

  let rest = ref;
  let digest: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!DIGEST_RE.test(digest)) throw new Error('The digest must be sha256: followed by 64 lowercase hex characters.');
  }

  const slash = rest.indexOf('/');
  if (slash < 0) {
    throw new Error('Include the registry host, e.g. registry.example.com/library/model:latest. Docker Hub is never assumed.');
  }
  const host = rest.slice(0, slash);
  let path = rest.slice(slash + 1);
  const hostMatch = HOST_RE.exec(host);
  if (!hostMatch) {
    throw new Error(`"${host}" is not a registry host. Include the host, e.g. registry.example.com/library/model:latest.`);
  }
  const port = hostMatch[1] ?? hostMatch[2];
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new Error('The registry port is out of range.');

  let tag: string | null = null;
  const lastColon = path.lastIndexOf(':');
  if (lastColon >= 0) {
    tag = path.slice(lastColon + 1);
    path = path.slice(0, lastColon);
    if (!TAG_RE.test(tag)) throw new Error(`"${tag}" is not a valid tag.`);
  }
  if (!path) throw new Error('The repository name is missing.');
  for (const component of path.split('/')) {
    if (!PATH_COMPONENT_RE.test(component)) {
      throw new Error(`"${component}" is not a valid repository name part (lowercase letters, digits, '.', '_', '-').`);
    }
  }
  if (!tag && !digest) tag = 'latest';

  const normalized = `${host.toLowerCase()}/${path}${tag ? `:${tag}` : ''}${digest ? `@${digest}` : ''}`;
  return { host: host.toLowerCase(), repo: path, tag, digest, normalized };
}

export const RUN_LIMITS = {
  cpus: { min: 0.5, max: 16 },
  memoryMb: { min: 512, max: 32768 },
  displayName: { max: 60 },
  // The whole command line stays well under Windows' 32,767 characters.
  env: { count: 50, name: 128, value: 4096, total: 16384 },
  mounts: { count: 5, hostPath: 1024, containerPath: 200 },
} as const;

/** Set by the app itself: Mode sets the first; the second is the score address the app reads from the image. */
export const RESERVED_ENV: Record<string, string> = {
  SAS_SCR_REST_API_TYPE: 'SAS_SCR_REST_API_TYPE is set by Mode.',
  SAS_SCR_APP_PATH:
    "SAS_SCR_APP_PATH sets the model's score address, which the app reads from the image, so it can't be changed here.",
};

// Letters, digits, _ and dots: SCR logger variables have dotted names (SAS_SCR_LOG_LEVEL_App.tk.MAS).
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

function readEnv(value: unknown): EnvVar[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Invalid environment variables.');
  if (value.length > RUN_LIMITS.env.count) throw new Error(`At most ${RUN_LIMITS.env.count} environment variables.`);
  const seen = new Set<string>();
  let total = 0;
  return value.map((item): EnvVar => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid environment variable.');
    if (Object.keys(item).some((k) => k !== 'name' && k !== 'value')) throw new Error('Invalid environment variable.');
    const { name, value: v } = item as { name?: unknown; value?: unknown };
    if (typeof name !== 'string' || !name) throw new Error('An environment variable has no name.');
    if (name.length > RUN_LIMITS.env.name || !ENV_NAME_RE.test(name)) {
      throw new Error(`"${name.slice(0, 40)}" is not a valid variable name (letters, digits, _ and ., starting with a letter or _).`);
    }
    if (Object.prototype.hasOwnProperty.call(RESERVED_ENV, name)) throw new Error(RESERVED_ENV[name]);
    if (seen.has(name)) throw new Error(`${name} is set twice.`);
    seen.add(name);
    if (typeof v !== 'string') throw new Error(`The value of ${name} must be text.`);
    if (v.length > RUN_LIMITS.env.value) throw new Error(`The value of ${name} is longer than ${RUN_LIMITS.env.value} characters.`);
    if (hasUnsafeChars(v)) throw new Error(`The value of ${name} may not contain line breaks, tabs or control characters.`);
    total += name.length + v.length + 1;
    if (total > RUN_LIMITS.env.total) throw new Error('The environment variables are too long together.');
    return { name, value: v };
  });
}

/**
 * Inside the container these paths are, hold or sit below the system, the
 * runtime itself (SCR lives in /opt/scr) or the app's tmpfs (/tmp). A folder
 * bound there would break the container or cover the kernel's file systems.
 */
export const PROTECTED_CONTAINER_PATHS = [
  '/proc', '/sys', '/dev', '/etc', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/usr', '/boot', '/run', '/var/run',
  '/tmp', '/opt/scr',
];

const CONTAINER_PATH_RE = /^(?:\/[A-Za-z0-9_@+][A-Za-z0-9._@+-]*)+$/;

/** Whether two absolute paths are the same, or one lies inside the other. */
export function pathsOverlap(a: string, b: string, p: path.PlatformPath = path.posix, foldCase = false): boolean {
  const x = foldCase ? a.toLowerCase() : a;
  const y = foldCase ? b.toLowerCase() : b;
  const within = (rel: string) => rel === '' || (rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
  return within(p.relative(x, y)) || within(p.relative(y, x));
}

function readContainerPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter the path inside the container, e.g. /data.');
  const target = value.trim().replace(/\/+$/, '');
  if (!target || target.length > RUN_LIMITS.mounts.containerPath || !CONTAINER_PATH_RE.test(target)) {
    throw new Error(
      `"${value.slice(0, 60)}" is not a usable container path. Start with /, and use letters, digits, '.', '_' and '-' (no spaces, no "..").`
    );
  }
  const hit = PROTECTED_CONTAINER_PATHS.find((p) => pathsOverlap(target, p));
  if (hit) throw new Error(`A folder can't be mounted at ${target}: it would cover or sit inside ${hit}. Use a path such as /data.`);
  return target;
}

/**
 * The syntax of a folder on this computer. Whether it exists and may be
 * shared is checked separately (mounts.ts), because that needs the disk.
 */
export function readHostPath(value: unknown, platform: NodeJS.Platform = process.platform): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Choose a folder on this computer.');
  const raw = value.trim();
  if (raw.length > RUN_LIMITS.mounts.hostPath) throw new Error('The folder path is too long.');
  if (hasUnsafeChars(raw)) throw new Error('The folder path may not contain control characters.');
  // Docker and Podman read --mount as comma-separated fields, and Podman has no quoting for a comma in a path.
  if (raw.includes(',') || raw.includes('"')) {
    throw new Error('Folders with a comma or a quote in their path cannot be mounted. Rename the folder or choose another one.');
  }
  if (platform === 'win32') {
    if (raw.startsWith('\\\\') || raw.startsWith('//')) {
      throw new Error('Network folders (\\\\server\\share) cannot be mounted. Choose a folder on a local drive.');
    }
    if (!/^[A-Za-z]:[\\/]/.test(raw)) throw new Error('Use a full folder path, such as C:\\Users\\me\\data.');
    const normalized = path.win32.normalize(raw);
    return normalized.length > 3 ? normalized.replace(/\\+$/, '') : normalized;
  }
  if (!raw.startsWith('/')) throw new Error('Use a full folder path, starting with /.');
  const normalized = path.posix.normalize(raw);
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function readMounts(value: unknown, platform: NodeJS.Platform): FolderMount[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Invalid folders.');
  if (value.length > RUN_LIMITS.mounts.count) throw new Error(`At most ${RUN_LIMITS.mounts.count} folders.`);
  const targets: string[] = [];
  return value.map((item): FolderMount => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid folder.');
    if (Object.keys(item).some((k) => k !== 'hostPath' && k !== 'containerPath' && k !== 'readOnly')) {
      throw new Error('Invalid folder.');
    }
    const m = item as { hostPath?: unknown; containerPath?: unknown; readOnly?: unknown };
    if (typeof m.readOnly !== 'boolean') throw new Error('Invalid folder: read-only must be true or false.');
    const hostPath = readHostPath(m.hostPath, platform);
    const containerPath = readContainerPath(m.containerPath);
    const clash = targets.find((t) => pathsOverlap(t, containerPath));
    if (clash) {
      throw new Error(clash === containerPath ? `Two folders are mounted at ${clash}.` : `${clash} and ${containerPath} overlap; use separate paths.`);
    }
    targets.push(containerPath);
    return { hostPath, containerPath, readOnly: m.readOnly };
  });
}

/** The run form, checked against a closed schema: unknown keys are rejected, not dropped. */
export function readRunOptions(value: unknown, platform: NodeJS.Platform = process.platform): RunOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run options.');
  const v = value as Record<string, unknown>;
  const allowed = new Set(['displayName', 'cpus', 'memoryMb', 'mode', 'env', 'mounts']);
  for (const key of Object.keys(v)) {
    if (!allowed.has(key)) throw new Error(`Unknown run option "${key}".`);
  }
  const { cpus, memoryMb, mode, displayName } = v;
  if (typeof cpus !== 'number' || !Number.isFinite(cpus) || cpus < RUN_LIMITS.cpus.min || cpus > RUN_LIMITS.cpus.max) {
    throw new Error(`CPUs must be between ${RUN_LIMITS.cpus.min} and ${RUN_LIMITS.cpus.max}.`);
  }
  if (Math.round(cpus * 100) !== cpus * 100) throw new Error('CPUs may have at most two decimals.');
  if (
    typeof memoryMb !== 'number' ||
    !Number.isInteger(memoryMb) ||
    memoryMb < RUN_LIMITS.memoryMb.min ||
    memoryMb > RUN_LIMITS.memoryMb.max
  ) {
    throw new Error(`Memory must be a whole number of MB between ${RUN_LIMITS.memoryMb.min} and ${RUN_LIMITS.memoryMb.max}.`);
  }
  if (mode !== 'SAS' && mode !== 'BATCH') throw new Error('The mode must be SAS or BATCH.');
  let name: string | undefined;
  if (displayName !== undefined) {
    if (typeof displayName !== 'string') throw new Error('The name must be text.');
    const trimmed = displayName.trim();
    if (trimmed.length > RUN_LIMITS.displayName.max) throw new Error(`The name may have at most ${RUN_LIMITS.displayName.max} characters.`);
    if (hasUnsafeChars(trimmed)) throw new Error('The name may not contain control characters.');
    name = trimmed || undefined;
  }
  return { cpus, memoryMb, mode, displayName: name, env: readEnv(v.env), mounts: readMounts(v.mounts, platform) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function readManagedId(value: unknown): string {
  const id = (value as { managedId?: unknown } | null)?.managedId;
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('Invalid container id.');
  return id;
}

export function readOpId(value: unknown): string {
  const id = (value as { opId?: unknown } | null)?.opId;
  if (typeof id !== 'string' || !OP_ID_RE.test(id)) throw new Error('Invalid operation id.');
  return id;
}

export function readEngineChoice(value: unknown): EngineChoice {
  const choice = (value as { choice?: unknown } | null)?.choice;
  if (choice !== 'auto' && choice !== 'podman' && choice !== 'docker') throw new Error('Invalid engine choice.');
  return choice;
}

/** Container name: masscorer-<slug of the repository's last part, ≤30>-<6 hex>. */
export function containerName(repo: string, randomHex: string): string {
  const last = repo.slice(repo.lastIndexOf('/') + 1).toLowerCase();
  const slug = last.replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 30) || 'image';
  return `masscorer-${slug}-${randomHex.slice(0, 6)}`;
}
