// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Argument lists for the engine CLI. Pure: no I/O, every value already
 * validated. The same lists work for docker and podman.
 *
 * run never emits --privileged, --network host, --pid, --ipc, --uts, -v,
 * --volume, --device, --cap-add, --user, or a -p that is not bound to
 * 127.0.0.1 (see FORBIDDEN_RUN_FLAGS and the tests). Folders are bound only
 * as --mount=type=bind,source=<checked folder>,target=<checked path>, and
 * variables only as one --env=NAME=value token each, so no value can be read
 * as another flag.
 */

import type { EngineKind, EnvVar, FolderMount, ImageKind } from './types';

export const LABEL_MANAGED = 'com.sas.masscorer.managed';
export const LABEL_INSTALL = 'com.sas.masscorer.install';

/** SCR listens on 8080 (ExposedPorts is empty in SCR images, so it is assumed). */
export const CONTAINER_PORT = 8080;

export const FORBIDDEN_RUN_FLAGS = [
  '--privileged',
  '--network',
  '--net',
  '--pid',
  '--ipc',
  '--uts',
  '-v',
  '--volume',
  '--volumes-from',
  '--env-file',
  '--device',
  '--cap-add',
  '-u',
  '--user',
  '-P',
  '--publish-all',
];

export interface RunSpec {
  name: string;
  installId: string;
  /** host/repo@sha256:… or an image ID. */
  image: string;
  /** e.g. linux/amd64: the image's own platform, so the engine neither warns nor fetches another one. */
  platform: string;
  hostPort: number;
  kind: ImageKind;
  cpus: number;
  memoryMb: number;
  mode: 'SAS' | 'BATCH';
  env: EnvVar[];
  mounts: FolderMount[];
}

/** A bind mount in --mount syntax; the paths were checked to hold no comma. */
export const mountValue = (m: FolderMount): string =>
  `type=bind,source=${m.hostPath},target=${m.containerPath}${m.readOnly ? ',readonly' : ''}`;

export const versionArgs = (): string[] => ['version', '--format', 'json'];

export const pullArgs = (ref: string, platform?: string): string[] =>
  platform ? ['pull', '--platform', platform, ref] : ['pull', ref];

export const imageInspectArgs = (ref: string): string[] => ['image', 'inspect', ref];

export function runArgs(spec: RunSpec): string[] {
  const args = [
    'run',
    '-d',
    '--name', spec.name,
    '--label', `${LABEL_MANAGED}=1`,
    '--label', `${LABEL_INSTALL}=${spec.installId}`,
    // Loopback only: there is no option to publish on other interfaces.
    '-p', `127.0.0.1:${spec.hostPort}:${CONTAINER_PORT}`,
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    // SCR needs a writable /tmp. Podman adds one under --read-only by itself,
    // Docker does not, so it is always passed.
    '--tmpfs', '/tmp:rw,size=256m',
    '--pids-limit', '512',
    '--memory', `${spec.memoryMb}m`,
    '--cpus', String(spec.cpus),
    '--restart', 'no',
    '--platform', spec.platform,
  ];
  if (spec.kind === 'scr') {
    // Python model images unzip their model at start-up, so only SCR (Java)
    // images get a read-only root file system.
    args.push('--read-only', '-e', `SAS_SCR_REST_API_TYPE=${spec.mode}`);
  }
  for (const m of spec.mounts) args.push(`--mount=${mountValue(m)}`);
  for (const e of spec.env) args.push(`--env=${e.name}=${e.value}`);
  args.push(spec.image);
  return args;
}

export const containerInspectArgs = (id: string): string[] => ['container', 'inspect', id];

/** One reading per container, one JSON object per line. Podman gives raw numbers, Docker formatted text. */
export const statsArgs = (ids: string[]): string[] => ['stats', '--no-stream', '--format', '{{json .}}', ...ids];

/** The engine host's CPUs and memory (Podman: host.cpus/memTotal/memFree; Docker: NCPU/MemTotal). */
export const infoArgs = (kind: EngineKind): string[] =>
  kind === 'podman' ? ['info', '--format', 'json'] : ['info', '--format', '{{json .}}'];

export const listArgs = (installId: string): string[] => [
  'ps', '-a', '--filter', `label=${LABEL_INSTALL}=${installId}`, '--format', 'json',
];

export const startArgs = (id: string): string[] => ['start', id];

/** SCR ignores SIGTERM (measured), so waiting longer only delays the kill. */
export const stopArgs = (id: string): string[] => ['stop', '-t', '2', id];

export const removeArgs = (id: string): string[] => ['rm', '-f', id];

export const logsArgs = (id: string, tail: number): string[] => ['logs', '--tail', String(tail), '--timestamps', id];

/** The log from the start, for lines written once at start-up (the caller stops reading when it has what it needs). */
export const logsFromStartArgs = (id: string): string[] => ['logs', id];

/**
 * Podman only: prints the user name stored for a registry, or fails when there
 * is none. It reads no secret and signs nothing in; the app never runs any
 * other form of `login`.
 */
export const podmanLoginStatusArgs = (host: string): string[] => ['login', '--get-login', host];

export const podmanMachineListArgs = (): string[] => ['machine', 'list', '--format', 'json'];

export const podmanMachineStartArgs = (name: string): string[] => ['machine', 'start', name];

export const podmanConnectionsArgs = (): string[] => ['system', 'connection', 'list', '--format', 'json'];

export const dockerContextArgs = (): string[] => ['context', 'inspect'];

/** The image's manifest (or index) from the registry, with the engine's own sign-in. Nothing is pulled. */
export const manifestInspectArgs = (ref: string): string[] => ['manifest', 'inspect', ref];

const MACHINE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const STORE_PATH_RE = /^\/[A-Za-z0-9._/-]+$/;

/**
 * Inside the Podman machine: prints the default-route interface's line of
 * /proc/net/dev once a second. It stops when nobody reads it any more (grep
 * fails on the closed pipe) and after two hours at the latest.
 */
export const NET_COUNTER_SCRIPT =
  'dev=$(awk \'$2=="00000000"{print $1; exit}\' /proc/net/route); i=0; ' +
  'while [ "$i" -lt 7200 ] && grep "^ *$dev:" /proc/net/dev; do i=$((i+1)); sleep 1; done';

/** Podman machine only: runs one of the fixed scripts above inside the machine (one argument; ssh joins words). */
export function machineSshArgs(machine: string, script: string): string[] {
  if (!MACHINE_NAME_RE.test(machine)) throw new Error('Unexpected Podman machine name.');
  return ['machine', 'ssh', machine, script];
}

/** Inside the Podman machine: lists the compressed layer digests from Podman's layer store files. */
export function layerDigestsScript(files: string[]): string {
  for (const f of files) {
    if (!STORE_PATH_RE.test(f) || f.split('/').includes('..')) throw new Error('Unexpected Podman storage path.');
  }
  return `cat ${files.map((f) => `'${f}'`).join(' ')} 2>/dev/null | grep -o '"compressed-diff-digest":"sha256:[0-9a-f]*"'`;
}
